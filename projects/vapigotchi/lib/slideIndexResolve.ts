import type { SlideDirection } from "./types";

export function slideIndexResolve(
  currentIndex: number,
  slideCount: number,
  direction: SlideDirection,
) {
  if (direction === "first") {
    return 0;
  }

  if (direction === "last") {
    return Math.max(0, slideCount - 1);
  }

  if (direction === "previous") {
    return Math.max(0, currentIndex - 1);
  }

  return Math.min(Math.max(0, slideCount - 1), currentIndex + 1);
}
