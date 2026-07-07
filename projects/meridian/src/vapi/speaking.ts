/**
 * Shared barge-in (stop-speaking) config for every Meridian member.
 *
 * Centralized on purpose:
 *  - The squad's `membersOverrides.stopSpeakingPlan` OVERRIDES each member's own
 *    stopSpeakingPlan at call time, so the override and the per-assistant value
 *    must stay identical or behavior silently diverges between squad and standalone.
 *  - This has been re-tuned several times for PSTN false-interrupts; one source
 *    of truth stops it drifting.
 *
 * Strategy for the recurring "assistant starts a long read, stops, then repeats"
 * bug (false barge-in from line echo or a quiet backchannel during a long read):
 *  - HIGH `numWords` so a short echo/backchannel can't reach the interrupt
 *    threshold mid-read;
 *  - `interruptionPhrases` so a caller who genuinely wants to cut in still can,
 *    instantly, by saying "wait" / "stop" / "actually" — we don't trade away
 *    real interruptibility for the higher threshold;
 *  - `acknowledgementPhrases` so common "okay / mm-hmm / yeah" never interrupt;
 *  - `backoffSeconds` slightly longer so any genuine stop resumes cleanly.
 */
import type { Vapi } from "@vapi-ai/server-sdk";

export const STOP_SPEAKING_PLAN: Vapi.StopSpeakingPlan = {
  numWords: 10, // Vapi hard-caps numWords at 10; pair with interruptionPhrases for intentional cut-ins.
  backoffSeconds: 2,
  acknowledgementPhrases: [
    "okay", "ok", "uh huh", "mhm", "mm-hmm", "yeah", "yep", "yes",
    "right", "sure", "got it", "i see", "cool", "alright", "perfect", "thanks", "thank you",
  ],
  interruptionPhrases: [
    "stop", "wait", "hold on", "hang on", "actually", "one second", "one moment",
    "cancel that", "go back", "never mind",
  ],
};
