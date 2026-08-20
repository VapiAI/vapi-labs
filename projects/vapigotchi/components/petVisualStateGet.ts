import type { LivePetPayload, PetEvent } from "@/lib/types";
import type { PetVisualState } from "./types";

export function petVisualStateGet(
  activeEvent: PetEvent | null,
  data: LivePetPayload | null,
): PetVisualState {
  if (activeEvent?.type === "pet.fed") return "eating";
  if (activeEvent?.type === "pet.danced") return "dancing";
  if (activeEvent?.type === "pet.showered") return "showering";
  if (activeEvent?.type === "pet.napped") return "napping";
  if (!data) return "idle";
  if (data.calls.assistantSpeaking > 0) return "talking";
  if (data.calls.userSpeaking > 0) return "listening";
  if (data.calls.active > 0) return "on-call";
  if (data.calls.ringing > 0) return "ringing";
  if (data.pet.mood === "weak") return "weak";
  if (data.pet.mood === "hungry") return "hungry";
  if (data.pet.mood === "happy") return "happy";
  return "idle";
}
