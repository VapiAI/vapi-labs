"use client";

import { useEffect, useRef, useState } from "react";
import type Vapi from "@vapi-ai/web";
import type { WebCallLauncherProps, WebCallState } from "./types";

export function WebCallLauncher({ assistantId }: WebCallLauncherProps) {
  const clientRef = useRef<Vapi | null>(null);
  const [publicKey, setPublicKey] = useState("");
  const [state, setState] = useState<WebCallState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      clientRef.current?.stop();
      clientRef.current?.removeAllListeners();
    },
    [],
  );

  async function toggleCall(): Promise<void> {
    if (state === "active") {
      clientRef.current?.stop();
      setState("idle");
      return;
    }

    if (!publicKey.trim()) {
      setState("error");
      setError("Paste your Vapi public key first.");
      return;
    }

    try {
      setState("connecting");
      setError(null);
      const { default: VapiClient } = await import("@vapi-ai/web");
      const client = new VapiClient(publicKey.trim());
      clientRef.current = client;
      client.on("call-start", () => setState("active"));
      client.on("call-end", () => setState("idle"));
      client.on("error", () => {
        setState("error");
        setError("The call could not start. Check the key and microphone access.");
      });
      await client.start(assistantId);
      setState("active");
    } catch {
      setState("error");
      setError("The call could not start. Check the key and microphone access.");
    }
  }

  return (
    <details className="web-call-launcher">
      <summary>Optional: call from this page with the Web SDK</summary>
      <div className="web-call-content">
        <div>
          <label htmlFor="vapi-public-key">Vapi public key</label>
          <p>
            Used only in this browser tab. It is never sent to the VapiGotchi
            server or saved.
          </p>
        </div>
        <div className="web-call-controls">
          <input
            id="vapi-public-key"
            value={publicKey}
            onChange={(event) => setPublicKey(event.target.value)}
            placeholder="Paste your public key"
            autoComplete="off"
            spellCheck={false}
            disabled={state === "active" || state === "connecting"}
          />
          <button
            className={`call-button ${state === "active" ? "hang-up" : ""}`}
            type="button"
            onClick={toggleCall}
            disabled={state === "connecting"}
          >
            {state === "connecting"
              ? "Connecting..."
              : state === "active"
                ? "End call"
                : "Start web call"}
          </button>
        </div>
        {error && <p className="web-call-error">{error}</p>}
      </div>
    </details>
  );
}
