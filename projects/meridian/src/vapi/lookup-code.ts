/**
 * lookup_reservation — Vapi **Code tool** body (runs on Vapi infra; `args`/`env`
 * in scope; async; end with `return`). Talks to Supabase REST directly, so the
 * assistant stays standalone (no webhook) yet persistent.
 *
 * Behavior:
 *   - confirmation number → returns that reservation (with guest).
 *   - known guest name    → returns their persisted reservation.
 *   - NEW name            → invents a RANDOM reservation, assigns a confirmation
 *                           number, writes guest + reservation to Supabase, and
 *                           returns it. Same name next time → same record.
 *
 * env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (set on the tool).
 * Verified end-to-end by src/test/synth-reservation.ts.
 */
export const LOOKUP_CODE = `
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
function ri(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function rp(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pad(n, w) { return String(n).padStart(w, "0"); }
function fmt(d) { return d.toISOString().slice(0, 10); }
// Spoken-word date so TTS never reads an ISO string like "2026-06-25".
function spokenDate(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\\d{4})-(\\d{2})-(\\d{2})/);
  if (!m) return iso;
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const ord = ["","first","second","third","fourth","fifth","sixth","seventh","eighth","ninth","tenth","eleventh","twelfth","thirteenth","fourteenth","fifteenth","sixteenth","seventeenth","eighteenth","nineteenth","twentieth","twenty first","twenty second","twenty third","twenty fourth","twenty fifth","twenty sixth","twenty seventh","twenty eighth","twenty ninth","thirtieth","thirty first"];
  const day = parseInt(m[3], 10);
  return months[parseInt(m[2], 10) - 1] + " " + (ord[day] || day);
}

function shape(guest, resv) {
  guest = guest || {};
  return {
    found: true,
    guest: {
      firstName: (guest.name || "Guest").split(" ")[0],
      fullName: guest.name || "Valued Guest",
      loyaltyTier: guest.loyalty_tier || "standard",
      // loyaltyPoints intentionally omitted: a raw 5-digit balance would be read aloud as a
      // mangled numeral. Loyalty is surfaced as the tier (a word) only.
    },
    reservation: {
      confirmationNumber: resv.confirmation_number,
      property: resv.property_name,
      roomNumber: resv.room_number,
      roomType: resv.room_type,
      checkIn: spokenDate(resv.check_in),
      checkOut: spokenDate(resv.check_out),
      status: resv.status,
      specialRequests: resv.special_requests,
    },
  };
}

const conf = args.confirmationNumber ? String(args.confirmationNumber).trim().toUpperCase() : "";
const name = args.name ? String(args.name).trim() : "";

if (conf) {
  const rows = await q("/reservations?confirmation_number=eq." + encodeURIComponent(conf) + "&select=*,guests(*)");
  if (rows[0]) return shape(rows[0].guests, rows[0]);
}

if (name) {
  const guests = await q("/guests?name=ilike." + encodeURIComponent(name) + "&select=*");
  let guest = guests[0];
  if (guest) {
    const resv = await q("/reservations?guest_id=eq." + guest.id + "&order=check_in.desc&limit=1&select=*");
    if (resv[0]) return shape(guest, resv[0]);
  } else {
    guest = await insert("guests", {
      name: name,
      loyalty_tier: rp(["standard", "silver", "gold", "platinum"]),
      loyalty_points: ri(500, 95000),
    });
  }
  const today = new Date();
  const co = new Date(today);
  co.setDate(co.getDate() + ri(1, 5));
  const resv = await insert("reservations", {
    confirmation_number: "MGH" + pad(ri(0, 999999), 6),
    guest_id: guest.id,
    property_name: "Meridian Grand Hotel",
    room_number: String(ri(2, 20)) + pad(ri(1, 40), 2),
    room_type: rp(["Standard Queen", "Deluxe King", "King Suite", "Ocean-View Suite", "Garden Double"]),
    check_in: fmt(today),
    check_out: fmt(co),
    status: "active",
    special_requests: rp(["High floor", "Late checkout requested", "Extra towels on arrival", "Quiet room", "Early check-in"]),
  });
  return shape(guest, resv);
}

return { found: false, message: "Could you share your name or confirmation number so I can pull up your reservation?" };
`;
