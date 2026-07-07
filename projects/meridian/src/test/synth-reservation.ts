/**
 * Live integration test for the standalone code tools — executes the EXACT code
 * shipped to Vapi (lookup-code.ts / service-request-code.ts) against your real
 * Supabase. The bodies use `await`, so they're reconstructed as async functions.
 *
 *   npm run test:synth
 */
import { env } from "../config.js";
import { LOOKUP_CODE } from "../vapi/lookup-code.js";
import { SERVICE_REQUEST_CODE } from "../vapi/service-request-code.js";
import { header, pretty } from "../utils/print.js";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as any;
const lookup = new AsyncFunction("args", "env", LOOKUP_CODE);
const serviceRequest = new AsyncFunction("args", "env", SERVICE_REQUEST_CODE);

if (!env.supabaseUrl || !env.supabaseServiceKey) throw new Error("Supabase env missing — fill meridian/.env");
const toolEnv = { SUPABASE_URL: env.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: env.supabaseServiceKey };

header("Standalone code tools — live Supabase integration");

async function lookupCheck(label: string, args: Record<string, any>) {
  const a = await lookup(args, toolEnv);
  const b = await lookup(args, toolEnv); // second call must match → persisted
  const same = JSON.stringify(a) === JSON.stringify(b);
  pretty(`${label}  [persists: ${same ? "✓" : "✗"}]`, a);
  return a;
}

const justin = await lookupCheck('name "Justin Crowe"', { name: "Justin Crowe" });
await lookupCheck('name "Mallory Gray"', { name: "Mallory Gray" });
await lookupCheck('conf "MGH12345"', { confirmationNumber: "MGH12345" });

header("handle_service_request");
const sr = await serviceRequest(
  { name: "Justin Crowe", requestType: "extra towels", description: "two extra bath towels" },
  toolEnv
);
pretty("service request →", sr);
console.log(`\nattached to room ${justin?.reservation?.roomNumber} | reference ${sr?.reference}`);
