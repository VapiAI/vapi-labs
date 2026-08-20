import type { FoodType } from "@/lib/types";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FoodSprite } from "./FoodSprite";

const NEW_FOODS: FoodType[] = [
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
];

describe("food sprite", () => {
  it("draws every new menu item", () => {
    expect(
      NEW_FOODS.map((food) => {
        const markup = renderToStaticMarkup(createElement(FoodSprite, { food }));
        return {
          food,
          hasShape: /<(?:circle|ellipse|line|path|polygon|rect)\b/.test(markup),
        };
      }),
    ).toEqual(NEW_FOODS.map((food) => ({ food, hasShape: true })));
  });
});
