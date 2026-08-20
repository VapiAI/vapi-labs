import type { ReactNode } from "react";
import type { FoodSpriteProps } from "./types";

function foodShapePopularGet(food: FoodSpriteProps["food"]): ReactNode {
  switch (food) {
    case "apple":
      return (
        <>
          <rect x="9" y="8" width="22" height="22" rx="5" fill="#ff5a65" />
          <rect x="19" y="2" width="5" height="9" fill="#34283c" />
          <rect x="23" y="3" width="10" height="6" fill="#63d779" />
          <rect x="12" y="11" width="5" height="5" fill="#ff9b9f" />
        </>
      );
    case "pizza":
      return (
        <>
          <path d="M7 8h28L21 35z" fill="#ffd85a" />
          <rect x="6" y="5" width="30" height="7" rx="3" fill="#d88342" />
          <rect x="15" y="15" width="6" height="6" fill="#ef5350" />
          <rect x="23" y="20" width="6" height="6" fill="#ef5350" />
        </>
      );
    case "burger":
      return (
        <>
          <path d="M7 16c2-9 26-9 28 0z" fill="#f2b84b" />
          <rect x="6" y="16" width="30" height="6" fill="#63c56d" />
          <rect x="7" y="22" width="28" height="8" rx="2" fill="#8f4f2d" />
          <rect x="6" y="29" width="30" height="7" rx="3" fill="#f2b84b" />
          <rect x="13" y="10" width="3" height="2" fill="#fff3c4" />
          <rect x="24" y="9" width="3" height="2" fill="#fff3c4" />
        </>
      );
    case "sushi":
      return (
        <>
          <rect x="6" y="12" width="30" height="22" rx="5" fill="#263b39" />
          <rect x="10" y="9" width="22" height="21" rx="4" fill="#f8f0d5" />
          <rect x="14" y="12" width="14" height="9" rx="2" fill="#ff7b75" />
          <rect x="18" y="15" width="6" height="6" fill="#70c77c" />
        </>
      );
    case "bagel":
      return (
        <>
          <path
            d="M21 5C10 5 4 12 4 21s6 16 17 16 17-7 17-16S32 5 21 5zm0 11c4 0 7 2 7 5s-3 5-7 5-7-2-7-5 3-5 7-5z"
            fill="#d99a4e"
            fillRule="evenodd"
          />
          <path d="M10 16h4v2h-4zm17-5h4v2h-4zm2 15h4v2h-4z" fill="#fff0bd" />
        </>
      );
    case "protein-shake":
      return (
        <>
          <path d="M25 3h5l-3 9h-4z" fill="#5bc8d8" />
          <rect x="10" y="10" width="24" height="28" rx="5" fill="#9c75ff" />
          <rect x="13" y="7" width="18" height="6" rx="2" fill="#34283c" />
          <path d="M23 16l-7 11h6l-2 7 8-12h-6z" fill="#fff4ad" />
        </>
      );
  }
}

function foodShapeComfortGet(food: FoodSpriteProps["food"]): ReactNode {
  switch (food) {
    case "sandwich":
      return (
        <>
          <path d="M5 15L20 5l17 10-3 6H8z" fill="#f2cf83" />
          <path d="M7 20h28l-2 6H9z" fill="#65c56f" />
          <path d="M9 26h24l-3 6H12z" fill="#ffcf49" />
          <path d="M12 32h18l-2 6H14z" fill="#d98955" />
        </>
      );
    case "empanada":
      return (
        <>
          <path
            d="M5 19c8-12 25-12 33 0-3 12-9 18-17 18S8 31 5 19z"
            fill="#efb54f"
            stroke="#9e6235"
            strokeWidth="2"
          />
          <path d="M9 20l4 3 4-3 4 3 4-3 4 3 4-3" fill="none" stroke="#fff0b7" strokeWidth="2" />
        </>
      );
    case "ramen":
      return (
        <>
          <path d="M6 19h31l-5 17H12z" fill="#ef6269" />
          <rect x="5" y="16" width="33" height="6" rx="3" fill="#fff1cf" />
          <path d="M12 17c0-7 5-7 5-12m3 12c0-7 5-7 5-12m3 12c0-7 5-7 5-12" fill="none" stroke="#f3bd45" strokeWidth="3" />
          <path d="M9 7l29 8M13 3l26 8" stroke="#4f342d" strokeWidth="2" />
        </>
      );
    case "soup":
      return (
        <>
          <path d="M6 20h31l-5 16H12z" fill="#65cbd2" />
          <rect x="5" y="17" width="33" height="6" rx="3" fill="#f7ead2" />
          <path d="M13 15c-4-5 4-6 0-11m8 11c-4-5 4-6 0-11m8 11c-4-5 4-6 0-11" fill="none" stroke="#8f79b8" strokeWidth="2" />
          <rect x="13" y="20" width="5" height="4" fill="#ff914d" />
          <rect x="25" y="20" width="5" height="4" fill="#69b866" />
        </>
      );
    case "burrito":
      return (
        <>
          <rect x="9" y="8" width="25" height="28" rx="6" fill="#e9c27b" />
          <path d="M9 25h25v11H9z" fill="#aeb6c3" />
          <path d="M12 8l5 7 5-7 5 7 4-7" fill="#61bf6b" />
          <path d="M14 9l4 5 4-5 4 5 4-5" fill="none" stroke="#d85b53" strokeWidth="3" />
        </>
      );
  }
}

function foodShapeIngredientGet(food: FoodSpriteProps["food"]): ReactNode {
  switch (food) {
    case "filet-mignon":
      return (
        <>
          <path
            d="M5 22C5 11 15 6 26 8c9 2 14 9 11 18-3 10-15 13-24 9-5-2-8-7-8-13z"
            fill="#9c4e3d"
          />
          <path
            d="M10 21c1-7 8-10 15-8 6 1 9 6 7 11-2 6-10 8-16 6-4-2-6-5-6-9z"
            fill="#ef8b78"
          />
          <path d="M15 17l13 9m-15-3l10 7" stroke="#6b342d" strokeWidth="2" />
          <path d="M31 7l3-5 2 6 5 1-5 3-1 6-3-5-5-2z" fill="#68b568" />
        </>
      );
    case "chicken":
      return (
        <>
          <path
            d="M7 19C8 8 18 4 27 9c7 4 7 14 1 20-7 7-17 5-20-2-1-2-2-5-1-8z"
            fill="#db8d3f"
          />
          <path d="M27 27l8 8" stroke="#f5e5c3" strokeWidth="6" />
          <circle cx="36" cy="36" r="4" fill="#f5e5c3" />
          <path d="M11 16c3-5 9-7 14-3" fill="none" stroke="#f1b85f" strokeWidth="3" />
        </>
      );
    case "cheese":
      return (
        <>
          <path d="M5 31L12 9l25 11v15H5z" fill="#f4c542" />
          <path d="M12 9l25 11-10 4L5 17z" fill="#ffe27b" />
          <circle cx="15" cy="27" r="3" fill="#cf9236" />
          <circle cx="27" cy="31" r="4" fill="#cf9236" />
          <circle cx="25" cy="17" r="2" fill="#dba744" />
        </>
      );
    case "tomato":
      return (
        <>
          <circle cx="21" cy="23" r="16" fill="#ef5350" />
          <path d="M21 10l4-7 2 7 8-2-5 7 5 4-9-1-5 7-2-8-9 2 6-6-5-5 8 2z" fill="#58ad61" />
          <rect x="11" y="19" width="5" height="8" rx="2" fill="#ff8880" />
        </>
      );
  }
}

function foodShapeLatinGet(food: FoodSpriteProps["food"]): ReactNode {
  switch (food) {
    case "taco":
      return (
        <>
          <path d="M5 27C8 9 32 9 37 27z" fill="#f4bd45" />
          <path d="M10 23c6-10 16-10 22 0" fill="none" stroke="#56bd6c" strokeWidth="5" />
          <rect x="16" y="15" width="6" height="6" fill="#e65757" />
          <rect x="25" y="17" width="6" height="5" fill="#f5e4a7" />
        </>
      );
    case "arepa":
      return (
        <>
          <circle cx="21" cy="21" r="16" fill="#f1c760" />
          <circle cx="21" cy="21" r="11" fill="#ffd97d" />
          <rect x="12" y="16" width="4" height="3" fill="#c58b3d" />
          <rect x="25" y="24" width="5" height="3" fill="#c58b3d" />
        </>
      );
    case "pupusa":
      return (
        <>
          <circle cx="21" cy="21" r="16" fill="#efe1b5" />
          <circle cx="21" cy="21" r="11" fill="#fff0c7" />
          <rect x="12" y="18" width="4" height="3" fill="#b89059" />
          <rect x="24" y="13" width="5" height="3" fill="#b89059" />
          <rect x="23" y="26" width="4" height="3" fill="#b89059" />
        </>
      );
    case "ceviche":
      return (
        <>
          <path d="M6 17h30l-5 18H11z" fill="#67c9d2" />
          <rect x="4" y="14" width="34" height="6" rx="3" fill="#e8f5e9" />
          <rect x="10" y="9" width="8" height="7" fill="#ff9b4a" />
          <rect x="20" y="7" width="8" height="9" fill="#f6e8cc" />
          <rect x="29" y="10" width="6" height="6" fill="#d45c8b" />
        </>
      );
  }
}

function foodShapeGet(food: FoodSpriteProps["food"]): ReactNode {
  return (
    foodShapePopularGet(food) ??
    foodShapeComfortGet(food) ??
    foodShapeIngredientGet(food) ??
    foodShapeLatinGet(food)
  );
}

export function FoodSprite({ food }: FoodSpriteProps) {
  return (
    <g className="food-sprite" aria-label={food}>
      {foodShapeGet(food)}
    </g>
  );
}
