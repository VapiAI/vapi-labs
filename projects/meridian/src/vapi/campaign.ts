/**
 * Meridian — Outbound Disruption Campaign.
 * Proactively calls members affected by a flight disruption.
 * Looks up affected members from Supabase, builds personalized opening messages,
 * and places outbound calls in one batch via vapi.calls.create.
 *
 * Note: Vapi's /campaign API requires a Twilio/Vonage/Telnyx number.
 * This script uses vapi.calls.create with a `customers` array, which works
 * with Vapi-provisioned numbers and achieves the same proactive outbound effect.
 *
 * Required env:
 *   FLIGHT_NUMBER      e.g. UA482
 *   PHONE_NUMBER_ID    Vapi phone number ID (Dashboard → Phone Numbers → copy ID)
 *                      OR omit — it will auto-pick the first number in your org.
 *
 * Optional env:
 *   DISRUPTION_TYPE    cancelled | major-delay  (default: cancelled)
 *   DELAY_MINUTES      delay in minutes for major-delay, e.g. 180
 *   ORIGIN             origin airport code override, e.g. LAX
 *   DESTINATION        destination airport code override, e.g. MIA
 *   TEST_PHONE         E164 number to add as a test call (for demo/dry-run)
 *
 *   npm run campaign
 */
import type { Vapi } from "@vapi-ai/server-sdk";
import { vapi, env } from "../config.js";
import { supabase } from "../db/client.js";
import { header, pretty } from "../utils/print.js";

header("Meridian — Outbound Disruption Campaign");

if (!env.supabaseUrl || !env.supabaseServiceKey) {
  throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in meridian/.env.");
}

// ── Config from env ────────────────────────────────────────────────────────────

const FLIGHT_NUMBER = (process.env.FLIGHT_NUMBER ?? "").toUpperCase().trim();
if (!FLIGHT_NUMBER) throw new Error("Set FLIGHT_NUMBER env var, e.g. FLIGHT_NUMBER=UA482 npm run campaign");

const DISRUPTION_TYPE = ((process.env.DISRUPTION_TYPE ?? "cancelled").toLowerCase()) as "cancelled" | "major-delay";
const DELAY_MINUTES = Number(process.env.DELAY_MINUTES ?? 0);
const ORIGIN = (process.env.ORIGIN ?? "").toUpperCase() || null;
const DESTINATION = (process.env.DESTINATION ?? "").toUpperCase() || null;
const TEST_PHONE = process.env.TEST_PHONE?.trim() || null;

// ── Resolve the outbound assistant ────────────────────────────────────────────

const allAssistants = await vapi.assistants.list({ limit: 100 });
const outboundAssistant = allAssistants.find((a) => a.name === "Meridian — Outbound Disruption");
if (!outboundAssistant) {
  throw new Error(
    `Assistant "Meridian — Outbound Disruption" not found.\nCreate it first:  npm run assistant:outbound`
  );
}

// ── Resolve the outbound phone number ─────────────────────────────────────────

let phoneNumberId = process.env.PHONE_NUMBER_ID?.trim() ?? "";
if (!phoneNumberId) {
  const phoneNumbers = await vapi.phoneNumbers.list({ limit: 20 });
  const first = phoneNumbers[0];
  if (!first) {
    throw new Error("No phone numbers found in your Vapi org.\nAdd one at dashboard.vapi.ai/phone-numbers, then set PHONE_NUMBER_ID=<id>.");
  }
  phoneNumberId = first.id;
  const display = (first as { number?: string }).number ?? first.id;
  console.log(`Auto-selected phone number: ${display}  (set PHONE_NUMBER_ID to pin a specific one)\n`);
}

// ── Look up affected members from Supabase ─────────────────────────────────────

const db = supabase();
type BookingWithGuest = {
  booking_reference: string | null;
  origin: string | null;
  destination: string | null;
  cabin_class: string | null;
  guests: {
    id: string;
    name: string;
    phone: string | null;
    loyalty_tier: string | null;
  } | null;
};

const { data: bookings, error: dbErr } = await db
  .from("flight_bookings")
  .select("booking_reference, origin, destination, cabin_class, guests(id, name, phone, loyalty_tier)")
  .eq("flight_number", FLIGHT_NUMBER)
  .eq("status", "active")
  .not("guest_id", "is", null);

if (dbErr) throw new Error(`Supabase query failed: ${dbErr.message}`);
const rows = (bookings as unknown as BookingWithGuest[]) ?? [];
const withPhone = rows.filter((r) => r.guests?.phone);
const skipped = rows.length - withPhone.length;

// ── Build per-customer opening messages ────────────────────────────────────────

function buildFirstMessage(name: string, origin: string | null, dest: string | null): string {
  const from = origin ? ` from ${origin}` : "";
  const to = dest ? ` to ${dest}` : "";
  const route = `${FLIGHT_NUMBER}${from}${to}`;

  if (DISRUPTION_TYPE === "cancelled") {
    return `Hi ${name}, this is Aria from Meridian — I'm calling because your flight ${route} has been cancelled. We'd like to get you rebooked right now. Can I find you the next available option?`;
  }
  const delayHrs = DELAY_MINUTES ? Math.round(DELAY_MINUTES / 60) : 2;
  const hrs = `${delayHrs} hour${delayHrs === 1 ? "" : "s"}`;
  return `Hi ${name}, this is Aria from Meridian — your flight ${route} is delayed by about ${hrs}. We can move you to an earlier option if you'd prefer. Can I pull up some alternatives?`;
}

const customers: Vapi.CreateCustomerDto[] = withPhone.map((r) => {
  const g = r.guests!;
  const o = ORIGIN ?? r.origin;
  const d = DESTINATION ?? r.destination;
  return {
    number: g.phone!,
    name: g.name,
    assistantOverrides: {
      firstMessage: buildFirstMessage(g.name, o, d),
    },
  };
});

// Optional test customer (a real phone you own, for demo/dry-run)
if (TEST_PHONE) {
  customers.push({
    number: TEST_PHONE,
    name: "Test",
    assistantOverrides: {
      firstMessage: buildFirstMessage("there", ORIGIN, DESTINATION),
    },
  });
}

pretty("Members resolved", {
  onFlight: rows.length,
  withPhone: withPhone.length,
  skippedNoPhone: skipped,
  testCustomer: TEST_PHONE ? 1 : 0,
  totalCalls: customers.length,
});

if (customers.length === 0) {
  console.log(`\nNo callable members found for flight ${FLIGHT_NUMBER}.`);
  console.log(`Options:`);
  console.log(`  • Seed a member:  npm run seed  (adds Jordan Rivera with phone +14155550142)`);
  console.log(`  • Dry-run now:    TEST_PHONE=+1xxxxxxxxxx FLIGHT_NUMBER=${FLIGHT_NUMBER} npm run campaign`);
  process.exit(0);
}

// ── Place outbound calls ───────────────────────────────────────────────────────
//
// Vapi's /campaign API requires a Twilio/Vonage/Telnyx number, not Vapi-provisioned.
// calls.create with a `customers` array works with any number and achieves the same
// proactive outbound blast effect.

const batchName = `Meridian — Disruption: ${FLIGHT_NUMBER} ${DISRUPTION_TYPE}`;

const result = await vapi.calls.create({
  name: batchName,
  assistantId: outboundAssistant.id,
  phoneNumberId,
  customers,
});

// calls.create returns Call (single customer) or CallBatchResponse (customers array).
const batchResult = result as { results?: { id: string }[]; id?: string };
const callIds = batchResult.results ? batchResult.results.map((c) => c.id) : [batchResult.id];

pretty("Outbound calls placed", {
  batchName,
  customers: customers.length,
  assistant: outboundAssistant.name,
  callIds,
});

console.log(`\nMonitor calls at: https://dashboard.vapi.ai/calls`);
