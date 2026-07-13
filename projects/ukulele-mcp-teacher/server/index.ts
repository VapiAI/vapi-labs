import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { streamSSE } from 'hono/streaming';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod/v4';
import { chordCatalog, chordOptions, type ChordName, type ChordResource } from '../src/chords';
import { chordCardResourceUri, chordToolName } from '../src/mcpContract';
import { mcpSandboxProxyHtml } from '../src/mcpSandboxProxy';
import { renderChordApp } from './chordCardApp';

const app = new Hono();
const chordCardMimeType = RESOURCE_MIME_TYPE;
const hostToolEventSubscribers = new Set<(event: HostToolEvent) => void>();

type HostToolEvent = {
  type: typeof chordToolName;
  chord: ChordName;
  at: string;
  result: ChordToolResult;
};

type ChordToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: ChordResource;
  _meta: {
    ui: { resourceUri: string };
  };
};

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'mcp-session-id', 'Last-Event-ID', 'mcp-protocol-version'],
  exposeHeaders: ['mcp-session-id', 'mcp-protocol-version'],
}));

app.all('/mcp', async (c) => {
  traceServerFlow('mcp-http-request', { method: c.req.method });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createMcpServer();
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

app.get('/vapi-tool-events', (c) =>
  streamSSE(c, async (stream) => {
    traceServerFlow('host-events-connect');
    const subscriber = (event: HostToolEvent) => {
      traceServerFlow('host-events-send', { chord: event.chord, subscribers: hostToolEventSubscribers.size });
      void stream.writeSSE({
        event: 'chord-tool',
        data: JSON.stringify(event),
      }).catch(() => {
        hostToolEventSubscribers.delete(subscriber);
      });
    };

    hostToolEventSubscribers.add(subscriber);
    await stream.writeSSE({ event: 'ready', data: '{}' });

    const heartbeat = setInterval(() => {
      void stream.writeSSE({ event: 'heartbeat', data: '{}' }).catch(() => {
        clearInterval(heartbeat);
        hostToolEventSubscribers.delete(subscriber);
      });
    }, 15000);

    await new Promise<void>((resolve) => {
      c.req.raw.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    traceServerFlow('host-events-disconnect');
    clearInterval(heartbeat);
    hostToolEventSubscribers.delete(subscriber);
  }),
);

app.get('/mcp-sandbox-proxy', (c) =>
  c.html(mcpSandboxProxyHtml, 200, {
    'Cache-Control': 'public, max-age=3600',
    'Content-Security-Policy': [
      "default-src 'none'",
      "script-src 'unsafe-inline'",
      "style-src 'unsafe-inline'",
      "frame-src 'self' about:",
      "base-uri 'none'",
    ].join('; '),
  }),
);

function createMcpServer() {
  const server = new McpServer({
    name: 'ukulele-practice-mcp',
    version: '0.1.0',
  });

  registerAppResource(
    server,
    'Ukulele chord card',
    chordCardResourceUri,
    {
      description: 'MCP Apps UI template for rendering a ukulele chord practice card.',
    },
    async () => ({
      contents: [
        {
          uri: chordCardResourceUri,
          mimeType: chordCardMimeType,
          text: renderChordApp(),
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                connectDomains: [],
                resourceDomains: [],
              },
            },
          },
        },
      ],
    }),
  );

  registerAppTool(
    server,
    chordToolName,
    {
      title: 'Show ukulele chord',
      description:
        'Show an MCP Apps chord card for the requested ukulele chord. Call this before asking the learner to play.',
      inputSchema: {
        chord: z.enum(chordOptions).describe('The ukulele chord to show.'),
      },
      outputSchema: chordResourceSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      _meta: {
        ui: {
          resourceUri: chordCardResourceUri,
          visibility: ['model', 'app'],
        },
      },
    },
    async ({ chord }) => {
      traceServerFlow('tool-call-received', { chord });
      const data = chordCatalog[chord];
      const result: ChordToolResult = {
        content: [
          {
            type: 'text',
            text: `${data.title} visual chord card is displayed. The browser app will speak the next practice instruction through Vapi.`,
          },
        ],
        structuredContent: data,
        _meta: {
          ui: { resourceUri: chordCardResourceUri },
        },
      };
      publishHostToolEvent(result);
      traceServerFlow('tool-call-returning', { chord: data.name });

      return result;
    },
  );

  return server;
}

function publishHostToolEvent(result: ChordToolResult) {
  const event: HostToolEvent = {
    type: chordToolName,
    chord: result.structuredContent.name,
    at: new Date().toISOString(),
    result,
  };

  traceServerFlow('host-events-publish', {
    chord: event.chord,
    subscribers: hostToolEventSubscribers.size,
  });
  for (const subscriber of hostToolEventSubscribers) {
    subscriber(event);
  }
}

function traceServerFlow(event: string, details: Record<string, unknown> = {}) {
  if (process.env.DEBUG_UKULELE_FLOW !== '1') return;

  console.info('[ukulele-flow-server]', JSON.stringify({
    at: new Date().toISOString(),
    event,
    ...details,
  }));
}

const chordResourceSchema = z.object({
  name: z.enum(chordOptions),
  title: z.string(),
  frets: z.array(z.number()),
  fingers: z.array(z.string()),
  notes: z.array(z.string()),
  tip: z.string(),
  previous: z.enum(chordOptions),
  next: z.enum(chordOptions),
});

const port = Number(process.env.MCP_PORT ?? 8787);
serve({
  port,
  fetch: app.fetch,
});

console.log(`Ukulele MCP demo server listening on http://localhost:${port}`);
