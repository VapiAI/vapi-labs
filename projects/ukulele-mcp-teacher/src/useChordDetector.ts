import { useCallback, useEffect, useRef, useState } from 'react';
import { targetPitchClasses } from './chords';
import { traceFlow } from './flowTrace';
import type { AttemptResult, ChordName } from './types';

const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const warmupMs = 350;
const evaluationMsAfterAttack = 2200;
const earlyCorrectEvaluationMsAfterAttack = 950;
const listeningReminderMs = 9000;
const rmsSignalFloor = 0.018;
const rmsFullStrumFloor = 0.032;
const spectralSignalFloor = 24;
const minAudibleFrames = 16;
const minEarlyCorrectAudibleFrames = 10;
const minNoteFrames = 4;
const minNoteStrength = 0.23;
type DetectorPhase = 'idle' | 'arming' | 'listening' | 'signal' | 'evaluating';

const initialResult: AttemptResult = {
  verdict: 'idle',
  confidence: 0,
  detectedNotes: [],
  message: 'Ask for a chord, then listen and strum once.',
  listenId: 0,
};

export function useChordDetector() {
  const [result, setResult] = useState<AttemptResult>(initialResult);
  const [isListening, setIsListening] = useState(false);
  const [signalLevel, setSignalLevel] = useState(0);
  const [hasSignal, setHasSignal] = useState(false);
  const [phase, setPhaseState] = useState<DetectorPhase>('idle');
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const samplesRef = useRef<Map<string, { strength: number; frames: number }>>(new Map());
  const startedAtRef = useRef(0);
  const firstAudibleAtRef = useRef<number | null>(null);
  const reminderAtRef = useRef(0);
  const audibleFramesRef = useRef(0);
  const peakRmsRef = useRef(0);
  const nextListenIdRef = useRef(1);
  const listenIdRef = useRef(0);

  const setPhase = useCallback((phase: DetectorPhase, details?: Record<string, unknown>) => {
    setPhaseState(phase);
    traceFlow('detector', 'phase', { phase, ...details });
  }, []);

  const resetResult = useCallback((message = 'Ask for a chord, then listen and strum once.') => {
    setPhase('idle');
    setResult({
      verdict: 'idle',
      confidence: 0,
      detectedNotes: [],
      message,
      listenId: listenIdRef.current,
    });
    setSignalLevel(0);
    setHasSignal(false);
  }, [setPhase]);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioContextRef.current?.close().catch(() => undefined);
    sourceRef.current = null;
    analyserRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
    setIsListening(false);
    setPhase('idle');
  }, [setPhase]);

  const start = useCallback(async (targetChord: ChordName) => {
    stop();
    setPhase('arming', { chord: targetChord });
    samplesRef.current = new Map();
    const listenId = nextListenIdRef.current;
    nextListenIdRef.current += 1;
    listenIdRef.current = listenId;
    const startedAt = performance.now();
    startedAtRef.current = startedAt;
    reminderAtRef.current = startedAt;
    firstAudibleAtRef.current = null;
    audibleFramesRef.current = 0;
    peakRmsRef.current = 0;
    setSignalLevel(0);
    setHasSignal(false);
    setResult({
      verdict: 'listening',
      confidence: 0,
      detectedNotes: [],
      message: `Listening for ${targetChord}. Strum once, then let it ring.`,
      listenId,
    });

    const stream = await navigator.mediaDevices.getUserMedia(instrumentMicConstraints);
    if (listenIdRef.current !== listenId) {
      stream.getTracks().forEach((track) => track.stop());
      return listenId;
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContextCtor();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.2;

    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    streamRef.current = stream;
    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    sourceRef.current = source;
    setIsListening(true);
    setPhase('listening', { chord: targetChord, listenId });

    const frequencyData = new Uint8Array(analyser.frequencyBinCount);
    const timeData = new Float32Array(analyser.fftSize);

    const tick = () => {
      if (listenIdRef.current !== listenId) return;

      analyser.getByteFrequencyData(frequencyData);
      analyser.getFloatTimeDomainData(timeData);
      const maxValue = Math.max(...frequencyData);
      const rms = rootMeanSquare(timeData);
      const now = performance.now();
      const elapsed = now - startedAtRef.current;
      const rmsLevel = Math.min(100, Math.round(rms * 900));

      setSignalLevel(Math.max(rmsLevel, Math.round((maxValue / 255) * 100)));

      const hasFrameSignal = elapsed > warmupMs && rms >= rmsSignalFloor && maxValue >= spectralSignalFloor;
      if (hasFrameSignal) {
        setHasSignal(true);
        audibleFramesRef.current += 1;
        peakRmsRef.current = Math.max(peakRmsRef.current, rms);
        if (firstAudibleAtRef.current === null) {
          firstAudibleAtRef.current = now;
          setPhase('signal', {
            chord: targetChord,
            listenId,
            elapsedMs: Math.round(elapsed),
            rms: roundMetric(rms),
            maxValue,
          });
          traceFlow('detector', 'signal-start', {
            chord: targetChord,
            listenId,
            elapsedMs: Math.round(elapsed),
            rms: roundMetric(rms),
            maxValue,
          });
        }
      }

      const notes = strongestPitchClasses(
        frequencyData,
        audioContext.sampleRate,
        analyser.fftSize,
      );

      if (hasFrameSignal) {
        for (const [note, strength] of notes) {
          if (strength < minNoteStrength) continue;
          const current = samplesRef.current.get(note) ?? { strength: 0, frames: 0 };
          samplesRef.current.set(note, {
            strength: Math.max(current.strength, strength),
            frames: current.frames + 1,
          });
        }
      }

      const firstAudibleAt = firstAudibleAtRef.current;
      const attackAgeMs = firstAudibleAt ? now - firstAudibleAt : 0;
      const canEvaluateEarlyCorrect =
        Boolean(firstAudibleAt) &&
        attackAgeMs > earlyCorrectEvaluationMsAfterAttack &&
        audibleFramesRef.current >= minEarlyCorrectAudibleFrames &&
        peakRmsRef.current >= rmsFullStrumFloor;

      if (canEvaluateEarlyCorrect) {
        const earlyEvaluation = evaluate(targetChord, samplesRef.current);
        if (earlyEvaluation.verdict === 'correct') {
          setPhase('evaluating', {
            chord: targetChord,
            listenId,
            mode: 'early',
            verdict: earlyEvaluation.verdict,
          });
          traceFlow('detector', 'early-correct', {
            chord: targetChord,
            listenId,
            attackAgeMs: Math.round(attackAgeMs),
            audibleFrames: audibleFramesRef.current,
            peakRms: roundMetric(peakRmsRef.current),
            detectedNotes: earlyEvaluation.detectedNotes,
          });
          setResult({ ...earlyEvaluation, listenId });
          stop();
          return;
        }
      }

      const heardFullStrum =
        Boolean(firstAudibleAt) &&
        attackAgeMs > evaluationMsAfterAttack &&
        audibleFramesRef.current >= minAudibleFrames &&
        peakRmsRef.current >= rmsFullStrumFloor;

      if (heardFullStrum) {
        if (listenIdRef.current !== listenId) return;
        const evaluation = evaluate(targetChord, samplesRef.current);
        setPhase('evaluating', {
          chord: targetChord,
          listenId,
          mode: 'full',
          verdict: evaluation.verdict,
          confidence: evaluation.confidence,
        });
        traceFlow('detector', 'full-evaluation', {
          chord: targetChord,
          listenId,
          attackAgeMs: Math.round(attackAgeMs),
          audibleFrames: audibleFramesRef.current,
          peakRms: roundMetric(peakRmsRef.current),
          verdict: evaluation.verdict,
          confidence: evaluation.confidence,
          detectedNotes: evaluation.detectedNotes,
        });
        setResult({ ...evaluation, listenId });
        stop();
        return;
      }

      if (now - reminderAtRef.current > listeningReminderMs) {
        reminderAtRef.current = now;
        setResult({
          verdict: 'listening',
          confidence: 0,
          detectedNotes: stableDetectedNotes(samplesRef.current),
          message: `Still listening for a full ${targetChord} strum. Small bumps or partial strings will be ignored.`,
          listenId,
        });
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return listenId;
  }, [setPhase, stop]);

  useEffect(() => stop, [stop]);

  return { result, phase, isListening, signalLevel, hasSignal, start, stop, resetResult };
}

const instrumentMicConstraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
} satisfies MediaStreamConstraints;

function strongestPitchClasses(
  data: Uint8Array,
  sampleRate: number,
  fftSize: number,
): Array<[string, number]> {
  const peaks: Array<[string, number]> = [];
  const minFrequency = 180;
  const maxFrequency = 950;
  const binWidth = sampleRate / fftSize;
  const maxValue = Math.max(...data);

  if (maxValue < spectralSignalFloor) return peaks;

  for (let index = 0; index < data.length; index += 1) {
    const frequency = index * binWidth;
    if (frequency < minFrequency || frequency > maxFrequency) continue;

    const value = data[index];
    const left = data[index - 1] ?? 0;
    const right = data[index + 1] ?? 0;
    if (value < maxValue * 0.54 || value < left || value < right) continue;

    peaks.push([frequencyToPitchClass(frequency), value / 255]);
  }

  const byNote = new Map<string, number>();
  for (const [note, strength] of peaks) {
    byNote.set(note, Math.max(byNote.get(note) ?? 0, strength));
  }

  return [...byNote.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
}

function frequencyToPitchClass(frequency: number) {
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  const index = ((midi % 12) + 12) % 12;
  return noteNames[index];
}

function evaluate(
  targetChord: ChordName,
  evidence: Map<string, { strength: number; frames: number }>,
): AttemptResult {
  const expected = targetPitchClasses[targetChord];
  const detectedNotes = stableDetectedNotes(evidence);

  const hits = expected.filter((note) => detectedNotes.includes(note));
  const confidence = Math.round((hits.length / expected.length) * 100) / 100;

  if (confidence >= 0.95) {
    return {
      verdict: 'correct',
      confidence,
      detectedNotes,
      message: `Yes. I heard a full strum with the core notes for ${targetChord}. That one counts.`,
    };
  }

  if (confidence >= 0.55) {
    const missing = expected.filter((note) => !detectedNotes.includes(note));
    return {
      verdict: 'almost',
      confidence,
      detectedNotes,
      message: `Close. The full strum came through, and I heard ${hits.join(', ')}, but ${missing.join(', ')} was not stable enough.`,
    };
  }

  return {
    verdict: 'missed',
    confidence,
    detectedNotes,
    message:
      detectedNotes.length > 0
        ? `I heard a full strum with ${detectedNotes.slice(0, 3).join(', ')}, but not enough of ${targetChord}. Try a slower strum.`
        : `I heard the strum, but the chord tones did not come through clearly. Try once more, close to the mic.`,
  };
}

function stableDetectedNotes(evidence: Map<string, { strength: number; frames: number }>) {
  return [...evidence.entries()]
    .filter(([, value]) => value.strength >= minNoteStrength && value.frames >= minNoteFrames)
    .sort((a, b) => b[1].strength - a[1].strength)
    .map(([note]) => note)
    .slice(0, 8);
}

function rootMeanSquare(data: Float32Array) {
  let sum = 0;
  for (const sample of data) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / data.length);
}

function roundMetric(value: number) {
  return Math.round(value * 1000) / 1000;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
