export type TranscriptRole = 'assistant' | 'user' | 'tool' | 'browser' | 'system';

export type TranscriptEvent<Role extends TranscriptRole = TranscriptRole> = {
  id: string;
  role: Role;
  label: string;
  text: string;
  at: string;
  isPartial?: boolean;
};

type TranscriptEventOverrides = {
  id?: string;
  at?: string;
};

const defaultTranscriptLimit = 40;

export function createTranscriptEvent<Role extends TranscriptRole>(
  role: Role,
  text: string,
  isPartial = false,
  overrides: TranscriptEventOverrides = {},
): TranscriptEvent<Role> {
  return {
    id: overrides.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    label: transcriptRoleLabel(role),
    text,
    isPartial,
    at: overrides.at ?? new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date()),
  };
}

export function appendTranscriptEvent(
  events: TranscriptEvent[],
  event: TranscriptEvent,
  limit = defaultTranscriptLimit,
) {
  return [...events, event].slice(-limit);
}

export function reconcileTranscriptTurn(
  events: TranscriptEvent[],
  event: TranscriptEvent<'assistant' | 'user'>,
  limit = defaultTranscriptLimit,
) {
  const lastChatIndex = findLastChatIndex(events);
  const lastChat = lastChatIndex >= 0 ? events[lastChatIndex] : null;

  if (lastChat?.role !== event.role) {
    return appendTranscriptEvent(events, event, limit);
  }

  const mergedText = mergeTranscriptText(lastChat.text, event.text);
  if (normalizedTranscriptText(lastChat.text) === normalizedTranscriptText(mergedText)) {
    return events;
  }

  const mergedEvent = { ...lastChat, text: mergedText };
  return [
    ...events.slice(0, lastChatIndex),
    mergedEvent,
    ...events.slice(lastChatIndex + 1),
  ].slice(-limit);
}

export function mergeTranscriptText(previous: string, next: string) {
  const trimmedPrevious = previous.trim();
  const trimmedNext = next.trim();
  if (!trimmedPrevious) return trimmedNext;
  if (!trimmedNext) return trimmedPrevious;

  const normalizedPrevious = normalizedTranscriptText(trimmedPrevious);
  const normalizedNext = normalizedTranscriptText(trimmedNext);
  if (normalizedPrevious === normalizedNext) return trimmedPrevious;
  if (normalizedPrevious.endsWith(normalizedNext)) return trimmedPrevious;
  if (normalizedNext.startsWith(normalizedPrevious)) return trimmedNext;

  return `${trimmedPrevious} ${trimmedNext}`;
}

function transcriptRoleLabel(role: TranscriptRole) {
  switch (role) {
    case 'assistant':
      return 'Teacher';
    case 'user':
      return 'You';
    case 'tool':
      return 'Tool';
    case 'browser':
      return 'Browser';
    case 'system':
      return 'System';
  }
}

function findLastChatIndex(events: TranscriptEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const role = events[index].role;
    if (role === 'assistant' || role === 'user') return index;
  }

  return -1;
}

function normalizedTranscriptText(text: string) {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}
