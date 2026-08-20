import { beforeEach, describe, expect, it, vi } from "vitest";

const careMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/petRepository", () => ({
  petRepository: { care: careMock },
}));

import { POST } from "./route";

describe("pet care endpoint", () => {
  beforeEach(() => {
    careMock.mockReset();
    careMock.mockResolvedValue({ ok: true });
  });

  it("starts a supported care action", async () => {
    const response = await POST(
      new Request("https://vapigotchi.test/care", {
        body: JSON.stringify({ action: "dance-salsa" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ petId: "pet-1" }) },
    );

    expect(response.status).toBe(201);
    expect(careMock).toHaveBeenCalledWith("pet-1", {
      action: "dance-salsa",
      assistantName: undefined,
      callId: undefined,
    });
  });

  it("rejects an unsupported care action", async () => {
    const response = await POST(
      new Request("https://vapigotchi.test/care", {
        body: JSON.stringify({ action: "fly" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ petId: "pet-1" }) },
    );

    expect(response.status).toBe(400);
    expect(careMock).not.toHaveBeenCalled();
  });
});
