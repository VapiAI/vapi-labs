"use client";

import { useState, useSyncExternalStore } from "react";
import { HOME_COPY } from "@/lib/homeCopy";
import type { MainPetUrlCopyButtonProps } from "./types";

export function MainPetUrlCopyButton({
  language = "en",
  petId = "main",
}: MainPetUrlCopyButtonProps) {
  const origin = useSyncExternalStore(
    () => () => undefined,
    () => window.location.origin,
    () => "https://your-vapigotchi.example",
  );
  const [copied, setCopied] = useState(false);
  const copy = HOME_COPY[language].hero;

  async function copyMainPetUrl(): Promise<void> {
    await navigator.clipboard.writeText(
      `${origin}/pets/${encodeURIComponent(petId)}`,
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  }

  return (
    <button
      className="secondary-link"
      type="button"
      onClick={copyMainPetUrl}
    >
      {copied ? copy.copiedPetUrl : copy.copyPetUrl}
    </button>
  );
}
