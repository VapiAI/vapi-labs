"use client";

import { useState } from "react";
import type { CopyButtonProps } from "./types";

export function CopyButton({ copiedLabel, label, value }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  }

  return (
    <button className="copy-button" type="button" onClick={copy}>
      {copied ? (copiedLabel ?? "Copied!") : label}
    </button>
  );
}
