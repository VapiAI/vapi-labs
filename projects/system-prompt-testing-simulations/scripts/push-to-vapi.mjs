import fs from 'node:fs';
import path from 'node:path';
import { root, statePath, readJson, readState, writeState, syncExact } from './lib.mjs';

const state = readState();
state.tools ??= {};
state.assistants ??= {};

const tools = [
  ['checkTableAvailability', 'tools/check-table-availability.code-tool.json'],
  ['createRestaurantReservation', 'tools/create-restaurant-reservation.code-tool.json'],
];

for (const [key, relativePath] of tools) {
  const payload = readJson(path.join(root, relativePath));
  const toolName = payload.function?.name;
  if (!toolName) throw new Error(`${relativePath} has no function name`);
  const response = await syncExact(
    '/tool',
    state.tools[key]?.id,
    payload,
    toolName,
    (resource) => resource.type === payload.type
      ? resource.function?.name ?? resource.name
      : undefined,
  );
  if (!response.id) throw new Error(`Vapi returned no ID for ${key}`);
  state.tools[key] = { id: response.id };
  writeState(state);
  console.log(`${key}: ${response.id}`);
}

const toolIds = tools.map(([key]) => state.tools[key].id);
for (const condition of ['personality-first', 'rigid-sop', 'voice-native']) {
  const dir = path.join(root, 'assistants', condition);
  const source = readJson(path.join(dir, 'assistant.json'));
  const systemPromptFile = source.systemPromptFile;
  delete source.systemPromptFile;
  source.model = {
    ...source.model,
    toolIds,
    messages: [{ role: 'system', content: fs.readFileSync(path.join(dir, systemPromptFile), 'utf8') }],
  };
  const response = await syncExact(
    '/assistant',
    state.assistants[condition]?.id,
    source,
    source.name,
  );
  if (!response.id) throw new Error(`Vapi returned no ID for ${condition}`);
  state.assistants[condition] = { id: response.id, name: response.name ?? source.name };
  writeState(state);
  console.log(`${condition}: ${response.id}`);
}

console.log(`Saved deployment IDs to ${path.relative(root, statePath)}`);
