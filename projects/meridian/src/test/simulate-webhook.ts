/**
 * Phase 1 check — POSTs a fake Vapi `tool-calls` webhook for lookup_reservation to
 * the local server, exactly as Vapi would (including the x-vapi-secret header).
 * Also confirms a request WITHOUT the secret is rejected (401).
 *
 *   npm run server                      # terminal 1
 *   npm run test:webhook -- MGH12345    # terminal 2 (optional conf# arg)
 */
import { env, req as reqEnv } from "../config.js";
import { header, pretty } from "../utils/print.js";

const base = `http://localhost:${env.webhookPort}`;
const secret = reqEnv("VAPI_WEBHOOK_SECRET");
const conf = process.argv[2] ?? "MGH12345";

function toolCallsPayload(args: Record<string, unknown>) {
  return {
    message: {
      type: "tool-calls",
      call: { id: "sim-call-001" },
      toolCallList: [
        {
          id: "toolcall_sim_1",
          type: "function",
          function: { name: "lookup_reservation", arguments: JSON.stringify(args) },
        },
      ],
    },
  };
}

header("Simulate: lookup_reservation tool-call");

// 1) Negative: missing secret must be rejected.
const noAuth = await fetch(`${base}/webhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(toolCallsPayload({ confirmationNumber: conf })),
});
console.log(`no-secret request  → HTTP ${noAuth.status}  (expect 401)`);

// 2) Authenticated call.
const res = await fetch(`${base}/webhook`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-vapi-secret": secret },
  body: JSON.stringify(toolCallsPayload({ confirmationNumber: conf })),
});
const json = (await res.json().catch(() => ({}))) as any;
pretty(`authenticated request → HTTP ${res.status}`, json);

// Decode the tool result so you can read what Aria would receive.
const raw = json?.results?.[0]?.result;
if (raw) pretty("decoded tool result", JSON.parse(raw));
