import fs from 'node:fs';
import path from 'node:path';
import { root, readJson } from './lib.mjs';

const assistantRoot = path.join(root, 'assistants');
const conditions = fs.readdirSync(assistantRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const expected = ['personality-first', 'rigid-sop', 'voice-native'];
if (JSON.stringify(conditions) !== JSON.stringify(expected)) {
  throw new Error(`Expected exactly ${expected.join(', ')}; found ${conditions.join(', ')}`);
}

const configs = conditions.map((condition) => {
  const dir = path.join(assistantRoot, condition);
  const config = readJson(path.join(dir, 'assistant.json'));
  const prompt = path.join(dir, config.systemPromptFile);
  if (!fs.existsSync(prompt) || !fs.readFileSync(prompt, 'utf8').trim()) {
    throw new Error(`${condition} has no readable system prompt`);
  }
  if (!config.name || !config.firstMessage || !config.model?.provider ||
      !config.model?.model || !config.voice?.provider || !config.voice?.voiceId ||
      !config.transcriber?.provider || !config.transcriber?.model) {
    throw new Error(`${condition} is missing a required assistant setting`);
  }
  if (config.voice.provider === 'vapi' && config.voice.version !== 2) {
    throw new Error(`${condition} must use Vapi voice version 2`);
  }
  return config;
});

const withoutDifferences = (config) => {
  const copy = structuredClone(config);
  delete copy.name;
  delete copy.systemPromptFile;
  return copy;
};
const shared = JSON.stringify(withoutDifferences(configs[0]));
for (let index = 1; index < configs.length; index += 1) {
  if (JSON.stringify(withoutDifferences(configs[index])) !== shared) {
    throw new Error(`${conditions[index]} differs in non-prompt assistant configuration`);
  }
}

const toolFiles = [
  'tools/check-table-availability.code-tool.json',
  'tools/create-restaurant-reservation.code-tool.json',
];
const toolConfigs = toolFiles.map((file) => readJson(path.join(root, file)));
const expectedToolNames = ['check_table_availability', 'create_restaurant_reservation'];
for (let index = 0; index < toolConfigs.length; index += 1) {
  const tool = toolConfigs[index];
  if (tool.type !== 'code' || tool.function?.name !== expectedToolNames[index] ||
      tool.function?.strict !== true || tool.function?.parameters?.type !== 'object' ||
      !tool.code?.trim()) {
    throw new Error(`${toolFiles[index]} is not a complete strict Vapi Code Tool`);
  }
}

const executeCodeTool = (tool, args) => Function('args', tool.code)(args);
const availableResult = executeCodeTool(toolConfigs[0], {
  reservationDate: '2026-08-28',
  requestedTime: '20:00',
  partySize: 6,
});
const unavailableResult = executeCodeTool(toolConfigs[0], {
  reservationDate: '2026-08-28',
  requestedTime: '19:30',
  partySize: 6,
});
const invalidDateResult = executeCodeTool(toolConfigs[0], {
  reservationDate: '2026-02-30',
  requestedTime: '20:00',
  partySize: 6,
});
if (availableResult.available !== true ||
    unavailableResult.available !== false ||
    JSON.stringify(unavailableResult.alternatives) !== JSON.stringify(['18:45', '20:00']) ||
    invalidDateResult.error !== 'missing_or_invalid_required_information') {
  throw new Error('Availability Code Tool does not implement the documented fixture');
}

const confirmedResult = executeCodeTool(toolConfigs[1], {
  reservationDate: '2026-08-28',
  reservationTime: '20:00',
  partySize: 6,
  guestName: 'Simulation Guest',
  phoneNumber: '+14155550130',
  occasion: 'Birthday',
  seatingNeeds: 'Stroller',
  allergyNotes: 'Shellfish allergy',
});
const unavailableBookingResult = executeCodeTool(toolConfigs[1], {
  reservationDate: '2026-08-28',
  reservationTime: '19:30',
  partySize: 6,
  guestName: 'Simulation Guest',
  phoneNumber: '+14155550130',
  occasion: '',
  seatingNeeds: '',
  allergyNotes: '',
});
const invalidBookingResult = executeCodeTool(toolConfigs[1], {
  reservationDate: '2026-08-28',
  reservationTime: '25:00',
  partySize: 6,
  guestName: 'Simulation Guest',
  phoneNumber: '+14155550130',
  occasion: '',
  seatingNeeds: '',
  allergyNotes: '',
});
if (confirmedResult.status !== 'confirmed' ||
    unavailableBookingResult.reason !== 'slot_not_available' ||
    invalidBookingResult.reason !== 'missing_or_invalid_required_information') {
  throw new Error('Reservation Code Tool does not enforce the documented fixture');
}

const simulation = readJson(path.join(root, 'simulations/config.json'));
if (!simulation.personality?.assistant?.name ||
    !simulation.scenario?.name ||
    !simulation.simulation?.name ||
    !simulation.suite?.name) {
  throw new Error('Simulation resources must include exact reusable names');
}
if (simulation.study.iterationsPerAssistant !== 1) {
  throw new Error('The introductory simulation must default to one iteration');
}
if (JSON.stringify(simulation.study.assistantOrder) !== JSON.stringify(expected)) {
  throw new Error('Simulation assistant order must match the three conditions');
}
if (!simulation.study.name || !simulation.study.purpose) {
  throw new Error('The simulation study needs a name and purpose');
}

const approvedDate = simulation.study.approvedDate;
if (typeof approvedDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(approvedDate)) {
  throw new Error('study.approvedDate must use YYYY-MM-DD format');
}
const approvedDateValue = new Date(`${approvedDate}T00:00:00.000Z`);
if (Number.isNaN(approvedDateValue.getTime()) ||
    approvedDateValue.toISOString().slice(0, 10) !== approvedDate) {
  throw new Error('study.approvedDate is not a valid calendar date');
}
const calendarDateLabel = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
}).format(approvedDateValue);
const weekdayDateLabel = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
}).format(approvedDateValue);
if (!simulation.scenario.instructions.includes('next Friday') ||
    !simulation.scenario.instructions.includes(weekdayDateLabel)) {
  throw new Error(`Scenario opening and intent must agree with ${weekdayDateLabel}`);
}
if (!simulation.scenario.evaluations?.length) {
  throw new Error('The simulation scenario needs at least one evaluation');
}
for (const evaluation of simulation.scenario.evaluations ?? []) {
  if (!evaluation.structuredOutput || evaluation.structuredOutputId) {
    throw new Error('Each evaluation must use one inline structured output');
  }
  if (evaluation.structuredOutput.schema?.type !== 'boolean' ||
      typeof evaluation.value !== 'boolean' ||
      evaluation.comparator !== '=' ||
      evaluation.required !== true) {
    throw new Error(`${evaluation.structuredOutput.name} is not a required Boolean equality`);
  }
}

for (const name of ['date_resolved_before_check', 'final_slot_checked']) {
  const evaluation = simulation.scenario.evaluations.find(
    (candidate) => candidate.structuredOutput?.name === name,
  );
  if (!evaluation?.structuredOutput?.description?.includes(calendarDateLabel)) {
    throw new Error(`${name} must agree with approved date ${calendarDateLabel}`);
  }
}

const businessContext = fs.readFileSync(path.join(root, 'docs', 'business-context.md'), 'utf8');
if (!businessContext.includes(approvedDate) || !businessContext.includes(weekdayDateLabel)) {
  throw new Error('Business context must document the approved simulation date');
}

console.log('Validated three assistants and one introductory Vapi simulation suite.');
