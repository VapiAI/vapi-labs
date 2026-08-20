import { HOME_COPY } from "@/lib/homeCopy";
import type { SetupLanguage } from "@/lib/types";

const HEALTH_SEGMENTS = Array.from({ length: 10 }, (_, index) => index + 1);

export function HealthMeter({
  health,
  language = "en",
}: {
  health: number;
  language?: SetupLanguage;
}) {
  const copy = HOME_COPY[language].pet;

  return (
    <section
      className="health-panel"
      aria-label={`${copy.healthAria} ${health} ${copy.outOf} 100`}
    >
      <div className="health-heading">
        <span>{copy.health}</span>
        <strong>{health}/100</strong>
      </div>
      <div className="health-segments" aria-hidden="true">
        {HEALTH_SEGMENTS.map((segment) => (
          <span
            className={
              health >= segment * 10 - 9
                ? "health-segment active"
                : "health-segment"
            }
            key={segment}
          />
        ))}
      </div>
    </section>
  );
}
