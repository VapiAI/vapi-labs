import { petRepository } from "./petRepository";
import type {
  CallStatus,
  SpeakerRole,
  VapiWebhookMessage,
  VapiWebhookPayload,
} from "./types";

const CALL_STATUSES: CallStatus[] = [
  "scheduled",
  "queued",
  "ringing",
  "in-progress",
  "forwarding",
  "ended",
];

function isCallStatus(value: unknown): value is CallStatus {
  return typeof value === "string" && CALL_STATUSES.includes(value as CallStatus);
}

function isSpeakerRole(value: unknown): value is SpeakerRole {
  return value === "assistant" || value === "user";
}

function webhookMessageGet(payload: unknown): VapiWebhookMessage | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const message = (payload as VapiWebhookPayload).message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return undefined;
  }

  return message;
}

export async function vapiWebhookApply(
  petId: string,
  payload: unknown,
): Promise<{ handled: boolean; eventType: string | null }> {
  const message = webhookMessageGet(payload);
  if (!message) {
    return { handled: false, eventType: null };
  }

  const eventType = typeof message.type === "string" ? message.type : null;
  if (eventType !== "status-update" && eventType !== "speech-update") {
    return { handled: false, eventType };
  }

  const assistantName =
    typeof message.assistant?.name === "string"
      ? message.assistant.name
      : undefined;
  const callId =
    typeof message.call?.id === "string" ? message.call.id : undefined;
  if (eventType === "status-update" && callId) {
    const status = message.status ?? message.call?.status;
    if (isCallStatus(status)) {
      await petRepository.callStatusSet(
        petId,
        callId,
        status,
        typeof message.call?.startedAt === "string"
          ? message.call.startedAt
          : undefined,
        assistantName,
      );
      return { handled: true, eventType };
    }
  }

  if (eventType === "speech-update" && callId && isSpeakerRole(message.role)) {
    if (message.status === "started" || message.status === "stopped") {
      await petRepository.callSpeakerSet(
        petId,
        callId,
        message.role,
        message.status === "started",
        assistantName,
      );
      return { handled: true, eventType };
    }
  }

  return { handled: false, eventType };
}
