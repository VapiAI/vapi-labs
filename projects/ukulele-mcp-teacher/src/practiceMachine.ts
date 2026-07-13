import { assign, fromPromise, setup } from 'xstate';
import { readUiResource, resourceMimeType, showUkuleleChord } from './mcpClient';
import type { AttemptResult, ChordName, ToolResult } from './types';

export type PracticeStateValue =
  | 'idle'
  | 'loading-ui'
  | 'loading-resource'
  | 'showing'
  | 'instructing'
  | 'listening'
  | 'feedback';

export type PracticeContext = {
  chord: ChordName;
  toolResult: ToolResult | null;
  stagedToolResult: ToolResult | null;
  uiHtml: string | null;
  uiResourceUri: string | null;
  attempt: AttemptResult | null;
  exerciseId: number;
  error?: string;
};

export type PracticeEvent =
  | { type: 'REQUEST_CHORD'; chord: ChordName; exerciseId: number }
  | { type: 'LOAD_TOOL_RESULT'; result: ToolResult; exerciseId: number }
  | { type: 'TOOL_ERROR'; error: string; exerciseId: number }
  | { type: 'START_INSTRUCTION'; exerciseId: number }
  | { type: 'INSTRUCTION_COMPLETE'; exerciseId: number }
  | { type: 'START_LISTENING'; exerciseId: number }
  | { type: 'ATTEMPT_RESULT'; attempt: AttemptResult; exerciseId: number }
  | { type: 'FEEDBACK_COMPLETE'; exerciseId: number }
  | { type: 'MIC_ERROR'; error: string; exerciseId: number }
  | { type: 'END_SESSION' };

type LoadedChord = {
  result: ToolResult;
  resourceUri: string;
  uiHtml: string;
};

type LoadChordInput = {
  chord: ChordName;
  currentResourceUri: string | null;
  currentUiHtml: string | null;
};

type LoadToolResourceInput = {
  result: ToolResult | null;
  currentResourceUri: string | null;
  currentUiHtml: string | null;
};

export const initialPracticeContext: PracticeContext = {
  chord: 'C',
  toolResult: null,
  stagedToolResult: null,
  uiHtml: null,
  uiResourceUri: null,
  attempt: null,
  exerciseId: 0,
};

export const practiceMachine = setup({
  types: {
    context: {} as PracticeContext,
    events: {} as PracticeEvent,
  },
  actors: {
    loadChord: fromPromise<LoadedChord, LoadChordInput>(async ({ input }) => {
      const result = await showUkuleleChord(input.chord);
      return loadToolResultResource({
        result,
        currentResourceUri: input.currentResourceUri,
        currentUiHtml: input.currentUiHtml,
      });
    }),
    loadToolResource: fromPromise<LoadedChord, LoadToolResourceInput>(async ({ input }) => {
      if (!input.result) {
        throw new Error('Missing MCP tool result.');
      }

      return loadToolResultResource({
        result: input.result,
        currentResourceUri: input.currentResourceUri,
        currentUiHtml: input.currentUiHtml,
      });
    }),
  },
  guards: {
    isCurrentExercise: ({ context, event }) =>
      'exerciseId' in event && event.exerciseId === context.exerciseId,
  },
  actions: {
    requestChord: assign(({ context, event }) => {
      if (event.type !== 'REQUEST_CHORD') return {};
      return {
        chord: event.chord,
        toolResult: context.chord === event.chord ? context.toolResult : null,
        stagedToolResult: null,
        attempt: null,
        exerciseId: event.exerciseId,
        error: undefined,
      };
    }),
    stageToolResult: assign(({ event }) => {
      if (event.type !== 'LOAD_TOOL_RESULT') return {};
      return {
        chord: event.result.structuredContent.name,
        stagedToolResult: event.result,
        toolResult: null,
        attempt: null,
        exerciseId: event.exerciseId,
        error: undefined,
      };
    }),
    acceptLoadedChord: assign(({ event }) => {
      if (!('output' in event)) return {};
      const output = event.output as LoadedChord;
      return {
        chord: output.result.structuredContent.name,
        toolResult: output.result,
        stagedToolResult: null,
        uiHtml: output.uiHtml,
        uiResourceUri: output.resourceUri,
        attempt: null,
        error: undefined,
      };
    }),
    acceptAttempt: assign(({ event }) => {
      if (event.type !== 'ATTEMPT_RESULT') return {};
      return { attempt: event.attempt, error: undefined };
    }),
    setError: assign(({ event }) => {
      if (event.type !== 'TOOL_ERROR' && event.type !== 'MIC_ERROR') return {};
      return { error: event.error };
    }),
    setActorError: assign(({ event }) => {
      if (!('error' in event)) return {};
      const error = (event as { error: unknown }).error;
      return {
        stagedToolResult: null,
        error: error instanceof Error ? error.message : 'Unable to load the chord card.',
      };
    }),
    clearSession: assign(() => ({ ...initialPracticeContext })),
  },
}).createMachine({
  id: 'practice',
  initial: 'idle',
  context: () => ({ ...initialPracticeContext }),
  states: {
    idle: {
      on: {
        REQUEST_CHORD: { target: 'loading-ui', actions: 'requestChord' },
        LOAD_TOOL_RESULT: { target: 'loading-resource', actions: 'stageToolResult' },
        END_SESSION: { actions: 'clearSession' },
      },
    },
    'loading-ui': {
      invoke: {
        src: 'loadChord',
        input: ({ context }) => ({
          chord: context.chord,
          currentResourceUri: context.uiResourceUri,
          currentUiHtml: context.uiHtml,
        }),
        onDone: {
          target: 'showing',
          actions: 'acceptLoadedChord',
        },
        onError: {
          target: 'idle',
          actions: 'setActorError',
        },
      },
      on: {
        REQUEST_CHORD: { target: 'loading-ui', reenter: true, actions: 'requestChord' },
        LOAD_TOOL_RESULT: { target: 'loading-resource', actions: 'stageToolResult' },
        TOOL_ERROR: {
          guard: 'isCurrentExercise',
          target: 'idle',
          actions: 'setError',
        },
        END_SESSION: { target: 'idle', actions: 'clearSession' },
      },
    },
    'loading-resource': {
      invoke: {
        src: 'loadToolResource',
        input: ({ context }) => ({
          result: context.stagedToolResult,
          currentResourceUri: context.uiResourceUri,
          currentUiHtml: context.uiHtml,
        }),
        onDone: {
          target: 'showing',
          actions: 'acceptLoadedChord',
        },
        onError: {
          target: 'idle',
          actions: 'setActorError',
        },
      },
      on: {
        REQUEST_CHORD: { target: 'loading-ui', actions: 'requestChord' },
        LOAD_TOOL_RESULT: { target: 'loading-resource', reenter: true, actions: 'stageToolResult' },
        TOOL_ERROR: {
          guard: 'isCurrentExercise',
          target: 'idle',
          actions: 'setError',
        },
        END_SESSION: { target: 'idle', actions: 'clearSession' },
      },
    },
    showing: {
      on: {
        REQUEST_CHORD: { target: 'loading-ui', actions: 'requestChord' },
        LOAD_TOOL_RESULT: { target: 'loading-resource', actions: 'stageToolResult' },
        START_INSTRUCTION: {
          guard: 'isCurrentExercise',
          target: 'instructing',
        },
        START_LISTENING: {
          guard: 'isCurrentExercise',
          target: 'listening',
        },
        END_SESSION: { target: 'idle', actions: 'clearSession' },
      },
    },
    instructing: {
      on: {
        REQUEST_CHORD: { target: 'loading-ui', actions: 'requestChord' },
        LOAD_TOOL_RESULT: { target: 'loading-resource', actions: 'stageToolResult' },
        INSTRUCTION_COMPLETE: {
          guard: 'isCurrentExercise',
          target: 'showing',
        },
        END_SESSION: { target: 'idle', actions: 'clearSession' },
      },
    },
    listening: {
      on: {
        REQUEST_CHORD: { target: 'loading-ui', actions: 'requestChord' },
        LOAD_TOOL_RESULT: { target: 'loading-resource', actions: 'stageToolResult' },
        ATTEMPT_RESULT: {
          guard: 'isCurrentExercise',
          target: 'feedback',
          actions: 'acceptAttempt',
        },
        MIC_ERROR: {
          guard: 'isCurrentExercise',
          target: 'showing',
          actions: 'setError',
        },
        END_SESSION: { target: 'idle', actions: 'clearSession' },
      },
    },
    feedback: {
      on: {
        REQUEST_CHORD: { target: 'loading-ui', actions: 'requestChord' },
        LOAD_TOOL_RESULT: { target: 'loading-resource', actions: 'stageToolResult' },
        START_LISTENING: {
          guard: 'isCurrentExercise',
          target: 'listening',
        },
        FEEDBACK_COMPLETE: {
          guard: 'isCurrentExercise',
          target: 'showing',
        },
        END_SESSION: { target: 'idle', actions: 'clearSession' },
      },
    },
  },
});

async function loadToolResultResource(input: {
  result: ToolResult;
  currentResourceUri: string | null;
  currentUiHtml: string | null;
}): Promise<LoadedChord> {
  const resourceUri = input.result._meta.ui.resourceUri;

  if (input.currentResourceUri === resourceUri && input.currentUiHtml) {
    return {
      result: input.result,
      resourceUri,
      uiHtml: input.currentUiHtml,
    };
  }

  const resource = await readUiResource(resourceUri);
  const htmlResource = resource.contents.find(
    (content) => content.uri === resourceUri && content.mimeType === resourceMimeType,
  );

  if (!htmlResource) {
    throw new Error(`MCP UI resource was not returned for ${resourceUri}.`);
  }

  return {
    result: input.result,
    resourceUri,
    uiHtml: htmlResource.text,
  };
}
