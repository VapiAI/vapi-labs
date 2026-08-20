import type {
  FoodType,
  LivePetPayload,
  PetEvent,
  SetupLanguage,
  WorkshopSlide,
} from "@/lib/types";

export type PetVisualState =
  | "idle"
  | "weak"
  | "hungry"
  | "happy"
  | "ringing"
  | "on-call"
  | "listening"
  | "talking"
  | "eating"
  | "dancing"
  | "showering"
  | "napping";

export interface LivePetHookResult {
  data: LivePetPayload | null;
  error: string | null;
  isLoading: boolean;
}

export interface PixelPetProps {
  ariaLabel?: string;
  callCount: number;
  food?: FoodType;
  language?: SetupLanguage;
  state: PetVisualState;
}

export interface FoodSpriteProps {
  food: FoodType;
}

export interface CareSpriteProps {
  state: PetVisualState;
}

export interface PetExperienceProps {
  embedded?: boolean;
  featured?: boolean;
  language?: SetupLanguage;
  petId: string;
  stage?: boolean;
}

export interface FeaturedLanguageToggleProps {
  language: SetupLanguage;
}

export interface EventQueueState {
  active: PetEvent | null;
  queued: PetEvent[];
}

export interface CopyButtonProps {
  copiedLabel?: string;
  label: string;
  value: string;
}

export interface DashboardCallHintProps {
  language?: SetupLanguage;
  mainPet?: boolean;
}

export interface MainPetUrlCopyButtonProps {
  language?: SetupLanguage;
  petId?: string;
}

export interface SiteHeaderProps {
  language?: SetupLanguage;
}

export interface SetupFieldProps {
  copiedLabel?: string;
  copyLabel?: string;
  description: string;
  label: string;
  value: string;
}

export interface SetupConfiguratorProps {
  language: SetupLanguage;
}

export interface SetupBonusActionsProps {
  careComposerPrompt: string;
  careTool: string;
  language: SetupLanguage;
}

export interface WebCallLauncherProps {
  assistantId: string;
}

export interface WorkshopSlideViewProps {
  processLabel: string;
  slide: WorkshopSlide;
}

export type WebCallState = "idle" | "connecting" | "active" | "error";
