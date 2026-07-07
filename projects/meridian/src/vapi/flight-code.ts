/**
 * Vapi **Code tool** bodies for the airline side (run on Vapi infra; `args`/`env`
 * in scope; async; end with `return`). Supabase-backed tools talk to Supabase
 * REST directly, so everything stays standalone (no webhook).
 *
 *   get_flight_status      → synth a realistic status + persist a flight_booking
 *   find_alternative_flights → synth 3 alternative options (no DB)
 *   confirm_rebook         → PATCH the flight_booking to the chosen flight
 *   compensation_engine    → pure calc: delay length × loyalty-tier multiplier
 *
 * Verified end-to-end by src/test/flight-tools.ts.
 */

export const GET_FLIGHT_STATUS_CODE = `
const base = env.SUPABASE_URL + "/rest/v1";
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
async function q(path) { const r = await fetch(base + path, { headers: H }); return r.ok ? await r.json() : []; }
async function insert(t, row) { const r = await fetch(base + "/" + t, { method: "POST", headers: Object.assign({ Prefer: "return=representation" }, H), body: JSON.stringify(row) }); const j = await r.json(); return Array.isArray(j) ? j[0] : j; }
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); }
function pick(a, seed) { return a[seed % a.length]; }
function pad(n, w) { return String(n).padStart(w, "0"); }
function fmt(d) {
  const h = d.getUTCHours(); const m = d.getUTCMinutes();
  const ap = h >= 12 ? "PM" : "AM"; const h12 = h % 12 || 12;
  const sm = ["","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
  const tm = ["","","twenty","thirty","forty","fifty"];
  const mw = m === 0 ? "" : m < 10 ? "oh " + sm[m] : m < 20 ? sm[m] : m % 10 === 0 ? tm[Math.floor(m/10)] : tm[Math.floor(m/10)] + " " + sm[m%10];
  return sm[h12] + (mw ? " " + mw : "") + " " + ap;
}
function fmtFlightNum(n) {
  const sm = ["","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
  const tm = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
  function two(x) { if (!x) return ""; return x < 20 ? sm[x] : (x % 10 === 0 ? tm[Math.floor(x/10)] : tm[Math.floor(x/10)] + " " + sm[x%10]); }
  if (!Number.isInteger(n) || n < 0 || n > 9999) return String(n).split("").map(function (c) { return (c >= "0" && c <= "9") ? (sm[+c] || "zero") : c; }).join(" ").trim();
  if (n < 100) return two(n);
  if (n < 1000) { const lo2 = n % 100; return sm[Math.floor(n/100)] + " " + (lo2 === 0 ? "hundred" : lo2 < 10 ? "oh " + sm[lo2] : two(lo2)); }
  const hi = Math.floor(n/100); const lo = n % 100;
  return two(hi) + " " + (lo === 0 ? "hundred" : lo < 10 ? "oh " + sm[lo] : two(lo));
}
function fmtFlight(fn) {
  const map = {UA:"United",AA:"American",DL:"Delta",AS:"Alaska",B6:"JetBlue",WN:"Southwest",F9:"Frontier",NK:"Spirit"};
  if (/^\\d+$/.test(fn)) return fmtFlightNum(parseInt(fn, 10)); // bare digits ("1234") → "twelve thirty four", not "12 flight..."
  const m = fn.match(/^([A-Z0-9]{2})(\\d+)$/);
  if (m) return (map[m[1]] || m[1]) + " flight " + fmtFlightNum(parseInt(m[2], 10));
  // Non-canonical input: never read a raw multi-digit run — spell any digits as words.
  return fn.replace(/\\d+/g, function (d) { return " " + fmtFlightNum(parseInt(d, 10)) + " "; }).replace(/ +/g, " ").trim();
}
const CITY = {JFK:"New York",LAX:"Los Angeles",ORD:"Chicago",SFO:"San Francisco",ATL:"Atlanta",DFW:"Dallas",SEA:"Seattle",MIA:"Miami",BOS:"Boston",DEN:"Denver"};
function city(code) { return CITY[code] || code; }
function delayWords(mins) {
  const h = Math.floor(mins / 60); const m = mins % 60;
  const hw = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve"];
  const sm = ["","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
  const tm = ["","","twenty","thirty","forty","fifty"];
  const minWords = m < 20 ? sm[m] : (m % 10 === 0 ? tm[Math.floor(m/10)] : tm[Math.floor(m/10)] + " " + sm[m%10]);
  if (h === 0) return minWords + (m === 1 ? " minute" : " minutes");
  const hp = (hw[h] || h) + (h === 1 ? " hour" : " hours");
  if (m === 0) return "about " + hp;
  if (m === 30) return "about " + (hw[h] || h) + " and a half hours";
  return "about " + hp + " and " + minWords + " minutes";
}

const fn = String(args.flightNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
if (!fn) return { found: false, message: "What's your flight number?" };
const name = args.name ? String(args.name).trim() : "";

let guest = null;
if (name) {
  const g = await q("/guests?name=ilike." + encodeURIComponent(name) + "&select=*");
  guest = g[0] || await insert("guests", { name: name, loyalty_tier: pick(["standard", "silver", "gold", "platinum"], hash(name)), loyalty_points: (hash(name) % 90000) + 1000 });
}

const airports = ["JFK", "LAX", "ORD", "SFO", "ATL", "DFW", "SEA", "MIA", "BOS", "DEN"];
const h = hash(fn);
const origin = pick(airports, h);
let destination = pick(airports, Math.floor(h / 3));
if (destination === origin) destination = pick(airports, Math.floor(h / 3) + 1);

const roll = h % 100;
let status = "on-time", delayMinutes = 0, disruptionType = "on-time";
if (roll < 35) { status = "cancelled"; disruptionType = "cancelled"; }
else if (roll < 75) { status = "delayed"; delayMinutes = 60 + (h % 300); disruptionType = delayMinutes >= 120 ? "major-delay" : "minor-delay"; }
const needsRebooking = status === "cancelled" || delayMinutes >= 120;

const dep = new Date(); dep.setHours(8 + (h % 12), h % 60, 0, 0);
const arr = new Date(dep.getTime() + (90 + (h % 240)) * 60000);
const estDep = status === "delayed" ? new Date(dep.getTime() + delayMinutes * 60000) : dep;

let booking = null;
if (guest) { const b = await q("/flight_bookings?guest_id=eq." + guest.id + "&flight_number=eq." + encodeURIComponent(fn) + "&limit=1"); booking = b[0] || null; }
if (!booking) { const b2 = await q("/flight_bookings?flight_number=eq." + encodeURIComponent(fn) + "&limit=1"); booking = b2[0] || null; }
if (!booking) {
  booking = await insert("flight_bookings", {
    guest_id: guest ? guest.id : null,
    flight_number: fn, origin: origin, destination: destination,
    departure_time: dep.toISOString(), arrival_time: arr.toISOString(),
    seat: String(1 + (h % 40)) + pick(["A", "B", "C", "D", "E", "F"], h),
    cabin_class: pick(["economy", "economy", "economy", "business", "first"], Math.floor(h / 5)),
    booking_reference: "BK" + pad(h % 1000000, 6), status: status,
  });
}
// Insert can be rejected (e.g. a booking_reference unique collision); never return an empty ref.
if (!booking || !booking.booking_reference) {
  booking = { booking_reference: "BK" + pad(h % 1000000, 6), cabin_class: pick(["economy", "economy", "economy", "business", "first"], Math.floor(h / 5)) };
}

return {
  flightNumber: fn, status: status, delayMinutes: delayMinutes, disruptionType: disruptionType, needsRebooking: needsRebooking,
  origin: origin, destination: destination, scheduledDeparture: dep.toISOString(), estimatedDeparture: estDep.toISOString(),
  bookingReference: booking.booking_reference, cabinClass: booking.cabin_class,
  message: status === "cancelled" ? (fmtFlight(fn) + " from " + city(origin) + " to " + city(destination) + " has been cancelled.")
    : status === "delayed" ? (fmtFlight(fn) + " is delayed " + delayWords(delayMinutes) + ", now departing around " + fmt(estDep) + ".")
    : (fmtFlight(fn) + " from " + city(origin) + " to " + city(destination) + " is on time."),
};
`;

export const FIND_ALTERNATIVES_CODE = `
// Seed the options off the route so a re-call (e.g. after a false barge-in mid-read) returns the
// SAME three flights — the caller can still pick "option two" after an interruption.
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); }
let __seed = hash(String(args.origin || "X").toUpperCase() + "|" + String(args.destination || "Y").toUpperCase() + "|MERIDIAN") || 1;
function rnd() { __seed = (Math.imul(__seed, 1103515245) + 12345) & 0x7fffffff; return __seed / 0x7fffffff; }
function ri(min, max) { return Math.floor(rnd() * (max - min + 1)) + min; }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }
function fmt(d) {
  const h = d.getUTCHours(); const m = d.getUTCMinutes();
  const ap = h >= 12 ? "PM" : "AM"; const h12 = h % 12 || 12;
  const sm = ["","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
  const tm = ["","","twenty","thirty","forty","fifty"];
  const mw = m === 0 ? "" : m < 10 ? "oh " + sm[m] : m < 20 ? sm[m] : m % 10 === 0 ? tm[Math.floor(m/10)] : tm[Math.floor(m/10)] + " " + sm[m%10];
  return sm[h12] + (mw ? " " + mw : "") + " " + ap;
}
function fmtFlightNum(n) {
  const sm = ["","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
  const tm = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
  function two(x) { if (!x) return ""; return x < 20 ? sm[x] : (x % 10 === 0 ? tm[Math.floor(x/10)] : tm[Math.floor(x/10)] + " " + sm[x%10]); }
  if (!Number.isInteger(n) || n < 0 || n > 9999) return String(n).split("").map(function (c) { return (c >= "0" && c <= "9") ? (sm[+c] || "zero") : c; }).join(" ").trim();
  if (n < 100) return two(n);
  if (n < 1000) { const lo2 = n % 100; return sm[Math.floor(n/100)] + " " + (lo2 === 0 ? "hundred" : lo2 < 10 ? "oh " + sm[lo2] : two(lo2)); }
  const hi = Math.floor(n/100); const lo = n % 100;
  return two(hi) + " " + (lo === 0 ? "hundred" : lo < 10 ? "oh " + sm[lo] : two(lo));
}
function fmtFlight(fn) {
  const map = {UA:"United",AA:"American",DL:"Delta",AS:"Alaska",B6:"JetBlue",WN:"Southwest",F9:"Frontier",NK:"Spirit"};
  if (/^\\d+$/.test(fn)) return fmtFlightNum(parseInt(fn, 10)); // bare digits ("1234") → "twelve thirty four", not "12 flight..."
  const m = fn.match(/^([A-Z0-9]{2})(\\d+)$/);
  if (m) return (map[m[1]] || m[1]) + " flight " + fmtFlightNum(parseInt(m[2], 10));
  // Non-canonical input: never read a raw multi-digit run — spell any digits as words.
  return fn.replace(/\\d+/g, function (d) { return " " + fmtFlightNum(parseInt(d, 10)) + " "; }).replace(/ +/g, " ").trim();
}
const carriers = ["UA", "AA", "DL", "AS", "B6", "WN"];
const origin = args.origin ? String(args.origin).toUpperCase() : "";
const destination = args.destination ? String(args.destination).toUpperCase() : "";
const now = new Date();
const options = [];
for (let i = 0; i < 3; i++) {
  const dep = new Date(now.getTime() + (ri(2, 9) + i * 2) * 3600000);
  const arr = new Date(dep.getTime() + (90 + ri(0, 240)) * 60000);
  options.push({
    option: i + 1,
    flightNumber: pick(carriers) + ri(100, 2999),
    origin: origin || null, destination: destination || null,
    departureTime: fmt(dep), arrivalTime: fmt(arr),
    seatsAvailable: ri(2, 30), cabinClass: pick(["economy", "economy", "business"]),
  });
}
return { options: options, message: "Here are three options. Option one: " + fmtFlight(options[0].flightNumber) + " departing " + options[0].departureTime + ". Option two: " + fmtFlight(options[1].flightNumber) + " departing " + options[1].departureTime + ". Option three: " + fmtFlight(options[2].flightNumber) + " departing " + options[2].departureTime + ". Which would you like?" };
`;

export const CONFIRM_REBOOK_CODE = `
const base = env.SUPABASE_URL + "/rest/v1";
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
async function q(path) { const r = await fetch(base + path, { headers: H }); return r.ok ? await r.json() : []; }
async function patch(path, row) { const r = await fetch(base + path, { method: "PATCH", headers: Object.assign({ Prefer: "return=representation" }, H), body: JSON.stringify(row) }); const j = await r.json(); return Array.isArray(j) ? j[0] : j; }
function fmtFlightNum(n) {
  const sm = ["","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
  const tm = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
  function two(x) { if (!x) return ""; return x < 20 ? sm[x] : (x % 10 === 0 ? tm[Math.floor(x/10)] : tm[Math.floor(x/10)] + " " + sm[x%10]); }
  if (!Number.isInteger(n) || n < 0 || n > 9999) return String(n).split("").map(function (c) { return (c >= "0" && c <= "9") ? (sm[+c] || "zero") : c; }).join(" ").trim();
  if (n < 100) return two(n);
  if (n < 1000) { const lo2 = n % 100; return sm[Math.floor(n/100)] + " " + (lo2 === 0 ? "hundred" : lo2 < 10 ? "oh " + sm[lo2] : two(lo2)); }
  const hi = Math.floor(n/100); const lo = n % 100;
  return two(hi) + " " + (lo === 0 ? "hundred" : lo < 10 ? "oh " + sm[lo] : two(lo));
}
function fmtFlight(fn) {
  const map = {UA:"United",AA:"American",DL:"Delta",AS:"Alaska",B6:"JetBlue",WN:"Southwest",F9:"Frontier",NK:"Spirit"};
  if (/^\\d+$/.test(fn)) return fmtFlightNum(parseInt(fn, 10)); // bare digits ("1234") → "twelve thirty four", not "12 flight..."
  const m = fn.match(/^([A-Z0-9]{2})(\\d+)$/);
  if (m) return (map[m[1]] || m[1]) + " flight " + fmtFlightNum(parseInt(m[2], 10));
  // Non-canonical input: never read a raw multi-digit run — spell any digits as words.
  return fn.replace(/\\d+/g, function (d) { return " " + fmtFlightNum(parseInt(d, 10)) + " "; }).replace(/ +/g, " ").trim();
}

const ref = args.bookingReference ? String(args.bookingReference).trim().toUpperCase() : "";
const name = args.name ? String(args.name).trim() : "";
const newFlight = args.newFlightNumber ? String(args.newFlightNumber).toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
const seat = args.seat ? String(args.seat).toUpperCase().split(" ").join("") : "";
if (!newFlight && !seat) return { changed: false, message: "What would you like to change — a different flight, or your seat?" };

let booking = null;
if (ref) { const b = await q("/flight_bookings?booking_reference=ilike." + encodeURIComponent(ref) + "&limit=1"); booking = b[0] || null; }
if (!booking && name) { const g = await q("/guests?name=ilike." + encodeURIComponent(name) + "&select=id"); if (g[0]) { const b = await q("/flight_bookings?guest_id=eq." + g[0].id + "&order=created_at.desc&limit=1"); booking = b[0] || null; } }
if (!booking) {
  // Never fabricate a confirmation out of thin air: if the caller gave NO identifier, ask for one.
  if (!ref && !name) return { changed: false, message: "I couldn't find a booking to change — can I get your name or booking reference?" };
  // They gave a reference/name (demo accepts any): confirm the change against it.
  const parts = []; if (newFlight) parts.push("onto " + fmtFlight(newFlight)); if (seat) parts.push("with your new seat");
  return {
    changed: true, bookingReference: ref || name, flightNumber: newFlight || null, seat: seat || null,
    message: "Done — you're rebooked" + (parts.length ? " " + parts.join(" ") : "") + ". Your booking reference is unchanged, and a confirmation is on its way.",
  };
}

const upd = { status: "active" };
if (newFlight) upd.flight_number = newFlight;
// Only persist a departure time if it is a genuine ISO timestamp. The model often supplies a
// spoken-word time ("nine forty AM"), which would 400 the timestamptz column and, because the
// error object replaces the row, blow up fmtFlight(updated.flight_number) below.
if (args.newDepartureTime && /^\\d{4}-\\d{2}-\\d{2}T/.test(String(args.newDepartureTime)) && !isNaN(Date.parse(args.newDepartureTime))) {
  upd.departure_time = new Date(args.newDepartureTime).toISOString();
}
if (seat) upd.seat = seat;
const updated = await patch("/flight_bookings?id=eq." + booking.id, upd);

// PATCH may still return an error object instead of the row — fall back to known values so we
// never read a field off undefined or speak an empty confirmation.
const okFlight = (updated && updated.flight_number) ? updated.flight_number : (newFlight || booking.flight_number);
const okRef = (updated && updated.booking_reference) ? updated.booking_reference : (booking.booking_reference || ref || name);
const parts = [];
if (newFlight) parts.push("onto " + fmtFlight(okFlight));
if (seat) parts.push("with your new seat");
return {
  changed: true, bookingReference: okRef, flightNumber: okFlight || null,
  seat: (updated && updated.seat) || seat || null, cabinClass: (updated && updated.cabin_class) || null,
  message: "Done — you're rebooked" + (parts.length ? " " + parts.join(" ") : "") + ". Your booking reference is unchanged.",
};
`;

export const COMPENSATION_CODE = `
const tierMult = { standard: 1.0, silver: 1.25, gold: 1.5, platinum: 2.0 };
const tier = args.loyaltyTier ? String(args.loyaltyTier).toLowerCase() : "standard";
const mult = tierMult[tier] || 1.0;
const cancelled = args.cancelled === true || String(args.disruptionType || "").toLowerCase() === "cancelled";
let delayMinutes = Number(args.delayMinutes || 0);
if (!delayMinutes && args.delayHours) delayMinutes = Number(args.delayHours) * 60;

let base = cancelled ? 200 : Math.round((delayMinutes / 60) * 40);
let voucher = Math.round(base * mult);
if (voucher > 500) voucher = 500;
if (voucher < 0) voucher = 0;
const eligible = voucher > 0;
// Return NO dollar figure or raw minute count to the model — the credit is a pending request,
// sized by the back office, never spoken. Only an eligibility flag + tier reach the model.
return {
  eligible: eligible, tier: tier,
  message: eligible
    ? "I've noted a travel credit request for this disruption; our team will review it and follow up."
    : "There's no eligible disruption here, so there's nothing to submit.",
};
`;
