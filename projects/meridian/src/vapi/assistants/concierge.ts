/**
 * Meridian — Concierge (squad front door). Thin router: greets neutrally,
 * figures out hotel vs flight intent, and transfers. No business/lookup tools —
 * identification happens in the specialist it routes to — but it DOES carry the
 * required transferCall tool (with assistantName destinations); removing it
 * breaks all routing. Routing destinations also live in the squad member config
 * (see ../squad.ts).
 *
 * Run:  npm run assistant:concierge   (ASSISTANT_ID=<id> to upsert)
 */
import type { Vapi } from "@vapi-ai/server-sdk";
import { vapi } from "../../config.js";
import { STOP_SPEAKING_PLAN } from "../speaking.js";
import { header, pretty } from "../../utils/print.js";

header("Meridian — create/update Concierge (front door)");

const SYSTEM_PROMPT = `# Identity
You are Aria, the Meridian member concierge — the first voice a member hears. Meridian is a premium travel membership: one concierge for a member's whole trip, hotel and air. Warm and natural — 1 to 2 sentences.

# Your only job: identify what they need, then call the transfer function.
- FLIGHT — status, delay, cancellation, rebooking, a flight seat or cabin upgrade, or any flight change → transfer to flight.
- HOTEL — reservation, room, amenities, hours, policies, housekeeping, in-room request, room/suite upgrade, or check-in → transfer to hotel.
- BOTH — if they say "both" (or describe a flight AND a hotel matter), say you'll start them with the flight team and they can be handed to the hotel team next, then transfer to flight.

# Transfer rules — these are mandatory
- A one-word answer is enough intent: if they say just "flight", transfer to flight; if just "hotel", transfer to hotel. Do NOT re-ask or confirm — transfer right away.
- Call the transfer function the moment intent is clear. Do NOT say goodbye, ask "anything else?", or end the call yourself.
- If they say "transfer me to flight" or "connect me to hotel" — transfer immediately.
- Callers often say their name first. Acknowledge warmly, then transfer if you know what they need.
- If they say only "upgrade" without specifying, ask ONCE: "Is that a room upgrade at the hotel, or a flight seat upgrade?" then route accordingly.
- If intent is still unclear after one reply, ask ONCE: "Is this about your flight, your hotel, or both?" Never ask it twice.
- Never look anything up or collect details — the specialist handles all of that.`;

const config: Vapi.CreateAssistantDto = {
  name: "Meridian — Concierge",
  model: {
    provider: "openai",
    model: "gpt-4o",
    temperature: 0.3,
    messages: [{ role: "system", content: SYSTEM_PROMPT }],
    tools: [
      {
        type: "transferCall",
        destinations: [
          { type: "assistant", assistantName: "Meridian — Hotel Concierge (Jack)", description: "Anything about the HOTEL STAY: a reservation, check-in or check-out time, late checkout, amenities and hours (pool, spa, gym, restaurant), Wi-Fi, parking or valet, pet policy, housekeeping, towels, room service, a room or suite upgrade for the hotel stay, directions, or changing/cancelling a hotel reservation." },
          { type: "assistant", assistantName: "Meridian — Flight Triage", description: "Anything about a FLIGHT: flight status, a delay, a cancellation, 'my flight or trip was cancelled', changing or rebooking a flight, or a flight seat or cabin upgrade." },
        ],
      },
    ],
  },
  voice: { provider: "deepgram", voiceId: "asteria" },
  transcriber: { provider: "deepgram", model: "nova-2" },
  firstMessage: "Thanks for calling Meridian, this is Aria. How can I help you today — is it about your flight, your hotel, or both?",
  startSpeakingPlan: { waitSeconds: 0.6 },
  stopSpeakingPlan: STOP_SPEAKING_PLAN,
};

const existingId = process.env.ASSISTANT_ID;
const assistant = existingId ? await vapi.assistants.update({ id: existingId, ...config }) : await vapi.assistants.create(config);
pretty(existingId ? "Updated assistant" : "Created assistant", { id: assistant.id, name: assistant.name });
console.log(`\nUpsert: ASSISTANT_ID=${assistant.id} npm run assistant:concierge`);
