"use client";

import type { SlideDirection, SetupLanguage } from "@/lib/types";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { slideIndexResolve } from "@/lib/slideIndexResolve";
import { SLIDES_COPY } from "@/lib/slides/constants";
import { WorkshopSlideView } from "./WorkshopSlideView";

async function presentationToggle() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }

    await document.documentElement.requestFullscreen();
  } catch {
    return;
  }
}

export function SlidesDeck() {
  const [language, setLanguage] = useState<SetupLanguage>("en");
  const [slideIndex, setSlideIndex] = useState(0);
  const slides = SLIDES_COPY[language];
  const slide = slides[slideIndex];
  const slideCount = slides.length;
  const isEnglish = language === "en";

  const slideChange = useCallback(
    (direction: SlideDirection) => {
      setSlideIndex((currentIndex) =>
        slideIndexResolve(currentIndex, slideCount, direction),
      );
    },
    [slideCount],
  );

  useEffect(() => {
    function keyHandle(event: KeyboardEvent) {
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        slideChange("next");
      }

      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        slideChange("previous");
      }

      if (event.key === "Home") {
        event.preventDefault();
        slideChange("first");
      }

      if (event.key === "End") {
        event.preventDefault();
        slideChange("last");
      }

      if (event.key === " " && event.target === document.body) {
        event.preventDefault();
        slideChange("next");
      }
    }

    window.addEventListener("keydown", keyHandle);
    return () => window.removeEventListener("keydown", keyHandle);
  }, [slideChange]);

  return (
    <main className="slides-page" lang={language}>
      <header className="slides-toolbar">
        <Link className="slides-brand" href="/">
          <span aria-hidden="true">V</span>
          VapiGotchi
        </Link>
        <nav aria-label={isEnglish ? "Presentation links" : "Enlaces de presentación"}>
          <Link href="/#live-demo">{isEnglish ? "Live demo" : "Demo en vivo"}</Link>
          <Link href="/setup">{isEnglish ? "Workshop setup" : "Setup del workshop"}</Link>
        </nav>
        <div className="slides-toolbar-actions">
          <div
            className="slides-language-toggle"
            role="group"
            aria-label={isEnglish ? "Presentation language" : "Idioma de la presentación"}
          >
            <button
              type="button"
              aria-pressed={language === "en"}
              onClick={() => setLanguage("en")}
            >
              EN
            </button>
            <button
              type="button"
              aria-pressed={language === "es"}
              onClick={() => setLanguage("es")}
            >
              ES
            </button>
          </div>
          <button
            className="present-button"
            type="button"
            onClick={() => void presentationToggle()}
          >
            {isEnglish ? "Present" : "Presentar"} ⛶
          </button>
        </div>
      </header>

      <div className="slide-frame" aria-live="polite">
        <WorkshopSlideView
          processLabel={isEnglish ? "Process" : "Proceso"}
          slide={slide}
        />
      </div>

      <footer className="slides-footer">
        <button
          type="button"
          aria-label={isEnglish ? "Previous slide" : "Slide anterior"}
          disabled={slideIndex === 0}
          onClick={() => slideChange("previous")}
        >
          ←
        </button>
        <div className="slide-progress" aria-label={isEnglish ? "Slide progress" : "Progreso"}>
          {slides.map((item, index) => (
            <button
              type="button"
              aria-label={`${isEnglish ? "Go to slide" : "Ir al slide"} ${index + 1}: ${item.title}`}
              aria-current={index === slideIndex ? "step" : undefined}
              key={item.title}
              onClick={() => setSlideIndex(index)}
            />
          ))}
        </div>
        <span>
          {String(slideIndex + 1).padStart(2, "0")} / {String(slideCount).padStart(2, "0")}
        </span>
        <button
          type="button"
          aria-label={isEnglish ? "Next slide" : "Siguiente slide"}
          disabled={slideIndex === slideCount - 1}
          onClick={() => slideChange("next")}
        >
          →
        </button>
      </footer>
    </main>
  );
}
