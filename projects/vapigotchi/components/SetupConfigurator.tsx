"use client";

import type { SetupConfiguratorProps } from "./types";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { MAIN_ASSISTANTS } from "@/lib/constants";
import { SETUP_COPY } from "@/lib/setupCopy";
import { setupTools } from "@/lib/setupTools";
import { CopyButton } from "./CopyButton";
import { SetupBonusActions } from "./SetupBonusActions";
import { SetupField } from "./SetupField";

export function SetupConfigurator({ language }: SetupConfiguratorProps) {
  const origin = useSyncExternalStore(
    () => () => undefined,
    () => window.location.origin,
    () => "https://your-vapigotchi.example",
  );
  const [assistantId, setAssistantId] = useState("");
  const [sharedPet, setSharedPet] = useState(false);
  const copy = SETUP_COPY[language];

  const hasAssistantId = assistantId.trim().length > 0;
  const normalizedId = assistantId.trim() || "YOUR_ASSISTANT_ID";
  const canGenerate = sharedPet || hasAssistantId;
  const encodedId = encodeURIComponent(
    sharedPet ? MAIN_ASSISTANTS[language].petId : normalizedId,
  );
  const urls = useMemo(
    () => ({
      careToolUrl: `${origin}/api/v1/pets/${encodedId}/care`,
      feedToolUrl: `${origin}/api/v1/pets/${encodedId}/feed`,
      getStateToolUrl: `${origin}/api/v1/pets/${encodedId}`,
      livePageUrl: `${origin}/pets/${encodedId}`,
      serverUrl: `${origin}/api/v1/pets/${encodedId}/vapi/events`,
    }),
    [encodedId, origin],
  );
  const { careTool, feedTool, stateTool } = useMemo(
    () => setupTools.jsonGet(language, urls),
    [language, urls],
  );
  const composerPrompt = useMemo(
    () => setupTools.composerPromptGet(language, urls),
    [language, urls],
  );
  const careComposerPrompt = useMemo(
    () => setupTools.careComposerPromptGet(language, urls),
    [language, urls],
  );

  return (
    <div className="configurator">
      <section className="setup-step">
        <div className="step-number">1</div>
        <div className="step-content">
          <span className="eyebrow">{copy.stepOne.eyebrow}</span>
          <h2>{copy.stepOne.title}</h2>
          <p>{copy.stepOne.description}</p>
          <a
            className="primary-link"
            href="https://dashboard.vapi.ai/assistants"
            target="_blank"
            rel="noreferrer"
          >
            {copy.stepOne.createAssistant}
          </a>
          <div className="starter-prompt">
            <div className="starter-prompt-heading">
              <strong>{copy.stepOne.promptLabel}</strong>
              <CopyButton
                copiedLabel={copy.actions.copied}
                label={copy.actions.copyPrompt}
                value={copy.stepOne.assistantPrompt}
              />
            </div>
            <pre>{copy.stepOne.assistantPrompt}</pre>
          </div>
          <div className="starter-prompt">
            <div className="starter-prompt-heading">
              <strong>{copy.stepOne.firstMessageLabel}</strong>
              <CopyButton
                copiedLabel={copy.actions.copied}
                label={copy.actions.copyFirstMessage}
                value={copy.stepOne.firstMessage}
              />
            </div>
            <pre>{copy.stepOne.firstMessage}</pre>
          </div>
          <div className="setup-tip">
            <strong>{copy.stepOne.tipStrong}</strong>
            <span>{copy.stepOne.tipText}</span>
          </div>
        </div>
      </section>

      <section className="setup-step identity-step">
        <div className="step-number">2</div>
        <div className="step-content">
          <span className="eyebrow">{copy.stepTwo.eyebrow}</span>
          <h2>{copy.stepTwo.title}</h2>
          <p>{copy.stepTwo.description}</p>
          <div
            className="pet-target-picker"
            role="radiogroup"
            aria-label={copy.stepTwo.targetLabel}
          >
            <button
              type="button"
              role="radio"
              aria-checked={!sharedPet}
              onClick={() => setSharedPet(false)}
            >
              <strong>{copy.stepTwo.personalTarget}</strong>
              <span>{copy.stepTwo.personalTargetDescription}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={sharedPet}
              onClick={() => setSharedPet(true)}
            >
              <strong>{copy.stepTwo.sharedTarget}</strong>
              <span>{copy.stepTwo.sharedTargetDescription}</span>
            </button>
          </div>
          {!sharedPet && (
            <label className="assistant-input">
              <span>{copy.stepTwo.assistantIdLabel}</span>
              <input
                value={assistantId}
                onChange={(event) => setAssistantId(event.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                spellCheck={false}
              />
            </label>
          )}
          {canGenerate ? (
            <>
              <p className="generated-note">{copy.stepTwo.generatedNote}</p>
              <SetupField
                copiedLabel={copy.actions.copied}
                copyLabel={copy.actions.copy}
                label={copy.stepTwo.serverUrlLabel}
                description={copy.stepTwo.serverUrlDescription}
                value={urls.serverUrl}
              />
              <SetupField
                copiedLabel={copy.actions.copied}
                copyLabel={copy.actions.copy}
                label={copy.stepTwo.livePageLabel}
                description={copy.stepTwo.livePageDescription}
                value={urls.livePageUrl}
              />
            </>
          ) : (
            <div className="locked-panel">
              <span aria-hidden="true">⌁</span>
              {copy.stepTwo.locked}
            </div>
          )}
        </div>
      </section>

      <section className="setup-step">
        <div className="step-number">3</div>
        <div className="step-content">
          <span className="eyebrow">{copy.stepThree.eyebrow}</span>
          <h2>{copy.stepThree.title}</h2>
          <p>{copy.stepThree.description}</p>
          {canGenerate ? (
            <>
              <div className="starter-prompt composer-prompt">
                <div className="starter-prompt-heading">
                  <strong>{copy.stepThree.composerLabel}</strong>
                  <CopyButton
                    copiedLabel={copy.actions.copied}
                    label={copy.actions.copyComposerPrompt}
                    value={composerPrompt}
                  />
                </div>
                <pre>{composerPrompt}</pre>
              </div>
              <div className="tool-card">
                <div className="tool-card-heading">
                  <div>
                    <strong>feed_vapigotchi</strong>
                    <span>{copy.stepThree.feedMeta}</span>
                  </div>
                  <CopyButton
                    copiedLabel={copy.actions.copied}
                    label={copy.actions.copyJson}
                    value={feedTool}
                  />
                </div>
                <pre>{feedTool}</pre>
              </div>
              <div className="tool-card">
                <div className="tool-card-heading">
                  <div>
                    <strong>check_vapigotchi</strong>
                    <span>{copy.stepThree.stateMeta}</span>
                  </div>
                  <CopyButton
                    copiedLabel={copy.actions.copied}
                    label={copy.actions.copyJson}
                    value={stateTool}
                  />
                </div>
                <pre>{stateTool}</pre>
              </div>
              <SetupBonusActions
                careComposerPrompt={careComposerPrompt}
                careTool={careTool}
                language={language}
              />
            </>
          ) : (
            <div className="locked-panel">
              <span aria-hidden="true">⌁</span>
              {copy.stepThree.locked}
            </div>
          )}
        </div>
      </section>

      <section className="setup-step final-step">
        <div className="step-number">4</div>
        <div className="step-content">
          <span className="eyebrow">{copy.stepFour.eyebrow}</span>
          <h2>{copy.stepFour.title}</h2>
          <p>
            {sharedPet
              ? copy.stepFour.sharedDescription
              : copy.stepFour.description}
          </p>
          <div className="final-actions">
            <Link
              className={`primary-link ${canGenerate ? "" : "disabled"}`}
              href={canGenerate ? `/pets/${encodedId}` : "/setup"}
              aria-disabled={!canGenerate}
            >
              {copy.stepFour.openPet}
            </Link>
            <a
              className="secondary-link"
              href="https://dashboard.vapi.ai/assistants"
              target="_blank"
              rel="noreferrer"
            >
              {copy.stepFour.openDashboard}
            </a>
          </div>
          <div className="test-prompt">
            <span>{copy.stepFour.testLabel}</span>
            <blockquote>“{copy.stepFour.testPrompt}”</blockquote>
          </div>
        </div>
      </section>
    </div>
  );
}
