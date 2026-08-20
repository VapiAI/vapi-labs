import { describe, expect, it } from "vitest";
import { SETUP_COPY } from "./setupCopy";
import { setupTools } from "./setupTools";

const FOOD_MENU = [
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

const URLS = {
  careToolUrl: "https://vapigotchi.test/api/v1/pets/pet-1/care",
  feedToolUrl: "https://vapigotchi.test/api/v1/pets/pet-1/feed",
  getStateToolUrl: "https://vapigotchi.test/api/v1/pets/pet-1",
};

describe("setup tool JSON", () => {
  it("uses English descriptions without changing the API contract", () => {
    const tools = setupTools.jsonGet("en", URLS);

    expect(tools.feedTool).toContain('"name": "feed_vapigotchi"');
    expect(tools.feedTool).toContain(SETUP_COPY.en.tools.feedDescription);
    expect(tools.feedTool).toContain(URLS.feedToolUrl);
    expect(JSON.parse(tools.feedTool).body.properties.food.enum).toEqual(
      FOOD_MENU,
    );
    expect(tools.careTool).toContain('"name": "care_for_vapigotchi"');
    expect(tools.careTool).toContain(SETUP_COPY.en.tools.careDescription);
    expect(tools.careTool).toContain(URLS.careToolUrl);
    expect(tools.careTool).toContain('"dance-salsa"');
    expect(tools.careTool).toContain('"shower"');
    expect(tools.careTool).toContain('"nap"');
    expect(tools.stateTool).toContain('"name": "check_vapigotchi"');
    expect(tools.stateTool).toContain(SETUP_COPY.en.tools.stateDescription);
    expect(tools.stateTool).toContain(URLS.getStateToolUrl);
  });

  it("switches the tool and prompt descriptions to Spanish", () => {
    const tools = setupTools.jsonGet("es", URLS);
    const composerPrompt = setupTools.composerPromptGet("es", URLS);
    const careComposerPrompt = setupTools.careComposerPromptGet("es", URLS);

    expect(tools.feedTool).toContain(SETUP_COPY.es.tools.feedDescription);
    expect(tools.feedTool).toContain(SETUP_COPY.es.tools.foodDescription);
    expect(tools.careTool).toContain(SETUP_COPY.es.tools.careDescription);
    expect(tools.careTool).toContain(SETUP_COPY.es.tools.actionDescription);
    expect(tools.stateTool).toContain(SETUP_COPY.es.tools.stateDescription);
    expect(SETUP_COPY.es.stepOne.assistantPrompt).toContain(
      "check_vapigotchi",
    );
    expect(SETUP_COPY.es.stepOne.assistantPrompt).toContain(
      "feed_vapigotchi",
    );
    expect(SETUP_COPY.es.stepOne.firstMessage).toContain("VapiGotchi");
    expect(composerPrompt).toContain("Crea estas dos API Request tools");
    expect(composerPrompt).toContain(URLS.feedToolUrl);
    expect(composerPrompt).not.toContain(URLS.careToolUrl);
    expect(composerPrompt).toContain(SETUP_COPY.es.tools.stateDescription);
    expect(careComposerPrompt).toContain(URLS.careToolUrl);
    expect(careComposerPrompt).toContain("care_for_vapigotchi");
    expect(SETUP_COPY.es.bonus.promptAddendum).toContain(
      "care_for_vapigotchi",
    );
  });
});
