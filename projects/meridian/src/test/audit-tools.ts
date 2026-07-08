/**
 * Exhaustive runtime audit of every Meridian Code-tool body.
 * Executes the EXACT shipped code against live Supabase across an input matrix,
 * then scans every spoken `message` for TTS hazards and every return for framing
 * violations. Prints a JSON report. Run: npx tsx meridian/src/test/audit-tools.ts
 */
import { env } from "../config.js";
import {
  GET_FLIGHT_STATUS_CODE, FIND_ALTERNATIVES_CODE, CONFIRM_REBOOK_CODE, COMPENSATION_CODE,
} from "../vapi/flight-code.js";
import { SERVICE_REQUEST_CODE, ROOM_UPGRADE_CODE } from "../vapi/service-request-code.js";
import { ISSUE_TRAVEL_CREDIT_CODE } from "../vapi/recovery-code.js";
import { LOOKUP_CODE } from "../vapi/lookup-code.js";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as any;
if (!env.supabaseUrl || !env.supabaseServiceKey) throw new Error("Supabase env missing");
const toolEnv = { SUPABASE_URL: env.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: env.supabaseServiceKey };

const fns: Record<string, any> = {
  get_flight_status: new AsyncFunction("args", "env", GET_FLIGHT_STATUS_CODE),
  find_alternative_flights: new AsyncFunction("args", "env", FIND_ALTERNATIVES_CODE),
  confirm_rebook: new AsyncFunction("args", "env", CONFIRM_REBOOK_CODE),
  compensation_engine: new AsyncFunction("args", "env", COMPENSATION_CODE),
  handle_service_request: new AsyncFunction("args", "env", SERVICE_REQUEST_CODE),
  request_room_upgrade: new AsyncFunction("args", "env", ROOM_UPGRADE_CODE),
  issue_travel_credit: new AsyncFunction("args", "env", ISSUE_TRAVEL_CREDIT_CODE),
  lookup_reservation: new AsyncFunction("args", "env", LOOKUP_CODE),
};

// ── TTS-hazard scanner ────────────────────────────────────────────────────────
// A spoken string must contain no raw multi-digit run, no colon time, no ISO
// date, no $, and no hyphen between word-chars (heard as "minus").
function scanSpoken(s: string): string[] {
  const hits: string[] = [];
  if (typeof s !== "string" || !s) return hits;
  if (/\d\d/.test(s)) hits.push(`multi-digit run: "${(s.match(/\d[\d:]*\d/) || [])[0]}"`);
  if (/\b\d{1,2}:\d{2}\b/.test(s)) hits.push("colon time");
  if (/\d{4}-\d{2}-\d{2}/.test(s)) hits.push("ISO date");
  if (/\$\s*\d/.test(s)) hits.push("dollar amount");
  if (/[A-Za-z]-[A-Za-z]|\d-\d/.test(s)) hits.push(`hyphen-as-minus: "${(s.match(/\S*-\S*/) || [])[0]}"`);
  return hits;
}

type Case = { tool: string; label: string; args: any; expect?: (r: any) => string[] };
const cases: Case[] = [
  // lookup_reservation
  { tool: "lookup_reservation", label: "new name (creates)", args: { name: "Audit Persona Alpha" } },
  { tool: "lookup_reservation", label: "same name (persists)", args: { name: "Audit Persona Alpha" } },
  { tool: "lookup_reservation", label: "unknown conf#", args: { confirmationNumber: "ZZ999" } },
  { tool: "lookup_reservation", label: "empty args", args: {} },
  // handle_service_request
  { tool: "handle_service_request", label: "towels by name", args: { name: "Audit Persona Alpha", requestType: "extra towels", description: "two bath towels" } },
  { tool: "handle_service_request", label: "missing type (defaults)", args: { name: "Audit Persona Alpha" } },
  { tool: "handle_service_request", label: "no identifier", args: { requestType: "late checkout" } },
  // get_flight_status — many to hit all branches + tricky hours + bare-digit + oversized regressions
  ...["UA482", "AA1011", "UA12", "DL2034", "DL-2034", "Delta 500", "AS7", "B6321", "WN1599", "NK88", "F9404", "QQ9999",
      "1234", "482", "4825", "UA10000", "12345"].map((f) => ({
    tool: "get_flight_status", label: `status ${f}`, args: { flightNumber: f, name: "Audit Persona Alpha" },
  })),
  { tool: "get_flight_status", label: "missing flightNumber", args: { name: "Audit Persona Alpha" } },
  // find_alternative_flights
  { tool: "find_alternative_flights", label: "with route", args: { origin: "JFK", destination: "LAX" } },
  { tool: "find_alternative_flights", label: "no route", args: {} },
  // confirm_rebook
  { tool: "confirm_rebook", label: "by ref + flight", args: { bookingReference: "BK929441", newFlightNumber: "DL2034" } },
  { tool: "confirm_rebook", label: "5-char ref (synthetic ok)", args: { bookingReference: "ABCDE", newFlightNumber: "UA777" } },
  { tool: "confirm_rebook", label: "by name", args: { name: "Audit Persona Alpha", newFlightNumber: "AA100" } },
  { tool: "confirm_rebook", label: "NOTHING to change", args: {} },
  { tool: "confirm_rebook", label: "seat only", args: { name: "Audit Persona Alpha", seat: "14C" } },
  { tool: "confirm_rebook", label: "non-ISO departure (must not throw)", args: { bookingReference: "BK929441", newFlightNumber: "DL2034", newDepartureTime: "nine forty AM" } },
  { tool: "confirm_rebook", label: "bare-digit flight by ref", args: { bookingReference: "BK929441", newFlightNumber: "1234" } },
  // compensation_engine — assert NO dollar field, NO $ in message
  { tool: "compensation_engine", label: "cancelled gold", args: { cancelled: true, loyaltyTier: "gold" },
    expect: (r) => (r.voucherUSD !== undefined ? ["leaks voucherUSD to model"] : []) },
  { tool: "compensation_engine", label: "180min platinum", args: { delayMinutes: 180, loyaltyTier: "platinum" },
    expect: (r) => (r.currency !== undefined ? ["leaks currency to model"] : []) },
  { tool: "compensation_engine", label: "on-time standard", args: { delayMinutes: 0, loyaltyTier: "standard" } },
  // request_room_upgrade — offer must quote price; accept must be pending
  { tool: "request_room_upgrade", label: "offer (no accept)", args: { name: "Audit Persona Alpha" },
    expect: (r) => (/confirmed|charged|done/i.test(r.message || "") ? ["offer claims confirmed/charged"] : []) },
  { tool: "request_room_upgrade", label: "accept (pending)", args: { name: "Audit Persona Alpha", accept: true },
    expect: (r) => (/\bconfirmed\b|charged now\.?$/i.test(r.message || "") && !/folio/i.test(r.message || "") ? ["accept not pending-framed"] : []) },
  // issue_travel_credit — pending only, no $
  { tool: "issue_travel_credit", label: "with name", args: { name: "Audit Persona Alpha", reason: "flight cancellation" },
    expect: (r) => (r.amountUSD !== undefined || r.newBalanceUSD !== undefined ? ["leaks amount/balance"] : []) },
  { tool: "issue_travel_credit", label: "missing name", args: {} },
];

(async () => {
  const report: any[] = [];
  for (const c of cases) {
    const entry: any = { tool: c.tool, label: c.label };
    try {
      const r = await fns[c.tool](c.args, toolEnv);
      entry.ok = true;
      entry.message = r?.message ?? null;
      const leaks = scanSpoken(r?.message ?? "");
      if (leaks.length) entry.ttsLeaks = leaks;
      const framing = c.expect ? c.expect(r) : [];
      if (framing.length) entry.framing = framing;
      // surface a couple key return fields
      entry.keys = Object.keys(r || {});
    } catch (e: any) {
      entry.ok = false;
      entry.error = String(e?.message ?? e);
    }
    report.push(entry);
  }
  const problems = report.filter((e) => !e.ok || e.ttsLeaks || e.framing);
  console.log(JSON.stringify({ total: report.length, problems: problems.length, report }, null, 2));
  console.log(`\n=== ${problems.length} PROBLEM(S) of ${report.length} cases ===`);
  for (const p of problems) console.log(`  ✗ ${p.tool} / ${p.label}: ${p.error || JSON.stringify(p.ttsLeaks || p.framing)}`);
  if (!problems.length) console.log("  ✓ all clean");
})();
