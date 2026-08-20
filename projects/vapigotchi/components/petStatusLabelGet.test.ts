import { describe, expect, it } from "vitest";
import { petStatusLabelGet } from "./petStatusLabelGet";

const EVENT_BASE = {
  callId: null,
  createdAt: "2026-08-20T00:00:00.000Z",
  healthAfter: 80,
  healthGain: 10,
  id: 1,
};

describe("pet status label", () => {
  it("localizes every new action in Spanish", () => {
    expect([
      petStatusLabelGet(
        "es",
        { ...EVENT_BASE, type: "pet.fed", food: "sushi" },
        "eating",
      ),
      petStatusLabelGet(
        "es",
        { ...EVENT_BASE, type: "pet.danced", action: "dance-salsa" },
        "dancing",
      ),
      petStatusLabelGet(
        "es",
        { ...EVENT_BASE, type: "pet.showered", action: "shower" },
        "showering",
      ),
      petStatusLabelGet(
        "es",
        { ...EVENT_BASE, type: "pet.napped", action: "nap" },
        "napping",
      ),
    ]).toEqual([
      "Comiendo sushi",
      "Bailando salsa",
      "Dándose una ducha",
      "Tomando una siesta",
    ]);
  });
});
