/**
 * Meridian — Upsell & Recovery. Standalone (Code tools → Supabase REST).
 * Two jobs: room-upgrade upsell on check-in, and travel-credit recovery after a
 * flight disruption. In the squad, Hotel Concierge and Rebooking hand off here.
 *
 * Run:  npm run assistant:upsell   (ASSISTANT_ID=<id> to upsert)
 */
import type { Vapi } from "@vapi-ai/server-sdk";
import { env, vapi } from "../../config.js";
import { ROOM_UPGRADE_CODE } from "../service-request-code.js";
import { ISSUE_TRAVEL_CREDIT_CODE } from "../recovery-code.js";
import { STOP_SPEAKING_PLAN } from "../speaking.js";
import { header, pretty } from "../../utils/print.js";

header("Meridian — create/update Upsell & Recovery");

if (!env.supabaseUrl || !env.supabaseServiceKey) {
  throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in meridian/.env.");
}
const supabaseEnv = [
  { name: "SUPABASE_URL", value: env.supabaseUrl },
  { name: "SUPABASE_SERVICE_ROLE_KEY", value: env.supabaseServiceKey },
];

const SYSTEM_PROMPT = `# Identity
You are Sophie, a Meridian member-care specialist for upgrades and service recovery. Warm, generous within reason, concise — 2 sentences or fewer. Introduce yourself by name on your first turn.

# Intent first — decide before you act
Figure out which job this is BEFORE doing anything:
- A room upgrade or a check-in is ALWAYS the upgrade branch. Never mention or offer a travel credit for it.
- Only the recovery branch may mention a travel credit, and ONLY when the caller has a CONFIRMED flight cancellation or a delay of two hours or more. If there's no confirmed disruption, do not bring up a credit at all.

# A) Upgrade (check-in or "nicer room")
1. Call request_room_upgrade (accept omitted) to fetch one offer; read the room and rate back exactly as the tool's message states them — the rate is already spoken-word formatted, so never restate it as digits or with a dollar sign.
2. If they ask the cost, state the price BEFORE proceeding — answer the question, don't skip to confirming.
3. Only when they clearly say yes, call request_room_upgrade again with accept true. Then tell them it's been REQUESTED and goes on their folio at check-in — never that it's "confirmed", "done", or charged. Never take a card number.

# B) Recovery (post-disruption only)
1. Confirm the disruption (cancellation, or a delay of two hours or more). If the conversation already shows one — e.g. you were just transferred from rebooking — acknowledge it and proceed without re-asking what happened. If there's no confirmed disruption, don't proceed.
2. Call issue_travel_credit with the guest's name and a short reason.
3. Tell the guest only that the request has been submitted for team review. Never speak a dollar amount or balance, and never say the credit was applied, approved, or added.

# Tool rules
- Call one tool at a time; short filler while you wait. Never take a card number.
- State only what the tools return — never invent prices, amounts, or balances.

# Close
Ask if there's anything else you can help with.`;

const tools: Vapi.CreateAssistantDtoModel["tools"] = [
  {
    type: "transferCall",
    destinations: [
      { type: "assistant", assistantName: "Meridian — Hotel Concierge (Jack)", description: "Caller shifts back to a HOTEL-stay matter." },
      { type: "assistant", assistantName: "Meridian — Flight Triage", description: "Caller shifts to a FLIGHT matter." },
    ],
  },
  {
    type: "code",
    function: {
      name: "request_room_upgrade",
      description: "Offer one room upgrade with its nightly rate (call with accept omitted to fetch the offer so you can quote the price). Call again with accept=true ONLY after the guest agrees — this submits a PENDING upgrade request added to the folio at check-in; it does not charge anything.",
      parameters: {
        type: "object",
        properties: {
          confirmationNumber: { type: "string", description: "Confirmation number, if known." },
          name: { type: "string", description: "Guest's full name." },
          accept: { type: "boolean", description: "true only once the guest has agreed to the quoted upgrade; omit/false to just fetch the offer." },
        },
      },
    },
    environmentVariables: supabaseEnv,
    code: ROOM_UPGRADE_CODE,
  },
  {
    type: "code",
    function: {
      name: "issue_travel_credit",
      description: "Submit a PENDING travel-credit request for team review after a confirmed flight disruption. Does not apply a credit or touch any balance, and returns no dollar amount. Pass the guest's name and a short reason.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The guest's full name." },
          reason: { type: "string", description: "Short reason, e.g. 'flight cancellation' or 'three-hour delay'." },
        },
        required: ["name"],
      },
    },
    environmentVariables: supabaseEnv,
    code: ISSUE_TRAVEL_CREDIT_CODE,
  },
];

const config: Vapi.CreateAssistantDto = {
  name: "Meridian — Upsell & Recovery",
  model: { provider: "openai", model: "gpt-4o", temperature: 0.3, messages: [{ role: "system", content: SYSTEM_PROMPT }], tools },
  voice: { provider: "deepgram", voiceId: "stella" },
  transcriber: { provider: "deepgram", model: "nova-2" },
  firstMessage: "Hi, this is Sophie with Meridian member care — how can I help you today?",
  analysisPlan: {
    structuredDataPlan: {
      enabled: true,
      schema: {
        type: "object",
        properties: {
          guestName: { type: "string", description: "The caller's full name." },
          upgradeOffered: { type: "boolean", description: "True once a room-upgrade offer with a price was presented to the guest, regardless of whether they accepted." },
          upgradeRequested: { type: "boolean", description: "True only if the guest accepted and a room-upgrade request was submitted." },
          creditRequestSubmitted: { type: "boolean", description: "Whether a travel-credit request was submitted for team review." },
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
console.log(`\nUpsert: ASSISTANT_ID=${assistant.id} npm run assistant:upsell`);
