import { normalizeChordName, type ChordName } from '../chords';
import { chordToolName } from '../mcpContract';

export type TranscriptMessage = {
  transcript: string;
  transcriptType?: 'partial' | 'final';
  role?: unknown;
  type?: unknown;
};

export type SpeechUpdateMessage = {
  type: 'speech-update';
  role: 'assistant' | 'user';
  status: 'started' | 'stopped';
};

export type ToolCallsMessage = {
  type: 'tool-calls';
  toolCallList: Array<{
    function?: {
      name?: string;
      arguments?: unknown;
    };
  }>;
};

export type ToolCallResult = {
  name?: string;
  result?: unknown;
};

export type ToolCompletedMessage = {
  type: 'tool.completed';
  messages: Array<{ toolCallResult?: ToolCallResult }>;
};

export type ToolCallsResultMessage = {
  type: 'tool-calls-result';
  toolCallResult: ToolCallResult;
};

export function isTranscriptMessage(message: unknown): message is TranscriptMessage {
  return isRecord(message) && typeof message.transcript === 'string';
}

export function transcriptRole(message: Pick<TranscriptMessage, 'role' | 'type'>): 'assistant' | 'user' {
  const role = String(message.role ?? '').toLowerCase();
  if (role === 'user') return 'user';
  if (role === 'assistant') return 'assistant';

  const type = String(message.type ?? '').toLowerCase();
  if (type.includes('user')) return 'user';
  return 'assistant';
}

export function isSpeechUpdateMessage(message: unknown): message is SpeechUpdateMessage {
  return (
    isRecord(message) &&
    message.type === 'speech-update' &&
    (message.role === 'assistant' || message.role === 'user') &&
    (message.status === 'started' || message.status === 'stopped')
  );
}

export function isUserInterruptedMessage(
  message: unknown,
): message is { type: 'user-interrupted'; turnId?: string } {
  return isRecord(message) && message.type === 'user-interrupted';
}

export function isToolCallsMessage(message: unknown): message is ToolCallsMessage {
  return isRecord(message) && message.type === 'tool-calls' && Array.isArray(message.toolCallList);
}

export function isToolCompletedMessage(message: unknown): message is ToolCompletedMessage {
  return isRecord(message) && message.type === 'tool.completed' && Array.isArray(message.messages);
}

export function isToolCallsResultMessage(message: unknown): message is ToolCallsResultMessage {
  return isRecord(message) && message.type === 'tool-calls-result' && isRecord(message.toolCallResult);
}

export function isChordToolName(name: unknown): name is string {
  return typeof name === 'string' && (name === chordToolName || name.endsWith(`-${chordToolName}`));
}

export function parseToolArguments(args: unknown): Record<string, unknown> {
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args) as unknown;
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  return isRecord(args) ? args : {};
}

export function extractChordFromToolResult(toolCallResult: ToolCallResult): ChordName | null {
  const result = parseToolResultPayload(toolCallResult.result);
  if (!Array.isArray(result)) return null;

  for (const item of result) {
    if (!isRecord(item)) continue;
    const chord = chordFromPracticeText(item.text);
    if (chord) return chord;
  }

  return null;
}

export function summarizeVapiMessage(message: unknown): Record<string, unknown> {
  if (!isRecord(message)) return { valueType: typeof message };

  const summary: Record<string, unknown> = {
    type: message.type,
    role: message.role,
  };

  if (typeof message.transcript === 'string') {
    summary.transcriptType = message.transcriptType;
    summary.transcript = clipTraceText(message.transcript);
  }

  if (Array.isArray(message.toolCallList)) {
    summary.toolCalls = message.toolCallList.map((toolCall) => {
      const fn = isRecord(toolCall) && isRecord(toolCall.function) ? toolCall.function : undefined;
      return {
        name: fn?.name,
        arguments: typeof fn?.arguments === 'string' ? clipTraceText(fn.arguments) : fn?.arguments,
      };
    });
  }

  if (isRecord(message.toolCallResult)) {
    summary.toolCallResult = {
      name: message.toolCallResult.name,
      result: typeof message.toolCallResult.result === 'string'
        ? clipTraceText(message.toolCallResult.result)
        : message.toolCallResult.result,
    };
  }

  if (Array.isArray(message.messages)) summary.messages = message.messages.length;
  if (typeof message.status === 'string') summary.status = message.status;

  return summary;
}

export function clipTraceText(text: string) {
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function parseToolResultPayload(result: unknown): unknown {
  if (typeof result !== 'string') return result;

  try {
    return JSON.parse(result) as unknown;
  } catch {
    return result;
  }
}

function chordFromPracticeText(text: unknown): ChordName | null {
  if (typeof text !== 'string') return null;
  const match = text.match(/^Practice\s+(.+?)\./i);
  return normalizeChordName(match?.[1]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
