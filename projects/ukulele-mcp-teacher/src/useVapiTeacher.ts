import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttemptResult, ChordName } from './types';
import { vapiClientMessages } from './vapiConfig';
import { chordCatalog, chordSpokenNames, normalizeChordName } from './chords';
import { isFlowDebugEnabled, traceFlow } from './flowTrace';
import {
  clipTraceText,
  extractChordFromToolResult,
  isChordToolName,
  isSpeechUpdateMessage,
  isToolCallsMessage,
  isToolCallsResultMessage,
  isToolCompletedMessage,
  isTranscriptMessage,
  isUserInterruptedMessage,
  parseToolArguments,
  summarizeVapiMessage,
  transcriptRole,
} from './teacher/vapiMessages';
import {
  appendTranscriptEvent,
  createTranscriptEvent,
  reconcileTranscriptTurn,
  type TranscriptEvent,
} from './teacher/transcript';

type TeacherStatus = 'ready' | 'connecting' | 'connected' | 'error';

type VapiSendMessage =
  | {
      type: 'add-message';
      message: { role: 'system'; content: string };
      triggerResponseEnabled?: boolean;
    }
  | {
      type: 'say';
      message?: string;
      content: string;
      endCallAfterSpoken?: boolean;
      interruptionsEnabled?: boolean;
      interruptAssistantEnabled?: boolean;
    }
  | {
      type: 'control';
      control: 'mute-assistant' | 'unmute-assistant' | 'say-first-message';
    }
  | { type: 'end-call' };

type VapiClient = {
  start: (
    assistantIdOrConfig: string | Record<string, unknown>,
    assistantOverrides?: Record<string, unknown>,
  ) => Promise<unknown> | unknown;
  stop: () => void;
  setMuted?: (mute: boolean) => void;
  send?: (message: VapiSendMessage) => void;
  say?: (
    message: string,
    endCallAfterSpoken?: boolean,
    interruptionsEnabled?: boolean,
    interruptAssistantEnabled?: boolean,
  ) => void;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
};

type UseVapiTeacherOptions = {
  onAssistantSpeechStopped?: (reason?: string) => void | Promise<void>;
  onFeedbackDelivered?: (attempt: AttemptResult, chord: ChordName) => void | Promise<void>;
  onUserSpeechStarted?: () => void | Promise<void>;
  onChordToolCall?: (chord: ChordName) => void | Promise<void>;
  onEndSession?: () => void | Promise<void>;
};

type BrowserSpeechWindow = {
  id: number;
  kind: 'speech' | 'transition';
  reason: string;
  expectedLine: string;
  expectedChordPhrase: string | null;
  suppressUntil: number;
  acceptedFinal: boolean;
  completedExpectedLine: boolean;
  started: boolean;
};

type SayOptions = {
  reason?: string;
  interruptionsEnabled?: boolean;
  interruptAssistantEnabled?: boolean;
  endCallAfterSpoken?: boolean;
  handoffDelayMs?: number;
  watchdogMs?: number | false;
};

const lastSpokenVariantIndexByKey = new Map<string, number>();

export function useVapiTeacher(options: UseVapiTeacherOptions = {}) {
  const publicKey = import.meta.env.VITE_VAPI_PUBLIC_KEY as string | undefined;
  const assistantId = import.meta.env.VITE_VAPI_ASSISTANT_ID as string | undefined;
  const hasCredentials = Boolean(publicKey && assistantId);
  const missingConfiguration = [
    publicKey ? null : 'VITE_VAPI_PUBLIC_KEY',
    assistantId ? null : 'VITE_VAPI_ASSISTANT_ID',
  ].filter((name): name is string => Boolean(name));
  const [status, setStatus] = useState<TeacherStatus>(hasCredentials ? 'ready' : 'error');
  const [lastTeacherLine, setLastTeacherLine] = useState(
    hasCredentials
      ? 'Ready for a live practice session.'
      : `Missing Vapi configuration: ${missingConfiguration.join(', ')}. Run assistant:create, then restart the app.`,
  );
  const [transcript, setTranscript] = useState<TranscriptEvent[]>([]);
  const vapiRef = useRef<VapiClient | null>(null);
  const optionsRef = useRef(options);
  const feedbackDeliveredTimerRef = useRef<number | null>(null);
  const lastAnnouncedChordRef = useRef<ChordName | null>(null);
  const lastSayNowRef = useRef<{ line: string; at: number } | null>(null);
  const suppressInterruptedAssistantTranscriptRef = useRef(false);
  const browserSpeechWindowRef = useRef<BrowserSpeechWindow | null>(null);
  const browserSpeechWindowTimerRef = useRef<number | null>(null);
  const scheduledSayTimerRef = useRef<number | null>(null);
  const sayStartWatchdogTimerRef = useRef<number | null>(null);
  const endSessionTimerRef = useRef<number | null>(null);
  const assistantMutedRef = useRef(false);
  const assistantUnmuteTimerRef = useRef<number | null>(null);
  const userInputMutedRef = useRef(false);
  const endingSessionRef = useRef(false);
  const localSessionEndedRef = useRef(false);
  const fatalErrorRef = useRef<string | null>(null);
  const nextBrowserSpeechWindowIdRef = useRef(1);

  optionsRef.current = options;

  useEffect(() => () => {
    clearFeedbackDeliveredTimer();
    clearEndSessionTimer();
    clearScheduledSay();
    clearAssistantUnmuteTimer();
    clearSayStartWatchdog();
    clearBrowserSpeechWindow('unmount');
    setUserInputMuted(false, 'unmount');
  }, []);

  const canUseVapi = hasCredentials && status !== 'connected' && status !== 'connecting';
  const addTranscriptEvent = useCallback((role: TranscriptEvent['role'], text: string) => {
    const event = createTranscriptEvent(role, text);
    if (isFlowDebugEnabled()) {
      console.info(`[ukulele-teacher] ${event.label}: ${event.text}`);
    }
    setTranscript((events) => appendTranscriptEvent(events, event));
  }, []);

  const addTranscriptTurn = useCallback((
    role: Extract<TranscriptEvent['role'], 'assistant' | 'user'>,
    text: string,
    transcriptType: 'partial' | 'final',
  ) => {
    const isPartial = transcriptType === 'partial';
    const event = createTranscriptEvent(role, text, isPartial);
    if (isFlowDebugEnabled()) {
      console.info(`[ukulele-teacher] ${event.label}${isPartial ? ' partial' : ''}: ${event.text}`);
    }
    if (isPartial) return;

    setTranscript((events) => reconcileTranscriptTurn(events, event));
  }, []);

  const start = useCallback(async () => {
    traceFlow('vapi', 'start-called', { status, hasCredentials, hasAssistantId: Boolean(assistantId) });
    if (status === 'connecting' || status === 'connected') return;

    if (!publicKey || !assistantId) {
      const message = `Cannot start Vapi call. Missing ${missingConfiguration.join(', ')}.`;
      console.error(`[ukulele-teacher] ${message}`);
      setStatus('error');
      setLastTeacherLine(message);
      addTranscriptEvent('system', message);
      return;
    }

    try {
      setStatus('connecting');
      fatalErrorRef.current = null;
      traceFlow('vapi', 'import-sdk-start');
      const module = await import('@vapi-ai/web');
      const Vapi = module.default;
      const vapi = new Vapi(publicKey) as unknown as VapiClient;
      vapiRef.current = vapi;
      traceFlow('vapi', 'sdk-created');

      vapi.on('call-start', () => {
        traceFlow('vapi', 'call-start');
        endingSessionRef.current = false;
        localSessionEndedRef.current = false;
        lastAnnouncedChordRef.current = null;
        suppressInterruptedAssistantTranscriptRef.current = false;
        userInputMutedRef.current = false;
        setStatus('connected');
        setLastTeacherLine('Teacher call started.');
        addTranscriptEvent('system', 'Practice call started.');
      });

      vapi.on('call-end', () => {
        traceFlow('vapi', 'call-end');
        const fatalError = fatalErrorRef.current;
        clearFeedbackDeliveredTimer();
        clearEndSessionTimer();
        clearScheduledSay();
        clearSayStartWatchdog();
        clearAssistantUnmuteTimer();
        clearBrowserSpeechWindow('call-end');
        userInputMutedRef.current = false;
        endingSessionRef.current = false;
        assistantMutedRef.current = false;
        suppressInterruptedAssistantTranscriptRef.current = false;
        setStatus(fatalError ? 'error' : 'ready');
        setLastTeacherLine(fatalError ?? 'Teacher call ended.');
        addTranscriptEvent('system', 'Practice call ended.');
        if (!localSessionEndedRef.current) {
          localSessionEndedRef.current = true;
          void optionsRef.current.onEndSession?.();
        }
      });

      vapi.on('speech-end', () => {
        traceFlow('vapi', 'speech-end');
        addTranscriptEvent('system', 'Teacher stopped speaking.');
        void optionsRef.current.onAssistantSpeechStopped?.(currentBrowserSpeechReason());
      });

      vapi.on('speech-start', () => {
        traceFlow('vapi', 'speech-start');
        markAssistantSpeechStarted('sdk-speech-start');
        addTranscriptEvent('system', 'Teacher started speaking.');
      });

      vapi.on('message', (message) => {
        traceFlow('vapi-message', 'received', summarizeVapiMessage(message));
        if (isUserInterruptedMessage(message)) {
          suppressInterruptedAssistantTranscriptRef.current = true;
          clearFeedbackDeliveredTimer();
          traceFlow('vapi-message', 'suppress-interrupted-assistant-transcript');
          addTranscriptEvent('system', 'Teacher interrupted.');
          void optionsRef.current.onUserSpeechStarted?.();
        }

        if (isTranscriptMessage(message)) {
          const role = transcriptRole(message);
          const transcriptType = message.transcriptType ?? 'final';
          let acceptedBrowserSpeech = false;
          if (role === 'assistant') {
            const browserSpeechDecision = evaluateBrowserSpeechTranscript(
              message.transcript,
              transcriptType,
            );
            if (browserSpeechDecision === 'skip') return;
            acceptedBrowserSpeech = browserSpeechDecision === 'accept';
          }
          if (
            role === 'assistant' &&
            suppressInterruptedAssistantTranscriptRef.current &&
            !acceptedBrowserSpeech
          ) {
            traceFlow('vapi-message', 'skipped-interrupted-assistant-transcript', {
              transcriptType: message.transcriptType ?? 'final',
              transcript: clipTraceText(message.transcript),
            });
            return;
          }

          setLastTeacherLine(message.transcript);
          if (role === 'assistant' || role === 'user') {
            addTranscriptTurn(role, message.transcript, transcriptType);
          } else {
            addTranscriptEvent(role, message.transcript);
          }
        }

        if (isSpeechUpdateMessage(message)) {
          addTranscriptEvent(
            'system',
            `${message.role === 'assistant' ? 'Teacher' : 'You'} ${message.status} speaking.`,
          );
          if (message.role === 'assistant' && message.status === 'stopped') {
            void optionsRef.current.onAssistantSpeechStopped?.(currentBrowserSpeechReason());
          }
          if (message.role === 'assistant' && message.status === 'started') {
            markAssistantSpeechStarted('speech-update');
            if (browserSpeechWindowRef.current) {
              traceFlow('vapi-message', 'assistant-speech-update-started-during-browser-speech-window', {
                browserSpeechWindowId: browserSpeechWindowRef.current.id,
              });
            } else {
              suppressInterruptedAssistantTranscriptRef.current = false;
            }
          }
          if (message.role === 'user' && message.status === 'started') {
            clearBrowserSpeechWindow('user-speech-started');
            clearFeedbackDeliveredTimer();
            void optionsRef.current.onUserSpeechStarted?.();
          }
        }

        if (isToolCallsMessage(message)) {
          for (const toolCall of message.toolCallList) {
            const functionName = toolCall.function?.name;
            if (functionName === 'end_practice_session') {
              const args = parseToolArguments(toolCall.function?.arguments);
              if (args.confirmation !== 'confirmed') {
                traceFlow('vapi-tool', 'end-session-rejected-without-tool-confirmation');
                addTranscriptEvent('system', 'Ignored end_practice_session without confirmation="confirmed".');
                sendContext({
                  type: 'end_session_rejected',
                  instruction:
                    'The end-session tool did not include confirmation="confirmed". Ask the learner to confirm stopping before calling it again.',
                }, true);
                continue;
              }
              addTranscriptEvent('tool', 'end_practice_session()');
              stopSession();
              continue;
            }

            if (!isChordToolName(functionName)) continue;

            const args = parseToolArguments(toolCall.function?.arguments);
            const chord = normalizeChordName(args.chord);
            if (!chord) {
              traceFlow('vapi-tool', 'ignored-unsupported-chord', {
                functionName,
                rawChord: String(args.chord ?? ''),
              });
              addTranscriptEvent('system', `Ignored unsupported chord tool argument: ${String(args.chord ?? '')}`);
              continue;
            }

            traceFlow('vapi-tool', 'tool-call', { functionName, chord });
            addTranscriptEvent('tool', `${functionName}(${chord})`);
            void optionsRef.current.onChordToolCall?.(chord);
          }
        }

        if (isToolCompletedMessage(message)) {
          for (const toolResult of message.messages) {
            const toolCallResult = toolResult.toolCallResult;
            if (!toolCallResult) continue;

            const functionName = toolCallResult.name;
            if (!isChordToolName(functionName)) continue;

            const chord = extractChordFromToolResult(toolCallResult);
            if (!chord) continue;

            traceFlow('vapi-tool', 'tool-completed', { functionName, chord });
            addTranscriptEvent('tool', `${functionName} result(${chord})`);
          }
        }

        if (isToolCallsResultMessage(message)) {
          const functionName = message.toolCallResult.name;
          if (isChordToolName(functionName)) {
            const chord = extractChordFromToolResult(message.toolCallResult);
            if (chord) {
              traceFlow('vapi-tool', 'tool-calls-result', { functionName, chord });
              addTranscriptEvent('tool', `${functionName} result(${chord})`);
            }
          }
        }
      });

      traceFlow('vapi', 'start-sdk-call', { assistantId });
      await vapi.start(assistantId, {
        clientMessages: [...vapiClientMessages],
      });
      traceFlow('vapi', 'start-sdk-call-returned');
    } catch (error) {
      traceFlow('vapi', 'start-error', { error: error instanceof Error ? error.message : String(error) });
      setStatus('error');
      const line = error instanceof Error ? error.message : 'Voice teacher failed to start.';
      setLastTeacherLine(line);
      addTranscriptEvent('system', line);
    }
  }, [addTranscriptEvent, addTranscriptTurn, assistantId, publicKey, status]);

  const stopSession = useCallback(() => {
    traceFlow('vapi', 'stop-session');
    clearFeedbackDeliveredTimer();
    clearScheduledSay();
    if (!hasCredentials || status !== 'connected' || !vapiRef.current) {
      endSessionNow('stop-session');
      return;
    }
    if (endingSessionRef.current) {
      traceFlow('vapi', 'stop-session-ignored-already-ending');
      return;
    }

    endingSessionRef.current = true;
    localSessionEndedRef.current = true;
    const line = 'Good practice today. See you next time.';
    setLastTeacherLine(line);
    void optionsRef.current.onEndSession?.();
    sayNow(line, {
      reason: 'end-session',
      interruptionsEnabled: false,
      interruptAssistantEnabled: true,
      endCallAfterSpoken: true,
      watchdogMs: false,
    });
    clearEndSessionTimer();
    endSessionTimerRef.current = window.setTimeout(() => {
      endSessionTimerRef.current = null;
      endSessionNow('end-session-timeout');
    }, feedbackDeliveryDelayMs(line) + 1600);
  }, [addTranscriptEvent, hasCredentials, status]);

  const interruptTeacher = useCallback((reason: string, holdMs = 1600) => {
    traceFlow('browser-to-vapi', 'teacher-interrupt', {
      reason,
      hasVapi: Boolean(vapiRef.current),
      wasMuted: assistantMutedRef.current,
    });
    clearFeedbackDeliveredTimer();
    holdAssistantTranscripts(reason, holdMs);
    muteAssistant(reason, holdMs);
  }, []);

  const setUserInputMuted = useCallback((muted: boolean, reason: string) => {
    if (userInputMutedRef.current === muted) return;
    userInputMutedRef.current = muted;
    traceFlow('browser-to-vapi', 'user-input-muted', {
      muted,
      reason,
      hasVapi: Boolean(vapiRef.current),
    });
    vapiRef.current?.setMuted?.(muted);
  }, []);

  const announceChord = useCallback((chord: ChordName) => {
    if (lastAnnouncedChordRef.current === chord) {
      traceFlow('browser-context', 'announce-chord-skipped-duplicate', { chord });
      return 0;
    }
    lastAnnouncedChordRef.current = chord;

    traceFlow('browser-context', 'announce-chord', { chord, hasCredentials });
    const line = strumInstructionLine(chord);
    setLastTeacherLine(line);
    if (hasCredentials) {
      addTranscriptEvent('browser', `Chord UI loaded for ${chordSpokenNames[chord]}.`);
      sendContext({
        type: 'selected_chord',
        chord,
        chordName: chordSpokenNames[chord],
        instruction:
          `The learner navigated to ${spokenChordPhrase(chord)} in the MCP App. The browser is handling the next spoken instruction deterministically. Do not respond to this event unless the learner asks a separate question.`,
      });
      sayNow(line, {
        reason: 'chord-instruction',
        interruptionsEnabled: true,
        interruptAssistantEnabled: true,
        handoffDelayMs: 220,
        watchdogMs: false,
      });
    } else {
      addTranscriptEvent('browser', `Chord UI loaded for ${chordSpokenNames[chord]}.`);
    }
    return hasCredentials ? feedbackDeliveryDelayMs(line) + 600 : 0;
  }, [addTranscriptEvent, hasCredentials]);

  const announceListening = useCallback((chord: ChordName) => {
    traceFlow('browser-context', 'announce-listening', { chord, hasCredentials });
    const line = `Listening for ${chordSpokenNames[chord]} now. Strum once and let it ring.`;
    setLastTeacherLine(line);
    addTranscriptEvent('browser', line);
    sendContext({ type: 'listening_started', chord, chordName: chordSpokenNames[chord] });
  }, [hasCredentials]);

  const announceAttempt = useCallback((attempt: AttemptResult, chord: ChordName) => {
    const line = coachingLine(chord, attempt);
    const payload = {
      type: 'chord_attempt_result',
      chord,
      chordName: chordSpokenNames[chord],
      spokenFeedback: line,
      attempt,
      instruction: attemptResponseInstruction(chord, attempt, line),
    };
    traceFlow('browser-context', 'announce-attempt', {
      chord,
      verdict: attempt.verdict,
      confidence: attempt.confidence,
      hasCredentials,
      line,
    });
    setLastTeacherLine(line);
    addTranscriptEvent(
      'browser',
      `${chord} attempt: ${attempt.verdict} (${Math.round(attempt.confidence * 100)}% confidence). ${attempt.message}`,
    );
    if (hasCredentials) {
      sendContext(payload, false);
      sayNow(line, {
        reason: 'feedback',
        interruptionsEnabled: true,
        interruptAssistantEnabled: false,
        handoffDelayMs: 220,
      });
      scheduleFeedbackDelivered(attempt, chord, line);
    } else {
      addTranscriptEvent('system', 'Vapi is not configured; spoken feedback was not sent.');
      scheduleFeedbackDelivered(attempt, chord, line);
    }
  }, [hasCredentials]);

  function scheduleFeedbackDelivered(attempt: AttemptResult, chord: ChordName, line: string) {
    clearFeedbackDeliveredTimer();
    if (attempt.verdict !== 'almost' && attempt.verdict !== 'missed') return;

    feedbackDeliveredTimerRef.current = window.setTimeout(() => {
      feedbackDeliveredTimerRef.current = null;
      traceFlow('browser-context', 'feedback-delivered-timer', {
        chord,
        verdict: attempt.verdict,
      });
      void optionsRef.current.onFeedbackDelivered?.(attempt, chord);
    }, feedbackDeliveryDelayMs(line));
  }

  function clearFeedbackDeliveredTimer() {
    if (feedbackDeliveredTimerRef.current === null) return;
    window.clearTimeout(feedbackDeliveredTimerRef.current);
    feedbackDeliveredTimerRef.current = null;
  }

  function clearEndSessionTimer() {
    if (endSessionTimerRef.current === null) return;
    window.clearTimeout(endSessionTimerRef.current);
    endSessionTimerRef.current = null;
  }

  function clearScheduledSay() {
    if (scheduledSayTimerRef.current === null) return;
    window.clearTimeout(scheduledSayTimerRef.current);
    scheduledSayTimerRef.current = null;
  }

  function clearSayStartWatchdog() {
    if (sayStartWatchdogTimerRef.current === null) return;
    window.clearTimeout(sayStartWatchdogTimerRef.current);
    sayStartWatchdogTimerRef.current = null;
  }

  function clearAssistantUnmuteTimer() {
    if (assistantUnmuteTimerRef.current === null) return;
    window.clearTimeout(assistantUnmuteTimerRef.current);
    assistantUnmuteTimerRef.current = null;
  }

  function beginBrowserSpeechWindow(line: string, reason: string) {
    clearBrowserSpeechWindow('replace');
    const id = nextBrowserSpeechWindowIdRef.current;
    nextBrowserSpeechWindowIdRef.current += 1;
    const guardMs = browserSpeechGuardMs(line);
    const speechWindow: BrowserSpeechWindow = {
      id,
      kind: 'speech',
      reason,
      expectedLine: line,
      expectedChordPhrase: expectedChordPhrase(line),
      suppressUntil: Date.now() + guardMs,
      acceptedFinal: false,
      completedExpectedLine: false,
      started: false,
    };
    browserSpeechWindowRef.current = speechWindow;
    traceFlow('browser-to-vapi', 'browser-speech-window-start', {
      id,
      line,
      guardMs,
      expectedChordPhrase: speechWindow.expectedChordPhrase,
    });
    browserSpeechWindowTimerRef.current = window.setTimeout(() => {
      if (browserSpeechWindowRef.current?.id !== id) return;
      clearBrowserSpeechWindow('timeout');
    }, guardMs);
    return id;
  }

  function holdAssistantTranscripts(reason: string, guardMs = 1600) {
    clearScheduledSay();
    clearBrowserSpeechWindow('replace');
    const id = nextBrowserSpeechWindowIdRef.current;
    nextBrowserSpeechWindowIdRef.current += 1;
    browserSpeechWindowRef.current = {
      id,
      kind: 'transition',
      reason,
      expectedLine: '',
      expectedChordPhrase: null,
      suppressUntil: Date.now() + guardMs,
      acceptedFinal: false,
      completedExpectedLine: false,
      started: false,
    };
    traceFlow('browser-to-vapi', 'assistant-transcript-hold-start', { id, reason, guardMs });
    browserSpeechWindowTimerRef.current = window.setTimeout(() => {
      if (browserSpeechWindowRef.current?.id !== id) return;
      clearBrowserSpeechWindow('hold-timeout');
    }, guardMs);
  }

  function clearBrowserSpeechWindow(reason: string) {
    if (browserSpeechWindowTimerRef.current !== null) {
      window.clearTimeout(browserSpeechWindowTimerRef.current);
      browserSpeechWindowTimerRef.current = null;
    }
    const speechWindow = browserSpeechWindowRef.current;
    if (!speechWindow) return;

    clearSayStartWatchdog();
    browserSpeechWindowRef.current = null;
    traceFlow('browser-to-vapi', 'browser-speech-window-end', {
      id: speechWindow.id,
      kind: speechWindow.kind,
      reason,
      acceptedFinal: speechWindow.acceptedFinal,
      completedExpectedLine: speechWindow.completedExpectedLine,
    });
  }

  function currentBrowserSpeechReason() {
    const speechWindow = browserSpeechWindowRef.current;
    return speechWindow?.kind === 'speech' ? speechWindow.reason : undefined;
  }

  function evaluateBrowserSpeechTranscript(
    transcriptText: string,
    transcriptType: 'partial' | 'final',
  ): 'accept' | 'skip' | 'none' {
    const speechWindow = browserSpeechWindowRef.current;
    if (!speechWindow) return 'none';

    if (Date.now() > speechWindow.suppressUntil) {
      clearBrowserSpeechWindow('expired-before-transcript');
      return 'none';
    }

    if (speechWindow.kind === 'transition') {
      traceFlow('vapi-message', 'skipped-transition-assistant-transcript', {
        browserSpeechWindowId: speechWindow.id,
        transcriptType,
        transcript: clipTraceText(transcriptText),
      });
      return 'skip';
    }

    if (matchesExpectedBrowserSpeech(transcriptText, speechWindow)) {
      if (speechWindow.completedExpectedLine) {
        traceFlow('vapi-message', 'skipped-repeated-browser-speech-transcript', {
          browserSpeechWindowId: speechWindow.id,
          transcriptType,
          transcript: clipTraceText(transcriptText),
        });
        return 'skip';
      }
      if (transcriptType === 'final') {
        speechWindow.acceptedFinal = true;
        if (transcriptCompletesExpectedLine(transcriptText, speechWindow.expectedLine)) {
          speechWindow.completedExpectedLine = true;
          extendBrowserSpeechWindow(speechWindow, repeatedSpeechCooldownMs(speechWindow.expectedLine));
        }
      }
      suppressInterruptedAssistantTranscriptRef.current = false;
      traceFlow('vapi-message', 'accepted-browser-speech-transcript', {
        browserSpeechWindowId: speechWindow.id,
        transcriptType,
        transcript: clipTraceText(transcriptText),
      });
      return 'accept';
    }

    traceFlow('vapi-message', 'skipped-stale-assistant-transcript', {
      browserSpeechWindowId: speechWindow.id,
      transcriptType,
      expectedLine: clipTraceText(speechWindow.expectedLine),
      transcript: clipTraceText(transcriptText),
    });
    return 'skip';
  }

  function extendBrowserSpeechWindow(speechWindow: BrowserSpeechWindow, guardMs: number) {
    if (browserSpeechWindowTimerRef.current !== null) {
      window.clearTimeout(browserSpeechWindowTimerRef.current);
      browserSpeechWindowTimerRef.current = null;
    }
    speechWindow.suppressUntil = Date.now() + guardMs;
    traceFlow('browser-to-vapi', 'browser-speech-window-extended', {
      id: speechWindow.id,
      kind: speechWindow.kind,
      guardMs,
    });
    browserSpeechWindowTimerRef.current = window.setTimeout(() => {
      if (browserSpeechWindowRef.current?.id !== speechWindow.id) return;
      clearBrowserSpeechWindow('repeat-cooldown-timeout');
    }, guardMs);
  }

  function sendContext(payload: unknown, triggerResponseEnabled = false) {
    traceFlow('browser-to-vapi', 'send-context', {
      hasVapi: Boolean(vapiRef.current),
      triggerResponseEnabled,
      payload,
    });
    vapiRef.current?.send?.({
      type: 'add-message',
      message: {
        role: 'system',
        content: `Browser practice event: ${JSON.stringify(payload)}`,
      },
      triggerResponseEnabled,
    });
  }

  function sayNow(line: string, options: SayOptions = {}) {
    if (options.handoffDelayMs && options.handoffDelayMs > 0) {
      clearScheduledSay();
      traceFlow('browser-to-vapi', 'say-now-scheduled', {
        line,
        reason: options.reason ?? 'primary',
        delayMs: options.handoffDelayMs,
      });
      scheduledSayTimerRef.current = window.setTimeout(() => {
        scheduledSayTimerRef.current = null;
        sayNow(line, { ...options, handoffDelayMs: 0 });
      }, options.handoffDelayMs);
      return;
    }

    const lastSayNow = lastSayNowRef.current;
    const now = Date.now();
    if (lastSayNow && normalizedSpeechText(lastSayNow.line) === normalizedSpeechText(line) && now - lastSayNow.at < 900) {
      traceFlow('browser-to-vapi', 'say-now-skipped-duplicate', { line });
      return;
    }
    lastSayNowRef.current = { line, at: now };
    unmuteAssistant('before-say');
    const reason = options.reason ?? 'primary';
    const speechWindowId = beginBrowserSpeechWindow(line, reason);

    const sent = sendSay(line, reason, options);
    if (sent && hasCredentials && options.watchdogMs !== false) {
      startSayStartWatchdog(line, speechWindowId, reason, options.watchdogMs);
    }
  }

  function sendSay(line: string, reason: string, options: SayOptions = {}) {
    const interruptionsEnabled = options.interruptionsEnabled ?? false;
    const interruptAssistantEnabled = options.interruptAssistantEnabled ?? false;
    const endCallAfterSpoken = options.endCallAfterSpoken ?? false;
    traceFlow('browser-to-vapi', 'say-now-sdk', {
      line,
      reason,
      endCallAfterSpoken,
      interruptionsEnabled,
      interruptAssistantEnabled,
    });
    if (isFlowDebugEnabled()) {
      console.info('[ukulele-teacher] Sending Vapi say():', line);
    }
    if (vapiRef.current?.say) {
      vapiRef.current.say(line, endCallAfterSpoken, interruptionsEnabled, interruptAssistantEnabled);
      return true;
    }

    traceFlow('browser-to-vapi', 'say-now-sdk-unavailable', { line, reason });
    return false;
  }

  function startSayStartWatchdog(line: string, speechWindowId: number, reason: string, delayMs = 2200) {
    clearSayStartWatchdog();
    sayStartWatchdogTimerRef.current = window.setTimeout(() => {
      sayStartWatchdogTimerRef.current = null;
      const speechWindow = browserSpeechWindowRef.current;
      if (!speechWindow || speechWindow.id !== speechWindowId || speechWindow.started) return;

      const error = `Vapi did not start speaking within ${delayMs}ms for ${reason}.`;
      traceFlow('browser-to-vapi', 'say-start-watchdog-timeout', {
        line,
        reason,
        browserSpeechWindowId: speechWindowId,
      });
      console.error(`[ukulele-teacher] ${error}`);
      fatalErrorRef.current = error;
      setStatus('error');
      setLastTeacherLine(error);
      addTranscriptEvent('system', error);
      clearBrowserSpeechWindow('say-start-watchdog-timeout');
      vapiRef.current?.stop();
    }, delayMs);
  }

  function markAssistantSpeechStarted(source: string) {
    const speechWindow = browserSpeechWindowRef.current;
    if (!speechWindow || speechWindow.started) return;
    speechWindow.started = true;
    clearSayStartWatchdog();
    traceFlow('browser-to-vapi', 'say-start-confirmed', {
      source,
      browserSpeechWindowId: speechWindow.id,
    });
  }

  function endSessionNow(reason: string) {
    traceFlow('vapi', 'end-session-now', { reason });
    clearFeedbackDeliveredTimer();
    clearEndSessionTimer();
    clearScheduledSay();
    clearSayStartWatchdog();
    clearAssistantUnmuteTimer();
    setUserInputMuted(false, reason);
    clearBrowserSpeechWindow(reason);
    assistantMutedRef.current = false;
    endingSessionRef.current = false;
    vapiRef.current?.stop();
    setStatus(hasCredentials ? 'ready' : 'error');
    addTranscriptEvent('system', 'Practice session ended.');
    if (!localSessionEndedRef.current) {
      localSessionEndedRef.current = true;
      void optionsRef.current.onEndSession?.();
    }
  }

  function muteAssistant(reason: string, holdMs = 180) {
    clearAssistantUnmuteTimer();
    assistantMutedRef.current = true;
    sendAssistantControl('mute-assistant', reason);
    assistantUnmuteTimerRef.current = window.setTimeout(() => {
      assistantUnmuteTimerRef.current = null;
      unmuteAssistant(`${reason}-cooldown`);
    }, holdMs);
  }

  function unmuteAssistant(reason: string) {
    clearAssistantUnmuteTimer();
    if (!assistantMutedRef.current) return;
    assistantMutedRef.current = false;
    sendAssistantControl('unmute-assistant', reason);
  }

  function sendAssistantControl(control: 'mute-assistant' | 'unmute-assistant', reason: string) {
    traceFlow('browser-to-vapi', 'assistant-control', {
      control,
      reason,
      hasVapi: Boolean(vapiRef.current),
    });
    vapiRef.current?.send?.({ type: 'control', control });
  }

  return {
    status,
    canUseVapi,
    lastTeacherLine,
    transcript,
    start,
    stop: stopSession,
    announceChord,
    announceListening,
    announceAttempt,
    holdAssistantTranscripts,
    interruptTeacher,
    setUserInputMuted,
  };
}

function normalizedSpeechText(text: string) {
  return text
    .toLowerCase()
    .replace(/\b1\b/g, 'one')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expectedChordPhrase(line: string) {
  const normalizedLine = normalizedSpeechText(line);
  if (normalizedLine.includes('a minor')) return 'a minor';
  if (normalizedLine.includes('c major')) return 'c major';
  if (normalizedLine.includes('f major')) return 'f major';
  if (normalizedLine.includes('g seven')) return 'g seven';
  if (normalizedLine.includes('g7')) return 'g seven';
  if (normalizedLine.includes('g major')) return 'g major';
  return null;
}

function matchesExpectedBrowserSpeech(transcript: string, speechWindow: BrowserSpeechWindow) {
  const expected = normalizedSpeechText(speechWindow.expectedLine);
  const actual = normalizedSpeechText(transcript);
  if (!actual) return false;
  if (expected.startsWith(actual)) return true;
  if (expected.includes(actual)) return true;
  if (actual.startsWith(expected)) return true;

  if (hasConflictingChordPhrase(actual, speechWindow.expectedChordPhrase)) {
    return false;
  }

  const expectedTokens = expected.split(' ');
  const actualTokens = new Set(actual.split(' '));
  const sharedTokens = expectedTokens.filter((token) => actualTokens.has(token));
  const hasOpeningToken = expectedTokens[0] !== undefined && actualTokens.has(expectedTokens[0]);
  const hasChordPhrase = !speechWindow.expectedChordPhrase || actual.includes(speechWindow.expectedChordPhrase);

  if (actual.length <= 8) {
    return hasOpeningToken;
  }

  return hasOpeningToken && hasChordPhrase && sharedTokens.length >= 3;
}

function transcriptCompletesExpectedLine(transcript: string, expectedLine: string) {
  const expected = normalizedSpeechText(expectedLine);
  const actual = normalizedSpeechText(transcript);
  if (!actual) return false;
  if (actual === expected || actual.startsWith(expected)) return true;
  if (!expected.endsWith(actual)) return false;

  const actualTokens = actual.split(' ');
  return actualTokens.length >= 3 || actual.length >= 14;
}

function hasConflictingChordPhrase(actual: string, expectedPhrase: string | null) {
  const phrases = ['a minor', 'c major', 'f major', 'g major', 'g seven'];
  return phrases.some((phrase) => phrase !== expectedPhrase && actual.includes(phrase));
}

function coachingLine(chord: ChordName, attempt: AttemptResult) {
  const chordName = spokenChordPhrase(chord);

  if (attempt.verdict === 'correct') {
    const nextChordName = spokenChordPhrase(nextPracticeChord(chord));
    return spokenVariant(`correct-${chord}`, [
      `Nice, that sounded like ${chordName}. Want to try ${nextChordName}?`,
      `Great, I heard ${chordName}. Want to try ${nextChordName}?`,
      `Yep, ${chordName} came through. Want to try ${nextChordName}?`,
      `That one counts as ${chordName}. Want to try ${nextChordName}?`,
    ]);
  }

  if (attempt.verdict === 'almost') {
    return spokenVariant(`almost-${chord}`, [
      `${attempt.message} Give it one more slow strum.`,
      `${attempt.message} Try one more slow, even strum.`,
      `${attempt.message} Reset your fingers and give it another gentle strum.`,
    ]);
  }

  if (attempt.verdict === 'missed') {
    return spokenVariant(`missed-${chord}`, [
      `${attempt.message} Let's reset your fingers and try once more.`,
      `${attempt.message} Take a second to reset, then try one clean strum.`,
      `${attempt.message} No problem. Set the shape again and give it one slow strum.`,
    ]);
  }

  return spokenVariant(`listening-${chord}`, [
    `I'm listening for ${chordName}. Strum once and let it ring.`,
    `Ready for ${chordName}. Give it one full strum.`,
    `Whenever you're ready, strum ${chordName} once and let it ring.`,
  ]);
}

function attemptResponseInstruction(chord: ChordName, attempt: AttemptResult, line: string) {
  const chordName = spokenChordPhrase(chord);

  if (attempt.verdict === 'correct') {
    return `The learner played ${chordName} correctly. The browser app is speaking this exact feedback through Vapi: "${line}" Do not respond to this event unless the learner asks a separate question.`;
  }

  if (attempt.verdict === 'almost' || attempt.verdict === 'missed') {
    return `The learner did not play ${chordName} cleanly yet. The browser app is speaking the retry feedback through Vapi and will listen again. Do not respond to this event unless the learner asks a separate question.`;
  }

  return `The browser is still listening for ${chordName}. Do not respond to this event unless the learner asks a separate question.`;
}

function strumInstructionLine(chord: ChordName) {
  const chordName = chord === 'Am' ? 'A minor' : chordSpokenNames[chord];
  return spokenVariant(`strum-${chord}`, [
    `Strum ${chordName} once.`,
    `Give ${chordName} one clean strum.`,
    `Try one clean ${chordName} strum.`,
  ]);
}

function spokenChordPhrase(chord: ChordName) {
  return chord === 'Am' ? 'the A minor chord' : chordSpokenNames[chord];
}

function nextPracticeChord(chord: ChordName): ChordName {
  return chordCatalog[chord].next;
}

function spokenVariant(key: string, variants: string[]) {
  if (variants.length <= 1) return variants[0] ?? '';

  const previousIndex = lastSpokenVariantIndexByKey.get(key) ?? -1;
  let index = Math.floor(Math.random() * variants.length);
  if (index === previousIndex) {
    index = (index + 1) % variants.length;
  }

  lastSpokenVariantIndexByKey.set(key, index);
  return variants[index];
}

function feedbackDeliveryDelayMs(line: string) {
  const estimatedSpeechMs = Math.max(1800, line.length * 55);
  return Math.min(5200, estimatedSpeechMs);
}

function browserSpeechGuardMs(line: string) {
  return Math.min(8500, feedbackDeliveryDelayMs(line) + 2600);
}

function repeatedSpeechCooldownMs(line: string) {
  return Math.min(8000, Math.max(4200, feedbackDeliveryDelayMs(line) + 2800));
}
