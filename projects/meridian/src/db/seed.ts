/**
 * Seeds one demo guest + reservation so Phase 1 lookups return a real hit.
 * Idempotent: guest is found-or-created by email; reservation upserts on
 * confirmation_number (which is unique in the schema).
 *
 *   npm run seed
 */
import { supabase } from "./client.js";
import { header, pretty } from "../utils/print.js";

header("Meridian — seed demo data");
const db = supabase();

const DEMO_EMAIL = "jordan.rivera@example.com";

// guests.email is not unique in the schema, so find-or-create manually.
let { data: guest, error: findErr } = await db
  .from("guests")
  .select("*")
  .eq("email", DEMO_EMAIL)
  .maybeSingle();
if (findErr) throw new Error(findErr.message);

if (!guest) {
  const ins = await db
    .from("guests")
    .insert({
      name: "Jordan Rivera",
      email: DEMO_EMAIL,
      phone: "+14155550142",
      loyalty_tier: "gold",
      loyalty_points: 24500,
      travel_credit_balance: 0,
    })
    .select()
    .single();
  if (ins.error) throw new Error(ins.error.message);
  guest = ins.data;
}

// reservations.confirmation_number is unique → safe to upsert.
const { error: rErr } = await db.from("reservations").upsert(
  {
    confirmation_number: "MGH12345",
    guest_id: guest.id,
    property_name: "Meridian Grand Hotel",
    room_number: "1204",
    room_type: "King Suite",
    check_in: "2026-06-22",
    check_out: "2026-06-25",
    status: "active",
    special_requests: "High floor, late checkout requested",
  },
  { onConflict: "confirmation_number" }
);
if (rErr) throw new Error(rErr.message);

pretty("Seeded", {
  guest: guest.name,
  tier: guest.loyalty_tier,
  confirmation: "MGH12345",
  room: "1204 (King Suite)",
});
