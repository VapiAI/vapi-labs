import assert from 'node:assert/strict';
import test from 'node:test';
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
} from './vapiMessages';
import { vapiClientMessages } from '../vapiConfig';

test('classifies transcript and speech lifecycle messages', () => {
  assert.equal(isTranscriptMessage({ transcript: 'hello', role: 'user' }), true);
  assert.equal(isTranscriptMessage({ transcript: 42 }), false);
  assert.equal(transcriptRole({ role: 'user' }), 'user');
  assert.equal(transcriptRole({ type: 'assistant-transcript' }), 'assistant');
  assert.equal(isSpeechUpdateMessage({ type: 'speech-update', role: 'assistant', status: 'started' }), true);
  assert.equal(isSpeechUpdateMessage({ type: 'speech-update', role: 'system', status: 'started' }), false);
  assert.equal(isUserInterruptedMessage({ type: 'user-interrupted', turnId: 'turn-1' }), true);
  assert.equal(vapiClientMessages.includes('speech-update'), true);
  assert.equal((vapiClientMessages as readonly string[]).includes('assistant.speechStarted'), false);
});

test('classifies supported Vapi tool message envelopes', () => {
  assert.equal(isToolCallsMessage({ type: 'tool-calls', toolCallList: [] }), true);
  assert.equal(isToolCallsMessage({ type: 'tool-calls', toolCallList: null }), false);
  assert.equal(isToolCompletedMessage({ type: 'tool.completed', messages: [] }), true);
  assert.equal(isToolCompletedMessage({ type: 'tool.completed' }), false);
  assert.equal(isToolCallsResultMessage({ type: 'tool-calls-result', toolCallResult: {} }), true);
  assert.equal(isToolCallsResultMessage({ type: 'tool-calls-result', toolCallResult: null }), false);
});

test('recognizes exact and namespaced chord tool names', () => {
  assert.equal(isChordToolName('show_ukulele_chord'), true);
  assert.equal(isChordToolName('mcp-abc-show_ukulele_chord'), true);
  assert.equal(isChordToolName('show_guitar_chord'), false);
  assert.equal(isChordToolName(undefined), false);
});

test('parses object and JSON-string tool arguments safely', () => {
  assert.deepEqual(parseToolArguments({ chord: 'C' }), { chord: 'C' });
  assert.deepEqual(parseToolArguments('{"chord":"Am"}'), { chord: 'Am' });
  assert.deepEqual(parseToolArguments('{bad json'), {});
  assert.deepEqual(parseToolArguments('"not an object"'), {});
  assert.deepEqual(parseToolArguments(null), {});
});

test('extracts chords from direct and JSON-string tool result payloads', () => {
  const direct = [{ type: 'text', text: 'Practice C. The visual card is ready.' }];
  const encoded = JSON.stringify([{ type: 'text', text: 'Practice G seven. The visual card is ready.' }]);
  assert.equal(extractChordFromToolResult({ result: direct }), 'C');
  assert.equal(extractChordFromToolResult({ result: encoded }), 'G7');
});

test('returns null for malformed or unsupported tool results', () => {
  assert.equal(extractChordFromToolResult({ result: 'not json' }), null);
  assert.equal(extractChordFromToolResult({ result: [{ text: 'Practice D.' }] }), null);
  assert.equal(extractChordFromToolResult({ result: [{ value: 'Practice C.' }] }), null);
  assert.equal(extractChordFromToolResult({}), null);
});

test('summarizes messages without retaining unbounded trace text', () => {
  const longText = 'x'.repeat(220);
  const summary = summarizeVapiMessage({
    type: 'transcript',
    role: 'user',
    transcriptType: 'final',
    transcript: longText,
    status: 'complete',
  });

  assert.equal(summary.type, 'transcript');
  assert.equal(summary.role, 'user');
  assert.equal(summary.status, 'complete');
  assert.equal(summary.transcript, clipTraceText(longText));
  assert.equal(String(summary.transcript).length, 180);
});
