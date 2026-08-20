import { describe, expect, it } from "vitest";
import { petVisualStateGet } from "./petVisualStateGet";

const EVENT_BASE = {
  callId: "call-1",
  createdAt: "2026-08-20T00:00:00.000Z",
  healthAfter: 80,
  healthGain: 10,
  id: 1,
};

describe("pet visual state", () => {
  it("maps every API action event to its animation", () => {
    expect([
      petVisualStateGet(
        { ...EVENT_BASE, type: "pet.fed", food: "burger" },
        null,
      ),
      petVisualStateGet(
        { ...EVENT_BASE, type: "pet.danced", action: "dance-salsa" },
        null,
      ),
      petVisualStateGet(
        { ...EVENT_BASE, type: "pet.showered", action: "shower" },
        null,
      ),
      petVisualStateGet(
        { ...EVENT_BASE, type: "pet.napped", action: "nap" },
        null,
      ),
    ]).toEqual(["eating", "dancing", "showering", "napping"]);
  });
});
