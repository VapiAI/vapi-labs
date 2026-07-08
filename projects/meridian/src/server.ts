/**
 * Meridian webhook server — the single endpoint Vapi calls for tool execution
 * and call lifecycle events.
 *
 *   npm run server                                  # terminal 1 (:3100)
 *   ./bin/cloudflared tunnel --url http://localhost:3100     # terminal 2 → public URL
 */
import express from "express";
import { env } from "./config.js";
import { webhookRouter } from "./routes/webhook.js";
import { header } from "./utils/print.js";

const app = express();
// Vapi end-of-call reports (transcript + messages) can exceed Express's 100kb default.
app.use(express.json({ limit: "5mb" }));
app.use(webhookRouter);
app.get("/health", (_req, res) => res.json({ ok: true, service: "meridian" }));

app.listen(env.webhookPort, () => {
  header("Meridian webhook server");
  console.log(`  POST http://localhost:${env.webhookPort}/webhook   (x-vapi-secret required)`);
  console.log(`  GET  http://localhost:${env.webhookPort}/health`);
  console.log(`\n  Expose publicly:  ./bin/cloudflared tunnel --url http://localhost:${env.webhookPort}`);
});
