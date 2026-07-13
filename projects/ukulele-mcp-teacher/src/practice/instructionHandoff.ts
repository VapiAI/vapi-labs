const minimumInstructionCompletionDelayMs = 2400;

export function isChordInstructionCompletion(reason?: string) {
  return reason === 'chord-instruction';
}

export function instructionCompletionDelay(expectedSpeechMs: number) {
  return Math.max(minimumInstructionCompletionDelayMs, expectedSpeechMs);
}
