import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const statePath = path.join(root, 'state', 'vapi-resources.json');

function loadDotEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function readState() {
  return fs.existsSync(statePath) ? readJson(statePath) : { tools: {}, assistants: {}, simulation: {} };
}

export function writeState(state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

export function apiKey() {
  loadDotEnv();
  if (!process.env.VAPI_API_KEY) throw new Error('VAPI_API_KEY is not set');
  return process.env.VAPI_API_KEY;
}

export async function vapi(method, endpoint, body) {
  const response = await fetch(`https://api.vapi.ai${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let result;
  try { result = text ? JSON.parse(text) : {}; } catch { result = { raw: text }; }
  const expectedStatus = method === 'POST' ? 201 : 200;
  if (!response.ok || response.status !== expectedStatus) {
    throw new Error(`${method} ${endpoint} failed (${response.status}): ${JSON.stringify(result)}`);
  }
  return result;
}

export async function upsert(endpoint, id, payload) {
  return id
    ? vapi('PATCH', `${endpoint}/${id}`, payload)
    : vapi('POST', endpoint, payload);
}

export async function findByExactName(endpoint, name, getName = (resource) => resource.name) {
  const response = await vapi('GET', endpoint);
  const resources = Array.isArray(response) ? response : response.results ?? [];
  const matches = resources.filter((resource) => getName(resource) === name);
  if (matches.length > 1) {
    throw new Error(`Multiple ${endpoint} resources are named "${name}"`);
  }
  return matches[0];
}

export async function syncExact(endpoint, savedId, payload, name, getName) {
  const existing = savedId
    ? await vapi('GET', `${endpoint}/${savedId}`)
    : await findByExactName(endpoint, name, getName);
  const updated = await upsert(endpoint, existing?.id, payload);
  return vapi('GET', `${endpoint}/${updated.id}`);
}

export function syncNamed(endpoint, savedId, payload) {
  return syncExact(endpoint, savedId, payload, payload.name);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
