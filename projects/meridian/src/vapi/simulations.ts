/**
 * Meridian — Phase 5 Simulation Suite.
 *
 * Creates (or upserts) 10 Vapi Evals covering the full Meridian squad flow.
 * Pass RUN=1 to also execute all evals and print a pass/fail summary.
 *
 *   npm run simulations               # create/update evals
 *   RUN=1 npm run simulations         # create + run all
 */
import type { Vapi } from "@vapi-ai/server-sdk";
import { vapi } from "../config.js";
import { header, pretty } from "../utils/print.js";

header("Meridian — Phase 5 Simulation Suite");

// Resolve assistant ids by name from the live org (create the assistants first — see README).
const allAssistants = await vapi.assistants.list({ limit: 100 });
function idByName(name: string): string {
  const matches = allAssistants.filter((a) => a.name === name);
  if (matches.length === 0) throw new Error(`Assistant not found: "${name}" — create the assistants first (see README).`);
  if (matches.length > 1) throw new Error(`Ambiguous: ${matches.length} assistants named "${name}" — delete the stale duplicate(s).`);
  return matches[0].id;
}
const IDS = {
  concierge: idByName("Meridian — Concierge"),
  hotel:     idByName("Meridian — Hotel Concierge (Jack)"),
  triage:    idByName("Meridian — Flight Triage"),
  rebooking: idByName("Meridian — Rebooking"),
  upsell:    idByName("Meridian — Upsell & Recovery"),
};

// ── Judge helpers ─────────────────────────────────────────────────────────────

function aiJudge(criteria: string): Vapi.ChatEvalAssistantMessageEvaluationJudgePlan {
  return {
    type: "ai",
    model: {
      provider: "openai",
      model: "gpt-4o-mini",
      temperature: 0,
      maxTokens: 50,
      messages: [
        {
          role: "system",
          content: `You are evaluating an AI voice assistant. ${criteria}\n\nConversation so far:\n{{messages}}\n\nRespond with exactly "pass" or "fail".`,
        },
      ],
    } as Vapi.AssistantMessageJudgePlanAiModel,
  };
}

// ── Message helpers ───────────────────────────────────────────────────────────

type Msg = Vapi.CreateEvalDtoMessagesItem;

const u = (content: string): Msg =>
  ({ role: "user", content }) as Vapi.ChatEvalUserMessageMock;

const a = (content: string, toolCalls?: Vapi.ChatEvalAssistantMessageMockToolCall[]): Msg =>
  ({ role: "assistant", content, toolCalls }) as Vapi.ChatEvalAssistantMessageMock;

const t = (content: string): Msg =>
  ({ role: "tool", content }) as Vapi.ChatEvalToolResponseMessageMock;

const check = (criteria: string, exitOnFailure = false): Msg =>
  ({
    role: "assistant",
    judgePlan: aiJudge(criteria),
    continuePlan: exitOnFailure ? { exitOnFailureEnabled: true } : undefined,
  }) as Vapi.ChatEvalAssistantMessageEvaluation;

// ── Scenario definitions ──────────────────────────────────────────────────────

type Spec = {
  eval: Vapi.CreateEvalDto;
  target: Vapi.CreateEvalRunDtoTarget;
};

const SCENARIOS: Spec[] = [

  // 01 — Concierge routes hotel request
  {
    eval: {
      name: "01-hotel-routing",
      description: "Caller states a hotel need on the first turn. Concierge must call transferCall to Hotel Concierge.",
      type: "chat.mockConversation",
      messages: [
        u("Hi, I need help with my hotel reservation."),
        check(
          "The assistant should call the transferCall function to route to the Hotel Concierge. Pass if transferCall was called to a hotel destination. Fail if no transfer was made or if the assistant asked 'hotel or flight?'.",
          true
        ),
      ],
    },
    target: { type: "assistant", assistantId: IDS.concierge },
  },

  // 02 — Concierge routes flight request
  {
    eval: {
      name: "02-flight-routing",
      description: "Caller states a flight need. Concierge must call transferCall to Flight Triage.",
      type: "chat.mockConversation",
      messages: [
        u("I need to check on my flight status."),
        check(
          "The assistant should call transferCall to route to the Flight Triage desk. Pass if transferCall was called to a flight destination. Fail if no transfer was made.",
          true
        ),
      ],
    },
    target: { type: "assistant", assistantId: IDS.concierge },
  },

  // 03 — Explicit transfer request is immediate
  {
    eval: {
      name: "03-explicit-transfer-immediate",
      description: "Caller explicitly says 'transfer me to the flight desk'. Concierge must comply on the first turn without asking questions.",
      type: "chat.mockConversation",
      messages: [
        u("Transfer me to the flight desk, please."),
        check(
          "The caller explicitly requested a transfer. The assistant must call transferCall immediately with no clarifying questions. Pass if transferCall was called on the first turn. Fail if the assistant asked any questions or added commentary.",
          true
        ),
      ],
    },
    target: { type: "assistant", assistantId: IDS.concierge },
  },

  // 04 — Name-first greeting doesn't trigger double-ask
  {
    eval: {
      name: "04-name-first-no-double-ask",
      description: "Caller gives their name first, then states hotel need. Concierge must NOT ask 'hotel or flight?' again.",
      type: "chat.mockConversation",
      messages: [
        u("Hi, my name is Sarah."),
        a("Hi Sarah! How can I help you today?"),
        u("I need help with my hotel stay."),
        check(
          "The caller has already stated they need hotel help. The assistant should call transferCall to Hotel Concierge without asking 'Is this about your hotel stay or a flight?' or any similar question. Pass if transferCall was called to a hotel destination without re-asking. Fail if the assistant re-asked the routing question."
        ),
      ],
    },
    target: { type: "assistant", assistantId: IDS.concierge },
  },

  // 05 — Hotel: reservation lookup by name
  {
    eval: {
      name: "05-hotel-lookup-by-name",
      description: "Hotel concierge calls lookup_reservation when caller gives their name.",
      type: "chat.mockConversation",
      messages: [
        u("My name is Emily Chen."),
        check(
          "The hotel concierge should call the lookup_reservation tool with the caller's name. Pass if lookup_reservation was called (with any arguments). Fail if the tool was not called or the assistant asked for a confirmation number first."
        ),
      ],
    },
    target: { type: "assistant", assistantId: IDS.hotel },
  },

  // 06 — Hotel: service request (towels)
  {
    eval: {
      name: "06-hotel-service-request-towels",
      description: "Hotel concierge calls handle_service_request when guest asks for extra towels.",
      type: "chat.mockConversation",
      messages: [
        u("Hi, I'm Emily Chen, room 412."),
        a("Hello Emily! Let me look up your reservation.", [
          { name: "lookup_reservation", arguments: { name: "Emily Chen" } },
        ]),
        t(JSON.stringify({ name: "Emily Chen", room: "412", confirmationNumber: "MC123456", checkIn: "2026-06-23", checkOut: "2026-06-26", loyaltyTier: "silver" })),
        a("Welcome back, Emily! I have your reservation at Room 412. How can I help you today?"),
        u("I need extra towels please."),
        check(
          "The guest requested extra towels. The hotel concierge should call handle_service_request with a requestType like 'extra towels'. Pass if handle_service_request was called. Fail if the tool was not called.",
          true
        ),
      ],
    },
    target: { type: "assistant", assistantId: IDS.hotel },
  },

  // 07 — Hotel: knowledge base query (pool hours)
  {
    eval: {
      name: "07-hotel-kb-amenity-hours",
      description: "Hotel concierge queries the knowledge base when asked about amenity hours.",
      type: "chat.mockConversation",
      messages: [
        u("Hi I'm David Lee."),
        a("Hello David! Let me pull up your reservation.", [
          { name: "lookup_reservation", arguments: { name: "David Lee" } },
        ]),
        t(JSON.stringify({ name: "David Lee", room: "208", confirmationNumber: "MC789012", loyaltyTier: "standard" })),
        a("Hi David! I have your reservation at Room 208. What can I help you with?"),
        u("What time does the pool close tonight?"),
        check(
          "The guest asked about pool hours. The hotel concierge should query the hotel-knowledge-base tool (a query tool) rather than answering from memory. Pass if a knowledge base query tool was called. Fail if the assistant answered without calling the knowledge base tool."
        ),
      ],
    },
    target: { type: "assistant", assistantId: IDS.hotel },
  },

  // 08 — Flight triage: status check
  {
    eval: {
      name: "08-flight-status-check",
      description: "Flight triage calls get_flight_status when caller asks about a specific flight.",
      type: "chat.mockConversation",
      messages: [
        u("Can you check if flight UA482 is on time?"),
        check(
          "The caller asked about flight UA482. The flight triage assistant should call get_flight_status with flightNumber 'UA482'. Pass if get_flight_status was called. Fail if the tool was not called or was called with a different flight number.",
          true
        ),
      ],
    },
    target: { type: "assistant", assistantId: IDS.triage },
  },

  // 09 — Flight triage → rebooking on cancellation
  {
    eval: {
      name: "09-flight-cancelled-routes-to-rebooking",
      description: "Flight triage calls transferCall to rebooking after confirming a cancellation.",
      type: "chat.mockConversation",
      messages: [
        u("Hi I'm Marcus Lee, I'm on flight UA482."),
        a("Let me check that flight for you, Marcus.", [
          { name: "get_flight_status", arguments: { flightNumber: "UA482", name: "Marcus Lee" } },
        ]),
        t(JSON.stringify({ flightNumber: "UA482", status: "cancelled", delayMinutes: null, recommendRebook: true, origin: "LAX", destination: "MIA" })),
        a("I'm sorry Marcus — flight UA482 has been cancelled. I'll get you on the next available flight right away."),
        check(
          "The flight was cancelled. The flight triage assistant should call transferCall to route the caller to the Rebooking specialist. Pass if transferCall was called to a rebooking destination. Fail if no transfer was made.",
          true
        ),
      ],
    },
    target: { type: "assistant", assistantId: IDS.triage },
  },

  // 10 — Cabin upgrade routes to flight, not hotel
  {
    eval: {
      name: "10-cabin-upgrade-routes-to-flight",
      description: "Caller asks for a cabin upgrade. Concierge must route to flight (not hotel or upsell).",
      type: "chat.mockConversation",
      messages: [
        u("I'd like to upgrade my seat to business class on my upcoming flight."),
        check(
          "The caller wants a flight cabin upgrade. The concierge should call transferCall to the Flight Triage desk, not to the Hotel Concierge and not to Upsell & Recovery. Pass if transferCall was called to a flight-related destination. Fail if the transfer went to hotel, upsell, or if no transfer was made.",
          true
        ),
      ],
    },
    target: { type: "assistant", assistantId: IDS.concierge },
  },

  // 11 — Concierge routes on a bare one-word "flight" answer
  {
    eval: {
      name: "11-oneword-flight-routes",
      description: "After the open greeting, the caller answers only 'flight'. Concierge must transfer to Flight Triage without re-asking.",
      type: "chat.mockConversation",
      messages: [
        a("Thanks for calling Meridian, this is Aria. How can I help you today — is it about your flight, your hotel, or both?"),
        u("Flight."),
        check(
          "The caller answered 'flight'. The concierge must treat this one-word answer as clear intent and call transferCall to the Flight Triage desk. Pass if transferCall was called to a flight destination. Fail if the assistant re-asked, asked for clarification, or made no transfer.",
          true
        ),
      ],
    },
    target: { type: "assistant", assistantId: IDS.concierge },
  },

  // 12 — Concierge handles "both" by starting with flight
  {
    eval: {
      name: "12-both-routes-to-flight",
      description: "Caller says they have both a flight and hotel issue. Concierge must transfer to Flight Triage (the agreed first hop).",
      type: "chat.mockConversation",
      messages: [
        a("Thanks for calling Meridian, this is Aria. How can I help you today — is it about your flight, your hotel, or both?"),
        u("Honestly both — my flight got delayed and I also need to sort out my hotel room."),
        check(
          "The caller has BOTH a flight and a hotel matter. The concierge should acknowledge and transfer to the Flight Triage desk first (not the hotel). Pass if transferCall was called to a flight destination. Fail if it transferred to hotel first or made no transfer.",
          true
        ),
      ],
    },
    target: { type: "assistant", assistantId: IDS.concierge },
  },

  // 13 — Member care: a ROOM UPGRADE must NOT trigger a travel credit
  {
    eval: {
      name: "13-upgrade-not-credit",
      description: "Caller asks for a room upgrade. Sophie must use request_room_upgrade and must NOT offer or issue a travel credit.",
      type: "chat.mockConversation",
      messages: [
        u("Hi, I'm checking in later today and I'd love to upgrade to a nicer room."),
        check(
          "This is a ROOM UPGRADE request, not a disruption. The member-care assistant should call request_room_upgrade. It must NOT call issue_travel_credit and must NOT offer or mention a travel credit. Pass only if request_room_upgrade was called and no travel credit was offered or issued. Fail if a travel credit was mentioned, offered, or issued.",
          true
        ),
      ],
    },
    target: { type: "assistant", assistantId: IDS.upsell },
  },

  // 14 — Member care: answer the upgrade COST, don't auto-confirm
  {
    eval: {
      name: "14-upgrade-price-not-confirmed",
      description: "After an upgrade offer, the caller asks the cost. Sophie must restate the price and NOT claim the upgrade is confirmed.",
      type: "chat.mockConversation",
      messages: [
        u("I'd like to upgrade my room."),
        a("Let me pull up an option for you.", [
          { name: "request_room_upgrade", arguments: { name: "Emily Chen" } },
        ]),
        t(JSON.stringify({ offered: true, toRoom: "a Junior Suite", message: "I can offer you an upgrade to a Junior Suite for ninety dollars a night. Would you like me to put in the request?" })),
        a("I can offer you an upgrade to a Junior Suite for ninety dollars a night. Would you like me to put in the request?"),
        u("Wait, how much did you say it costs?"),
        check(
          "The guest asked the cost. The assistant should restate the nightly price (ninety dollars a night) in words and ask if they'd like to proceed. It must NOT claim the upgrade is confirmed, done, booked, or charged. Pass if it gives the price and does not claim confirmation. Fail if it claims the upgrade is confirmed/done or fails to give the price."
        ),
      ],
    },
    target: { type: "assistant", assistantId: IDS.upsell },
  },

  // 15 — Member care: travel credit is framed as a PENDING request (no $, not applied)
  {
    eval: {
      name: "15-credit-is-pending-request",
      description: "On a confirmed cancellation, Sophie submits a travel-credit request and frames it as pending review — never a dollar amount or 'applied'.",
      type: "chat.mockConversation",
      messages: [
        u("My flight was cancelled and I was told member care could help with a travel credit. I'm Emily Chen."),
        a("I'm sorry about the cancellation, Emily — let me get that started.", [
          { name: "issue_travel_credit", arguments: { name: "Emily Chen", reason: "flight cancellation" } },
        ]),
        t(JSON.stringify({ submitted: true, status: "pending_review", message: "I've submitted a travel credit request for your account. Our team will review it and be in touch as soon as possible." })),
        check(
          "The assistant should tell the guest the travel credit is a REQUEST submitted for team review. It must NOT state any dollar amount, must NOT state a balance, and must NOT say the credit was applied, approved, added, or granted. Pass only if it is framed as a pending request with no dollar amount and no applied/approved claim. Fail otherwise."
        ),
      ],
    },
    target: { type: "assistant", assistantId: IDS.upsell },
  },
];

// ── Upsert evals ──────────────────────────────────────────────────────────────

const existing = (await vapi.eval.evalControllerGetPaginated({ limit: 100 })).results ?? [];
const byName = new Map(existing.map((e) => [e.name, e]));

let created = 0;
let updated = 0;
const evalIds: { name: string; id: string }[] = [];

for (const spec of SCENARIOS) {
  const prev = byName.get(spec.eval.name!);
  if (prev) {
    await vapi.eval.evalControllerUpdate({ id: prev.id, ...spec.eval });
    evalIds.push({ name: spec.eval.name!, id: prev.id });
    updated++;
  } else {
    const created_ = await vapi.eval.evalControllerCreate(spec.eval);
    evalIds.push({ name: spec.eval.name!, id: created_.id });
    created++;
  }
}

pretty("Eval suite ready", { created, updated, total: SCENARIOS.length });
console.log("\nScenarios:");
evalIds.forEach(({ name, id }) => console.log(`  ${name}  →  ${id}`));

// ── Optional: run all ─────────────────────────────────────────────────────────

if (process.env.RUN !== "1") {
  console.log("\nTo run all scenarios:  RUN=1 npm run simulations");
  process.exit(0);
}

console.log("\nRunning all scenarios (parallel, then polling to completion)…");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fire every run, capturing its run id.
const runs = await Promise.all(
  SCENARIOS.map(async (spec) => {
    try {
      const run = (await vapi.eval.evalControllerRun({
        eval: spec.eval,
        target: spec.target as Vapi.CreateEvalRunDtoTarget,
        type: "eval",
      })) as Record<string, any>;
      // evalControllerRun returns { workflowId, evalRunId } — the run id is evalRunId.
      return { name: spec.eval.name!, runId: (run?.evalRunId ?? run?.id) as string | undefined, error: undefined as string | undefined };
    } catch (err: unknown) {
      return { name: spec.eval.name!, runId: undefined, error: err instanceof Error ? err.message : String(err) };
    }
  })
);

// Poll each run until it ends (or we hit the per-run timeout).
const POLL_MS = 6000;
const MAX_MS = 360000;
async function resolveRun(name: string, runId?: string, startErr?: string) {
  if (startErr || !runId) return { name, status: "error", detail: startErr ?? "no run id" };
  const deadline = Date.now() + MAX_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    let run: Record<string, any>;
    try {
      run = (await vapi.eval.evalControllerGetRun({ id: runId })) as Record<string, any>;
    } catch (err: unknown) {
      return { name, status: "error", detail: err instanceof Error ? err.message : String(err) };
    }
    if (run?.status === "ended") {
      const rs = (run.results ?? []) as Array<{ status?: string }>;
      const verdicts = rs.map((r) => r.status).filter(Boolean) as string[];
      const passed = verdicts.length > 0 && verdicts.every((s) => s === "pass");
      return { name, status: passed ? "pass" : "fail", detail: `${run.endedReason ?? ""} [${verdicts.join(",") || "no-result"}]` };
    }
    if (run?.status === "error" || run?.status === "timeout" || run?.status === "aborted") {
      return { name, status: "error", detail: `${run.status}: ${run.endedMessage ?? ""}` };
    }
  }
  return { name, status: "error", detail: "poll timeout" };
}

const results = await Promise.all(runs.map((r) => resolveRun(r.name, r.runId, r.error)));
results.sort((a, b) => a.name.localeCompare(b.name));

const pass = results.filter((r) => r.status === "pass").length;
const fail = results.filter((r) => r.status === "fail").length;
const errs = results.filter((r) => r.status === "error").length;

console.log("\n── Simulation results ──");
for (const r of results) {
  const mark = r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "⚠";
  console.log(`  ${mark} ${r.name.padEnd(34)} ${r.status.toUpperCase()}${r.detail ? "  " + r.detail : ""}`);
}
console.log(`\n${pass}/${results.length} passed` + (fail ? `, ${fail} failed` : "") + (errs ? `, ${errs} errored` : ""));
console.log("Full traces: https://dashboard.vapi.ai/evals");
process.exit(fail > 0 || errs > 0 ? 1 : 0);
