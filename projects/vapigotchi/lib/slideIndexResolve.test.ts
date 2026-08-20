import { describe, expect, it } from "vitest";
import { slideIndexResolve } from "./slideIndexResolve";

describe("slideIndexResolve", () => {
  it("moves forward without passing the final slide", () => {
    expect([
      slideIndexResolve(2, 8, "next"),
      slideIndexResolve(7, 8, "next"),
    ]).toEqual([3, 7]);
  });

  it("moves backward without passing the first slide", () => {
    expect([
      slideIndexResolve(2, 8, "previous"),
      slideIndexResolve(0, 8, "previous"),
    ]).toEqual([1, 0]);
  });

  it("jumps to either edge of the deck", () => {
    expect([
      slideIndexResolve(4, 8, "first"),
      slideIndexResolve(4, 8, "last"),
    ]).toEqual([0, 7]);
  });
});
