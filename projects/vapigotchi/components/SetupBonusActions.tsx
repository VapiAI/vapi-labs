import type { SetupBonusActionsProps } from "./types";

import { SETUP_COPY } from "@/lib/setupCopy";
import { CopyButton } from "./CopyButton";

export function SetupBonusActions({
  careComposerPrompt,
  careTool,
  language,
}: SetupBonusActionsProps) {
  const copy = SETUP_COPY[language];

  return (
    <details className="bonus-actions">
      <summary>
        <span>{copy.bonus.eyebrow}</span>
        <strong>{copy.bonus.title}</strong>
        <i aria-hidden="true">＋</i>
      </summary>
      <div className="bonus-actions-content">
        <p>{copy.bonus.description}</p>
        <div className="starter-prompt composer-prompt">
          <div className="starter-prompt-heading">
            <strong>{copy.bonus.composerLabel}</strong>
            <CopyButton
              copiedLabel={copy.actions.copied}
              label={copy.actions.copyComposerPrompt}
              value={careComposerPrompt}
            />
          </div>
          <pre>{careComposerPrompt}</pre>
        </div>
        <div className="starter-prompt">
          <div className="starter-prompt-heading">
            <strong>{copy.bonus.promptLabel}</strong>
            <CopyButton
              copiedLabel={copy.actions.copied}
              label={copy.actions.copyPrompt}
              value={copy.bonus.promptAddendum}
            />
          </div>
          <pre>{copy.bonus.promptAddendum}</pre>
        </div>
        <div className="tool-card">
          <div className="tool-card-heading">
            <div>
              <strong>care_for_vapigotchi</strong>
              <span>{copy.bonus.careMeta}</span>
            </div>
            <CopyButton
              copiedLabel={copy.actions.copied}
              label={copy.actions.copyJson}
              value={careTool}
            />
          </div>
          <pre>{careTool}</pre>
        </div>
      </div>
    </details>
  );
}
