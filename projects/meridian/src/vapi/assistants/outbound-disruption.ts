/**
 * Meridian — Outbound Disruption. Standalone (Code tools → Supabase REST; no webhook).
 * Proactively calls members when a flight is cancelled or delayed 2h+.
 * Fully self-contained: finds alternatives, confirms the rebook, and mentions the travel
 * credit — no transfer needed, which keeps the outbound flow to a single call.
 *
 * Run:  npm run assistant:outbound   (ASSISTANT_ID=<id> to upsert)
 */
import type { Vapi } from "@vapi-ai/server-sdk";
import { env, vapi } from "../../config.js";
import { FIND_ALTERNATIVES_CODE, CONFIRM_REBOOK_CODE, COMPENSATION_CODE } from "../flight-code.js";
import { STOP_SPEAKING_PLAN } from "../speaking.js";
import { header, pretty } from "../../utils/print.js";

header("Meridian — create/update Outbound Disruption");

if (!env.supabaseUrl || !env.supabaseServiceKey) {
  throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in meridian/.env.");
}
const supabaseEnv = [
  { name: "SUPABASE_URL", value: env.supabaseUrl },
  { name: "SUPABASE_SERVICE_ROLE_KEY", value: env.supabaseServiceKey },
];

// Spoken if the member declines/is busy. Set CALLBACK_NUMBER to your demo line
// (spell it the way it should be READ ALOUD, e.g. "nine seven zero, ...").
const CALLBACK_LINE = process.env.CALLBACK_NUMBER
  ? `give them the callback number (${process.env.CALLBACK_NUMBER})`
  : `let them know they can call the Meridian member line back anytime`;

const SYSTEM_PROMPT = `# Identity
You are Meridian's outbound disruption specialist. You placed this call — the member did not call you.
Your opening message already told them which flight was disrupted and why you're calling. Be brief.

# Your flow
1. Confirm they want to rebook. If they decline or are busy, ${CALLBACK_LINE} and close warmly.
2. If yes, call find_alternative_flights with the origin and destination from your opening message.
   Read at most 3 options with departure times. Never invent flight numbers.
3. When they choose a flight, call confirm_rebook with their name and the chosen flight number.
   State only what the tool returns — never invent confirmation numbers. Read the tool's message as given; never read a raw flight code or ISO time aloud.
4. Call compensation_engine with the disruption type and their loyalty tier (standard if unknown).
   Tell them only that a travel-credit request has been noted for review — never quote a dollar amount or say it's been applied.

# Rules
- One tool at a time. Short filler while you wait ("Let me pull those up...").
- Never take a card number. Never quote a credit dollar amount — credits are requests the team reviews.
- 1–2 sentences per turn maximum.
- If they are already at the airport or have been rebooked, acknowledge and close warmly.`;

const tools: Vapi.CreateAssistantDtoModel["tools"] = [
  {
    type: "code",
    function: {
      name: "find_alternative_flights",
      description: "Find up to 3 alternative flights for a disrupted route. Pass origin and destination airport codes.",
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
      description: "Rebook the member onto a new flight. Pass their name and the chosen flight number.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The member's full name." },
          bookingReference: { type: "string", description: "Booking reference if known, e.g. BK929441." },
          newFlightNumber: { type: "string", description: "The chosen flight number, e.g. UA891." },
          newDepartureTime: { type: "string", description: "Optional. Only an exact ISO timestamp; omit otherwise — never pass a spoken time." },
          seat: { type: "string", description: "Seat assignment, if changing." },
        },
        required: ["name", "newFlightNumber"],
      },
    },
    environmentVariables: supabaseEnv,
    code: CONFIRM_REBOOK_CODE,
  },
  {
    type: "code",
    function: {
      name: "compensation_engine",
      description: "Calculate the travel-credit voucher owed for this disruption.",
      parameters: {
        type: "object",
        properties: {
          cancelled: { type: "boolean", description: "True if the flight was cancelled." },
          disruptionType: { type: "string", description: "on-time, minor-delay, major-delay, or cancelled." },
          delayMinutes: { type: "number", description: "Delay length in minutes (for a delay)." },
          delayHours: { type: "number", description: "Delay length in hours (alternative to delayMinutes)." },
          loyaltyTier: { type: "string", description: "standard, silver, gold, or platinum." },
        },
      },
    },
    code: COMPENSATION_CODE,
  },
];

const config: Vapi.CreateAssistantDto = {
  name: "Meridian — Outbound Disruption",
  model: {
    provider: "openai",
    model: "gpt-4o",
    temperature: 0.3,
    messages: [{ role: "system", content: SYSTEM_PROMPT }],
    tools,
  },
  voice: { provider: "deepgram", voiceId: "asteria" },
  transcriber: { provider: "deepgram", model: "nova-2" },
  // Generic fallback — campaign script overrides firstMessage per customer.
  firstMessage: "Hi, this is Aria from Meridian — I'm calling about a disruption on your upcoming flight. Can I help get you rebooked?",
  firstMessageMode: "assistant-speaks-first",
  startSpeakingPlan: { waitSeconds: 0.6 },
  stopSpeakingPlan: STOP_SPEAKING_PLAN,
  analysisPlan: {
    structuredDataPlan: {
      enabled: true,
      schema: {
        type: "object",
        properties: {
          memberName: { type: "string", description: "The member's full name." },
          rebookAccepted: { type: "boolean", description: "Whether the member accepted the rebooking offer." },
          rebookedFlight: { type: "string", description: "The new flight number, if rebooked." },
          creditRequestRaised: { type: "boolean", description: "Whether a travel-credit request was noted for review." },
        },
      },
    },
  },
};

const existingId = process.env.ASSISTANT_ID;
const assistant = existingId
  ? await vapi.assistants.update({ id: existingId, ...config })
  : await vapi.assistants.create(config);
pretty(existingId ? "Updated assistant" : "Created assistant", {
  id: assistant.id,
  name: assistant.name,
  tools: tools.map((t) => ("function" in t && t.function ? t.function.name : t.type)),
});
console.log(`\nUpsert: ASSISTANT_ID=${assistant.id} npm run assistant:outbound`);
