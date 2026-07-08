/**
 * Vercel serverless entry point — wraps the Meridian Express app.
 * All routes (/webhook, /health) are handled by the Express router.
 * Env vars come from Vercel's environment (not .env files).
 */
import express from "express";
import { webhookRouter } from "../src/routes/webhook.js";

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(webhookRouter);
app.get("/health", (_req, res) => res.json({ ok: true, service: "meridian" }));

export default app;
