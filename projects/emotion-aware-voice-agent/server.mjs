// Brand-safe empathy demo server. Plain Node 22, no dependencies.
//
// One process does four jobs for a Vapi assistant:
//   1. Custom LLM (POST /chat/completions, OpenAI-compatible, streaming). Before
//      each reply it asks Hume Audio Decisions how the caller SOUNDS, picks a
//      delivery tag from the brand's approved palette in code, removes any
//      brackets the model writes, and puts the approved tag before every
//      sentence so ElevenLabs v4 performs it.
//   2. Listener (call.monitor.listenUrl). Keeps the last seconds of caller and
//      agent audio, and scores each agent turn with Hume ("did the agent
//      actually sound on-brand?").
//   3. Escalation. Two angry or frustrated caller turns anywhere in the call: the agent says a
//      handoff line, then the server transfers the call to a specialist through
//      the live call control URL, with a one-line mood summary for them.
//   4. Dashboard (GET /, SSE at /events) showing caller and agent mood.
//
// Env: see .env.example. DEMO_SECRET is required.

import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT ?? 7788);
const PUBLIC_DIR = new URL('./public', import.meta.url).pathname;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
const HUME_API_KEY = process.env.HUME_API_KEY ?? '';
const SPECIALIST_NUMBER = process.env.SPECIALIST_NUMBER ?? '';
// The dashboard stream has no login, so it only ever sees the last 4 digits.
const SPECIALIST_SHOWN = SPECIALIST_NUMBER ? `***${SPECIALIST_NUMBER.slice(-4)}` : '';
const LLM_MODEL = process.env.LLM_MODEL ?? 'gpt-4.1';
const HUME_WAIT_MS = Number(process.env.HUME_WAIT_MS ?? 1200);
// Hume's answer time grows with clip length (1.5 s ~ 0.6 s, 4.2 s ~ 1.3 s), and
// the last couple of seconds carry the tone, so only the tail of a turn is sent.
const CLIP_MAX_MS = Number(process.env.CLIP_MAX_MS ?? 2500);
// Escalation: a caller turn counts when Hume's top choice for it is angry or
// frustrated. Once ESCALATE_TURNS such turns have happened anywhere in the call
// (they need not be in a row, and calm turns never reset the count), the agent
// hands off.
const UPSET_MOODS = new Set(['angry', 'frustrated']);
const ESCALATE_TURNS = Number(process.env.ESCALATE_TURNS ?? 2);
const DEBUG = process.env.DEBUG_BODIES === '1';
// Shared secret Vapi sends as x-demo-secret (custom-llm headers and server
// headers), so nobody else can spend the OpenAI and Hume keys.
const DEMO_SECRET = process.env.DEMO_SECRET ?? '';
if (!DEMO_SECRET) {
  console.error('DEMO_SECRET is not set. Set it here and as the x-demo-secret header on the assistant, so nobody else can spend your OpenAI and Hume keys.');
  process.exit(1);
}
function secretMatches(given) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(DEMO_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}
function authorized(req) {
  return secretMatches(req.headers['x-demo-secret']);
}

function log(...args) {
  console.log(new Date().toISOString().slice(11, 23), ...args);
}

// ---- Per-call trace -------------------------------------------------------------
// Every dashboard event for a call, plus each exact clip sent to Hume, is saved
// under TRACE_DIR/<callId>/ so a run can be replayed and the mood rules tuned.
// Off unless TRACE_DIR is set, because the clips are recordings of real callers.
const TRACE_DIR = process.env.TRACE_DIR ?? '';
const CALL_ID_RE = /^[0-9a-zA-Z-]{8,64}$/;
function traceDir(callId) {
  if (!TRACE_DIR || !CALL_ID_RE.test(callId ?? '')) return null;
  const dir = join(TRACE_DIR, callId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function traceWrite(callId, record) {
  try {
    const dir = traceDir(callId);
    if (dir) appendFileSync(join(dir, 'events.ndjson'), JSON.stringify({ t: new Date().toISOString(), ...record }) + '\n');
  } catch (err) {
    log('trace write failed', String(err).slice(0, 160));
  }
}
function traceClip(callId, name, samples, rate) {
  try {
    const dir = traceDir(callId);
    if (!dir) return null;
    writeFileSync(join(dir, name), wavEncode(samples, rate));
    return name;
  } catch (err) {
    log('trace clip failed', String(err).slice(0, 160));
    return null;
  }
}

// ---- Brand voice palette -----------------------------------------------------
// The brand approves these deliveries and nothing else. The caller's mood picks
// one; anger is never mirrored back.
const PALETTE = {
  angry: { tag: '[slightly calm, reassuring]', delivery: 'calm and reassuring' },
  frustrated: { tag: '[slightly calm, reassuring]', delivery: 'calm and reassuring' },
  fearful: { tag: '[slightly gentle, steady and reassuring]', delivery: 'calm and reassuring' },
  sad: { tag: '[slightly gentle, warm and empathetic]', delivery: 'gentle and empathetic' },
  happy: { tag: '[slightly upbeat, bright and friendly]', delivery: 'upbeat and bright' },
  neutral: { tag: '[slightly warm, friendly]', delivery: 'warm and friendly' },
};
const DEFAULT_MOOD = 'neutral';
const CALLER_MOODS = ['angry', 'frustrated', 'sad', 'fearful', 'happy', 'neutral'];

// ---- Hume Audio Decisions ------------------------------------------------------
const HUME_URL = 'https://api.cloud.hume.ai/v0/decisions/file';

const CALLER_REQUEST = JSON.stringify({
  context:
    "One caller speaking on a customer-support phone line for an internet provider. Only the caller's voice is in the recording.",
  questions: {
    emotion: {
      type: 'choice',
      instructions:
        "Judging by how the caller's voice sounds, not by the meaning of the words, how is the caller feeling?",
      criteria: [
        { name: 'angry', description: 'Angry, hostile, raised or harsh voice' },
        { name: 'frustrated', description: 'Tense, clipped, irritated, exasperated or sarcastic voice' },
        { name: 'sad', description: 'Sad, down or discouraged voice' },
        { name: 'fearful', description: 'Worried, anxious or nervous voice' },
        { name: 'happy', description: 'Happy, cheerful, amused or relieved voice' },
        { name: 'neutral', description: 'Calm, even, relaxed voice' },
        { name: 'none of these', description: 'Fits none of the other options' },
      ],
    },
    laughing: { type: 'noul', instructions: 'Does the caller laugh?' },
    sighing: { type: 'noul', instructions: 'Does the caller sigh?' },
  },
});

const AGENT_REQUEST = JSON.stringify({
  context:
    "One customer-support agent speaking on a phone line for an internet provider. Only the agent's voice is in the recording.",
  questions: {
    delivery: {
      type: 'choice',
      instructions: "Judging by how the agent's voice sounds, how would you describe the agent's delivery?",
      criteria: [
        { name: 'calm and reassuring', description: 'Steady, soothing, unhurried and reassuring' },
        { name: 'warm and friendly', description: 'Pleasant, warm and welcoming' },
        { name: 'upbeat and bright', description: 'Lively, cheerful and energetic' },
        { name: 'gentle and empathetic', description: 'Soft, caring and sympathetic' },
        { name: 'irritated or curt', description: 'Short, impatient, cold or annoyed' },
        { name: 'flat or robotic', description: 'Monotone, lifeless or mechanical' },
        { name: 'none of these', description: 'Fits none of the other options' },
      ],
    },
  },
});

function wavEncode(samples, sampleRate) {
  const header = Buffer.alloc(44);
  const dataBytes = samples.length * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.from(samples.buffer, samples.byteOffset, dataBytes)]);
}

async function humeAsk(samples, sampleRate, requestJson) {
  const form = new FormData();
  form.append('request', new Blob([requestJson], { type: 'application/json' }));
  form.append('file', new Blob([wavEncode(samples, sampleRate)], { type: 'audio/wav' }), 'clip.wav');
  const started = Date.now();
  const res = await fetch(HUME_URL, {
    method: 'POST',
    headers: { 'X-Hume-Api-Key': HUME_API_KEY },
    body: form,
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`hume ${res.status} ${text.slice(0, 200)}`);
  return { body: JSON.parse(text), latencyMs: Date.now() - started };
}

// ---- Per-channel audio ring with a simple energy voice detector ----------------
const FRAME_MS = 20;
const VOICE_RMS = 350;

class Channel {
  constructor(sampleRate, seconds = 20) {
    this.sampleRate = sampleRate;
    this.ring = new Int16Array(sampleRate * seconds);
    this.total = 0; // samples ever written
    this.lastVoiced = -1; // sample index of the end of the last voiced frame
    this.segmentStart = -1; // first voiced sample of the current speech run
    this.silentSince = 0;
  }
  write(samples) {
    const frame = (this.sampleRate * FRAME_MS) / 1000;
    for (let off = 0; off < samples.length; off += frame) {
      const slice = samples.subarray(off, Math.min(off + frame, samples.length));
      let sum = 0;
      for (let i = 0; i < slice.length; i++) sum += slice[i] * slice[i];
      const rms = Math.sqrt(sum / Math.max(1, slice.length));
      for (let i = 0; i < slice.length; i++) this.ring[(this.total + i) % this.ring.length] = slice[i];
      this.total += slice.length;
      if (rms >= VOICE_RMS) {
        if (this.segmentStart < 0 || this.total - this.lastVoiced > this.sampleRate * 0.8) {
          this.segmentStart = this.total - slice.length;
        }
        this.lastVoiced = this.total;
      }
    }
  }
  slice(from, to) {
    const start = Math.max(from, this.total - this.ring.length + 1, 0);
    const end = Math.min(to, this.total);
    const out = new Int16Array(Math.max(0, end - start));
    for (let i = 0; i < out.length; i++) out[i] = this.ring[(start + i) % this.ring.length];
    return out;
  }
  silenceMs() {
    return this.lastVoiced < 0 ? Infinity : ((this.total - this.lastVoiced) / this.sampleRate) * 1000;
  }
}

// ---- Call state ---------------------------------------------------------------
const calls = new Map();

function callState(callId) {
  let s = calls.get(callId);
  if (!s) {
    s = {
      callId,
      listenUrl: null,
      controlUrl: null,
      ws: null,
      caller: null,
      agent: null,
      callerTurnStart: -1,
      agentSpeaking: false,
      agentTurnStart: -1,
      callerMood: null,
      currentMood: DEFAULT_MOOD,
      frustratedStreak: 0, // caller turns so far whose top mood was angry or frustrated
      upsetTurns: new Map(), // caller turn key -> counted? (a later reading of the same turn replaces it)
      callType: null,
      moodTrail: [], // caller readings, oldest first, for the transfer packet
      escalation: null, // null | 'speaking' | 'transferring' | 'done' | 'failed' | 'simulated'
      humeInflight: null, // { key, promise }
      turn: 0,
      lastIntendedTag: PALETTE[DEFAULT_MOOD].tag,
      transcript: [],
      ended: false,
    };
    calls.set(callId, s);
  }
  return s;
}

// ---- Listen socket -------------------------------------------------------------
async function listenConnect(s, attempt = 1) {
  if (!s.listenUrl || s.ws || s.ended) return;
  const ws = new WebSocket(s.listenUrl);
  ws.binaryType = 'arraybuffer';
  s.ws = ws;
  let opened = false;
  const timer = setTimeout(() => {
    if (!opened) {
      log(`listen ${s.callId.slice(0, 8)} handshake timeout (attempt ${attempt})`);
      try { ws.close(); } catch {}
      s.ws = null;
      if (attempt < 6) setTimeout(() => listenConnect(s, attempt + 1), 500);
    }
  }, 4000);
  ws.addEventListener('open', () => {
    opened = true;
    clearTimeout(timer);
    log(`listen ${s.callId.slice(0, 8)} connected`);
  });
  ws.addEventListener('message', (ev) => {
    if (typeof ev.data === 'string') {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'start') {
          const rate = Number(msg.sampleRate) || 16000;
          s.caller = new Channel(rate);
          s.agent = new Channel(rate);
          s.channels = Number(msg.channels) || 2;
        }
      } catch {}
      return;
    }
    if (!s.caller) {
      s.caller = new Channel(16000);
      s.agent = new Channel(16000);
      s.channels = 2;
    }
    audioIngest(s, new Int16Array(ev.data));
  });
  ws.addEventListener('close', () => {
    clearTimeout(timer);
    if (s.ws === ws) s.ws = null;
  });
  ws.addEventListener('error', () => {});
}

function audioIngest(s, interleaved) {
  const n = Math.floor(interleaved.length / 2);
  const caller = new Int16Array(n);
  const agent = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    caller[i] = interleaved[2 * i]; // channel 0 is the caller
    agent[i] = interleaved[2 * i + 1]; // channel 1 is the assistant
  }
  const agentWasVoiced = s.agent.lastVoiced;
  const callerWasVoiced = s.caller.lastVoiced;
  s.caller.write(caller);
  s.agent.write(agent);

  // Caller turn bookkeeping: a turn starts at the caller's first voiced frame
  // after the agent last spoke.
  if (s.caller.lastVoiced !== callerWasVoiced && s.callerTurnStart < 0) s.callerTurnStart = s.caller.segmentStart;

  // Agent turn detection: speech starts, then 900 ms of silence ends the turn.
  if (s.agent.lastVoiced !== agentWasVoiced && s.agent.lastVoiced > 0) {
    if (!s.agentSpeaking) {
      s.agentSpeaking = true;
      s.agentTurnStart = s.agent.segmentStart;
      s.callerTurnStart = -1;
    }
  } else if (s.agentSpeaking && s.agent.silenceMs() > 900) {
    s.agentSpeaking = false;
    agentTurnEnded(s);
  }
}

function agentTurnEnded(s) {
  const rate = s.agent.sampleRate;
  const end = s.agent.lastVoiced + Math.round(rate * 0.15);
  const start = Math.max(s.agentTurnStart - Math.round(rate * 0.1), end - rate * 6);
  const clip = s.agent.slice(start, end);
  const intended = s.lastIntendedTag;
  if (s.escalation === 'speaking') escalationTransfer(s);
  if (clip.length < rate * 1.0 || !HUME_API_KEY) return;
  s.agentClipN = (s.agentClipN ?? 0) + 1;
  const clipFile = traceClip(s.callId, `agent-${String(s.agentClipN).padStart(2, '0')}.wav`, clip, rate);
  humeAsk(clip, rate, AGENT_REQUEST)
    .then(({ body, latencyMs }) => {
      const a = body.answers?.delivery;
      if (!a) return;
      const expected = Object.values(PALETTE).find((p) => p.tag === intended)?.delivery;
      // Hume separates calm, warm and gentle only loosely, so "on brand" means
      // the agent never sounded curt, flat or unclear. The closest approved
      // delivery is still shown.
      const offBrand = ['irritated or curt', 'flat or robotic', 'none of these'];
      emitEvent('agent-mood', {
        callId: s.callId,
        label: a.choice,
        prob: a.probabilities?.[a.choice] ?? 0,
        probs: a.probabilities,
        intendedTag: intended,
        expected,
        exact: expected ? a.choice === expected : null,
        match: !offBrand.includes(a.choice),
        offBrandScore: offBrand.reduce((sum, k) => sum + (a.probabilities?.[k] ?? 0), 0),
        clipMs: Math.round((clip.length / rate) * 1000),
        latencyMs,
        clipFile,
      });
    })
    .catch((err) => log('agent hume failed', String(err).slice(0, 160)));
}

// ---- Caller mood for the current turn -------------------------------------------
function callerClip(s) {
  if (!s.caller || s.caller.lastVoiced < 0) return null;
  const rate = s.caller.sampleRate;
  const end = s.caller.lastVoiced + Math.round(rate * 0.2);
  let start = s.callerTurnStart >= 0 ? s.callerTurnStart - Math.round(rate * 0.1) : end - rate * 3;
  const fullStart = start; // whole turn, kept in the trace for comparison
  start = Math.max(start, end - Math.round((rate * CLIP_MAX_MS) / 1000));
  if (end - start < rate * 1.2) start = end - Math.round(rate * 1.2); // Hume needs >= 1 s
  const turnKey = s.callerTurnStart >= 0 ? s.callerTurnStart : s.caller.lastVoiced;
  return { key: s.caller.lastVoiced, turnKey, start, samples: s.caller.slice(start, end), full: fullStart < start ? s.caller.slice(fullStart, end) : null, rate };
}

function callerMoodRequest(s) {
  const clip = callerClip(s);
  if (!clip || clip.samples.length < clip.rate || !HUME_API_KEY) return null;
  if (s.humeInflight?.key === clip.key) return s.humeInflight.promise;
  s.clipN = (s.clipN ?? 0) + 1;
  const clipFile = traceClip(s.callId, `caller-${String(s.clipN).padStart(2, '0')}.wav`, clip.samples, clip.rate);
  const fullFile = clip.full ? traceClip(s.callId, `caller-${String(s.clipN).padStart(2, '0')}-full.wav`, clip.full, clip.rate) : null;
  const clipStartS = +(clip.start / clip.rate).toFixed(2);
  const promise = humeAsk(clip.samples, clip.rate, CALLER_REQUEST)
    .then(({ body, latencyMs }) => {
      const e = body.answers?.emotion;
      const probs = e?.probabilities ?? {};
      let label = 'neutral';
      let prob = 0;
      for (const m of CALLER_MOODS) if ((probs[m] ?? 0) > prob) { label = m; prob = probs[m]; }
      const mood = {
        label,
        prob,
        probs,
        laughing: body.answers?.laughing?.noul ?? null,
        sighing: body.answers?.sighing?.noul ?? null,
        clipMs: Math.round((clip.samples.length / clip.rate) * 1000),
        latencyMs,
        at: Date.now(),
        clipFile,
        fullFile, // the whole turn when the clip had to be cut to CLIP_MAX_MS
        clipStartS, // seconds since the listen socket opened (approximate)
        turnStartS: clip.turnKey >= 0 ? +(clip.turnKey / clip.rate).toFixed(2) : null,
      };
      s.callerMood = mood;
      emitEvent('caller-mood', { callId: s.callId, turn: s.turn, ...mood });
      s.moodTrail.push({ label, prob, upset: upsetScore(mood) });
      upsetCount(s, mood, clip.turnKey);
      return mood;
    })
    .catch((err) => {
      log('caller hume failed', String(err).slice(0, 160));
      return null;
    });
  s.humeInflight = { key: clip.key, promise };
  return promise;
}

// Pick the delivery for this reply. A mood switches the delivery only when Hume
// is reasonably sure; otherwise the last delivery holds.
// Real voices split Hume's raters, so the top answer usually lands at 0.30-0.45.
// A fixed "switch above 0.45" rule froze the delivery on one early reading.
// Instead: a top mood of angry or frustrated goes straight to the calm palette,
// otherwise follow the leading mood when it clearly leads the runner-up, else hold.
const MOOD_MIN = Number(process.env.MOOD_MIN ?? 0.25);
const MOOD_MARGIN = Number(process.env.MOOD_MARGIN ?? 0.05);

// The upset streak counts caller TURNS, scored whenever Hume answers. A reading
// that lands after the reply already started still counts, so a slow answer on
// the caller's angriest line can't drop it from the escalation count. A second
// reading for the same turn replaces the first instead of adding to it.
function upsetCount(s, mood, turnKey) {
  const counted = UPSET_MOODS.has(mood.label);
  s.upsetTurns.set(turnKey, counted);
  s.frustratedStreak = [...s.upsetTurns.values()].filter(Boolean).length;
  emitEvent('upset-count', {
    callId: s.callId,
    count: s.frustratedStreak,
    needed: ESCALATE_TURNS,
    counted,
    label: mood.label,
    upset: upsetScore(mood),
    due: escalationDue(s),
  });
}

function escalationDue(s) {
  return s.frustratedStreak >= ESCALATE_TURNS;
}

function deliveryChoose(s, mood) {
  let reason = 'hold';
  if (mood) {
    const ranked = Object.entries(mood.probs)
      .filter(([k]) => k !== 'none of these' && PALETTE[k])
      .sort((a, b) => b[1] - a[1]);
    const [top, second] = ranked;
    // "Upset" means the same thing here as in the escalation count: Hume's top
    // mood is angry or frustrated. A neutral caller with some frustrated score
    // in the mix stays on the friendly delivery.
    if (UPSET_MOODS.has(mood.label)) {
      s.currentMood = mood.label;
      reason = 'upset';
    } else if (top && top[1] >= MOOD_MIN && top[1] - (second?.[1] ?? 0) >= MOOD_MARGIN) {
      s.currentMood = top[0];
      reason = 'lead';
    }
  }
  return { palette: PALETTE[s.currentMood] ?? PALETTE[DEFAULT_MOOD], reason, decided: s.currentMood };
}

function ruleText(mood, choice) {
  const { palette, reason, decided } = choice;
  if (!mood) return `No new voice reading. Holding ${palette.delivery}.`;
  if (reason === 'upset') {
    const pct = Math.round((upsetScore(mood)) * 100);
    return `Caller sounds upset (angry + frustrated ${pct}%). Brand rule: never mirror anger. Delivering ${palette.delivery}.`;
  }
  if (reason === 'hold') return `Mixed reading (top: ${mood.label}). Holding ${palette.delivery}.`;
  return `Caller sounds ${decided}. Delivering ${palette.delivery}.`;
}

function upsetScore(mood) {
  return (mood.probs.angry ?? 0) + (mood.probs.frustrated ?? 0);
}

// ---- Escalation -----------------------------------------------------------------
const HANDOFF_LINE =
  "I'm really sorry this has been so frustrating. I'm connecting you with a specialist right now who can sort this out for you.";

async function summaryBuild(s) {
  const recent = s.transcript.slice(-8).map((t) => `${t.role}: ${t.text}`).join('\n');
  const fallback = `Caller has sounded ${s.callerMood?.label ?? 'frustrated'} on ${s.frustratedStreak} turns of this call.`;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        temperature: 0,
        max_tokens: 80,
        messages: [
          {
            role: 'system',
            content:
              'You brief a support specialist who is about to take over a call. Write one short spoken sentence that starts with "Heads up:" and describes the caller in the third person: what they need and how they sound. Never address the caller.',
          },
          { role: 'user', content: `Caller voice mood: ${fallback}\nTranscript:\n${recent}` },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });
    const j = await res.json();
    return j.choices?.[0]?.message?.content?.trim() || fallback;
  } catch {
    return fallback;
  }
}

// The live call control command that warm-transfers to the specialist. The
// dashboard shows this exact body as the "transfer packet".
function transferBody(summary) {
  return {
    type: 'transfer',
    destination: {
      type: 'number',
      number: SPECIALIST_NUMBER,
      message: '',
      // Warm transfer: Vapi dials the specialist, reads them the briefing,
      // then connects the caller.
      transferPlan: {
        mode: 'warm-transfer-experimental',
        message: summary,
        fallbackPlan: {
          message: "[slightly calm, reassuring] I'm sorry, the specialist team is busy right now. I'll stay with you and we'll sort this out together.",
          endCallEnabled: false,
        },
      },
    },
  };
}

async function callControl(s, body, label) {
  if (!s.controlUrl) return false;
  try {
    const res = await fetch(s.controlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    log(`${label} ${s.callId.slice(0, 8)} -> ${res.status}`);
    emitEvent('escalation', { callId: s.callId, status: res.ok ? 'hung-up' : 'failed', reason: res.ok ? null : `${label} ${res.status}` });
    return res.ok;
  } catch (err) {
    emitEvent('escalation', { callId: s.callId, status: 'failed', reason: String(err).slice(0, 120) });
    return false;
  }
}

async function escalationTransfer(s) {
  if (s.escalation !== 'speaking') return;
  s.escalation = 'transferring';
  const summary = await (s.summaryPromise ?? summaryBuild(s));
  const body = transferBody(summary);
  emitEvent('transfer-packet', {
    callId: s.callId,
    to: 'Super Reliable Internet escalations',
    number: SPECIALIST_SHOWN,
    mode: 'Warm transfer: the specialist hears the briefing before the caller joins',
    summary,
    trail: s.moodTrail.slice(-5),
    command: { ...body, destination: { ...body.destination, number: SPECIALIST_SHOWN } },
    webCall: s.callType === 'webCall',
  });

  // A web call has no phone leg, so Vapi would fail the transfer and drop the
  // call with an error. Instead, play the handoff steps on the dashboard and
  // end the call cleanly through live call control.
  if (s.callType === 'webCall') {
    s.escalation = 'simulated';
    const step = (status, ms) =>
      setTimeout(() => emitEvent('escalation', { callId: s.callId, status, summary, number: SPECIALIST_SHOWN }), ms);
    step('dialing', 0);
    step('briefed', 1400);
    step('handed-off', 2800);
    setTimeout(() => callControl(s, { type: 'end-call' }, 'end-call'), 4200);
    log(`transfer ${s.callId.slice(0, 8)} simulated: web call`);
    return;
  }
  emitEvent('escalation', { callId: s.callId, status: 'transferring', summary, number: SPECIALIST_SHOWN });
  if (!s.controlUrl) {
    s.escalation = 'failed';
    emitEvent('escalation', { callId: s.callId, status: 'failed', summary, reason: 'no control URL' });
    return;
  }
  try {
    const res = await fetch(s.controlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    log(`transfer ${s.callId.slice(0, 8)} -> ${res.status} ${text.slice(0, 160)}`);
    s.escalation = res.ok ? 'done' : 'failed';
    emitEvent('escalation', {
      callId: s.callId,
      status: res.ok ? 'done' : 'failed',
      summary,
      reason: res.ok ? null : `control ${res.status}`,
    });
  } catch (err) {
    s.escalation = 'failed';
    emitEvent('escalation', { callId: s.callId, status: 'failed', summary, reason: String(err).slice(0, 120) });
  }
}

// ---- Custom LLM -------------------------------------------------------------------
const TAG_RE = /\[[^\]]*\]/g;
const SENTENCE_RE = /^([\s\S]*?[.!?…]+["'”’)]*)(\s+)([\s\S]*)$/;

function chunkFrame(id, content, finish = null) {
  return `data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: LLM_MODEL,
    choices: [{ index: 0, delta: finish ? {} : { content }, finish_reason: finish }],
  })}\n\n`;
}

// Turns a stream of model text into sentences, each starting with the tag.
class SentenceTagger {
  constructor(tag, emit, mode = 'every') {
    this.tag = tag;
    this.mode = mode;
    this.emit = emit;
    this.buf = '';
    this.stripped = 0;
    this.out = '';
  }
  push(text) {
    this.buf += text;
    // Hold back an unclosed "[" so a tag split across tokens is still caught.
    const open = this.buf.lastIndexOf('[');
    const safeEnd = open > this.buf.lastIndexOf(']') ? open : this.buf.length;
    let safe = this.buf.slice(0, safeEnd);
    const rest = this.buf.slice(safeEnd);
    const before = safe.length;
    safe = safe.replace(TAG_RE, '');
    if (safe.length !== before) this.stripped++;
    let m;
    while ((m = safe.match(SENTENCE_RE))) {
      this.sentence(m[1]);
      safe = m[3];
    }
    this.buf = safe + rest;
  }
  end() {
    const tail = this.buf.replace(TAG_RE, '').replace(/\[[^\]]*$/, '');
    if (tail.trim()) this.sentence(tail);
    this.buf = '';
  }
  sentence(text) {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    // v4 carries a tag's emotion forward, so 'first' tags only the opening sentence.
    const tagged = Boolean(this.tag) && (this.mode !== 'first' || !this.out);
    const piece = tagged ? `${this.tag} ${clean} ` : `${clean} `;
    this.out += piece;
    this.emit(piece);
  }
}

// Tag wording variants, chosen per assistant with an "x-tag-variant" model header
// such as "first:soft". Lets us compare deliveries on real calls without a deploy.
const TAG_STYLES = {
  slightly: (p) => p.tag,
  plain: (p) => p.tag.replace('[slightly ', '['),
  soft: (p) => ({
    'calm and reassuring': '[calm, reassuring, softly]',
    'gentle and empathetic': '[gentle, soft]',
    'upbeat and bright': '[cheerful, conversational]',
    'warm and friendly': '[warm, conversational]',
  })[p.delivery] ?? p.tag,
  adverb: (p) => ({
    'calm and reassuring': '[calmly]',
    'gentle and empathetic': '[gently]',
    'upbeat and bright': '[cheerfully]',
    'warm and friendly': '[warmly]',
  })[p.delivery] ?? p.tag,
  natural: () => '',
};
function tagVariant(req) {
  const [mode, style] = String(req.headers['x-tag-variant'] ?? 'first:slightly').split(':');
  return { mode: mode === 'first' ? 'first' : 'every', style: TAG_STYLES[style] ? style : 'slightly' };
}

const SOOTHING = new Set(['calm and reassuring', 'gentle and empathetic']);
// The prompt asks for one text-alert offer per call, but the model repeats it
// when the caller asks about timing again, so the server tracks it.
const TEXT_OFFER_RE = /\b(text alert|text you|send you a text|text message|a text)\b/i;
function deliveryNote(mood, palette, s, textOffered = false) {
  const heard = mood
    ? `Voice analysis of the caller's last turn: they sound ${mood.label} (${Math.round(mood.prob * 100)}%).` +
      (mood.sighing >= 0.5 ? ' They sighed.' : '') +
      (mood.laughing >= 0.5 ? ' They laughed.' : '')
    : 'No new voice analysis for this turn.';
  return (
    `${heard} The brand delivery for this reply is "${palette.delivery}". ` +
    (SOOTHING.has(palette.delivery)
      ? 'Write words that fit that delivery. Acknowledge how the caller feels briefly and kindly, once, then help. '
      : 'Write words that fit that delivery: positive, friendly and matter-of-fact, and go straight to helping. ') +
    'Never mention voice analysis, tags or delivery. Never write square brackets.' +
    (textOffered ? ' The text alert has already been offered in this call, so leave it out of this reply.' : '') +
    (s.frustratedStreak > 0 ? ` The caller has sounded upset on ${s.frustratedStreak} turn(s) of this call.` : '')
  );
}

async function chatCompletions(req, res, body) {
  const callId = body.call?.id ?? 'unknown';
  const s = callState(callId);
  s.callType ??= body.call?.type ?? null;
  if (body.call?.monitor) {
    s.listenUrl ??= body.call.monitor.listenUrl;
    s.controlUrl ??= body.call.monitor.controlUrl;
    listenConnect(s);
  }
  s.turn++;
  const id = `chatcmpl-${Date.now().toString(36)}`;
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  // Wait briefly for Hume's reading of the caller's last turn.
  const t0 = Date.now();
  const pending = callerMoodRequest(s);
  const mood = pending
    ? await Promise.race([pending, new Promise((r) => setTimeout(() => r(null), HUME_WAIT_MS))])
    : null;
  const waitedMs = Date.now() - t0;
  const choice = deliveryChoose(s, mood);
  const palette = choice.palette;
  s.lastIntendedTag = palette.tag;
  const variant = tagVariant(req);
  const spokenTag = TAG_STYLES[variant.style](palette);
  emitEvent('brand', {
    callId,
    turn: s.turn,
    callerMood: mood?.label ?? null,
    decidedMood: choice.decided,
    delivery: palette.delivery,
    tag: spokenTag || palette.tag,
    variant: `${variant.mode}:${variant.style}`,
    rule: ruleText(mood, choice),
    waitedMs,
    streak: s.frustratedStreak,
  });

  // Escalation: after enough upset turns, speak the handoff line and transfer
  // once the agent finishes saying it.
  const escalate = !s.escalation && SPECIALIST_NUMBER && escalationDue(s) && s.controlUrl;
  // If the caller talks over the handoff line, Vapi asks for a new reply before
  // the transfer goes out. Answer with the handoff line again, never a normal reply.
  const handoffRepeat = s.escalation === 'speaking';
  if (escalate || handoffRepeat) {
    if (escalate) {
      s.escalation = 'speaking';
      s.summaryPromise = summaryBuild(s);
      emitEvent('escalation', { callId, status: 'speaking', number: SPECIALIST_SHOWN });
      setTimeout(() => escalationTransfer(s), 12000); // backstop if turn-end detection misses
    }
    const tagger = new SentenceTagger(spokenTag, (p) => res.write(chunkFrame(id, p)), variant.mode);
    tagger.push(HANDOFF_LINE);
    tagger.end();
    res.write(chunkFrame(id, '', 'stop'));
    res.end('data: [DONE]\n\n');
    emitEvent('agent-text', { callId, turn: s.turn, text: tagger.out.trim(), stripped: 0 });
    return;
  }

  const textOffered = (body.messages ?? []).some((m) => m.role === 'assistant' && TEXT_OFFER_RE.test(String(m.content ?? '')));
  const messages = [...(body.messages ?? []), { role: 'system', content: deliveryNote(mood, palette, s, textOffered) }];
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const tagger = new SentenceTagger(spokenTag, (p) => res.write(chunkFrame(id, p)), variant.mode);
  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages,
        stream: true,
        temperature: body.temperature ?? 0.3,
        max_tokens: body.max_tokens ?? 300,
      }),
      signal: ac.signal,
    });
    if (!upstream.ok) throw new Error(`openai ${upstream.status} ${(await upstream.text()).slice(0, 200)}`);
    const decoder = new TextDecoder();
    let sse = '';
    for await (const part of upstream.body) {
      sse += decoder.decode(part, { stream: true });
      let nl;
      while ((nl = sse.indexOf('\n')) >= 0) {
        const line = sse.slice(0, nl).trim();
        sse = sse.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) tagger.push(delta);
        } catch {}
      }
    }
    tagger.end();
    res.write(chunkFrame(id, '', 'stop'));
    res.end('data: [DONE]\n\n');
    emitEvent('agent-text', { callId, turn: s.turn, text: tagger.out.trim(), stripped: tagger.stripped });
  } catch (err) {
    if (ac.signal.aborted) return;
    log('llm failed', String(err).slice(0, 200));
    tagger.end();
    if (!tagger.out) tagger.sentence("Sorry, give me just a second.");
    res.write(chunkFrame(id, '', 'stop'));
    res.end('data: [DONE]\n\n');
  }
}

// ---- SSE to the dashboard (replay buffer, boot token) ---------------------------
const BOOT = Math.random().toString(36).slice(2, 8);
const buffer = [];
let nextId = 1;
let lastEvictedId = 0;
const clients = new Set();

function frameBuild(event) {
  return `id: ${BOOT}-${event.id}\ndata: ${JSON.stringify({ type: event.type, data: event.data })}\n\n`;
}

function emitEvent(type, data) {
  const event = { id: nextId++, type, data };
  if (data?.callId) traceWrite(data.callId, { type, ...data });
  buffer.push(event);
  if (buffer.length > 400) lastEvictedId = buffer.shift().id;
  if (DEBUG) log('event', type, JSON.stringify(data).slice(0, 200));
  const payload = frameBuild(event);
  for (const r of clients) r.write(payload);
}

function sseHandler(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(':' + ' '.repeat(2048) + '\n');
  res.write('retry: 3000\n\n');
  const last = req.headers['last-event-id'] ?? '';
  const [bootSeen, idRaw] = String(last).split('-');
  const lastId = Number(idRaw);
  if (bootSeen === BOOT && Number.isFinite(lastId) && lastId >= lastEvictedId) {
    for (const e of buffer) if (e.id > lastId) res.write(frameBuild(e));
  } else {
    if (last) res.write(`data: ${JSON.stringify({ type: 'reset', data: {} })}\n\n`);
    for (const e of buffer) res.write(frameBuild(e));
  }
  clients.add(res);
  req.on('close', () => clients.delete(res));
}
setInterval(() => { for (const r of clients) r.write(':hb\n\n'); }, 15000);

// ---- Vapi webhooks ------------------------------------------------------------------
function webhook(body) {
  const m = body.message ?? {};
  const callId = m.call?.id;
  if (!callId) return;
  if (m.type === 'status-update') {
    const s = callState(callId);
    s.listenUrl ??= m.call?.monitor?.listenUrl;
    s.controlUrl ??= m.call?.monitor?.controlUrl;
    s.callType ??= m.call?.type ?? null;
    if (m.status === 'in-progress') {
      traceWrite(callId, {
        type: 'config',
        boot: BOOT,
        settings: { CLIP_MAX_MS, HUME_WAIT_MS, ESCALATE_RULE: 'top mood angry or frustrated, any turns', ESCALATE_TURNS, UPSET_RULE: 'top mood angry or frustrated', MOOD_MIN, MOOD_MARGIN, LLM_MODEL },
        callerRequest: JSON.parse(CALLER_REQUEST),
        agentRequest: JSON.parse(AGENT_REQUEST),
      });
      emitEvent('call-start', { callId, startedAt: Date.now(), callType: s.callType });
      listenConnect(s);
    }
    if (m.status === 'ended') callEnd(s, m.endedReason);
    return;
  }
  if (String(m.type).startsWith('transcript') && m.transcriptType === 'final') {
    const s = callState(callId);
    const role = m.role === 'user' ? 'user' : 'assistant';
    s.transcript.push({ role, text: m.transcript });
    emitEvent('transcript', { callId, role, text: m.transcript });
    return;
  }
  if (m.type === 'end-of-call-report') {
    callEnd(callState(callId), m.endedReason);
  }
}

function callEnd(s, reason) {
  if (s.ended) return;
  s.ended = true;
  try { s.ws?.close(); } catch {}
  emitEvent('call-end', { callId: s.callId, endedReason: reason ?? null });
  setTimeout(() => calls.delete(s.callId), 10 * 60 * 1000);
}

// ---- HTTP ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png' };

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 2_000_000) req.destroy(); // Vapi request bodies are far smaller
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); }
    });
  });
}

// ---- Web call token ---------------------------------------------------------------
// The "Talk to the agent" button needs a Vapi public token. The server mints a
// short-lived JWT restricted to this one assistant and this page's origin, so
// the private key never reaches the browser. Off unless the four variables
// are set. While it is on, anyone who can open the page can start calls on
// your accounts, so turn it off when you are done demoing.
function b64url(str) { return Buffer.from(str).toString('base64url'); }

function webcallTokenMint({ orgId, privateKey, assistantId, origin, ttlSeconds = 3600 }) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    orgId,
    token: {
      tag: 'public',
      restrictions: { enabled: true, allowedAssistantIds: [assistantId], allowedOrigins: [origin], allowTransientAssistant: false },
    },
    iat: now,
    exp: now + ttlSeconds,
  }));
  const signature = createHmac('sha256', privateKey).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function webcallTokenHandler(res) {
  const { VAPI_ORG_ID, VAPI_PRIVATE_KEY, ASSISTANT_ID, PUBLIC_ORIGIN } = process.env;
  if (!VAPI_ORG_ID || !VAPI_PRIVATE_KEY || !ASSISTANT_ID || !PUBLIC_ORIGIN) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Web calling is not configured on this server' }));
    return;
  }
  const token = webcallTokenMint({ orgId: VAPI_ORG_ID, privateKey: VAPI_PRIVATE_KEY, assistantId: ASSISTANT_ID, origin: PUBLIC_ORIGIN });
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ token, assistantId: ASSISTANT_ID }));
}

// GET /traces                 -> list of saved calls, newest first
// GET /traces/<callId>        -> that call's events.ndjson
// GET /traces/<callId>/<file> -> a saved clip (wav)
// Clips are the caller's real voice, so these need ?key=<DEMO_SECRET>.
async function traceHandler(req, res, url) {
  if (!TRACE_DIR) { res.writeHead(404); res.end('tracing is off'); return; }
  if (!secretMatches(url.searchParams.get('key'))) { res.writeHead(401); res.end('unauthorized'); return; }
  const [, , callId, file] = url.pathname.split('/');
  if (!callId) {
    const list = existsSync(TRACE_DIR)
      ? readdirSync(TRACE_DIR).filter((d) => CALL_ID_RE.test(d)).map((d) => {
        const dir = join(TRACE_DIR, d);
        const files = readdirSync(dir);
        return { callId: d, modified: statSync(dir).mtime.toISOString(), clips: files.filter((f) => f.endsWith('.wav')).length };
      }).sort((a, b) => b.modified.localeCompare(a.modified))
      : [];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ dir: TRACE_DIR, calls: list }));
    return;
  }
  if (!CALL_ID_RE.test(callId) || (file && !/^[a-z]+-\d+(-full)?\.wav$/.test(file))) { res.writeHead(400); res.end('bad path'); return; }
  const data = await readFile(join(TRACE_DIR, callId, file ?? 'events.ndjson'));
  res.writeHead(200, { 'content-type': file ? 'audio/wav' : 'application/x-ndjson' });
  res.end(data);
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, boot: BOOT, hume: !!HUME_API_KEY, openai: !!OPENAI_API_KEY, specialist: !!SPECIALIST_NUMBER }));
      return;
    }
    if (url.pathname === '/events') return sseHandler(req, res);
    if (url.pathname === '/traces' || url.pathname.startsWith('/traces/')) return await traceHandler(req, res, url);
    if (url.pathname === '/webcall-token') return webcallTokenHandler(res);
    if (req.method === 'POST' && url.pathname.endsWith('/chat/completions')) {
      if (!authorized(req)) { res.writeHead(401); res.end('unauthorized'); return; }
      const body = await readJson(req);
      if (DEBUG) log('llm body keys', Object.keys(body).join(','), 'call', body.call?.id);
      return chatCompletions(req, res, body);
    }
    if (req.method === 'POST' && url.pathname === '/vapi') {
      if (!authorized(req)) { res.writeHead(401); res.end('unauthorized'); return; }
      const body = await readJson(req);
      if (DEBUG) log('webhook', body.message?.type, body.message?.status ?? '', body.message?.transcriptType ?? '');
      webhook(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    if (req.method === 'POST' && url.pathname === '/reset') {
      buffer.length = 0;
      emitEvent('reset', {});
      res.writeHead(200);
      res.end('{}');
      return;
    }
    const path = normalize(join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!path.startsWith(PUBLIC_DIR.endsWith('/') ? PUBLIC_DIR : PUBLIC_DIR + '/')) { res.writeHead(403); res.end(); return; }
    const data = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    if (!res.headersSent) { res.writeHead(404); res.end('not found'); }
    else log('request error', String(err).slice(0, 160));
  }
}).listen(PORT, () => log(`emotion-aware voice agent on :${PORT}`));

export { SentenceTagger, PALETTE, deliveryChoose, upsetCount, escalationDue };
