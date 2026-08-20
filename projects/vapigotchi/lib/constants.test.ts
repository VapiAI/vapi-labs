import { describe, expect, it } from "vitest";
import {
  CARE_ACTION_HEALTH_GAIN,
  FOOD_TYPES,
  MAIN_PHONES,
} from "./constants";

describe("main assistant configuration", () => {
  it("keeps both public display numbers and dial targets aligned", () => {
    expect(MAIN_PHONES).toEqual({
      en: {
        display: "+1 (659) 399 0187",
        href: "tel:+16593990187",
      },
      es: {
        display: "+1 (984) 305 5885",
        href: "tel:+19843055885",
      },
    });
  });

  it("assigns a health gain to every care action", () => {
    expect(CARE_ACTION_HEALTH_GAIN).toEqual({
      "dance-salsa": 5,
      shower: 10,
      nap: 20,
    });
  });

  it("offers the complete workshop food menu", () => {
    expect(FOOD_TYPES).toEqual([
      "apple",
      "pizza",
      "burger",
      "sushi",
      "bagel",
      "protein-shake",
      "sandwich",
      "empanada",
      "ramen",
      "soup",
      "burrito",
      "filet-mignon",
      "chicken",
      "cheese",
      "tomato",
      "lemon",
      "taco",
      "arepa",
      "pupusa",
      "ceviche",
    ]);
  });
});
