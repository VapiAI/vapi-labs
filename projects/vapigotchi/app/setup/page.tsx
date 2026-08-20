"use client";

import { useState } from "react";
import { SetupConfigurator } from "@/components/SetupConfigurator";
import { SiteHeader } from "@/components/SiteHeader";
import { SETUP_COPY } from "@/lib/setupCopy";
import type { SetupLanguage } from "@/lib/types";

export default function SetupPage() {
  const [language, setLanguage] = useState<SetupLanguage>("en");
  const copy = SETUP_COPY[language];

  return (
    <main className="setup-page">
      <SiteHeader language={language} />
      <div lang={language}>
        <header className="setup-hero">
          <div
            className="language-toggle"
            role="group"
            aria-label={copy.languageLabel}
          >
            <button
              type="button"
              aria-pressed={language === "en"}
              onClick={() => setLanguage("en")}
            >
              English
            </button>
            <button
              type="button"
              aria-pressed={language === "es"}
              onClick={() => setLanguage("es")}
            >
              Español
            </button>
          </div>
          <span className="hero-kicker">{copy.hero.kicker}</span>
          <h1>{copy.hero.title}</h1>
          <p>{copy.hero.description}</p>
        </header>
        <SetupConfigurator language={language} />
      </div>
    </main>
  );
}
