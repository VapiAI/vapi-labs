/**
 * Applies db/schema.sql to your Supabase Postgres.
 * Requires SUPABASE_DB_URL (Supabase → Project Settings → Database → Connection string → URI).
 *
 *   npm run migrate
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { env } from "../config.js";
import { header } from "../utils/print.js";

header("Meridian — apply schema");

if (!env.supabaseDbUrl) {
  throw new Error(
    "Set SUPABASE_DB_URL in meridian/.env (Supabase → Project Settings → Database → Connection string → URI)."
  );
}

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.resolve(here, "schema.sql"), "utf8");

const client = new pg.Client({
  connectionString: env.supabaseDbUrl,
  ssl: { rejectUnauthorized: false }, // Supabase requires SSL
});

await client.connect();
try {
  await client.query(sql);
  console.log("✓ Schema applied: guests, reservations, flight_bookings, service_requests, call_logs.");
} finally {
  await client.end();
}
