import assert from 'node:assert/strict';
import test from 'node:test';
import { createActor } from 'xstate';
import {
  initialPracticeContext,
  practiceMachine,
} from '../practiceMachine';

test('feedback returns to showing when feedback completes', () => {
  const exerciseId = 7;
  const listening = practiceMachine.resolveState({
    value: 'listening',
    context: {
      ...initialPracticeContext,
      exerciseId,
    },
  });
  const actor = createActor(practiceMachine, { snapshot: listening }).start();

  actor.send({
    type: 'ATTEMPT_RESULT',
    exerciseId,
    attempt: {
      verdict: 'correct',
      confidence: 0.94,
      detectedNotes: ['C', 'E', 'G'],
      message: 'Clean C major strum.',
    },
  });

  assert.equal(actor.getSnapshot().value, 'feedback');

  actor.send({ type: 'FEEDBACK_COMPLETE', exerciseId });

  assert.equal(actor.getSnapshot().value, 'showing');
  actor.stop();
});

test('instruction must complete before the machine can listen for a strum', () => {
  const exerciseId = 11;
  const showing = practiceMachine.resolveState({
    value: 'showing',
    context: {
      ...initialPracticeContext,
      exerciseId,
    },
  });
  const actor = createActor(practiceMachine, { snapshot: showing }).start();

  actor.send({ type: 'START_INSTRUCTION', exerciseId });
  assert.equal(actor.getSnapshot().value, 'instructing');

  actor.send({ type: 'START_LISTENING', exerciseId });
  assert.equal(actor.getSnapshot().value, 'instructing');

  actor.send({ type: 'INSTRUCTION_COMPLETE', exerciseId });
  assert.equal(actor.getSnapshot().value, 'showing');

  actor.send({ type: 'START_LISTENING', exerciseId });
  assert.equal(actor.getSnapshot().value, 'listening');
  actor.stop();
});
