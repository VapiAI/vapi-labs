/**
 * issue_travel_credit (registered tool name) — Vapi **Code tool** body (Vapi infra; async).
 * Despite the legacy name, it only SUBMITS a pending request — it does not issue/apply anything.
 * Logs a PENDING travel-credit request for team review. It does NOT apply a
 * credit, touch any balance, or speak/return a dollar amount — the spoken line
 * and the system of record must agree: a request was submitted, nothing granted.
 * Standalone (no webhook); writes to the existing service_requests table.
 *
 * args: name (required), reason (optional).
 * env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
export const ISSUE_TRAVEL_CREDIT_CODE = `
const base = env.SUPABASE_URL + "/rest/v1";
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
async function q(path) { const r = await fetch(base + path, { headers: H }); return r.ok ? await r.json() : []; }
async function insert(t, row) { const r = await fetch(base + "/" + t, { method: "POST", headers: Object.assign({ Prefer: "return=representation" }, H), body: JSON.stringify(row) }); const j = await r.json(); return Array.isArray(j) ? j[0] : j; }

const name = args.name ? String(args.name).trim() : "";
const reason = args.reason ? String(args.reason).trim() : "flight disruption";
if (!name) return { submitted: false, message: "Whose account is this for — can I get your name?" };

// Link to the guest if we can find them; submit the request either way.
const guests = await q("/guests?name=ilike." + encodeURIComponent(name) + "&select=id");
const guestId = guests[0] ? guests[0].id : null;

await insert("service_requests", {
  reservation_id: null,
  guest_id: guestId,
  request_type: "travel credit",
  description: "Travel-credit request — " + reason + " (submitted by phone, pending team review).",
  status: "pending_review",
});

return {
  submitted: true, status: "pending_review", reason: reason,
  message: "I've submitted a travel credit request for your account. Our team will review it and be in touch as soon as possible.",
};
`;
