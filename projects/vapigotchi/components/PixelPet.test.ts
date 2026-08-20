import type { FoodType } from "@/lib/types";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PixelPet } from "./PixelPet";

function markupGet(food: FoodType): string {
  return renderToStaticMarkup(
    createElement(PixelPet, {
      callCount: 0,
      food,
      state: "eating",
    }),
  );
}

describe("pixel pet food expressions", () => {
  it("shows a sour face only while eating lemon", () => {
    const lemonMarkup = markupGet("lemon");
    const appleMarkup = markupGet("apple");

    expect({
      appleHasSourFace: appleMarkup.includes('class="sour-face"'),
      lemonHasFoodMarker: lemonMarkup.includes('data-food="lemon"'),
      lemonHasSourFace: lemonMarkup.includes('class="sour-face"'),
    }).toEqual({
      appleHasSourFace: false,
      lemonHasFoodMarker: true,
      lemonHasSourFace: true,
    });
  });
});
