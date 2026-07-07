/**
 * lookup_reservation — find a guest's reservation by confirmation number
 * (preferred, unique) or by name. Returns a verbal-friendly profile for Aria.
 */
import { supabase, type Guest, type Reservation } from "../db/client.js";

export interface LookupReservationArgs {
  name?: string;
  confirmationNumber?: string;
}

type ReservationRow = Reservation & { guests?: Guest | null };

function shape(reservation: ReservationRow, guest: Guest | null | undefined) {
  return {
    found: true as const,
    guest: guest
      ? {
          firstName: guest.name?.split(" ")[0] ?? guest.name,
          fullName: guest.name,
          loyaltyTier: guest.loyalty_tier ?? "standard",
          loyaltyPoints: guest.loyalty_points ?? 0,
        }
      : null,
    reservation: {
      confirmationNumber: reservation.confirmation_number,
      property: reservation.property_name,
      roomNumber: reservation.room_number,
      roomType: reservation.room_type,
      checkIn: reservation.check_in,
      checkOut: reservation.check_out,
      status: reservation.status,
      specialRequests: reservation.special_requests,
    },
  };
}

export async function lookupReservation(args: LookupReservationArgs) {
  const db = supabase();
  const conf = args.confirmationNumber?.trim();
  const name = args.name?.trim();

  // 1) Confirmation number is unique — try it first.
  if (conf) {
    const { data, error } = await db
      .from("reservations")
      .select("*, guests(*)")
      .ilike("confirmation_number", conf)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return shape(data as ReservationRow, (data as ReservationRow).guests ?? null);
  }

  // 2) Fall back to name → newest reservation for that guest.
  if (name) {
    const { data: guests, error: gErr } = await db.from("guests").select("*").ilike("name", name).limit(3);
    if (gErr) throw new Error(gErr.message);

    if (guests && guests.length > 1) {
      return {
        found: false as const,
        reason: "multiple_matches",
        message:
          "I'm seeing more than one guest under that name. Could you share your confirmation number so I pull up the right reservation?",
      };
    }
    if (guests && guests.length === 1) {
      const guest = guests[0] as Guest;
      const { data: r, error: rErr } = await db
        .from("reservations")
        .select("*")
        .eq("guest_id", guest.id)
        .order("check_in", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (rErr) throw new Error(rErr.message);
      if (r) return shape(r as ReservationRow, guest);
      return {
        found: false as const,
        reason: "guest_without_reservation",
        message: `I found your profile but no active reservation. Want me to take down a new request?`,
      };
    }
  }

  return {
    found: false as const,
    reason: "no_match",
    message:
      "I couldn't find a reservation under that name or confirmation number. Could you spell the last name, or read me the confirmation number?",
  };
}
