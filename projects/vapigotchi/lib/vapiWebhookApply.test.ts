import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  callSpeakerSet: vi.fn(),
  callStatusSet: vi.fn(),
}));

vi.mock("./petRepository", () => ({
  petRepository: repositoryMocks,
}));

import { vapiWebhookApply } from "./vapiWebhookApply";

const UNUSED_DEFAULT_SERVER_MESSAGES = [
  "assistant.started",
  "conversation-update",
  "end-of-call-report",
  "function-call",
  "hang",
  "handoff-destination-request",
  "tool-calls",
  "transfer-destination-request",
  "user-interrupted",
];

describe("Vapi webhook application", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(UNUSED_DEFAULT_SERVER_MESSAGES)(
    "acknowledges %s without touching pet state",
    async (type) => {
      await expect(
        vapiWebhookApply("pet-1", {
          message: {
            type,
            assistant: { name: "Byte" },
            call: { id: "call-1" },
          },
        }),
      ).resolves.toEqual({ handled: false, eventType: type });

      expect(repositoryMocks.callSpeakerSet).not.toHaveBeenCalled();
      expect(repositoryMocks.callStatusSet).not.toHaveBeenCalled();
    },
  );

  it.each([null, [], "message", {}, { message: null }])(
    "treats an unrelated JSON payload as an ignored message",
    async (payload) => {
      await expect(vapiWebhookApply("pet-1", payload)).resolves.toEqual({
        handled: false,
        eventType: null,
      });
    },
  );

  it("applies a valid status update", async () => {
    await expect(
      vapiWebhookApply("pet-1", {
        message: {
          type: "status-update",
          status: "in-progress",
          assistant: { name: "Byte" },
          call: {
            id: "call-1",
            startedAt: "2026-08-19T12:00:00.000Z",
          },
        },
      }),
    ).resolves.toEqual({ handled: true, eventType: "status-update" });

    expect(repositoryMocks.callStatusSet).toHaveBeenCalledWith(
      "pet-1",
      "call-1",
      "in-progress",
      "2026-08-19T12:00:00.000Z",
      "Byte",
    );
  });

  it("applies a valid speech update", async () => {
    await expect(
      vapiWebhookApply("pet-1", {
        message: {
          type: "speech-update",
          status: "started",
          role: "assistant",
          assistant: { name: "Byte" },
          call: { id: "call-1" },
        },
      }),
    ).resolves.toEqual({ handled: true, eventType: "speech-update" });

    expect(repositoryMocks.callSpeakerSet).toHaveBeenCalledWith(
      "pet-1",
      "call-1",
      "assistant",
      true,
      "Byte",
    );
  });
});
