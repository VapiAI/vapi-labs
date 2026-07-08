/**
 * Preflight — confirms every credential Meridian needs is present and live,
 * without printing secret values. Run before migrate/seed or any phase.
 *
 *   npm run check
 */
import pg from "pg";
import { env } from "../config.js";
import { header } from "../utils/print.js";

header("Meridian — preflight connection check");

function mask(v?: string) {
  return v ? `${v.slice(0, 4)}…${v.slice(-4)} (len ${v.length})` : "MISSING";
}

/** Identify what's actually in the key field, without printing the secret. */
function classifyKey(v?: string): string {
  if (!v) return "MISSING";
  if (v.startsWith("eyJ")) return "JWT (anon or service_role) — correct shape ✓";
  if (v.startsWith("sb_secret_")) return "new secret key — correct shape ✓";
  if (v.startsWith("sb_publishable_")) return "PUBLISHABLE key ✗ (client-side — you need the SECRET / service_role)";
  if (/^postgres(ql)?:\/\//.test(v) || v.toLowerCase().startsWith("postgres")) return "Postgres connection string ✗ (wrong field — that belongs in SUPABASE_DB_URL)";
  if (v.startsWith("http")) return "a URL ✗ (wrong field)";
  return "unrecognized format ✗";
}

console.log("Env presence:");
console.log("  VAPI_API_KEY          :", env.vapiApiKey ? "set" : "MISSING");
console.log("  VAPI_WEBHOOK_SECRET   :", env.webhookSecret ? "set" : "MISSING");
console.log("  SUPABASE_URL          :", env.supabaseUrl ?? "MISSING");
console.log("  SUPABASE_SERVICE_ROLE :", mask(env.supabaseServiceKey));
console.log("  SERVICE_ROLE type     :", classifyKey(env.supabaseServiceKey));
console.log("  SUPABASE_DB_URL       :", env.supabaseDbUrl ? "set" : "MISSING");

let ok = true;

// 1) Supabase REST — used by seed.ts + lookup_reservation (supabase-js)
if (env.supabaseUrl && env.supabaseServiceKey) {
  try {
    const r = await fetch(`${env.supabaseUrl}/rest/v1/`, {
      headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}` },
    });
    console.log(`\nSupabase REST → HTTP ${r.status}  ${r.ok ? "✓ URL + key valid" : "✗ check URL/key"}`);
    if (!r.ok) ok = false;
  } catch (e: any) {
    console.log("\nSupabase REST → ✗", e?.message);
    ok = false;
  }
} else {
  console.log("\nSupabase REST → skipped (URL/key missing)");
  ok = false;
}

// 2) Postgres — used by migrate.ts (pg)
if (env.supabaseDbUrl) {
  const c = new pg.Client({ connectionString: env.supabaseDbUrl, ssl: { rejectUnauthorized: false } });
  try {
    await c.connect();
    const r = await c.query("select current_database() as db, current_user as usr");
    console.log("Postgres      → ✓ connected:", r.rows[0]);
  } catch (e: any) {
    console.log("Postgres      → ✗", e?.message);
    ok = false;
  } finally {
    try {
      await c.end();
    } catch {
      /* ignore */
    }
  }
} else {
  console.log("Postgres      → skipped (DB URL missing)");
  ok = false;
}

console.log(`\n${ok ? "✓ All systems go — ready to migrate + seed." : "✗ Fix the items marked ✗ above."}`);
process.exit(ok ? 0 : 1);
