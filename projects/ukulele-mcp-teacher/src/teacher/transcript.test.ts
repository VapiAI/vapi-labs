import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendTranscriptEvent,
  createTranscriptEvent,
  mergeTranscriptText,
  reconcileTranscriptTurn,
  type TranscriptEvent,
} from './transcript';

function event<Role extends TranscriptEvent['role']>(
  role: Role,
  text: string,
  id = `${role}-${text}`,
): TranscriptEvent<Role> {
  return createTranscriptEvent(role, text, false, { id, at: '12:00:00 PM' });
}

test('creates stable transcript event shapes and role labels', () => {
  assert.deepEqual(event('assistant', 'Ready.', 'event-1'), {
    id: 'event-1',
    role: 'assistant',
    label: 'Teacher',
    text: 'Ready.',
    isPartial: false,
    at: '12:00:00 PM',
  });
  assert.equal(event('user', 'Hi').label, 'You');
  assert.equal(event('tool', 'Called').label, 'Tool');
  assert.equal(event('browser', 'Rendered').label, 'Browser');
  assert.equal(event('system', 'Connected').label, 'System');
});

test('bounds appended transcript history', () => {
  const events = [event('system', 'one'), event('system', 'two')];
  const next = appendTranscriptEvent(events, event('system', 'three'), 2);
  assert.deepEqual(next.map(({ text }) => text), ['two', 'three']);
});

test('replaces an incremental transcript with its longer form', () => {
  const original = event('assistant', 'Hello', 'assistant-1');
  const next = event('assistant', 'Hello there', 'assistant-2');
  const reconciled = reconcileTranscriptTurn([original], next);

  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].id, 'assistant-1');
  assert.equal(reconciled[0].text, 'Hello there');
});

test('does not duplicate equivalent or suffix-only transcript updates', () => {
  const events = [event('assistant', 'Hello there')];
  assert.equal(reconcileTranscriptTurn(events, event('assistant', ' hello   there ')), events);
  assert.equal(reconcileTranscriptTurn(events, event('assistant', 'there')), events);
});

test('combines distinct fragments from the same speaker', () => {
  assert.equal(mergeTranscriptText('Try C major.', 'Then strum once.'), 'Try C major. Then strum once.');
});

test('appends a new event when the speaker changes', () => {
  const events = [event('assistant', 'Ready.')];
  const reconciled = reconcileTranscriptTurn(events, event('user', 'Start with C.'));
  assert.deepEqual(reconciled.map(({ role }) => role), ['assistant', 'user']);
});

test('reconciles the latest chat turn without dropping intervening system events', () => {
  const assistant = event('assistant', 'Loading', 'assistant-1');
  const system = event('system', 'Tool started', 'system-1');
  const reconciled = reconcileTranscriptTurn(
    [assistant, system],
    event('assistant', 'Loading the chord', 'assistant-2'),
  );

  assert.deepEqual(reconciled.map(({ id }) => id), ['assistant-1', 'system-1']);
  assert.equal(reconciled[0].text, 'Loading the chord');
});
