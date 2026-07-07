/**
 * Live config verification — checks phone routing, squad membership, DISTINCT
 * per-member voices, uniform Deepgram transcriber + barge-in, transferCall
 * presence, that no duplicate assistant names exist, and that the squad does
 * NOT pin a single voice via membersOverrides (which would collapse all members
 * to one voice).
 *
 *   npm run test:verify
 */
import { vapi } from "../config.js";
import { header } from "../utils/print.js";

header("Meridian — live config verification");

const SQUAD_NAME = "Meridian Concierge Squad";

// Squad members resolved by NAME (ids change on recreate; names are the contract).
const MEMBER_NAMES = [
  "Meridian — Concierge",
  "Meridian — Hotel Concierge (Jack)",
  "Meridian — Flight Triage",
  "Meridian — Rebooking",
  "Meridian — Upsell & Recovery",
];

let failures = 0;
function ok(label: string) { console.log(`  ✓ ${label}`); }
function fail(label: string) { console.log(`  ✗ ${label}`); failures++; }

// ── 0. Resolve the squad by name ──────────────────────────────────────────────
const squads = await vapi.squads.list({ limit: 100 });
const squadMatch = squads.find((s) => s.name === SQUAD_NAME);
if (!squadMatch) {
  console.log(`✗ Squad "${SQUAD_NAME}" not found — run \`npm run squad\` first.`);
  process.exit(1);
}
const SQUAD_ID = squadMatch.id;

// ── 1. Phone number → squad (skipped if no phone number points at the squad) ──
console.log(`\n── Phone number ──`);
const phones = await vapi.phoneNumbers.list();
const phone = phones.find((p) => (p as unknown as Record<string, unknown>)["squadId"] === SQUAD_ID);
if (phone) ok(`${(phone as { number?: string }).number ?? phone.id} → ${SQUAD_NAME}`);
else console.log(`  – no phone number routes to the squad yet (attach one in the dashboard to take live calls)`);

// ── 2. No duplicate assistant names ───────────────────────────────────────────
const allAssistants = await vapi.assistants.list({ limit: 100 });
console.log(`\n── Duplicate-name check ──`);
const byName = new Map<string, string[]>();
for (const a of allAssistants) {
  if (!a.name?.startsWith("Meridian")) continue;
  byName.set(a.name, [...(byName.get(a.name) ?? []), a.id]);
}
for (const [name, ids] of byName) {
  if (ids.length > 1) fail(`duplicate name "${name}" → ${ids.join(", ")} (delete the stale one)`);
}
if (![...byName.values()].some((ids) => ids.length > 1)) ok("all Meridian assistant names are unique");

// ── 3. Squad membership (by name) ─────────────────────────────────────────────
const squad = await vapi.squads.get({ id: SQUAD_ID });
console.log(`\n── Squad: "${squad.name}" (${squad.members.length} members) ──`);
const idToName = new Map(allAssistants.map((a) => [a.id, a.name ?? ""]));
const memberNames = new Set(squad.members.map((m) => idToName.get((m as { assistantId: string }).assistantId) ?? "?"));
for (const name of MEMBER_NAMES) {
  memberNames.has(name) ? ok(name) : fail(`"${name}" missing from squad (members: ${[...memberNames].join(", ")})`);
}

// ── 4. Squad must NOT pin a single voice ──────────────────────────────────────
console.log(`\n── membersOverrides ──`);
const mo = (squad as Record<string, any>).membersOverrides ?? {};
if (mo.voice) fail(`membersOverrides.voice=${JSON.stringify(mo.voice)} pins ONE voice across all members — remove it`);
else ok("membersOverrides has no voice pin (members keep distinct voices)");
const moWords = mo.stopSpeakingPlan?.numWords ?? 0;
moWords >= 5 ? ok(`membersOverrides.stopSpeakingPlan.numWords=${moWords}`) : fail(`membersOverrides barge-in numWords=${moWords} (want ≥5)`);

// ── 5. Per-assistant: voice, transcriber, barge-in, transferCall ──────────────
const meridian = allAssistants.filter((a) => a.name?.startsWith("Meridian —"));
console.log(`\n── Assistant configs (${meridian.length} found) ──`);
const memberVoices: Record<string, string> = {};
for (const a of meridian) {
  const name = a.name ?? a.id;
  const voice = a.voice as { provider?: string; voiceId?: string } | undefined;
  const transcriber = a.transcriber as { provider?: string } | undefined;
  const ssp = a.stopSpeakingPlan as { numWords?: number } | undefined;
  const tools = ((a.model as { tools?: Array<{ type: string }> } | undefined)?.tools) ?? [];
  const hasTransfer = tools.some((t) => t.type === "transferCall");
  const isOutbound = name === "Meridian — Outbound Disruption";

  const voiceOk = voice?.provider === "deepgram" && !!voice?.voiceId;
  const transcriberOk = transcriber?.provider === "deepgram";
  const sspOk = (ssp?.numWords ?? 0) >= 5;
  const transferOk = isOutbound ? !hasTransfer : hasTransfer;

  if (voiceOk && transcriberOk && sspOk && transferOk) ok(`${name}  [${voice?.voiceId}]`);
  else console.log(`  ✗ ${name}`);
  if (!voiceOk) fail(`  voice: ${voice?.provider}/${voice?.voiceId} (want deepgram/<id>)`);
  if (!transcriberOk) fail(`  transcriber: ${transcriber?.provider ?? "none"} (want deepgram)`);
  if (!sspOk) fail(`  stopSpeakingPlan.numWords=${ssp?.numWords ?? "none"} (want ≥5)`);
  if (!transferOk) fail(`  transferCall ${hasTransfer ? "present" : "absent"} (${isOutbound ? "outbound should NOT have it" : "should be present"})`);

  if (MEMBER_NAMES.includes(name) && voice?.voiceId) memberVoices[name] = voice.voiceId;
}

// ── 6. The five squad members must have DISTINCT voices ───────────────────────
console.log(`\n── Distinct member voices ──`);
const voiceList = Object.values(memberVoices);
const uniqueVoices = new Set(voiceList);
if (voiceList.length === MEMBER_NAMES.length && uniqueVoices.size === voiceList.length) {
  ok(`5 distinct voices: ${MEMBER_NAMES.map((n) => `${n.replace("Meridian — ", "")}=${memberVoices[n]}`).join(", ")}`);
} else {
  fail(`voices not all distinct: ${JSON.stringify(memberVoices)}`);
}

console.log(`\n${failures === 0 ? "✓ All checks passed — config looks correct." : `✗ ${failures} check(s) failed — see above.`}`);
process.exit(failures === 0 ? 0 : 1);
