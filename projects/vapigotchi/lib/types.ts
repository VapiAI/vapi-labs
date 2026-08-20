export type FoodType =
  | "apple"
  | "pizza"
  | "burger"
  | "sushi"
  | "bagel"
  | "protein-shake"
  | "sandwich"
  | "empanada"
  | "ramen"
  | "soup"
  | "burrito"
  | "filet-mignon"
  | "chicken"
  | "cheese"
  | "tomato"
  | "lemon"
  | "taco"
  | "arepa"
  | "pupusa"
  | "ceviche";

export type PetMood = "weak" | "hungry" | "content" | "happy";

export type CallStatus =
  | "scheduled"
  | "queued"
  | "ringing"
  | "in-progress"
  | "forwarding"
  | "ended";

export type SpeakerRole = "assistant" | "user";

export type CareAction = "dance-salsa" | "shower" | "nap";

export type CareEventType = "pet.danced" | "pet.showered" | "pet.napped";

export interface PetState {
  id: string;
  name: string;
  health: number;
  mood: PetMood;
  mealsEaten: number;
  version: number;
  updatedAt: string;
}

export interface LiveCallSummary {
  ringing: number;
  active: number;
  total: number;
  assistantSpeaking: number;
  userSpeaking: number;
}

export interface PetEventBase {
  id: number;
  healthGain: number;
  healthAfter: number;
  callId: string | null;
  createdAt: string;
}

export interface PetFoodEvent extends PetEventBase {
  type: "pet.fed";
  food: FoodType;
}

export interface PetCareEvent extends PetEventBase {
  type: CareEventType;
  action: CareAction;
}

export type PetEvent = PetFoodEvent | PetCareEvent;

export interface LivePetPayload {
  pet: PetState;
  calls: LiveCallSummary;
  events: PetEvent[];
  latestEventId: number;
}

export interface FeedPetInput {
  food: FoodType;
  assistantName?: string;
  callId?: string;
}

export interface CarePetInput {
  action: CareAction;
  assistantName?: string;
  callId?: string;
}

export interface SetupUrls {
  careToolUrl: string;
  feedToolUrl: string;
  getStateToolUrl: string;
  livePageUrl: string;
  serverUrl: string;
}

export type SetupLanguage = "en" | "es";

export interface MainAssistant {
  assistantId: string;
  dashboardHref: string;
  name: string;
  petId: string;
  phone: {
    display: string;
    href: string;
  } | null;
}

export type SlideDirection = "first" | "last" | "next" | "previous";

export type SlideTone =
  | "purple"
  | "mint"
  | "yellow"
  | "pink"
  | "cyan"
  | "paper";

export interface SlideCard {
  body: string;
  eyebrow?: string;
  title: string;
}

export interface SlideResource {
  description: string;
  href: string;
  label: string;
}

export interface WorkshopSlide {
  cards?: readonly SlideCard[];
  eyebrow: string;
  flow?: readonly string[];
  lead: string;
  note?: string;
  prompt?: string;
  resources?: readonly SlideResource[];
  statement?: string;
  title: string;
  tone: SlideTone;
}

export interface VapiWebhookMessage {
  type?: string;
  status?: string;
  role?: string;
  call?: {
    id?: string;
    status?: string;
    startedAt?: string;
  };
  assistant?: {
    id?: string;
    name?: string;
  };
}

export interface VapiWebhookPayload {
  message?: VapiWebhookMessage;
}

export interface PetRow {
  id: string;
  name: string;
  health: number;
  meals_eaten: number;
  version: number;
  health_updated_at: string;
  updated_at: string;
}

export interface CallSummaryRow {
  ringing: number;
  active: number;
  assistant_speaking: number;
  user_speaking: number;
}

export interface LatestEventRow {
  latest_event_id: number;
}

export interface PetEventRow {
  id: number;
  type: string;
  food: string | null;
  health_gain: number | null;
  health_after: number | null;
  call_id: string | null;
  created_at: string;
}

export interface RuntimeBindings {
  DB: D1Database;
  ADMIN_API_KEY?: string;
}
