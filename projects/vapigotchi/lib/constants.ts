import type {
  CareAction,
  CareEventType,
  FoodType,
  MainAssistant,
  SetupLanguage,
} from "./types";

export const INITIAL_HEALTH = 35;
export const MAX_HEALTH = 100;
export const HEALTH_GAIN_PER_MEAL = 15;
export const HEALTH_DECAY_INTERVAL_SECONDS = 120;
export const STALE_CALL_INTERVAL_SECONDS = 600;
export const LIVE_POLL_INTERVAL_MS = 450;
export const IDLE_POLL_INTERVAL_MS = 2_000;
export const HIDDEN_POLL_INTERVAL_MS = 8_000;
export const PET_EVENT_DISPLAY_MS = 3_200;

export const MAIN_PHONES: {
  [Language in SetupLanguage]: MainAssistant["phone"];
} = {
  en: {
    display: "+1 (659) 399 0187",
    href: "tel:+16593990187",
  },
  es: {
    display: "+1 (984) 305 5885",
    href: "tel:+19843055885",
  },
};

export const MAIN_ASSISTANTS: { [Language in SetupLanguage]: MainAssistant } = {
  en: {
    assistantId: "17cae910-8362-44c8-a1fa-bdebcbfd2c91",
    dashboardHref:
      "https://dashboard.vapi.ai/assistants/17cae910-8362-44c8-a1fa-bdebcbfd2c91",
    name: "Byte the VapiGotchi",
    petId: "main",
    phone: MAIN_PHONES.en,
  },
  es: {
    assistantId: "d9e7b944-7e0a-47a2-8303-4c1b863017a9",
    dashboardHref:
      "https://dashboard.vapi.ai/assistants/d9e7b944-7e0a-47a2-8303-4c1b863017a9",
    name: "Chorizo",
    petId: "chorizo",
    phone: MAIN_PHONES.es,
  },
};

export const FOOD_TYPES: FoodType[] = [
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
  "taco",
  "arepa",
  "pupusa",
  "ceviche",
];

export const CARE_ACTIONS: CareAction[] = ["dance-salsa", "shower", "nap"];

export const CARE_ACTION_HEALTH_GAIN: { [Action in CareAction]: number } = {
  "dance-salsa": 5,
  shower: 10,
  nap: 20,
};

export const CARE_ACTION_EVENT_TYPE: {
  [Action in CareAction]: CareEventType;
} = {
  "dance-salsa": "pet.danced",
  shower: "pet.showered",
  nap: "pet.napped",
};
