import type { ChordResource } from './chords';

export type { ChordName } from './chords';

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: ChordResource;
  _meta: {
    ui: {
      resourceUri: string;
    };
  };
};

export type UiResource = {
  contents: Array<{
    uri: string;
    mimeType: 'text/html;profile=mcp-app';
    text: string;
  }>;
};

export type AttemptResult = {
  verdict: 'idle' | 'listening' | 'correct' | 'almost' | 'missed';
  confidence: number;
  detectedNotes: string[];
  message: string;
  listenId?: number;
};
