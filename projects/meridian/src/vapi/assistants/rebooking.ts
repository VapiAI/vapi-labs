/**
 * Meridian — Rebooking specialist. Standalone (Code tools; confirm_rebook →
 * Supabase REST; no webhook). Presents alternatives and confirms the rebook
 * (persists). Travel credits are NOT handled here — they hand off to member care.
 *
 * Run:  npm run assistant:rebooking   (ASSISTANT_ID=<id> to upsert)
 */
import type { Vapi } from "@vapi-ai/server-sdk";
import { env, vapi } from "../../config.js";
import { FIND_ALTERNATIVES_CODE, CONFIRM_REBOOK_CODE } from "../flight-code.js";
import { STOP_SPEAKING_PLAN } from "../speaking.js";
import { header, pretty } from "../../utils/print.js";

header("Meridian — create/update Rebooking specialist");

if (!env.supabaseUrl || !env.supabaseServiceKey) {
  throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in meridian/.env.");
}
const supabaseEnv = [
  { name: "SUPABASE_URL", value: env.supabaseUrl },
  { name: "SUPABASE_SERVICE_ROLE_KEY", value: env.supabaseServiceKey },
];

const SYSTEM_PROMPT = `# Identity
You are Marcus, a Meridian rebooking specialist. Warm, efficient, solution-focused. Keep replies to 2 sentences or fewer.

# Flow
1. The caller's flight was disrupted. Confirm their name (and booking reference if they have it).
2. Call find_alternative_flights for their route. Read at most 3 options with departure times — never more than 3.
3. When they choose one, call confirm_rebook with their booking reference (or name) plus the chosen flight number, then confirm the new flight clearly.
4. After a cancellation or a delay of two hours or more, the caller may be owed a travel credit — but you do NOT handle credits. Let them know member care will follow up, and transfer to Upsell & Recovery.

# Scope — flights only
- You rebook disrupted flights and change seats. You do NOT issue travel credits or quote compensation amounts — for those, transfer to member care. Paid cabin upgrades are arranged at the airport or online, not on this call.
- Never call a tool that isn't listed for you. Never attempt a tool you weren't given.

# Tool rules
- Call one tool at a time; say a short filler like "Let me find your options" while you wait.
- State only what the tools return — never invent flights, times, or credit amounts.
- Speak any time aloud as words ("three forty PM"), never as 9:47 or an ISO timestamp. The flight options already come back spoken-word formatted — read them as given.

# Close
Ask if there's anything else you can help with.`;

const tools: Vapi.CreateAssistantDtoModel["tools"] = [
  {
    type: "transferCall",
    destinations: [
      { type: "assistant", assistantName: "Meridian — Upsell & Recovery", description: "Rebooking is confirmed after a cancellation or two-hour-plus delay — hand off to member care for post-disruption follow-up." },
      { type: "assistant", assistantName: "Meridian — Flight Triage", description: "Caller wants to re-check flight status before deciding." },
    ],
  },
  {
    type: "code",
    function: {
      name: "find_alternative_flights",
      description: "Find up to 3 alternative flights for a route. Pass origin and destination airport codes if known.",
      parameters: {
        type: "object",
        properties: {
          origin: { type: "string", description: "Origin airport code, e.g. LAX." },
          destination: { type: "string", description: "Destination airport code, e.g. MIA." },
        },
      },
    },
    code: FIND_ALTERNATIVES_CODE,
  },
  {
    type: "code",
    function: {
      name: "confirm_rebook",
      description: "Rebook the guest's disrupted flight onto a new flight (and optionally change their seat). Pass booking reference (or name) and the chosen flight number. Does NOT handle paid cabin upgrades or travel credits.",
      parameters: {
        type: "object",
        properties: {
          bookingReference: { type: "string", description: "The booking reference, e.g. BK929441." },
          name: { type: "string", description: "The guest's full name, if no booking reference." },
          newFlightNumber: { type: "string", description: "The chosen flight number." },
          newDepartureTime: { type: "string", description: "Optional. Only an exact ISO timestamp; omit otherwise — never pass a spoken time, and never read it aloud." },
          seat: { type: "string", description: "Seat assignment to change to, e.g. 14A." },
        },
        required: ["newFlightNumber"],
      },
    },
    environmentVariables: supabaseEnv,
    code: CONFIRM_REBOOK_CODE,
  },
];

const config: Vapi.CreateAssistantDto = {
  name: "Meridian — Rebooking",
  model: { provider: "openai", model: "gpt-4o", temperature: 0.3, messages: [{ role: "system", content: SYSTEM_PROMPT }], tools },
  voice: { provider: "deepgram", voiceId: "arcas" },
  transcriber: { provider: "deepgram", model: "nova-2" },
  firstMessage: "Hi, this is Marcus, Meridian's rebooking specialist — I'll get you sorted. Can I get your name or booking reference?",
  analysisPlan: {
    structuredDataPlan: {
      enabled: true,
      schema: {
        type: "object",
        properties: {
          guestName: { type: "string", description: "The caller's full name." },
          rebookedFlight: { type: "string", description: "The new flight number, if rebooked." },
          creditFollowUpRaised: { type: "boolean", description: "Whether the caller was told member care will follow up on a travel credit." },
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
console.log(`\nUpsert: ASSISTANT_ID=${assistant.id} npm run assistant:rebooking`);
