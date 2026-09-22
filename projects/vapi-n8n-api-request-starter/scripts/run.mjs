import { readFile } from 'node:fs/promises';

const key = process.env.VAPI_API_KEY;
const webhookUrl = process.env.N8N_WEBHOOK_URL;

if (!key || !webhookUrl) {
  console.error('Set VAPI_API_KEY and N8N_WEBHOOK_URL before running this demo.');
  process.exit(1);
}

let parsedUrl;
try {
  parsedUrl = new URL(webhookUrl);
} catch {
  console.error('N8N_WEBHOOK_URL must be an HTTPS production webhook URL.');
  process.exit(1);
}

if (parsedUrl.protocol !== 'https:' || !parsedUrl.pathname.includes('/webhook/')) {
  console.error('N8N_WEBHOOK_URL must be an HTTPS production webhook URL.');
  process.exit(1);
}

const tool = JSON.parse(await readFile(new URL('../vapi/api-request-tool.json', import.meta.url)));
const assistant = JSON.parse(await readFile(new URL('../vapi/assistant.json', import.meta.url)));
tool.url = webhookUrl;
assistant.model.tools = [tool, { type: 'endCall', function: { name: 'end_completed_call' } }];

const preflight = await fetch(webhookUrl, { signal: AbortSignal.timeout(15000) });
if (!preflight.ok) {
  throw new Error(`n8n production webhook returned HTTP ${preflight.status}.`);
}

const hours = await preflight.json();
if (typeof hours.openNow !== 'boolean' || typeof hours.localTime !== 'string') {
  throw new Error('n8n webhook response is missing openNow or localTime.');
}
console.log(`n8n webhook OK: ${hours.openNow ? 'open' : 'closed'} at ${hours.localTime} (${hours.timeZone}).`);

const response = await fetch('https://api.vapi.ai/chat', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    assistant,
    input: 'Are you open right now? Please check before answering.',
  }),
  signal: AbortSignal.timeout(30000),
});

const result = await response.json();
if (!response.ok) {
  throw new Error(`Vapi chat returned HTTP ${response.status}: ${JSON.stringify(result).slice(0, 500)}`);
}

const toolResult = result.output?.find(({ role }) => role === 'tool');
if (!toolResult?.content) {
  throw new Error('Vapi did not return an API Request tool result.');
}

let liveHours;
try {
  liveHours = JSON.parse(toolResult.content);
} catch {
  throw new Error('Vapi tool result was not JSON.');
}
if (typeof liveHours.openNow !== 'boolean' || typeof liveHours.checkedAt !== 'string') {
  throw new Error('Vapi tool result did not contain the n8n business-hours response.');
}

const answer = result.output?.filter(({ role, content }) => role === 'assistant' && content)
  .at(-1)?.content;
if (!answer) {
  throw new Error('Vapi chat returned no assistant answer.');
}

console.log(`Vapi API Request confirmed: ${liveHours.checkedAt}.`);
console.log(`Vapi answer: ${answer}`);
console.log(`Chat ID: ${result.id}`);
