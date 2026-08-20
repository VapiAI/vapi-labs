"use client";

import { useEffect, useState } from "react";
import {
  HIDDEN_POLL_INTERVAL_MS,
  IDLE_POLL_INTERVAL_MS,
  LIVE_POLL_INTERVAL_MS,
} from "@/lib/constants";
import type { LivePetPayload } from "@/lib/types";
import type { LivePetHookResult } from "./types";

export function useLivePet(petId: string): LivePetHookResult {
  const [data, setData] = useState<LivePetPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let cursor: number | undefined;
    let timer: number | undefined;
    let consecutiveFailures = 0;

    async function poll(): Promise<void> {
      const query =
        cursor === undefined ? "" : `?afterEventId=${encodeURIComponent(cursor)}`;

      try {
        const response = await fetch(
          `/api/v1/pets/${encodeURIComponent(petId)}/live${query}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error(`Live state request failed with ${response.status}.`);
        }

        const payload = (await response.json()) as LivePetPayload;
        if (cancelled) return;

        if (cursor === undefined) {
          cursor = payload.latestEventId;
          payload.events = [];
        } else if (payload.events.length > 0) {
          cursor = payload.events[payload.events.length - 1]?.id ?? cursor;
        } else {
          cursor = payload.latestEventId;
        }

        consecutiveFailures = 0;
        setError(null);
        setData(payload);

        const nextDelay = document.hidden
          ? HIDDEN_POLL_INTERVAL_MS
          : payload.calls.total > 0
            ? LIVE_POLL_INTERVAL_MS
            : IDLE_POLL_INTERVAL_MS;
        timer = window.setTimeout(poll, nextDelay);
      } catch (pollError) {
        if (cancelled) return;
        consecutiveFailures += 1;
        setError(
          pollError instanceof Error
            ? pollError.message
            : "The live state request failed.",
        );
        timer = window.setTimeout(
          poll,
          Math.min(8_000, 1_000 * 2 ** consecutiveFailures),
        );
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [petId]);

  return { data, error, isLoading: data === null };
}
