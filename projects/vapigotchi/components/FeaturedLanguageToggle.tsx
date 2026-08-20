import type { FeaturedLanguageToggleProps } from "./types";

import Link from "next/link";
import { MAIN_ASSISTANTS } from "@/lib/constants";
import { HOME_COPY } from "@/lib/homeCopy";

export function FeaturedLanguageToggle({
  language,
}: FeaturedLanguageToggleProps) {
  const copy = HOME_COPY[language].pet;

  return (
    <nav
      className="language-toggle pet-language-toggle"
      aria-label={copy.languageLabel}
    >
      <Link
        aria-current={language === "en" ? "page" : undefined}
        href={`/pets/${MAIN_ASSISTANTS.en.petId}`}
        hrefLang="en"
        lang="en"
      >
        English
      </Link>
      <Link
        aria-current={language === "es" ? "page" : undefined}
        href={`/pets/${MAIN_ASSISTANTS.es.petId}`}
        hrefLang="es"
        lang="es"
      >
        Español
      </Link>
    </nav>
  );
}
