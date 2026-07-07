/**
 * Meridian Concierge Squad — wires the five assistants into one call flow.
 *
 *   Concierge (entry) ─▶ Hotel Concierge ⇄ Flight Triage ─▶ Rebooking ─▶ Upsell & Recovery
 *
 * Every member can reach the others for realistic topic pivots (a hotel caller
 * who suddenly has a flight problem, etc.) — missing destinations caused a
 * dropped call ("assistant-forwarded-call") when the model improvised a bad name.
 *
 * Routing lives here (member assistantDestinations), not in prompts. Transfers
 * are silent + rolling-history so the identified-member context carries across.
 * membersOverrides ONLY hardens barge-in (uniform numWords across members) — it must
 * NOT set `voice`, or every member would speak in one voice and you'd lose the
 * distinct personas. Each assistant declares its own Deepgram voice in its own file.
 *
 * Resolves members by name from the live org — create the 5 assistants first.
 * Names must be UNIQUE in the org or idByName throws (a duplicate silently resolved
 * the squad to a stale hotel agent once — see idByName guard below).
 *   npm run squad   (creates, or updates the existing squad in place)
 */
import type { Vapi } from "@vapi-ai/server-sdk";
import { vapi } from "../config.js";
import { STOP_SPEAKING_PLAN } from "./speaking.js";
import { header, pretty } from "../utils/print.js";

header("Meridian — create/update Concierge Squad");

const NAMES = {
  concierge: "Meridian — Concierge",
  hotel: "Meridian — Hotel Concierge (Jack)",
  triage: "Meridian — Flight Triage",
  rebooking: "Meridian — Rebooking",
  upsell: "Meridian — Upsell & Recovery",
};

const all = await vapi.assistants.list({ limit: 100 });
function idByName(name: string): string {
  const matches = all.filter((x) => x.name === name);
  if (matches.length === 0) throw new Error(`Assistant not found: "${name}" — create it first.`);
  if (matches.length > 1)
    throw new Error(
      `Ambiguous: ${matches.length} assistants named "${name}" (${matches.map((m) => m.id).join(", ")}). ` +
        `Delete the stale duplicate(s) so the name is unique before wiring the squad.`
    );
  return matches[0].id;
}
const id = {
  concierge: idByName(NAMES.concierge),
  hotel: idByName(NAMES.hotel),
  triage: idByName(NAMES.triage),
  rebooking: idByName(NAMES.rebooking),
  upsell: idByName(NAMES.upsell),
};

function handoff(msg: string): Vapi.AssistantOverrides {
  return { firstMessageMode: "assistant-speaks-first", firstMessage: msg };
}
function dest(name: string, description: string): Vapi.TransferDestinationAssistant {
  return { type: "assistant", assistantName: name, description };
}

const members: Vapi.SquadMemberDto[] = [
  {
    assistantId: id.concierge,
    assistantDestinations: [
      dest(NAMES.hotel, "Anything about the HOTEL STAY: a reservation, check-in or check-out time, late checkout, amenities and hours (pool, spa, gym, restaurant), Wi-Fi, parking or valet, pet policy, housekeeping, towels, room service, a room upgrade, directions, or changing/cancelling a hotel reservation."),
      dest(NAMES.triage, "Anything about a FLIGHT: flight status, a delay, a cancellation, 'my flight or trip was cancelled', changing or rebooking a flight, or a seat or cabin upgrade."),
    ],
  },
  {
    assistantId: id.hotel,
    assistantOverrides: handoff("This is Jack, your hotel specialist — happy to help with your stay. What do you need?"),
    assistantDestinations: [
      dest(NAMES.triage, "Caller shifts to a FLIGHT matter: flight status, a delay, a cancellation, rebooking, a seat or cabin upgrade on a flight, or any other flight-related request."),
      dest(NAMES.upsell, "Guest is checking in today or wants a hotel room upgrade (not flight-related)."),
    ],
  },
  {
    assistantId: id.triage,
    assistantOverrides: handoff("Hi, this is Maya at the Meridian flight desk. What's your flight number?"),
    assistantDestinations: [
      dest(NAMES.rebooking, "Flight is cancelled or delayed two hours or more and the caller needs to be rebooked."),
      dest(NAMES.hotel, "Caller shifts to a HOTEL matter: a reservation, room, amenities, or a service request."),
    ],
  },
  {
    assistantId: id.rebooking,
    assistantOverrides: handoff("This is Marcus, rebooking — I'll get you sorted. Do you have your booking reference handy?"),
    assistantDestinations: [
      dest(NAMES.upsell, "Rebooking is confirmed after a cancellation or two-hour-plus delay — hand off to member care for post-disruption follow-up."),
      dest(NAMES.triage, "Caller wants to re-check flight status before deciding."),
    ],
  },
  {
    assistantId: id.upsell,
    assistantOverrides: handoff("This is Sophie in member care — how can I help you today?"),
    assistantDestinations: [
      dest(NAMES.hotel, "Caller shifts back to a HOTEL-stay matter."),
      dest(NAMES.triage, "Caller shifts to a FLIGHT matter."),
    ],
  },
];

const config: Vapi.CreateSquadDto = {
  name: "Meridian Concierge Squad",
  members,
  membersOverrides: {
    // NO `voice` here — each member keeps its own distinct Deepgram voice.
    // Uniform Deepgram transcriber + barge-in across all members. This
    // stopSpeakingPlan OVERRIDES each member's own, so it is the source of truth.
    transcriber: { provider: "deepgram", model: "nova-2" },
    stopSpeakingPlan: STOP_SPEAKING_PLAN,
  },
};

const existing = (await vapi.squads.list({ limit: 100 })).find((s) => s.name === config.name);
const squad = existing ? await vapi.squads.update({ id: existing.id, ...config }) : await vapi.squads.create(config);

pretty(existing ? "Updated squad (id preserved — phone stays pointed)" : "Created squad", {
  id: squad.id,
  name: squad.name,
  members: members.length,
});
console.log(`\nSQUAD_ID=${squad.id}`);
