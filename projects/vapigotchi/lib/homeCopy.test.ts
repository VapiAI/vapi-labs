import { describe, expect, it } from "vitest";
import { MAIN_ASSISTANTS } from "./constants";
import { HOME_COPY } from "./homeCopy";

describe("main homepage languages", () => {
  it("keeps one public phone on each language experience", () => {
    expect(MAIN_ASSISTANTS).toEqual({
      en: {
        assistantId: "17cae910-8362-44c8-a1fa-bdebcbfd2c91",
        dashboardHref:
          "https://dashboard.vapi.ai/assistants/17cae910-8362-44c8-a1fa-bdebcbfd2c91",
        name: "Byte the VapiGotchi",
        petId: "main",
        phone: {
          display: "+1 (659) 399 0187",
          href: "tel:+16593990187",
        },
      },
      es: {
        assistantId: "d9e7b944-7e0a-47a2-8303-4c1b863017a9",
        dashboardHref:
          "https://dashboard.vapi.ai/assistants/d9e7b944-7e0a-47a2-8303-4c1b863017a9",
        name: "Chorizo",
        petId: "chorizo",
        phone: {
          display: "+1 (984) 305 5885",
          href: "tel:+19843055885",
        },
      },
    });
  });

  it("provides distinct English and Spanish homepage copy", () => {
    expect({
      en: {
        callLabel: HOME_COPY.en.hero.callLabel,
        title: HOME_COPY.en.hero.title,
      },
      es: {
        callLabel: HOME_COPY.es.hero.callLabel,
        title: HOME_COPY.es.hero.title,
      },
    }).toEqual({
      en: {
        callLabel: "Call Byte in English",
        title: "A voice agent you can see come alive.",
      },
      es: {
        callLabel: "Habla con Chorizo en español",
        title: "Un agente de voz que puedes ver cobrar vida.",
      },
    });
  });

  it("provides an accessible language label for each live pet", () => {
    expect({
      en: HOME_COPY.en.pet.languageLabel,
      es: HOME_COPY.es.pet.languageLabel,
    }).toEqual({
      en: "Live pet language",
      es: "Idioma de la mascota en vivo",
    });
  });

  it("localizes every new food label", () => {
    expect({
      en: {
        bagel: HOME_COPY.en.pet.food.bagel,
        burrito: HOME_COPY.en.pet.food.burrito,
        cheese: HOME_COPY.en.pet.food.cheese,
        chicken: HOME_COPY.en.pet.food.chicken,
        empanada: HOME_COPY.en.pet.food.empanada,
        filetMignon: HOME_COPY.en.pet.food["filet-mignon"],
        proteinShake: HOME_COPY.en.pet.food["protein-shake"],
        ramen: HOME_COPY.en.pet.food.ramen,
        sandwich: HOME_COPY.en.pet.food.sandwich,
        soup: HOME_COPY.en.pet.food.soup,
        tomato: HOME_COPY.en.pet.food.tomato,
      },
      es: {
        bagel: HOME_COPY.es.pet.food.bagel,
        burrito: HOME_COPY.es.pet.food.burrito,
        cheese: HOME_COPY.es.pet.food.cheese,
        chicken: HOME_COPY.es.pet.food.chicken,
        empanada: HOME_COPY.es.pet.food.empanada,
        filetMignon: HOME_COPY.es.pet.food["filet-mignon"],
        proteinShake: HOME_COPY.es.pet.food["protein-shake"],
        ramen: HOME_COPY.es.pet.food.ramen,
        sandwich: HOME_COPY.es.pet.food.sandwich,
        soup: HOME_COPY.es.pet.food.soup,
        tomato: HOME_COPY.es.pet.food.tomato,
      },
    }).toEqual({
      en: {
        bagel: "bagel",
        burrito: "burrito",
        cheese: "cheese",
        chicken: "chicken",
        empanada: "empanada",
        filetMignon: "filet mignon",
        proteinShake: "protein shake",
        ramen: "ramen",
        sandwich: "sandwich",
        soup: "soup",
        tomato: "tomato",
      },
      es: {
        bagel: "bagel",
        burrito: "burrito",
        cheese: "queso",
        chicken: "pollo",
        empanada: "empanada",
        filetMignon: "filete miñón",
        proteinShake: "batido de proteína",
        ramen: "ramen",
        sandwich: "sándwich",
        soup: "sopa",
        tomato: "tomate",
      },
    });
  });
});
