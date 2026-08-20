import type { DashboardCallHintProps } from "./types";

import { MAIN_ASSISTANTS } from "@/lib/constants";
import { HOME_COPY } from "@/lib/homeCopy";

export function DashboardCallHint({
  language = "en",
  mainPet = false,
}: DashboardCallHintProps) {
  if (mainPet) {
    const assistant = MAIN_ASSISTANTS[language];
    const copy = HOME_COPY[language].pet;
    const callHref = assistant.phone?.href ?? assistant.dashboardHref;

    return (
      <div className="call-action shared-call-action">
        <div className="call-action-copy">
          <span>{copy.callEyebrow}</span>
          <strong>{copy.callTitle}</strong>
          <p>{copy.callDescription}</p>
        </div>
        <a
          className="call-button"
          href={callHref}
          target={assistant.phone ? undefined : "_blank"}
          rel={assistant.phone ? undefined : "noreferrer"}
        >
          {copy.callAction}{" "}
          <span aria-hidden="true">{assistant.phone ? "☎" : "↗"}</span>
        </a>
      </div>
    );
  }

  return (
    <div className="call-action">
      <div className="call-action-copy">
        <span>Ready to wake it up?</span>
        <strong>Start a test call from your Vapi assistant.</strong>
        <p>
          Keep this page open. Vapi sends the call events and tool requests;
          the creature reacts here automatically.
        </p>
      </div>
      <a
        className="call-button"
        href="https://dashboard.vapi.ai/assistants"
        target="_blank"
        rel="noreferrer"
      >
        Open Vapi dashboard ↗
      </a>
    </div>
  );
}
