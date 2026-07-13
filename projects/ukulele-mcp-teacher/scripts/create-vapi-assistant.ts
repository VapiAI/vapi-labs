import dotenv from 'dotenv';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { teacherSystemPrompt } from '../src/teacherPrompt';
import { vapiClientMessages } from '../src/vapiConfig';
import { chordToolName } from '../src/mcpContract';

dotenv.config({ quiet: true });
dotenv.config({ path: '.env.local', override: true, quiet: true });

const dryRun = process.argv.includes('--dry-run');
const updateExisting = process.argv.includes('--update');
const assistantName = 'Ukulele MCP Teacher';
const mcpToolFunctionName = 'ukulelePracticeTools';

type AssistantConfig = {
  name: string;
  interruptionsEnabled: boolean;
  firstMessageInterruptionsEnabled: boolean;
  model: {
    provider: string;
    model: string;
    temperature: number;
    maxTokens: number;
    messages: Array<{ role: 'system'; content: string }>;
    tools: Array<Record<string, unknown>>;
    toolIds?: string[];
  };
  voice: Record<string, unknown>;
  transcriber: {
    provider: string;
    model: string;
    language: string;
  };
  monitorPlan: {
    controlEnabled: boolean;
  };
  firstMessageMode: 'assistant-speaks-first';
  firstMessage: string;
  clientMessages: string[];
};

if (dryRun) {
  const mcpServerUrl = requireMcpServerUrl();
  const configuredToolId = process.env.VAPI_MCP_TOOL_ID?.trim();
  const config = assistantConfigBuild(configuredToolId || undefined);
  console.log(JSON.stringify({
    mcpTool: mcpToolPayloadBuild(mcpServerUrl),
    assistant: config,
  }, null, 2));
  process.exit(0);
}

const apiKey = requireApiKey();
requirePublicKey();
const mcpServerUrl = requireMcpServerUrl();
const assistantId = updateExisting ? existingAssistantId() : null;
const mcpToolId = await dashboardMcpToolIdEnsure(apiKey, mcpServerUrl);
const config = assistantConfigBuild(mcpToolId);
const response = await fetch(
  assistantId ? `https://api.vapi.ai/assistant/${assistantId}` : 'https://api.vapi.ai/assistant',
  {
    method: assistantId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  },
);

const responseText = await response.text();
if (!response.ok) {
  console.error(`Vapi assistant ${assistantId ? 'update' : 'creation'} failed (${response.status}):`);
  console.error(responseText);
  process.exit(1);
}

const assistant = JSON.parse(responseText) as { id?: string; name?: string };
if (!assistant.id) {
  console.error('Vapi returned a response without an assistant id:');
  console.error(responseText);
  process.exit(1);
}

writeViteEnv(assistant.id, mcpToolId);

console.log(`${assistantId ? 'Updated' : 'Created'} Vapi assistant: ${assistant.name ?? config.name}`);
console.log(`Assistant ID: ${assistant.id}`);
console.log(`MCP Tool ID: ${mcpToolId}`);
console.log('Wrote VITE_VAPI_ASSISTANT_ID to .env.local.');

function assistantConfigBuild(mcpToolId?: string): AssistantConfig {
  return {
    name: assistantName,
    interruptionsEnabled: true,
    firstMessageInterruptionsEnabled: true,
    model: {
      provider: 'openai',
      model: 'gpt-4.1',
      temperature: 0.4,
      maxTokens: 180,
      messages: [
        {
          role: 'system',
          content: teacherSystemPrompt,
        },
      ],
      tools: [endPracticeToolConfigBuild()],
      ...(mcpToolId ? { toolIds: [mcpToolId] } : {}),
    },
    voice: {
      provider: 'vapi',
      voiceId: 'Elliot',
      version: 2,
    },
    transcriber: {
      provider: 'deepgram',
      model: 'flux-general-en',
      language: 'en',
    },
    monitorPlan: {
      controlEnabled: true,
    },
    firstMessageMode: 'assistant-speaks-first',
    firstMessage: 'Welcome, what shall we practice today?',
    clientMessages: [...vapiClientMessages],
  };
}

function endPracticeToolConfigBuild(): Record<string, unknown> {
  return {
    type: 'function',
    async: true,
    function: {
      name: 'end_practice_session',
      description:
        'End the hands-free ukulele practice session only after the learner confirms they want to stop.',
      parameters: {
        type: 'object',
        properties: {
          confirmation: {
            type: 'string',
            enum: ['confirmed'],
            description:
              'Must be "confirmed", and only after the learner explicitly confirms they want to end practice.',
          },
        },
        required: ['confirmation'],
        additionalProperties: false,
      },
    },
    messages: [
      {
        type: 'request-start',
        content: 'Ending practice. Nice work today.',
        blocking: false,
      },
    ],
  };
}

async function dashboardMcpToolIdEnsure(apiKey: string, mcpServerUrl: string) {
  const configuredToolId = process.env.VAPI_MCP_TOOL_ID?.trim();
  const toolPayload = mcpToolPayloadBuild(mcpServerUrl);
  const toolUpdatePayload = mcpToolConfigBuild(mcpServerUrl);

  if (configuredToolId) {
    const updatedTool = await vapiFetch<{ id?: string }>(`/tool/${configuredToolId}`, apiKey, {
      method: 'PATCH',
      body: JSON.stringify(toolUpdatePayload),
    });
    if (!updatedTool.id) throw new Error('Vapi returned an updated MCP tool without an id.');
    return updatedTool.id;
  }

  const tools = await vapiFetch<Array<{ id?: string; type?: string; server?: { url?: string } }>>('/tool', apiKey);
  const existingTool = tools.find((tool) => tool.type === 'mcp' && tool.server?.url === mcpServerUrl);
  if (existingTool?.id) {
    const updatedTool = await vapiFetch<{ id?: string }>(`/tool/${existingTool.id}`, apiKey, {
      method: 'PATCH',
      body: JSON.stringify(toolUpdatePayload),
    });
    if (!updatedTool.id) throw new Error('Vapi returned an updated MCP tool without an id.');
    return updatedTool.id;
  }

  const createdTool = await vapiFetch<{ id?: string }>('/tool', apiKey, {
    method: 'POST',
    body: JSON.stringify(toolPayload),
  });

  if (!createdTool.id) {
    console.error('Vapi returned a tool response without an id.');
    process.exit(1);
  }

  return createdTool.id;
}

function mcpToolPayloadBuild(mcpServerUrl: string) {
  return {
    type: 'mcp',
    ...mcpToolConfigBuild(mcpServerUrl),
  };
}

function mcpToolConfigBuild(mcpServerUrl: string) {
  return {
    function: {
      name: mcpToolFunctionName,
    },
    messages: [silentToolStartMessage()],
    server: {
      url: mcpServerUrl,
    },
    toolMessages: [
      {
        name: chordToolName,
        messages: [silentToolStartMessage()],
      },
    ],
  };
}

function requireMcpServerUrl() {
  const mcpServerUrl = process.env.VAPI_MCP_SERVER_URL?.trim();
  if (!mcpServerUrl) {
    console.error('Missing VAPI_MCP_SERVER_URL. Expose the local MCP server over HTTPS, set VAPI_MCP_SERVER_URL to that /mcp endpoint, then rerun this command.');
    process.exit(1);
  }

  let url: URL;
  try {
    url = new URL(mcpServerUrl);
  } catch {
    console.error('Invalid VAPI_MCP_SERVER_URL. Provide a complete public HTTPS URL ending in /mcp.');
    process.exit(1);
  }

  if (url.protocol !== 'https:' || !url.pathname.endsWith('/mcp')) {
    console.error('Invalid VAPI_MCP_SERVER_URL. The URL must use HTTPS and its path must end in /mcp.');
    process.exit(1);
  }

  return url.toString();
}

function requirePublicKey() {
  const publicKey = process.env.VITE_VAPI_PUBLIC_KEY?.trim();
  if (publicKey) return publicKey;

  console.error('Missing VITE_VAPI_PUBLIC_KEY. Add your Vapi public web key to .env before running this command.');
  process.exit(1);
}

function silentToolStartMessage() {
  return {
    type: 'request-start',
    content: '',
    blocking: false,
  };
}

async function vapiFetch<T>(path: string, apiKey: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.vapi.ai${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Vapi request failed (${response.status}): ${responseText}`);
  }

  return (responseText ? JSON.parse(responseText) : null) as T;
}

function requireApiKey() {
  const apiKey = process.env.VAPI_API_KEY?.trim();
  if (apiKey) return apiKey;

  console.error('Missing VAPI_API_KEY. Add your private Vapi API key to .env before running assistant:create or assistant:update.');
  process.exit(1);
}

function writeViteEnv(assistantId: string, mcpToolId?: string | null) {
  const envLocalPath = resolve(process.cwd(), '.env.local');
  const existing = existsSync(envLocalPath) ? readFileSync(envLocalPath, 'utf8') : '';
  const lines = [
    `VITE_VAPI_ASSISTANT_ID=${assistantId}`,
    mcpToolId ? `VAPI_MCP_TOOL_ID=${mcpToolId}` : null,
    publicKeyLine(),
  ].filter((line): line is string => Boolean(line));

  if (!existing) {
    writeFileSync(envLocalPath, `${lines.join('\n')}\n`);
    return;
  }

  let next = existing;
  for (const line of lines) {
    const key = line.split('=')[0];
    const regex = new RegExp(`^${key}=.*`, 'm');
    if (next.match(regex)) {
      next = next.replace(regex, line);
    } else {
      next += `${next.endsWith('\n') ? '' : '\n'}${line}\n`;
    }
  }

  writeFileSync(envLocalPath, next);
}

function publicKeyLine() {
  const publicKey = process.env.VITE_VAPI_PUBLIC_KEY;
  return publicKey ? `VITE_VAPI_PUBLIC_KEY=${publicKey}` : null;
}

function existingAssistantId() {
  const fromEnv = process.env.VITE_VAPI_ASSISTANT_ID?.trim();
  if (fromEnv) return fromEnv;

  const envLocalPath = resolve(process.cwd(), '.env.local');
  const existing = existsSync(envLocalPath) ? readFileSync(envLocalPath, 'utf8') : '';
  const match = existing.match(/^VITE_VAPI_ASSISTANT_ID=(.+)$/m);
  const assistantId = match?.[1]?.trim();
  if (!assistantId) {
    console.error('Missing VITE_VAPI_ASSISTANT_ID. Run assistant:create before assistant:update.');
    process.exit(1);
  }

  return assistantId;
}
