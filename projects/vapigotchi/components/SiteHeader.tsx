import Link from "next/link";
import { MAIN_ASSISTANTS } from "@/lib/constants";
import { HOME_COPY } from "@/lib/homeCopy";
import type { SiteHeaderProps } from "./types";

export function SiteHeader({ language = "en" }: SiteHeaderProps) {
  const copy = HOME_COPY[language];
  const assistant = MAIN_ASSISTANTS[language];

  return (
    <header className="site-header">
      <Link className="brand" href="/">
        <span className="brand-mark" aria-hidden="true">
          V
        </span>
        <span>VapiGotchi</span>
      </Link>
      <nav aria-label={copy.nav.label}>
        <Link href={`/pets/${assistant.petId}`}>{copy.nav.livePet}</Link>
        <Link href="/setup">{copy.nav.buildYours}</Link>
        <Link className="slides-link" href="/slides">
          {copy.nav.slides}
        </Link>
        <a href="https://github.com/VapiAI/vapi-labs/tree/main/projects/vapigotchi">GitHub</a>
      </nav>
    </header>
  );
}
