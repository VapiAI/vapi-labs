import { useEffect, useMemo, useRef, useState } from 'react';
import { Brain, CircleStop, MessageSquareText, Mic, Music2, Radio, Sparkles } from 'lucide-react';
import { useMachine } from '@xstate/react';
import { isFlowDebugEnabled, traceFlow } from './flowTrace';
import { useChordDetector } from './useChordDetector';
import { usePracticeRuntime, type PracticeRuntime } from './usePracticeRuntime';
import { useVapiTeacher } from './useVapiTeacher';
import { practiceMachine, type PracticeContext, type PracticeStateValue } from './practiceMachine';

type PracticeViewState = PracticeContext & { kind: PracticeStateValue };

export function App() {
  const [snapshot, sendPractice] = useMachine(practiceMachine);
  const state = useMemo<PracticeViewState>(
    () => ({
      ...snapshot.context,
      kind: snapshot.value as PracticeStateValue,
    }),
    [snapshot],
  );
  const detector = useChordDetector();
  const runtimeRef = useRef<PracticeRuntime | null>(null);
  const transcriptListRef = useRef<HTMLDivElement | null>(null);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const showDiagnosticsControls = useMemo(() => isFlowDebugEnabled(), []);
  const teacher = useVapiTeacher({
    onAssistantSpeechStopped: (reason) => runtimeRef.current?.listenAfterTeacher(reason),
    onFeedbackDelivered: (attempt, chord) => runtimeRef.current?.listenAfterRetryFeedback(attempt, chord),
    onUserSpeechStarted: () => runtimeRef.current?.handleUserSpeechStarted(),
    onChordToolCall: (chord) => runtimeRef.current?.handleChordToolCall(chord),
    onEndSession: () => runtimeRef.current?.endLocalSession(),
  });
  const runtime = usePracticeRuntime({
    state,
    detector,
    teacher,
    sendPractice,
  });
  runtimeRef.current = runtime;

  const chatTranscript = useMemo(
    () => teacher.transcript.filter(
      (event) => !event.isPartial && (event.role === 'assistant' || event.role === 'user'),
    ),
    [teacher.transcript],
  );
  const startButtonLabel =
    teacher.status === 'connecting'
      ? 'Connecting...'
      : teacher.status === 'connected'
        ? 'Practice running'
        : teacher.canUseVapi
          ? 'Start practice'
          : 'Configuration needed';
  const startDisabled = !teacher.canUseVapi;

  async function copyDiagnostics() {
    const trace = window.__ukuleleFlowTrace ?? [];
    const payload = JSON.stringify(trace, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setDiagnosticsCopied(true);
      window.setTimeout(() => setDiagnosticsCopied(false), 1600);
      traceFlow('app', 'diagnostics-copied', { entries: trace.length });
    } catch (error) {
      traceFlow('app', 'diagnostics-copy-failed', {
        entries: trace.length,
        error: error instanceof Error ? error.message : String(error),
      });
      console.info('[ukulele-flow-copy]', payload);
    }
  }

  useEffect(() => {
    const transcriptList = transcriptListRef.current;
    if (!transcriptList) return;
    transcriptList.scrollTop = transcriptList.scrollHeight;
  }, [chatTranscript]);

  const currentTitle = state.toolResult?.structuredContent.title ?? 'Choose a chord';

  return (
    <main className="app-shell">
      <section className="topbar" aria-label="Prototype status">
        <div>
          <h1>Ukulele Teacher</h1>
        </div>
        <div className="status-pill">
          <Radio size={16} />
          <span>{teacher.status}</span>
        </div>
      </section>

      <section className="workspace">
        <aside className="control-panel" aria-label="Practice controls">
          <section className="panel-section">
            <div className="section-title">
              <Sparkles size={17} />
              <h2>Voice teacher</h2>
            </div>
            <p className="teacher-line">{teacher.lastTeacherLine}</p>
            <div className="button-row">
              <button
                className="primary-button"
                type="button"
                onClick={runtime.startPractice}
                disabled={startDisabled}
              >
                <Mic size={17} />
                {startButtonLabel}
              </button>
              <button className="secondary-button" type="button" onClick={teacher.stop}>
                <CircleStop size={17} />
                End session
              </button>
            </div>
          </section>

          <section className="panel-section">
            <div className="section-title">
              <Music2 size={17} />
              <h2>Attempt</h2>
            </div>
            <div className={`verdict verdict-${detector.result.verdict}`}>
              {detector.result.verdict}
            </div>
            <p>{detector.result.message}</p>
            {detector.isListening ? (
              <p className={detector.hasSignal ? 'signal-good' : 'signal-waiting'}>
                {detector.hasSignal ? 'Mic heard sound. Keep letting it ring.' : 'Waiting for a clear strum.'}
              </p>
            ) : null}
            <div className="meter" aria-label={`Confidence ${detector.result.confidence}`}>
              <span style={{ width: `${Math.round(detector.result.confidence * 100)}%` }} />
            </div>
            <div className="meter signal-meter" aria-label={`Mic signal ${detector.signalLevel}`}>
              <span style={{ width: `${detector.signalLevel}%` }} />
            </div>
            <p className="small-label">
              Detected: {detector.result.detectedNotes.length ? detector.result.detectedNotes.join(', ') : 'none yet'}
            </p>
          </section>
        </aside>

        <section className="stage" aria-label="Practice card">
          <div className="stage-header">
            <div>
              <span className="eyebrow">Practice view</span>
              <h2>{currentTitle}</h2>
            </div>
            <span className={`state-badge state-${state.kind}`}>{state.kind}</span>
          </div>

          {runtime.uiHtml && runtime.uiFrameResourceUri ? (
            <iframe
              key={runtime.uiFrameResourceUri}
              className="mcp-frame"
              title={`${currentTitle} practice card`}
              srcDoc={runtime.uiHtml}
              sandbox="allow-scripts"
              onLoad={(event) => {
                event.currentTarget.classList.add('ready');
                void runtime.connectMcpAppFrame(event.currentTarget);
              }}
            />
          ) : (
            <div className="empty-state">
              <Brain size={42} />
              <p>Start the voice teacher and ask for a chord to open the practice view.</p>
            </div>
          )}

          {state.error ? <p className="error-text">{state.error}</p> : null}
        </section>

        <aside className="feedback-panel" aria-label="Feedback">
          <section className="panel-section transcript-section">
            <div className="section-title">
              <MessageSquareText size={17} />
              <h2>Transcript</h2>
              {showDiagnosticsControls ? (
                <button className="diagnostics-button" type="button" onClick={copyDiagnostics}>
                  {diagnosticsCopied ? 'Copied' : 'Copy diagnostics'}
                </button>
              ) : null}
            </div>
            <div className="transcript-list" aria-live="polite" ref={transcriptListRef}>
              {chatTranscript.length ? (
                chatTranscript.map((event) => (
                  <article className={`transcript-event transcript-${event.role}`} key={event.id}>
                    <div>
                      <strong>{event.label}</strong>
                      <time>{event.at}</time>
                    </div>
                    <p>{event.text}</p>
                  </article>
                ))
              ) : (
                <p className="empty-copy">Start practice to see the conversation here.</p>
              )}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
