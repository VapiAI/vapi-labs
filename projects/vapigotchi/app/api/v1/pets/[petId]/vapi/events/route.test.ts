import { beforeEach, describe, expect, it, vi } from "vitest";

const vapiWebhookApplyMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/vapiWebhookApply", () => ({
  vapiWebhookApply: vapiWebhookApplyMock,
}));

import { POST } from "./route";

describe("Vapi event endpoint", () => {
  beforeEach(() => {
    vapiWebhookApplyMock.mockResolvedValue({
      handled: false,
      eventType: "end-of-call-report",
    });
  });

  it("returns 200 for an unused default server message", async () => {
    const response = await POST(
      new Request("https://vapigotchi.test/vapi/events", {
        body: JSON.stringify({
          message: {
            type: "end-of-call-report",
            assistant: { name: "Byte" },
            call: { id: "call-1" },
          },
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ petId: "pet-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      received: true,
      handled: false,
      eventType: "end-of-call-report",
    });
    expect(vapiWebhookApplyMock).toHaveBeenCalledWith("pet-1", {
      message: {
        type: "end-of-call-report",
        assistant: { name: "Byte" },
        call: { id: "call-1" },
      },
    });
  });
});
