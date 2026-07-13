import assert from 'node:assert/strict';
import test from 'node:test';
import {
  instructionCompletionDelay,
  isChordInstructionCompletion,
} from './instructionHandoff';

test('only the selected chord instruction can complete an instruction handoff', () => {
  assert.equal(isChordInstructionCompletion('chord-instruction'), true);
  assert.equal(isChordInstructionCompletion('feedback'), false);
  assert.equal(isChordInstructionCompletion('end-session'), false);
  assert.equal(isChordInstructionCompletion(undefined), false);
});

test('instruction completion retains a deterministic safety delay', () => {
  assert.equal(instructionCompletionDelay(1800), 2400);
  assert.equal(instructionCompletionDelay(3200), 3200);
});
