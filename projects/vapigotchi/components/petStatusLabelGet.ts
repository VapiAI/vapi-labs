import type { PetEvent, SetupLanguage } from "@/lib/types";
import type { PetVisualState } from "./types";

import { HOME_COPY } from "@/lib/homeCopy";

export function petStatusLabelGet(
  language: SetupLanguage,
  activeEvent: PetEvent | null,
  visualState: PetVisualState,
): string {
  const copy = HOME_COPY[language].pet;

  if (activeEvent?.type === "pet.fed") {
    return `${copy.status.eating} ${copy.food[activeEvent.food]}`;
  }
  if (activeEvent?.type === "pet.danced") return copy.status.dancing;
  if (activeEvent?.type === "pet.showered") return copy.status.showering;
  if (activeEvent?.type === "pet.napped") return copy.status.napping;
  if (visualState === "talking") return copy.status.talking;
  if (visualState === "listening") return copy.status.listening;
  if (visualState === "ringing") return copy.status.ringing;
  if (visualState === "on-call") return copy.status.onCall;
  if (visualState === "weak") return copy.status.weak;
  if (visualState === "hungry") return copy.status.hungry;
  if (visualState === "happy") return copy.status.happy;
  return copy.status.idle;
}
