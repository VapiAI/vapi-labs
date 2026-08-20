import { describe, expect, it } from "vitest";
import { petState } from "./petState";

describe("pet state", () => {
  it("decays one health point every two minutes", () => {
    const now = new Date("2026-08-19T12:06:00.000Z");
    expect(
      petState.calculateEffectiveHealth(35, "2026-08-19T12:00:00.000Z", now),
    ).toEqual(32);
  });

  it("never decays below zero", () => {
    const now = new Date("2026-08-20T12:00:00.000Z");
    expect(
      petState.calculateEffectiveHealth(3, "2026-08-19T12:00:00.000Z", now),
    ).toEqual(0);
  });

  it("maps health to a mood", () => {
    expect(petState.getPetMood(12)).toEqual("weak");
    expect(petState.getPetMood(35)).toEqual("hungry");
    expect(petState.getPetMood(65)).toEqual("content");
    expect(petState.getPetMood(90)).toEqual("happy");
  });

  it("normalizes an assistant name", () => {
    expect(petState.normalizeAssistantName("  Byte    the brave  ")).toEqual(
      "Byte the brave",
    );
  });

  it("validates supported foods and pet identifiers", () => {
    expect(petState.isFoodType("pizza")).toEqual(true);
    expect(petState.isFoodType("burger")).toEqual(true);
    expect(petState.isFoodType("sushi")).toEqual(true);
    expect(petState.isFoodType("battery")).toEqual(false);
    expect(petState.isValidPetId("assistant_123-main")).toEqual(true);
    expect(petState.isValidPetId("not/a/pet")).toEqual(false);
  });

  it("validates supported care actions", () => {
    expect(petState.isCareAction("dance-salsa")).toEqual(true);
    expect(petState.isCareAction("shower")).toEqual(true);
    expect(petState.isCareAction("nap")).toEqual(true);
    expect(petState.isCareAction("fly")).toEqual(false);
  });
});
