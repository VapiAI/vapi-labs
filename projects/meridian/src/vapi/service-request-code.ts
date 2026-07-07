/**
 * handle_service_request — Vapi **Code tool** body (runs on Vapi infra; async).
 * Logs a guest service request to Supabase against their reservation, so the
 * assistant stays standalone (no webhook) yet persistent.
 *
 * args: requestType (required), description, confirmationNumber, name.
 * env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
export const SERVICE_REQUEST_CODE = `
const base = env.SUPABASE_URL + "/rest/v1";
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };

async function q(path) { const r = await fetch(base + path, { headers: H }); return r.ok ? await r.json() : []; }
async function insert(table, row) {
  const r = await fetch(base + "/" + table, {
    method: "POST",
    headers: Object.assign({ Prefer: "return=representation" }, H),
    body: JSON.stringify(row),
  });
  const j = await r.json();
  return Array.isArray(j) ? j[0] : j;
}

const conf = args.confirmationNumber ? String(args.confirmationNumber).trim().toUpperCase() : "";
const name = args.name ? String(args.name).trim() : "";
const requestType = args.requestType ? String(args.requestType).trim() : "general request";
const description = args.description ? String(args.description).trim() : requestType;

let resv = null;
let guest = null;
if (conf) {
  const rows = await q("/reservations?confirmation_number=eq." + encodeURIComponent(conf) + "&select=*,guests(*)");
  if (rows[0]) { resv = rows[0]; guest = rows[0].guests; }
}
if (!resv && name) {
  const guests = await q("/guests?name=ilike." + encodeURIComponent(name) + "&select=*");
  if (guests[0]) {
    guest = guests[0];
    const r = await q("/reservations?guest_id=eq." + guests[0].id + "&order=check_in.desc&limit=1&select=*");
    resv = r[0] || null;
  }
}

const created = await insert("service_requests", {
  reservation_id: resv ? resv.id : null,
  guest_id: guest ? guest.id : null,
  request_type: requestType,
  description: description,
  status: "pending",
});

const ref = "SR-" + (created && created.id ? String(created.id).slice(0, 8).toUpperCase() : String(Math.floor(Math.random() * 100000)));
const room = resv ? resv.room_number : null;
// Speak the room number digit by digit so TTS never reads "1702" as a multi-digit numeral.
function spokenDigits(s) {
  const w = { "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine" };
  return String(s).split("").map((c) => w[c] || c).join(" ");
}
return {
  logged: true,
  reference: ref,
  requestType: requestType,
  room: room,
  message: "I've logged your " + requestType + (room ? " for room " + spokenDigits(room) : "") + " — our team will take care of it shortly.",
};
`;

/**
 * request_room_upgrade — Vapi **Code tool** body (Vapi infra; async).
 * Deterministically offers ONE room upgrade with a real nightly rate (so the
 * agent can quote a price when asked), then on accept=true logs a PENDING
 * service_request — never an instant "confirmed" upgrade, never a card on the phone.
 *
 * args: confirmationNumber?, name?, accept? (boolean).
 * env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
export const ROOM_UPGRADE_CODE = `
const base = env.SUPABASE_URL + "/rest/v1";
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
async function q(path) { const r = await fetch(base + path, { headers: H }); return r.ok ? await r.json() : []; }
async function insert(t, row) { const r = await fetch(base + "/" + t, { method: "POST", headers: Object.assign({ Prefer: "return=representation" }, H), body: JSON.stringify(row) }); const j = await r.json(); return Array.isArray(j) ? j[0] : j; }
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); }
function words(n) {
  const sm = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
  const tm = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
  if (n < 20) return sm[n];
  if (n < 100) return tm[Math.floor(n/10)] + (n % 10 ? " " + sm[n%10] : "");
  const h = Math.floor(n/100), r = n % 100;
  return sm[h] + " hundred" + (r ? " " + words(r) : "");
}

const conf = args.confirmationNumber ? String(args.confirmationNumber).trim().toUpperCase() : "";
const name = args.name ? String(args.name).trim() : "";
const accept = args.accept === true;

// Locate the reservation (for room + linkage); fine if not found — still make an offer.
let resv = null, guest = null;
if (conf) { const rows = await q("/reservations?confirmation_number=eq." + encodeURIComponent(conf) + "&select=*,guests(*)"); if (rows[0]) { resv = rows[0]; guest = rows[0].guests; } }
if (!resv && name) { const gs = await q("/guests?name=ilike." + encodeURIComponent(name) + "&select=*"); if (gs[0]) { guest = gs[0]; const r = await q("/reservations?guest_id=eq." + gs[0].id + "&order=check_in.desc&limit=1&select=*"); resv = r[0] || null; } }

// Deterministic offer keyed to the guest so the quote is stable across the call.
const seed = hash(conf || name || (resv && resv.confirmation_number) || "MERIDIAN");
const tiers = ["a Deluxe Room", "a Junior Suite", "an Executive Suite", "an Ocean-View Suite"];
const toRoom = tiers[seed % tiers.length];
const nightlyRate = 75 + (seed % 18) * 15; // 75–330, multiples of 15
const rateWords = words(nightlyRate) + " dollars a night";

if (!accept) {
  // No raw nightlyRateUSD in the return — only the spoken-word rate in the message, so the model
  // can never read a bare numeral. The dollar figure lives in the DB description row only.
  return {
    offered: true, toRoom: toRoom,
    message: "I can offer you an upgrade to " + toRoom + " for " + rateWords + ". Would you like me to put in the request?",
  };
}

const created = await insert("service_requests", {
  reservation_id: resv ? resv.id : null,
  guest_id: guest ? guest.id : null,
  request_type: "room upgrade",
  description: "Upgrade to " + toRoom + " at $" + nightlyRate + "/night (requested by phone; folio at check-in).",
  status: "pending",
});

return {
  submitted: true, status: "pending", toRoom: toRoom,
  message: "I've put in the request for " + toRoom + " at " + rateWords + ". The team confirms availability and it goes on your folio at check-in; nothing's charged now.",
};
`;
