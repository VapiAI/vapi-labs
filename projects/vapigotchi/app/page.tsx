"use client";

import Link from "next/link";
import { useState } from "react";
import { MainPetUrlCopyButton } from "@/components/MainPetUrlCopyButton";
import { PetExperience } from "@/components/PetExperience";
import { SiteHeader } from "@/components/SiteHeader";
import { MAIN_ASSISTANTS } from "@/lib/constants";
import { HOME_COPY } from "@/lib/homeCopy";
import type { SetupLanguage } from "@/lib/types";

export default function Home() {
  const [language, setLanguage] = useState<SetupLanguage>("en");
  const assistant = MAIN_ASSISTANTS[language];
  const copy = HOME_COPY[language];
  const [titleBefore, titleAfter = ""] = copy.hero.title.split(
    copy.hero.emphasis,
  );
  const callHref = assistant.phone?.href ?? assistant.dashboardHref;

  return (
    <div lang={language}>
      <SiteHeader language={language} />
      <section className="home-hero">
        <div className="hero-copy">
          <div
            className="language-toggle home-language-toggle"
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
          <h1>
            {titleBefore}
            <em>{copy.hero.emphasis}</em>
            {titleAfter}
          </h1>
          <p>{copy.hero.description}</p>
          <a
            className={`hero-call-cta ${assistant.phone ? "" : "hero-assistant-cta"}`}
            href={callHref}
            target={assistant.phone ? undefined : "_blank"}
            rel={assistant.phone ? undefined : "noreferrer"}
          >
            <span className="hero-call-icon" aria-hidden="true">
              {assistant.phone ? "☎" : "ES"}
            </span>
            <span className="hero-call-copy">
              <small>{copy.hero.callLabel}</small>
              <strong>{assistant.phone?.display ?? assistant.name}</strong>
            </span>
            <span className="hero-call-action">{copy.hero.callAction}</span>
          </a>
          <div className="hero-actions">
            <a className="primary-link" href="#live-demo">
              {copy.hero.meetPet}
            </a>
            <Link className="secondary-link" href="/setup">
              {copy.hero.buildOwn}
            </Link>
            <MainPetUrlCopyButton
              language={language}
              petId={assistant.petId}
            />
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="pixel-burst burst-one">✦</div>
          <div className="pixel-burst burst-two">✦</div>
          <div className="hero-phone">☎</div>
          <div className="sound-wave">▂▄▆█▆▄▂</div>
          <div className="tool-chip">{copy.hero.toolChip}</div>
        </div>
      </section>
      <div id="live-demo">
        <PetExperience
          key={assistant.petId}
          embedded
          featured
          language={language}
          petId={assistant.petId}
        />
      </div>
      <section className="how-it-works">
        <span className="eyebrow">{copy.architecture.eyebrow}</span>
        <h2>{copy.architecture.title}</h2>
        <div className="flow-grid">
          {copy.architecture.steps.map((step) => (
            <article key={step.number}>
              <span>{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
        <Link className="primary-link dark-link" href="/setup">
          {copy.architecture.action}
        </Link>
      </section>
    </div>
  );
}
