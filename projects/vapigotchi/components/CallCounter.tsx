import { HOME_COPY } from "@/lib/homeCopy";
import type { LiveCallSummary, SetupLanguage } from "@/lib/types";

export function CallCounter({
  calls,
  language = "en",
}: {
  calls: LiveCallSummary;
  language?: SetupLanguage;
}) {
  const copy = HOME_COPY[language].pet;

  return (
    <div className="call-stats" aria-live="polite">
      <span>
        <i className="status-dot ringing" />
        {calls.ringing} {copy.ringing}
      </span>
      <span>
        <i className="status-dot active" />
        {calls.active} {copy.connected}
      </span>
      <span>
        <i className="status-dot speaking" />
        {calls.assistantSpeaking} {copy.speaking}
      </span>
    </div>
  );
}
