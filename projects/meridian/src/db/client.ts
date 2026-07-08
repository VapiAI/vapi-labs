/** Supabase service-role client + row types. Server-side only (bypasses RLS). */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config.js";

let _client: SupabaseClient | undefined;

/** Lazily construct the client so the server can boot even before creds are set. */
export function supabase(): SupabaseClient {
  if (!_client) {
    if (!env.supabaseUrl || !env.supabaseServiceKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in meridian/.env");
    }
    // env.supabaseUrl is normalized (any pasted /rest/v1 suffix stripped) so supabase-js
    // builds /rest/v1/<table> correctly.
    _client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

export interface Guest {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  loyalty_tier: "standard" | "silver" | "gold" | "platinum" | null;
  loyalty_points: number;
  travel_credit_balance: number;
}

export interface Reservation {
  id: string;
  confirmation_number: string;
  guest_id: string | null;
  property_name: string | null;
  room_number: string | null;
  room_type: string | null;
  check_in: string | null;
  check_out: string | null;
  status: string;
  special_requests: string | null;
}
