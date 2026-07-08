/**
 * Meridian — Flight Triage. Standalone (Code tool → Supabase REST; no webhook).
 * Identifies the caller + flight, pulls status, and flags when rebooking is
 * warranted. The triage → rebooking hand-off is wired in Phase 4 (squad).
 *
 * Run:  npm run assistant:triage   (ASSISTANT_ID=<id> to upsert)
 */
import type { Vapi } from "@vapi-ai/server-sdk";
import { env, vapi } from "../../config.js";
import { GET_FLIGHT_STATUS_CODE } from "../flight-code.js";
import { STOP_SPEAKING_PLAN } from "../speaking.js";
import { header, pretty } from "../../utils/print.js";

header("Meridian — create/update Flight Triage");

if (!env.supabaseUrl || !env.supabaseServiceKey) {
  throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in meridian/.env.");
}
const supabaseEnv = [
  { name: "SUPABASE_URL", value: env.supabaseUrl },
  { name: "SUPABASE_SERVICE_ROLE_KEY", value: env.supabaseServiceKey },
];

const SYSTEM_PROMPT = `# Identity
You are Maya, the Meridian flight specialist. Calm, fast, reassuring. 2 sentences or fewer. If they already gave their name earlier in the call, use it — don't ask again.

# Decide what they need
- STATUS ("is my flight on time?", a delay question): ask for the flight number if you don't have it, call get_flight_status, and read back its 'message' field. Route to the flight-changes specialist ONLY when the tool returns needsRebooking = true (cancellation, or a delay of two hours or more) — don't decide from the spoken hours.
- A CHANGE, REBOOK, or SEAT/CABIN UPGRADE ("change my flight", "different flight", "upgrade my seat"): you don't need to run a status check — hand off to the flight-changes specialist to handle it.

# Scope — you can only check status and transfer
- You do NOT rebook, quote prices or compensation, or issue credits. For any of those, transfer to the flight-changes specialist immediately.
- For baggage or flight check-in, explain those are handled at the airport counter or in the airline app and can't be processed on this call — don't attempt them.
- Never call any tool other than get_flight_status. Never attempt a tool you weren't given.

# Tool rules
- Call get_flight_status one at a time; say "let me check that flight" while you wait.
- Read back the tool's 'message' field verbatim — it is already spoken-word formatted. Never read the raw flightNumber code, minute counts, or any timestamp field aloud. Never invent flight options.

# Close
- If the caller came in with BOTH a flight and a hotel matter, once the flight is resolved proactively offer to connect them to the hotel team and transfer to the hotel concierge — don't just ask "anything else?".
- Otherwise, only ask "Is there anything else I can help with?" if you have fully resolved the issue without a transfer. If you are routing to a specialist, call the transfer function immediately — do not ask first.`;

const tools: Vapi.CreateAssistantDtoModel["tools"] = [
  {
    type: "transferCall",
    destinations: [
      { type: "assistant", assistantName: "Meridian — Rebooking", description: "Flight is cancelled or delayed two hours or more and the caller needs to be rebooked." },
      { type: "assistant", assistantName: "Meridian — Hotel Concierge (Jack)", description: "Caller shifts to a HOTEL matter: a reservation, room, amenities, or a service request." },
    ],
  },
  {
    type: "code",
    function: {
      name: "get_flight_status",
      description:
        "Get a flight's current status (on-time / delayed / cancelled), delay length, route, and whether rebooking is warranted. Optionally pass the caller's name.",
      parameters: {
        type: "object",
        properties: {
          flightNumber: { type: "string", description: "The flight number, e.g. UA482." },
          name: { type: "string", description: "Caller's full name, if given." },
        },
        required: ["flightNumber"],
      },
    },
    environmentVariables: supabaseEnv,
    code: GET_FLIGHT_STATUS_CODE,
  },
];

const config: Vapi.CreateAssistantDto = {
  name: "Meridian — Flight Triage",
  model: { provider: "openai", model: "gpt-4o", temperature: 0.3, messages: [{ role: "system", content: SYSTEM_PROMPT }], tools },
  voice: { provider: "deepgram", voiceId: "luna" },
  transcriber: { provider: "deepgram", model: "nova-2" },
  firstMessage: "Hi, this is Maya at the Meridian flight desk. Can I get your name and your flight number?",
  analysisPlan: {
    structuredDataPlan: {
      enabled: true,
      schema: {
        type: "object",
        properties: {
          guestName: { type: "string", description: "The caller's full name." },
          flightNumber: { type: "string", description: "The flight number." },
          disruptionType: { type: "string", description: "on-time, minor-delay, major-delay, or cancelled." },
        },
      },
    },
  },
  startSpeakingPlan: { waitSeconds: 0.6, transcriptionEndpointingPlan: { onNumberSeconds: 2 } },
  stopSpeakingPlan: STOP_SPEAKING_PLAN,
};

const existingId = process.env.ASSISTANT_ID;
const assistant = existingId ? await vapi.assistants.update({ id: existingId, ...config }) : await vapi.assistants.create(config);
pretty(existingId ? "Updated assistant" : "Created assistant", { id: assistant.id, name: assistant.name, tools: tools.map((t) => ("function" in t && t.function ? t.function.name : t.type)) });
console.log(`\nUpsert: ASSISTANT_ID=${assistant.id} npm run assistant:triage`);
