import { useEffect, useEffectEvent, useRef } from 'react';
import type { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { chordSpokenNames, isChordName } from './chords';
import { traceFlow } from './flowTrace';
import { chordToolName } from './mcpContract';
import { showUkuleleChord } from './mcpClient';
import {
  instructionCompletionDelay,
  isChordInstructionCompletion,
} from './practice/instructionHandoff';
import {
  type PracticeContext,
  type PracticeEvent,
  type PracticeStateValue,
} from './practiceMachine';
import type { AttemptResult, ChordName, ToolResult } from './types';
import type { useChordDetector } from './useChordDetector';
import type { useVapiTeacher } from './useVapiTeacher';

type PracticeViewState = PracticeContext & { kind: PracticeStateValue };
type ChordDetector = ReturnType<typeof useChordDetector>;
type VapiTeacher = ReturnType<typeof useVapiTeacher>;

type ActiveAttempt = {
  id: number;
  chord: ChordName;
  exerciseId: number;
  listenId: number;
};

type UsePracticeRuntimeOptions = {
  state: PracticeViewState;
  detector: ChordDetector;
  teacher: VapiTeacher;
  sendPractice: (event: PracticeEvent) => void;
};

const practiceTurnCommitDelayMs = 120;
const mcpServerOrigin = import.meta.env.VITE_MCP_SERVER_ORIGIN ?? 'http://localhost:8787';
const mcpSandboxProxyUrl = new URL('/mcp-sandbox-proxy', mcpServerOrigin).toString();

export function usePracticeRuntime({
  state,
  detector,
  teacher,
  sendPractice,
}: UsePracticeRuntimeOptions) {
  const autoListenArmedRef = useRef(false);
  const activeAttemptRef = useRef<ActiveAttempt | null>(null);
  const lastHandledAttemptIdRef = useRef(0);
  const nextAttemptIdRef = useRef(1);
  const nextExerciseIdRef = useRef(1);
  const currentExerciseIdRef = useRef(0);
  const stateRef = useRef(state);
  const detectorListeningRef = useRef(false);
  const appBridgeRef = useRef<AppBridge | null>(null);
  const appBridgeReadyRef = useRef(false);
  const bridgeGenerationRef = useRef(0);
  const uiHtmlRef = useRef<string | null>(null);
  const uiResourceUriRef = useRef<string | null>(null);
  const pendingToolResultRef = useRef<{ result: ToolResult; requestId: number } | null>(null);
  const committedToolResultRef = useRef<{ exerciseId: number; chord: ChordName } | null>(null);
  const practiceTurnCommitTimerRef = useRef<number | null>(null);
  const instructionCompletionTimerRef = useRef<number | null>(null);
  const suppressNextHostToolEventRef = useRef<ChordName | null>(null);
  const retryFeedbackPendingRef = useRef(false);
  const { interruptTeacher } = teacher;

  stateRef.current = state;
  detectorListeningRef.current = detector.isListening;
  uiHtmlRef.current = state.uiHtml;
  uiResourceUriRef.current = state.uiResourceUri;

  const startListeningAfterShowing = useEffectEvent(() => {
    autoListenArmedRef.current = false;
    void listenForChord();
  });

  const commitReadyToolResult = useEffectEvent((result: ToolResult, exerciseId: number) => {
    committedToolResultRef.current = {
      exerciseId,
      chord: result.structuredContent.name,
    };
    commitLoadedToolResult(result, exerciseId);
  });

  const handleAttemptResult = useEffectEvent((attempt: AttemptResult) => {
    const activeAttempt = activeAttemptRef.current;
    if (!activeAttempt || lastHandledAttemptIdRef.current === activeAttempt.id) return;
    if (activeAttempt.listenId !== attempt.listenId) {
      traceFlow('detector', 'attempt-result-ignored-stale', {
        attemptId: activeAttempt.id,
        chord: activeAttempt.chord,
        activeListenId: activeAttempt.listenId,
        resultListenId: attempt.listenId,
        verdict: attempt.verdict,
      });
      return;
    }

    traceFlow('detector', 'attempt-result', {
      attemptId: activeAttempt.id,
      chord: activeAttempt.chord,
      verdict: attempt.verdict,
      confidence: attempt.confidence,
      detectedNotes: attempt.detectedNotes,
    });
    teacher.setUserInputMuted(false, 'practice-feedback-enter');
    lastHandledAttemptIdRef.current = activeAttempt.id;
    activeAttemptRef.current = null;
    sendPractice({
      type: 'ATTEMPT_RESULT',
      exerciseId: activeAttempt.exerciseId,
      attempt,
    });
    if (attempt.verdict === 'almost' || attempt.verdict === 'missed') {
      autoListenArmedRef.current = true;
      retryFeedbackPendingRef.current = true;
    } else {
      retryFeedbackPendingRef.current = false;
    }
    teacher.holdAssistantTranscripts('strum-result');
    teacher.announceAttempt(attempt, activeAttempt.chord);
  });

  const handleHostChordToolEvent = useEffectEvent((event: Event) => {
    const payload = parseHostToolEvent(event);
    traceFlow('host-events', 'chord-tool-received', {
      valid: Boolean(payload),
      chord: payload?.result.structuredContent.name,
    });
    if (!payload) return;
    if (stateRef.current.error) {
      suppressNextHostToolEventRef.current = null;
    }
    if (suppressNextHostToolEventRef.current === payload.result.structuredContent.name) {
      traceFlow('host-events', 'chord-tool-ignored-local-origin', {
        chord: payload.result.structuredContent.name,
      });
      suppressNextHostToolEventRef.current = null;
      return;
    }
    if (shouldIgnoreHostToolEvent(payload.result.structuredContent.name)) {
      traceFlow('host-events', 'chord-tool-ignored-same-state', {
        chord: payload.result.structuredContent.name,
        state: stateRef.current.kind,
      });
      return;
    }

    prepareForNavigation('host-tool-navigation');
    const requestId = nextExerciseId();
    sendPractice({
      type: 'LOAD_TOOL_RESULT',
      result: payload.result,
      exerciseId: requestId,
    });
  });

  useEffect(() => () => {
    clearPracticeTurnCommitTimer();
    clearInstructionCompletionTimer();
    void appBridgeRef.current?.close();
  }, []);

  useEffect(() => {
    if (state.kind !== 'showing' || !autoListenArmedRef.current || detector.isListening) return;
    startListeningAfterShowing();
  }, [detector.isListening, state.kind]);

  useEffect(() => {
    if (state.kind !== 'showing' || !state.toolResult || !state.uiHtml) return;
    const committed = committedToolResultRef.current;
    const chord = state.toolResult.structuredContent.name;
    if (committed?.exerciseId === state.exerciseId && committed.chord === chord) return;

    commitReadyToolResult(state.toolResult, state.exerciseId);
  }, [state.exerciseId, state.kind, state.toolResult, state.uiHtml]);

  useEffect(() => {
    if (detector.result.verdict === 'idle' || detector.result.verdict === 'listening') return;
    handleAttemptResult(detector.result);
  }, [detector.result]);

  useEffect(() => {
    const events = new EventSource('/vapi-tool-events');
    traceFlow('host-events', 'connect');

    events.addEventListener('open', () => {
      traceFlow('host-events', 'open');
    });

    events.addEventListener('error', () => {
      traceFlow('host-events', 'error', { readyState: events.readyState });
    });

    events.addEventListener('ready', () => {
      traceFlow('host-events', 'ready');
    });

    events.addEventListener('chord-tool', handleHostChordToolEvent);

    return () => {
      events.close();
    };
  }, []);

  async function startPractice() {
    traceFlow('app', 'start-practice', { canUseVapi: teacher.canUseVapi, status: teacher.status });
    await teacher.start();
  }

  function selectChord(chord: ChordName, options: { force?: boolean } = {}) {
    const currentState = stateRef.current;
    if (
      !options.force &&
      currentState.chord === chord &&
      (currentState.kind === 'loading-ui' ||
        currentState.kind === 'loading-resource' ||
        ((currentState.kind === 'showing' ||
          currentState.kind === 'instructing' ||
          currentState.kind === 'listening' ||
          currentState.kind === 'feedback') &&
          Boolean(currentState.toolResult)))
    ) {
      traceFlow('host', 'select-chord-ignored-same-state', { chord, state: currentState.kind });
      return;
    }

    traceFlow('host', 'select-chord', { chord, previousChord: currentState.chord, state: currentState.kind });
    const requestId = nextExerciseId();
    retryFeedbackPendingRef.current = false;
    sendPractice({ type: 'REQUEST_CHORD', chord, exerciseId: requestId });
    suppressNextHostToolEventRef.current = chord;
  }

  function handleUserSpeechStarted() {
    const currentState = stateRef.current;
    traceFlow('voice-nav', 'user-barge-in', {
      state: currentState.kind,
      exerciseId: currentState.exerciseId,
    });
    autoListenArmedRef.current = false;
    retryFeedbackPendingRef.current = false;

    if (currentState.kind === 'instructing') {
      clearInstructionCompletionTimer();
      sendPractice({
        type: 'INSTRUCTION_COMPLETE',
        exerciseId: currentState.exerciseId,
      });
      return;
    }

    if (currentState.kind === 'feedback') {
      sendPractice({
        type: 'FEEDBACK_COMPLETE',
        exerciseId: currentState.exerciseId,
      });
      return;
    }

    if (currentState.kind === 'listening') {
      pauseInstrumentMicForQuestion();
    }
  }

  function handleChordToolCall(chord: ChordName) {
    prepareForNavigation('vapi-chord-tool');
    selectChord(chord);
  }

  async function listenForChord(toolResult = stateRef.current.toolResult) {
    if (!toolResult) {
      traceFlow('detector', 'listen-missing-tool-result', { chord: stateRef.current.chord });
      selectChord(stateRef.current.chord);
      return;
    }
    const chord = toolResult.structuredContent.name;
    if (detectorListeningRef.current && activeAttemptRef.current?.chord === chord) {
      traceFlow('detector', 'listen-skipped-already-listening', { chord });
      return;
    }
    if (detectorListeningRef.current) {
      traceFlow('detector', 'listen-stop-previous', {
        previousChord: activeAttemptRef.current?.chord,
        nextChord: chord,
      });
      detector.stop();
      activeAttemptRef.current = null;
      detectorListeningRef.current = false;
    }

    traceFlow('detector', 'listen-start', { chord });
    detector.resetResult(`Listening for ${chordSpokenNames[chord]}. Strum whenever you're ready.`);
    const attemptId = nextAttemptIdRef.current;
    const exerciseId = stateRef.current.exerciseId;
    nextAttemptIdRef.current += 1;
    sendPractice({ type: 'START_LISTENING', exerciseId });
    teacher.announceListening(chord);
    try {
      const listenId = await detector.start(chord);
      const currentState = stateRef.current;
      if (currentState.exerciseId !== exerciseId || currentState.toolResult?.structuredContent.name !== chord) {
        traceFlow('detector', 'listen-started-stale', {
          chord,
          attemptId,
          listenId,
          exerciseId,
          currentExerciseId: currentState.exerciseId,
          currentChord: currentState.toolResult?.structuredContent.name,
        });
        detector.stop();
        detectorListeningRef.current = false;
        return;
      }

      activeAttemptRef.current = { id: attemptId, chord, exerciseId, listenId };
      detectorListeningRef.current = true;
      traceFlow('detector', 'listen-started', { chord, attemptId, listenId, exerciseId });
    } catch (error) {
      traceFlow('detector', 'listen-start-failed', {
        chord,
        attemptId,
        error: error instanceof Error ? error.message : String(error),
      });
      activeAttemptRef.current = null;
      detectorListeningRef.current = false;
      teacher.setUserInputMuted(false, 'practice-listening-error');
      detector.resetResult('Browser mic permission is needed before I can listen for your strum.');
      sendPractice({
        type: 'MIC_ERROR',
        exerciseId,
        error: error instanceof Error ? error.message : 'Browser mic failed to start.',
      });
    }
  }

  async function listenAfterTeacher(reason?: string) {
    traceFlow('detector', 'listen-after-teacher-check', {
      armed: autoListenArmedRef.current,
      retryFeedbackPending: retryFeedbackPendingRef.current,
      isListening: detector.isListening,
      teacherStatus: teacher.status,
    });
    if (stateRef.current.kind === 'instructing') {
      if (!isChordInstructionCompletion(reason)) {
        traceFlow('detector', 'ignored-unrelated-speech-stop-during-instruction', { reason });
        return;
      }
      clearInstructionCompletionTimer();
      traceFlow('host', 'instruction-complete', { exerciseId: stateRef.current.exerciseId });
      sendPractice({
        type: 'INSTRUCTION_COMPLETE',
        exerciseId: stateRef.current.exerciseId,
      });
      return;
    }
    if (stateRef.current.kind === 'feedback' && !retryFeedbackPendingRef.current) {
      traceFlow('host', 'feedback-complete', { exerciseId: stateRef.current.exerciseId });
      sendPractice({
        type: 'FEEDBACK_COMPLETE',
        exerciseId: stateRef.current.exerciseId,
      });
      return;
    }
    if (retryFeedbackPendingRef.current) return;
    if (!autoListenArmedRef.current || detector.isListening || teacher.status !== 'connected') return;
    autoListenArmedRef.current = false;
    await listenForChord();
  }

  async function listenAfterRetryFeedback(attempt: AttemptResult, chord: ChordName) {
    traceFlow('detector', 'listen-after-feedback-check', {
      chord,
      verdict: attempt.verdict,
      currentChord: stateRef.current.chord,
      hasToolResult: Boolean(stateRef.current.toolResult),
      isListening: detector.isListening,
    });
    if (attempt.verdict !== 'almost' && attempt.verdict !== 'missed') return;
    const currentState = stateRef.current;
    if (currentState.chord !== chord || !currentState.toolResult || detector.isListening) return;
    retryFeedbackPendingRef.current = false;
    autoListenArmedRef.current = false;
    await listenForChord();
  }

  function pauseInstrumentMicForQuestion() {
    if (!detectorListeningRef.current && !activeAttemptRef.current && !detector.isListening) return;
    traceFlow('detector', 'pause-for-user-speech');
    teacher.setUserInputMuted(false, 'practice-listening-paused');
    detector.stop();
    detectorListeningRef.current = false;
    activeAttemptRef.current = null;
    autoListenArmedRef.current = Boolean(stateRef.current.toolResult);
  }

  function endLocalSession() {
    traceFlow('app', 'end-local-session');
    clearPracticeTurnCommitTimer();
    clearInstructionCompletionTimer();
    bridgeGenerationRef.current += 1;
    const appBridge = appBridgeRef.current;
    appBridgeRef.current = null;
    appBridgeReadyRef.current = false;
    pendingToolResultRef.current = null;
    void appBridge?.close();
    autoListenArmedRef.current = false;
    retryFeedbackPendingRef.current = false;
    activeAttemptRef.current = null;
    teacher.setUserInputMuted(false, 'practice-session-ended');
    detector.stop();
    detector.resetResult();
    detectorListeningRef.current = false;
    sendPractice({ type: 'END_SESSION' });
  }

  function commitLoadedToolResult(result: ToolResult, requestId: number) {
    if (isStaleUiRequest(requestId)) {
      traceFlow('mcp-app', 'commit-tool-result-skipped-stale', {
        chord: result.structuredContent.name,
        requestId,
      });
      return;
    }

    traceFlow('mcp-app', 'commit-tool-result', {
      chord: result.structuredContent.name,
      requestId,
      resourceUri: stateRef.current.uiResourceUri,
      bridgeReady: appBridgeReadyRef.current,
    });
    teacher.holdAssistantTranscripts('tool-result-navigation');
    clearInstructionCompletionTimer();
    resetDetectorForToolResult(result);
    autoListenArmedRef.current = false;
    retryFeedbackPendingRef.current = false;
    pendingToolResultRef.current = { result, requestId };

    if (appBridgeReadyRef.current) {
      void sendPendingToolDataToApp();
      return;
    }

    traceFlow('mcp-app', 'send-tool-data-pending-bridge', {
      chord: result.structuredContent.name,
      requestId,
      bridgeReady: appBridgeReadyRef.current,
    });
  }

  function resetDetectorForToolResult(result: ToolResult) {
    clearPracticeTurnCommitTimer();
    if (detectorListeningRef.current || activeAttemptRef.current) {
      traceFlow('detector', 'reset-for-tool-result', {
        previousChord: activeAttemptRef.current?.chord,
        nextChord: result.structuredContent.name,
        wasListening: detectorListeningRef.current,
      });
      detector.stop();
      teacher.setUserInputMuted(false, 'practice-tool-result-reset');
      detectorListeningRef.current = false;
      activeAttemptRef.current = null;
    }

    detector.resetResult(
      `Ready for ${chordSpokenNames[result.structuredContent.name]}. You can strum as soon as the chord appears.`,
    );
  }

  function schedulePracticeTurnCommit(result: ToolResult, requestId: number) {
    clearPracticeTurnCommitTimer();
    traceFlow('host', 'practice-turn-commit-scheduled', {
      chord: result.structuredContent.name,
      requestId,
      delayMs: practiceTurnCommitDelayMs,
    });

    practiceTurnCommitTimerRef.current = window.setTimeout(() => {
      practiceTurnCommitTimerRef.current = null;
      if (isStaleUiRequest(requestId)) {
        traceFlow('host', 'practice-turn-commit-skipped-stale', {
          chord: result.structuredContent.name,
          requestId,
          currentExerciseId: currentExerciseIdRef.current,
        });
        return;
      }

      traceFlow('host', 'practice-turn-instruction', { chord: result.structuredContent.name, requestId });
      autoListenArmedRef.current = true;
      sendPractice({ type: 'START_INSTRUCTION', exerciseId: requestId });
      const expectedSpeechMs = teacher.announceChord(result.structuredContent.name);
      scheduleInstructionCompletion(requestId, expectedSpeechMs);
    }, practiceTurnCommitDelayMs);
  }

  function clearPracticeTurnCommitTimer() {
    if (practiceTurnCommitTimerRef.current === null) return;
    window.clearTimeout(practiceTurnCommitTimerRef.current);
    practiceTurnCommitTimerRef.current = null;
  }

  function scheduleInstructionCompletion(exerciseId: number, expectedSpeechMs: number) {
    clearInstructionCompletionTimer();
    const delayMs = instructionCompletionDelay(expectedSpeechMs);
    instructionCompletionTimerRef.current = window.setTimeout(() => {
      instructionCompletionTimerRef.current = null;
      const currentState = stateRef.current;
      if (currentState.exerciseId !== exerciseId || currentState.kind !== 'instructing') return;

      traceFlow('host', 'instruction-complete-fallback', { exerciseId, delayMs });
      sendPractice({ type: 'INSTRUCTION_COMPLETE', exerciseId });
    }, delayMs);
  }

  function clearInstructionCompletionTimer() {
    if (instructionCompletionTimerRef.current === null) return;
    window.clearTimeout(instructionCompletionTimerRef.current);
    instructionCompletionTimerRef.current = null;
  }

  function prepareForNavigation(reason: string) {
    clearPracticeTurnCommitTimer();
    clearInstructionCompletionTimer();
    autoListenArmedRef.current = false;
    retryFeedbackPendingRef.current = false;
    interruptTeacher(reason, 5000);
    if (!detectorListeningRef.current && !activeAttemptRef.current && !detector.isListening) return;

    detector.stop();
    detectorListeningRef.current = false;
    activeAttemptRef.current = null;
    teacher.setUserInputMuted(false, `${reason}-navigation`);
  }

  function nextExerciseId() {
    const exerciseId = nextExerciseIdRef.current;
    nextExerciseIdRef.current += 1;
    currentExerciseIdRef.current = exerciseId;
    return exerciseId;
  }

  function isStaleUiRequest(requestId: number) {
    return requestId !== currentExerciseIdRef.current;
  }

  function shouldIgnoreHostToolEvent(chord: ChordName) {
    const currentState = stateRef.current;
    return (
      currentState.chord === chord &&
      (currentState.kind === 'loading-ui' ||
        ((currentState.kind === 'showing' ||
          currentState.kind === 'instructing' ||
          currentState.kind === 'listening' ||
          currentState.kind === 'feedback') &&
          Boolean(currentState.toolResult)))
    );
  }

  async function connectMcpAppFrame(frame: HTMLIFrameElement) {
    bridgeGenerationRef.current += 1;
    const bridgeGeneration = bridgeGenerationRef.current;
    const currentToolResult = stateRef.current.toolResult;

    traceFlow('mcp-app', 'bridge-connect-start', {
      chord: currentToolResult?.structuredContent.name,
      bridgeGeneration,
    });
    await appBridgeRef.current?.close();
    appBridgeReadyRef.current = false;

    const frameWindow = frame.contentWindow;
    if (!frameWindow) return;

    const { AppBridge, PostMessageTransport } = await import(
      '@modelcontextprotocol/ext-apps/app-bridge'
    );
    if (bridgeGeneration !== bridgeGenerationRef.current || frame.contentWindow !== frameWindow) return;

    const bridge = new AppBridge(
      null,
      { name: 'ukulele-browser-mcp-apps-host', version: '0.1.0' },
      {
        serverTools: {},
        logging: {},
        sandbox: {},
      },
      {
        hostContext: {
          displayMode: 'inline',
          platform: 'web',
          toolInfo: {
            tool: {
              name: chordToolName,
              description: 'Show an MCP Apps chord card for the requested ukulele chord.',
              inputSchema: {
                type: 'object',
                properties: {
                  chord: { type: 'string', enum: ['C', 'Am', 'F', 'G', 'G7'] },
                },
                required: ['chord'],
              },
            },
          },
        },
      },
    );

    bridge.oncalltool = async (params) => {
      traceFlow('mcp-app', 'app-tool-call', {
        name: params.name,
        arguments: params.arguments,
      });

      if (params.name !== chordToolName) {
        throw new Error(`Unsupported app tool call: ${params.name}`);
      }

      const chord = appChordFromArguments(params.arguments);
      if (!chord) {
        throw new Error('The chord-card tool requires one of: C, Am, F, G, or G7.');
      }
      prepareForNavigation('mcp-app-navigation');
      const requestId = nextExerciseId();
      suppressNextHostToolEventRef.current = chord;

      const result = await showUkuleleChord(chord);
      sendPractice({ type: 'LOAD_TOOL_RESULT', result, exerciseId: requestId });
      return result;
    };

    bridge.oninitialized = () => {
      if (bridgeGeneration !== bridgeGenerationRef.current) {
        traceFlow('mcp-app', 'bridge-initialized-stale', {
          chord: currentToolResult?.structuredContent.name,
          bridgeGeneration,
          currentBridgeGeneration: bridgeGenerationRef.current,
        });
        return;
      }
      appBridgeReadyRef.current = true;
      traceFlow('mcp-app', 'bridge-initialized', {
        chord: stateRef.current.toolResult?.structuredContent.name,
        bridgeGeneration,
      });
      void sendPendingToolDataToApp();
    };
    bridge.onsandboxready = () => {
      if (bridgeGeneration !== bridgeGenerationRef.current) return;
      const html = uiHtmlRef.current;
      if (!html) {
        traceFlow('mcp-app', 'sandbox-ready-without-html', { bridgeGeneration });
        return;
      }

      traceFlow('mcp-app', 'sandbox-resource-ready-send', {
        resourceUri: uiResourceUriRef.current,
        bridgeGeneration,
      });
      void bridge.sendSandboxResourceReady({
        html,
        sandbox: 'allow-scripts',
      });
    };
    bridge.onsizechange = ({ height }) => {
      if (bridgeGeneration !== bridgeGenerationRef.current) return;
      traceFlow('mcp-app', 'bridge-size-change', { height });
      if (height) frame.style.minHeight = `${Math.max(260, height)}px`;
    };

    appBridgeRef.current = bridge;
    void bridge.connect(new PostMessageTransport(frameWindow, frameWindow)).then(() => {
      if (bridgeGeneration !== bridgeGenerationRef.current) return;
      traceFlow('mcp-app', 'bridge-connect-finished');
    }).catch((error) => {
      if (bridgeGeneration !== bridgeGenerationRef.current) return;
      traceFlow('mcp-app', 'bridge-connect-error', {
        error: error instanceof Error ? error.message : String(error),
      });
      sendPractice({
        type: 'TOOL_ERROR',
        exerciseId: stateRef.current.exerciseId,
        error: error instanceof Error ? error.message : 'MCP App bridge failed to initialize.',
      });
    });
  }

  async function sendPendingToolDataToApp() {
    const pending = pendingToolResultRef.current;
    if (!pending) {
      traceFlow('mcp-app', 'send-tool-data-skipped-no-pending-result');
      return false;
    }

    if (isStaleUiRequest(pending.requestId)) {
      traceFlow('mcp-app', 'send-tool-data-skipped-stale', {
        chord: pending.result.structuredContent.name,
        requestId: pending.requestId,
      });
      return false;
    }

    await sendToolDataToApp(pending.result);
    if (pendingToolResultRef.current?.requestId === pending.requestId) {
      pendingToolResultRef.current = null;
    }
    schedulePracticeTurnCommit(pending.result, pending.requestId);
    return true;
  }

  async function sendToolDataToApp(toolResult: ToolResult) {
    const bridge = appBridgeRef.current;
    if (!bridge) {
      traceFlow('mcp-app', 'send-tool-data-skipped-no-bridge', { chord: toolResult.structuredContent.name });
      return;
    }

    traceFlow('mcp-app', 'send-tool-input', { chord: toolResult.structuredContent.name });
    await bridge.sendToolInput({
      arguments: { chord: toolResult.structuredContent.name },
    });
    traceFlow('mcp-app', 'send-tool-result', { chord: toolResult.structuredContent.name });
    await bridge.sendToolResult(toolResult);
    traceFlow('mcp-app', 'send-tool-data-done', { chord: toolResult.structuredContent.name });
  }

  return {
    uiHtml: state.uiHtml,
    uiFrameUrl: state.uiHtml ? mcpSandboxProxyUrl : null,
    uiFrameResourceUri: state.uiResourceUri,
    startPractice,
    connectMcpAppFrame,
    listenAfterTeacher,
    listenAfterRetryFeedback,
    handleUserSpeechStarted,
    handleChordToolCall,
    endLocalSession,
  };
}

export type PracticeRuntime = ReturnType<typeof usePracticeRuntime>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseHostToolEvent(event: Event): { result: ToolResult } | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== 'string') return null;

  try {
    const payload = JSON.parse(event.data) as { type?: unknown; result?: unknown };
    if (payload.type !== chordToolName) return null;
    return isToolResult(payload.result) ? { result: payload.result } : null;
  } catch {
    return null;
  }
}

function isToolResult(value: unknown): value is ToolResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Partial<ToolResult>;
  return (
    Array.isArray(result.content) &&
    typeof result.structuredContent === 'object' &&
    result.structuredContent !== null &&
    isChordName((result.structuredContent as { name?: unknown }).name) &&
    typeof result._meta === 'object' &&
    result._meta !== null &&
    typeof (result._meta as { ui?: { resourceUri?: unknown } }).ui?.resourceUri === 'string'
  );
}

function appChordFromArguments(argumentsValue: unknown): ChordName | null {
  const chord = isRecord(argumentsValue) ? argumentsValue.chord : undefined;
  if (isChordName(chord)) return chord;
  return null;
}
