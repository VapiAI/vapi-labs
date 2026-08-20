import type { SetupLanguage, SetupUrls } from "./types";

import { CARE_ACTIONS, FOOD_TYPES } from "./constants";
import { SETUP_COPY } from "./setupCopy";

function jsonGet(
  language: SetupLanguage,
  urls: Pick<SetupUrls, "careToolUrl" | "feedToolUrl" | "getStateToolUrl">,
): { careTool: string; feedTool: string; stateTool: string } {
  const copy = SETUP_COPY[language].tools;
  const feedTool = JSON.stringify(
    {
      type: "apiRequest",
      name: "feed_vapigotchi",
      description: copy.feedDescription,
      method: "POST",
      url: urls.feedToolUrl,
      body: {
        type: "object",
        properties: {
          food: {
            type: "string",
            enum: FOOD_TYPES,
            description: copy.foodDescription,
          },
        },
        required: ["food"],
      },
    },
    null,
    2,
  );

  const stateTool = JSON.stringify(
    {
      type: "apiRequest",
      name: "check_vapigotchi",
      description: copy.stateDescription,
      method: "GET",
      url: urls.getStateToolUrl,
    },
    null,
    2,
  );

  const careTool = JSON.stringify(
    {
      type: "apiRequest",
      name: "care_for_vapigotchi",
      description: copy.careDescription,
      method: "POST",
      url: urls.careToolUrl,
      body: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: CARE_ACTIONS,
            description: copy.actionDescription,
          },
        },
        required: ["action"],
      },
    },
    null,
    2,
  );

  return { careTool, feedTool, stateTool };
}

function composerPromptGet(
  language: SetupLanguage,
  urls: Pick<SetupUrls, "feedToolUrl" | "getStateToolUrl">,
): string {
  const descriptions = SETUP_COPY[language].tools;
  const foods = FOOD_TYPES.join(", ");

  if (language === "es") {
    return `Crea estas dos API Request tools para este asistente:

1. check_vapigotchi
- Método: GET
- URL: ${urls.getStateToolUrl}
- Description: ${descriptions.stateDescription}

2. feed_vapigotchi
- Método: POST
- URL: ${urls.feedToolUrl}
- Description: ${descriptions.feedDescription}
- El JSON body debe requerir una propiedad string llamada food con este enum exacto: ${foods}.
- Description de food: ${descriptions.foodDescription}

Crea ambas tools ahora. Mantén exactamente los nombres, métodos, URLs y valores del enum.`;
  }

  return `Create these two API Request tools for this assistant:

1. check_vapigotchi
- Method: GET
- URL: ${urls.getStateToolUrl}
- Description: ${descriptions.stateDescription}

2. feed_vapigotchi
- Method: POST
- URL: ${urls.feedToolUrl}
- Description: ${descriptions.feedDescription}
- The JSON body must require a string property named food with this exact enum: ${foods}.
- food description: ${descriptions.foodDescription}

Create both tools now. Keep the names, methods, URLs, and enum values exactly as written.`;
}

function careComposerPromptGet(
  language: SetupLanguage,
  urls: Pick<SetupUrls, "careToolUrl">,
): string {
  const descriptions = SETUP_COPY[language].tools;
  const actions = CARE_ACTIONS.join(", ");

  if (language === "es") {
    return `Agrega esta API Request tool opcional al asistente:

care_for_vapigotchi
- Método: POST
- URL: ${urls.careToolUrl}
- Description: ${descriptions.careDescription}
- El JSON body debe requerir una propiedad string llamada action con este enum exacto: ${actions}.
- Description de action: ${descriptions.actionDescription}

Crea esta tool ahora. Mantén exactamente el nombre, método, URL y valores del enum.`;
  }

  return `Add this optional API Request tool to the assistant:

care_for_vapigotchi
- Method: POST
- URL: ${urls.careToolUrl}
- Description: ${descriptions.careDescription}
- The JSON body must require a string property named action with this exact enum: ${actions}.
- action description: ${descriptions.actionDescription}

Create this tool now. Keep the name, method, URL, and enum values exactly as written.`;
}

export const setupTools = {
  careComposerPromptGet,
  composerPromptGet,
  jsonGet,
};
