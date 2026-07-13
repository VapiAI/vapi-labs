import type { ChordName, ToolResult, UiResource } from './types';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { chordToolName, resourceMimeType } from './mcpContract';

export { resourceMimeType } from './mcpContract';

const uiExtensionId = 'io.modelcontextprotocol/ui';
let clientPromise: Promise<Client> | null = null;
const uiResourcePromises = new Map<string, Promise<UiResource>>();

export async function showUkuleleChord(chord: ChordName): Promise<ToolResult> {
  const client = await mcpClient();
  const result = await client.callTool({
    name: chordToolName,
    arguments: { chord },
  });

  return result as ToolResult;
}

export async function readUiResource(resourceUri: string): Promise<UiResource> {
  const cachedResource = uiResourcePromises.get(resourceUri);
  if (cachedResource) return cachedResource;

  const resourcePromise = fetchUiResource(resourceUri).catch((error) => {
    uiResourcePromises.delete(resourceUri);
    throw error;
  });
  uiResourcePromises.set(resourceUri, resourcePromise);
  return resourcePromise;
}

async function fetchUiResource(resourceUri: string): Promise<UiResource> {
  const client = await mcpClient();
  const result = await client.readResource({ uri: resourceUri });

  return {
    contents: result.contents.map((content) => {
      if (!('text' in content)) {
        throw new Error(`MCP UI resource ${content.uri} did not return text content.`);
      }

      if (content.mimeType !== resourceMimeType) {
        throw new Error(`MCP UI resource ${content.uri} returned unsupported MIME type ${content.mimeType ?? 'unknown'}.`);
      }

      return {
        uri: content.uri,
        mimeType: resourceMimeType,
        text: content.text,
      };
    }),
  };
}

async function mcpClient() {
  clientPromise ??= createMcpClient();
  return clientPromise;
}

async function createMcpClient() {
  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
  ]);
  const client = new Client(
    {
      name: 'ukulele-browser-mcp-apps-host',
      version: '0.1.0',
    },
    {
      capabilities: {
        extensions: {
          [uiExtensionId]: {
            mimeTypes: [resourceMimeType],
          },
        },
      } as never,
    },
  );

  const transport = new StreamableHTTPClientTransport(
    new URL('/mcp', window.location.origin),
  );
  await client.connect(transport);

  return client;
}
