"use client";

import type { PetEvent } from "@/lib/types";
import type { PetExperienceProps } from "./types";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MAIN_ASSISTANTS, PET_EVENT_DISPLAY_MS } from "@/lib/constants";
import { HOME_COPY } from "@/lib/homeCopy";
import { CallCounter } from "./CallCounter";
import { DashboardCallHint } from "./DashboardCallHint";
import { FeaturedLanguageToggle } from "./FeaturedLanguageToggle";
import { HealthMeter } from "./HealthMeter";
import { PixelPet } from "./PixelPet";
import { petStatusLabelGet } from "./petStatusLabelGet";
import { petVisualStateGet } from "./petVisualStateGet";
import { SiteHeader } from "./SiteHeader";
import { useLivePet } from "./useLivePet";
import { WebCallLauncher } from "./WebCallLauncher";

export function PetExperience({
  embedded = false,
  featured = false,
  language = "en",
  petId,
  stage = false,
}: PetExperienceProps) {
  const { data, error, isLoading } = useLivePet(petId);
  const [activeEvent, setActiveEvent] = useState<PetEvent | null>(null);
  const lastPlayedEventId = useRef(0);
  const copy = HOME_COPY[language].pet;

  useEffect(() => {
    if (activeEvent || !data?.events.length) return;
    const nextEvent = data.events.find(
      (event) => event.id > lastPlayedEventId.current,
    );
    if (!nextEvent) return;

    const timer = window.setTimeout(() => {
      lastPlayedEventId.current = nextEvent.id;
      setActiveEvent(nextEvent);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeEvent, data?.events]);

  useEffect(() => {
    if (!activeEvent) return;
    const timer = window.setTimeout(
      () => setActiveEvent(null),
      PET_EVENT_DISPLAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [activeEvent]);

  const visualState = petVisualStateGet(activeEvent, data);
  const statusLabel = petStatusLabelGet(language, activeEvent, visualState);
  const petName = featured
    ? MAIN_ASSISTANTS[language].name
    : (data?.pet.name ?? "VapiGotchi");

  return (
    <main
      className={stage ? "experience stage-mode" : "experience"}
      lang={language}
    >
      {!stage && !embedded && <SiteHeader language={language} />}
      {!stage && !embedded && featured && (
        <FeaturedLanguageToggle language={language} />
      )}
      <section className="pet-shell">
        <div className="pet-titlebar">
          <div>
            <span className="eyebrow">{copy.eyebrow}</span>
            <h1>{petName}</h1>
            <p className="pet-id">
              {copy.idLabel}: {petId}
            </p>
          </div>
          <span className={`connection-pill ${error ? "offline" : ""}`}>
            <i /> {error ? copy.reconnecting : copy.live}
          </span>
        </div>

        <div className="pet-dashboard">
          <div className="pet-main-panel">
            <div className="state-ribbon">
              <span>{statusLabel}</span>
              <span className="state-sparkles" aria-hidden="true">
                ✦ ✦
              </span>
            </div>
            <PixelPet
              ariaLabel={`${petName}: ${statusLabel}`}
              callCount={data?.calls.total ?? 0}
              food={
                activeEvent?.type === "pet.fed" ? activeEvent.food : undefined
              }
              language={language}
              state={visualState}
            />
            {isLoading && <p className="loading-label">{copy.loading}</p>}
          </div>

          <aside className="pet-sidebar">
            <HealthMeter
              health={data?.pet.health ?? 35}
              language={language}
            />
            <CallCounter
              calls={
                data?.calls ?? {
                  active: 0,
                  assistantSpeaking: 0,
                  ringing: 0,
                  total: 0,
                  userSpeaking: 0,
                }
              }
              language={language}
            />
            <div className="stat-card">
              <span>{copy.mealsEaten}</span>
              <strong>{data?.pet.mealsEaten ?? 0}</strong>
            </div>
            <div className="privacy-note">
              <span aria-hidden="true">◉</span>
              <p>{copy.privacy}</p>
            </div>
          </aside>
        </div>

        {!stage && (
          <DashboardCallHint language={language} mainPet={featured} />
        )}
        {!stage && !featured && <WebCallLauncher assistantId={petId} />}

        {!stage && (
          <div className="pet-footer-actions">
            <p>{copy.footerPrompt}</p>
            <Link className="text-link" href="/setup">
              {copy.footerAction}
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
