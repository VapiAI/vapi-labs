/**
 * Meridian environment + shared Vapi client.
 *
 * Loads meridian/.env — copy .env.example to .env and fill in your values.
 * Only VAPI_API_KEY is required for the core demo (assistants + squad);
 * the rest enable persistence, the optional webhook server, and analytics.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { VapiClient } from "@vapi-ai/server-sdk";

const here = path.dirname(fileURLToPath(import.meta.url)); // meridian/src
dotenv.config({ path: path.resolve(here, "../.env") }); //    meridian/.env

export function req(key: string): string {
  const v = process.env[key]?.trim();
  if (!v) throw new Error(`Missing env var: ${key} — add it to meridian/.env`);
  return v;
}
function opt(key: string): string | undefined {
  return process.env[key]?.trim() || undefined;
}

/** Accept a pasted REST endpoint (…/rest/v1/) and reduce it to the base project URL. */
function normalizeSupabaseUrl(u?: string): string | undefined {
  if (!u) return undefined;
  return u.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
}

export const env = {
  vapiApiKey: req("VAPI_API_KEY"),
  /** Shared secret for the optional webhook server (any string you invent). */
  webhookSecret: opt("VAPI_WEBHOOK_SECRET"),
  webhookPort: Number(process.env.MERIDIAN_PORT ?? 3100),
  serverUrl: opt("SERVER_URL"),
  supabaseUrl: normalizeSupabaseUrl(opt("SUPABASE_URL")),
  supabaseServiceKey: opt("SUPABASE_SERVICE_ROLE_KEY"),
  supabaseDbUrl: opt("SUPABASE_DB_URL"),
  posthogApiKey: opt("POSTHOG_API_KEY"),
  /**
   * File id of assets/hotel-knowledge-base.txt after uploading it to YOUR
   * Vapi org (`npm run kb:upload` prints it). If unset, the hotel assistant
   * is created without the knowledge-base query tool.
   */
  hotelKbFileId: opt("HOTEL_KB_FILE_ID"),
};

export const vapi = new VapiClient({ token: env.vapiApiKey });
