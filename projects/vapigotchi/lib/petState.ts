import type { CareAction, FoodType, PetMood } from "./types";

import {
  CARE_ACTIONS,
  FOOD_TYPES,
  HEALTH_DECAY_INTERVAL_SECONDS,
} from "./constants";

function calculateEffectiveHealth(
  storedHealth: number,
  healthUpdatedAt: string,
  now: Date = new Date(),
): number {
  const updatedAt = new Date(healthUpdatedAt);
  if (Number.isNaN(updatedAt.getTime())) {
    return storedHealth;
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor((now.getTime() - updatedAt.getTime()) / 1_000),
  );
  const decay = Math.floor(elapsedSeconds / HEALTH_DECAY_INTERVAL_SECONDS);
  return Math.max(0, storedHealth - decay);
}

function getPetMood(health: number): PetMood {
  if (health <= 20) return "weak";
  if (health <= 50) return "hungry";
  if (health <= 79) return "content";
  return "happy";
}

function normalizeAssistantName(name?: string): string | undefined {
  if (!name) return undefined;

  const normalized = name.replace(/\s+/g, " ").trim().slice(0, 48);
  return normalized || undefined;
}

function isFoodType(value: unknown): value is FoodType {
  return typeof value === "string" && FOOD_TYPES.includes(value as FoodType);
}

function isCareAction(value: unknown): value is CareAction {
  return (
    typeof value === "string" && CARE_ACTIONS.includes(value as CareAction)
  );
}

function isValidPetId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export const petState = {
  calculateEffectiveHealth,
  getPetMood,
  normalizeAssistantName,
  isFoodType,
  isCareAction,
  isValidPetId,
};
