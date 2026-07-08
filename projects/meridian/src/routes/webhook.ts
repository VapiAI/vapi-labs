/**
 * Vapi webhook router.
 *  - Verifies the shared secret (x-vapi-secret header) on every request.
 *  - Dispatches `tool-calls` to handlers in the registry below.
 *  - Acks lifecycle events (call_logs wiring lands in Phase 4).
 *
 * Vapi resolves the webhook URL in this order:
 *   tool.server.url → assistant.server.url → phoneNumber.server.url → org.server.url
 * Meridian wires it at the PHONE-NUMBER level (the Demo Line's serverUrl, routed to the
 * Concierge Squad) — no assistant sets server. Code-tool calls run on Vapi infra and do NOT
 * hit this handler; the standalone Outbound assistant has no server wiring either.
 */
import { Router, type Request, type Response } from "express";
import { PostHog } from "posthog-node";
import { env } from "../config.js";
import { supabase } from "../db/client.js";
import { lookupReservation } from "../tools/lookup_reservation.js";


type ToolCtx = { callId?: string };
type ToolHandler = (args: Record<string, any>, ctx: ToolCtx) => unknown | Promise<unknown>;

const toolHandlers: Record<string, ToolHandler> = {
  lookup_reservation: (args) => lookupReservation(args),
  // handle_service_request, get_flight_status, find_alternative_flights, ... land in later phases.
};

/** Vapi sends tool-call arguments as a JSON string or an already-parsed object. */
function parseArgs(raw: unknown): Record<string, any> {
  if (raw == null) return {};
  if (typeof raw === "object") return raw as Record<string, any>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

export const webhookRouter = Router();

webhookRouter.post("/webhook", async (req: Request, res: Response) => {
  // ── Native Vapi auth: shared secret echoed in the x-vapi-secret header ──
  const provided = req.header("x-vapi-secret");
  // Fail closed: with no VAPI_WEBHOOK_SECRET configured, nothing authenticates.
  if (!env.webhookSecret || !provided || provided !== env.webhookSecret) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const message = (req.body?.message ?? {}) as Record<string, any>;
  const type = message.type as string | undefined;
  const callId = message.call?.id as string | undefined;
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${type ?? "unknown"}${callId ? ` call=${callId.slice(0, 8)}` : ""}`);

  switch (type) {
    case "tool-calls": {
      const toolCallList = (message.toolCallList ?? []) as Array<{
        id: string;
        function?: { name?: string; arguments?: unknown };
      }>;

      const results = await Promise.all(
        toolCallList.map(async (tc) => {
          const name = tc.function?.name;
          const args = parseArgs(tc.function?.arguments);
          const handler = name ? toolHandlers[name] : undefined;
          if (!handler) {
            return { toolCallId: tc.id, error: `Tool "${name}" not found` };
          }
          try {
            const output = await handler(args, { callId });
            console.log(`  → ${name}(${JSON.stringify(args)}) → ok`);
            // Vapi expects `result` as a string; stringify structured output.
            return { toolCallId: tc.id, result: JSON.stringify(output) };
          } catch (err: any) {
            console.error(`tool "${name}" failed:`, err?.message ?? err);
            return { toolCallId: tc.id, error: `Tool "${name}" failed: ${err?.message ?? "unknown error"}` };
          }
        })
      );
      return res.json({ results });
    }

    case "end-of-call-report": {
      // Analytics sink: it must NEVER throw out of the handler, or Vapi sees a
      // timeout and retries. Everything below is wrapped so we always 200.
      try {
        if (env.supabaseUrl && env.supabaseServiceKey) {
          const call = message.call as Record<string, any> | undefined;
          const artifact = message.artifact as Record<string, any> | undefined;
          const analysis = message.analysis as Record<string, any> | undefined;
          const structured = (analysis?.structuredData ?? {}) as Record<string, any>;

          const startMs = call?.startedAt ? new Date(call.startedAt).getTime() : null;
          const endMs = call?.endedAt ? new Date(call.endedAt).getTime() : null;
          const durationSeconds = startMs && endMs ? Math.round((endMs - startMs) / 1000) : null;

          const guestName: string | null = structured.guestName ?? structured.memberName ?? null;
          let guestId: string | null = null;
          if (guestName) {
            const { data } = await supabase().from("guests").select("id").ilike("name", guestName).limit(1);
            guestId = data?.[0]?.id ?? null;
          }

          // Squad calls populate call.squad, not call.assistant — best-effort the active member,
          // then fall back to the squad name so attribution is never silently null.
          const assistantName: string | null =
            call?.assistant?.name ?? (message as any)?.assistant?.name ?? call?.squad?.name ?? null;
          const callType = assistantName === "Meridian — Outbound Disruption" ? "outbound" : "inbound";

          // Members emit different field names; read them all (the analysis model fills only its own member's keys).
          const upsellOffered: boolean = structured.upgradeOffered ?? structured.upsellOffered ?? false;
          const upsellConverted: boolean = structured.upgradeRequested ?? structured.upsellConverted ?? false;
          const creditRequested: boolean =
            structured.creditRequestSubmitted ?? structured.creditFollowUpRaised ?? structured.creditRequestRaised ?? false;

          await supabase().from("call_logs").upsert(
            {
              vapi_call_id: call?.id ?? null,
              guest_id: guestId,
              assistant_name: assistantName,
              call_type: callType,
              resolution: call?.endedReason ?? null,
              transcript: artifact?.transcript ?? null,
              upsell_offered: upsellOffered,
              upsell_converted: upsellConverted,
              duration_seconds: durationSeconds,
            },
            { onConflict: "vapi_call_id" }
          );

          if (env.posthogApiKey && call?.id) {
            const resolvedEnded = call?.endedReason ?? "unknown";
            const deflected = ["customer-ended-call", "assistant-ended-call"].includes(resolvedEnded);
            const ph = new PostHog(env.posthogApiKey, { host: "https://us.i.posthog.com" });
            ph.capture({
              distinctId: call.id,
              event: "meridian_call_completed",
              properties: {
                assistant_name: assistantName,
                call_type: callType,
                resolution: resolvedEnded,
                deflected,
                upsell_offered: upsellOffered,
                upsell_converted: upsellConverted,
                credit_requested: creditRequested,
                duration_seconds: durationSeconds,
                guest_id: guestId,
              },
            });
            await ph.shutdown();
          }
        }
      } catch (err: any) {
        console.error("end-of-call-report handling failed (ignored):", err?.message ?? err);
      }
      return res.sendStatus(200);
    }

    default:
      return res.sendStatus(200);
  }
});
