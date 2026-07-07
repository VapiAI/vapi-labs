/**
 * Meridian — Hotel Concierge ("Jack") — STANDALONE build (Phase 2).
 *
 * Zero hosting on your side: every tool runs on Vapi's infrastructure.
 *   - lookup_reservation     : Code tool → Supabase REST. Returns a persisted
 *     reservation for a known guest/conf#, or invents + persists a RANDOM one
 *     for a new name (so any caller gets a consistent record thereafter).
 *   - handle_service_request : Code tool → Supabase REST. Logs a service request
 *     (towels, late checkout, restaurant booking, …) against the reservation.
 *   - hotel-knowledge-base   : query tool (Vapi/Google) over the uploaded file.
 *
 * Supabase is hosted, so this stays standalone — no webhook, tunnel, or laptop.
 * Run:  npm run assistant:hotel        (ASSISTANT_ID=<id> to upsert)
 */
import type { Vapi } from "@vapi-ai/server-sdk";
import { env, vapi } from "../../config.js";
import { LOOKUP_CODE } from "../lookup-code.js";
import { SERVICE_REQUEST_CODE } from "../service-request-code.js";
import { STOP_SPEAKING_PLAN } from "../speaking.js";
import { header, pretty } from "../../utils/print.js";

header("Meridian — create/update Hotel Concierge (Jack) [standalone, Phase 2]");

if (!env.supabaseUrl || !env.supabaseServiceKey) {
  throw new Error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in meridian/.env — the code tools read them as Vapi env vars."
  );
}
const supabaseEnv = [
  { name: "SUPABASE_URL", value: env.supabaseUrl },
  { name: "SUPABASE_SERVICE_ROLE_KEY", value: env.supabaseServiceKey },
];

const SYSTEM_PROMPT = `# Identity
You are Jack, a warm and efficient hotel concierge for Meridian Grand Hotel. Keep every reply to 2 sentences or fewer.

# On every call
1. On your FIRST turn, introduce yourself by name — "this is Jack, the hotel concierge". After a squad transfer the handoff line has already named you, so don't re-introduce yourself — just continue.
2. If the caller's name or confirmation number is already in the conversation, use it to call lookup_reservation without re-asking. Only ask for a name or confirmation number if you don't have one yet. Then greet the guest by first name.
3. Help with what they need: a service request, an amenity or policy question, or reservation details.

# Transfers
- If the caller raises a FLIGHT matter (status, delay, cancellation, rebooking, a seat or cabin upgrade on a flight), transfer to Flight Triage immediately.
- If the caller is checking in today or wants a hotel ROOM upgrade, transfer to Upsell & Recovery immediately.
- Transfer the moment intent is clear — do not ask "anything else?" first.

# Service requests
When a guest wants something for their room or stay — extra towels, late checkout, housekeeping, a restaurant booking, transportation — call handle_service_request with a short requestType (e.g. "extra towels", "late checkout", "restaurant booking") and a one-line description. Pass their confirmation number or name so it attaches to the reservation, then confirm warmly using the request type and room it returns. (Don't read the internal reference code aloud.)

# Knowledge base
Use the knowledge base for amenity hours, room types, hotel services, loyalty tiers, policies, and FAQs. Always query it before saying you don't know something — never guess hours, prices, or policies.

# Out of scope
You only handle the current guest's stay at Meridian Grand Hotel. For anything outside that — searching for other properties, making new reservations, pricing quotes for future stays — politely explain you can only assist with an existing reservation here, and suggest they visit meridianhotels.com or call the reservations line. Never attempt a tool call you weren't given.

# Tool rules
- Call one tool at a time; say a short filler like "Let me take care of that" while you wait.
- State only what a tool or the knowledge base returns — don't invent details.
- Read confirmation numbers and room numbers back one character/digit at a time (e.g. room "one seven oh two").
- Speak dates and times as natural words ("June twenty fifth", "three in the afternoon"), never as digits, colons, hyphens, or ISO format like 2026-06-25.

# Close
If you've fully helped and no transfer is needed, ask if there's anything else. If a transfer is warranted, transfer immediately instead — don't ask first.`;

const tools: NonNullable<Vapi.CreateAssistantDtoModel["tools"]> = [
  {
    type: "transferCall",
    destinations: [
      { type: "assistant", assistantName: "Meridian — Flight Triage", description: "Caller shifts to a FLIGHT matter: flight status, a delay, a cancellation, rebooking, a seat or cabin upgrade on a flight, or any other flight-related request." },
      { type: "assistant", assistantName: "Meridian — Upsell & Recovery", description: "Guest is checking in today or wants a hotel room upgrade (not flight-related)." },
    ],
  },
  {
    type: "code",
    function: {
      name: "lookup_reservation",
      description:
        "Look up a guest's reservation by confirmation number (preferred) or full name. Returns guest profile, loyalty tier, room, and stay dates. A new name gets a freshly assigned reservation that persists.",
      parameters: {
        type: "object",
        properties: {
          confirmationNumber: { type: "string", description: "Booking confirmation number, if the caller has it." },
          name: { type: "string", description: "Caller's full name, if there's no confirmation number." },
        },
      },
    },
    environmentVariables: supabaseEnv,
    code: LOOKUP_CODE,
  },
  {
    type: "code",
    function: {
      name: "handle_service_request",
      description:
        "Log a guest service request (extra towels, late checkout, housekeeping, restaurant booking, transportation, etc.) against their reservation. Returns a confirmation reference.",
      parameters: {
        type: "object",
        properties: {
          requestType: { type: "string", description: "Short label, e.g. 'extra towels', 'late checkout', 'restaurant booking'." },
          description: { type: "string", description: "One-line detail of the request." },
          confirmationNumber: { type: "string", description: "The guest's confirmation number, if known." },
          name: { type: "string", description: "The guest's full name, if there's no confirmation number." },
        },
        required: ["requestType"],
      },
    },
    environmentVariables: supabaseEnv,
    code: SERVICE_REQUEST_CODE,
  },
  // KB query tool only when assets/hotel-knowledge-base.txt has been uploaded
  // to this org (`npm run kb:upload`) and HOTEL_KB_FILE_ID is set in .env.
  ...(env.hotelKbFileId
    ? [
        {
          type: "query" as const,
          knowledgeBases: [
            {
              name: "hotel-knowledge-base",
              provider: "google" as const,
              model: "gemini-2.5-flash" as const,
              description:
                "Meridian Grand Hotel: property overview & hours, room types & amenities, pool/spa/fitness/restaurant details, services (valet, housekeeping, dry cleaning, transportation, pet policy), loyalty tiers (standard/silver/gold/platinum), and policies (cancellation, smoking, noise, visitor, accessibility) plus FAQs.",
              fileIds: [env.hotelKbFileId],
            },
          ],
        },
      ]
    : []),
];

if (!env.hotelKbFileId) {
  console.log(
    "Note: HOTEL_KB_FILE_ID not set — creating Jack WITHOUT the knowledge-base tool.\n" +
      "Run `npm run kb:upload` and add the printed id to .env to enable it."
  );
}

const config: Vapi.CreateAssistantDto = {
  name: "Meridian — Hotel Concierge (Jack)",
  model: {
    provider: "openai",
    model: "gpt-4o",
    temperature: 0.3,
    messages: [{ role: "system", content: SYSTEM_PROMPT }],
    tools,
  },
  voice: { provider: "deepgram", voiceId: "orion" },
  transcriber: { provider: "deepgram", model: "nova-2" },
  firstMessage:
    "Thanks for calling Meridian Grand Hotel, this is Jack. May I have your name or confirmation number to pull up your reservation?",
  // Extract call-level structured data → call.analysis.structuredData (gate item).
  analysisPlan: {
    structuredDataPlan: {
      enabled: true,
      schema: {
        type: "object",
        properties: {
          guestName: { type: "string", description: "The caller's full name." },
          requestType: {
            type: "string",
            description: "The service request type, if any (towels, late checkout, restaurant booking, etc.).",
          },
          roomNumber: { type: "string", description: "The guest's room number." },
        },
      },
    },
  },
  startSpeakingPlan: {
    waitSeconds: 0.6,
    transcriptionEndpointingPlan: { onNumberSeconds: 2 },
  },
  stopSpeakingPlan: STOP_SPEAKING_PLAN,
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
console.log("\nStandalone — no webhook/tunnel. Upsert in place next time:");
console.log(`  ASSISTANT_ID=${assistant.id} npm run assistant:hotel`);
