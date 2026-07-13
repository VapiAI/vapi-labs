# Ukulele MCP Teacher

Ukulele MCP Teacher is a hands-free practice app for the beginner ukulele chords `C`, `Am`, `F`, `G`, and `G7`. A learner talks to a Vapi assistant, sees chord cards served by a local MCP server, strums into the browser microphone, and receives immediate coaching.

## Quick Start

### Prerequisites

- Node.js 20.19 or newer
- npm
- A modern browser with microphone access
- A Vapi account with a private API key and public web key
- [ngrok](https://ngrok.com/) or another HTTPS tunnel

Get both public and private Vapi keys from **[Vapi Dashboard](https://dashboard.vapi.ai) → profile menu → Vapi API Keys**. 

### 1. Install and configure

```bash
npm install
cp .env.example .env
```

Add your keys to `.env`:

```text
VAPI_API_KEY=
VITE_VAPI_PUBLIC_KEY=
VAPI_MCP_SERVER_URL=
```
### 2. Start the app and MCP server

```bash
npm run dev
```

This starts the browser app at `http://localhost:5173` and the MCP server at `http://localhost:8787`.

### 3. Expose the MCP server

In a second terminal:

```bash
ngrok http 8787
```

Copy the public HTTPS URL into `.env`, including the `/mcp` path:

```text
VAPI_MCP_SERVER_URL=https://your-tunnel-host/mcp
```

### 4. Create the Vapi assistant

In a third terminal:

```bash
npm run assistant:create
```

The script creates or reuses the project's `ukulelePracticeTools` MCP tool, creates the `Ukulele MCP Teacher` assistant, attaches the tool, and writes these generated values to `.env.local`:

```text
VITE_VAPI_ASSISTANT_ID=
VAPI_MCP_TOOL_ID=
```

Restart `npm run dev` so Vite loads the generated values, then open `http://localhost:5173`.

To inspect the payload without creating anything in Vapi:

```bash
npm run assistant:config
```

To update the generated assistant and MCP tool later:

```bash
npm run assistant:update
```

Both generated IDs must remain in `.env.local` for updates. If an explicitly configured resource cannot be updated, the command exits instead of creating a replacement.

## How It Works

```text
learner voice -> Vapi teacher -> MCP chord tool -> browser chord UI -> mic analysis -> spoken coaching
```

The local Streamable HTTP MCP server provides the `show_ukulele_chord` tool and an MCP Apps UI resource at `ui://ukulele/chord-card-v1.html`. The React app hosts the chord UI in a sandboxed iframe and sends browser microphone results back into the live Vapi session.

## Commands

```bash
npm run dev                 # app and MCP server
npm run dev:app             # app only
npm run dev:mcp             # MCP server only
npm run assistant:config    # print payloads without API writes
npm run assistant:create    # create the MCP tool and assistant
npm run assistant:update    # update the generated resources
npm test                    # unit tests
npm run typecheck           # strict TypeScript validation
npm run build               # production build
npm run check               # tests, typecheck, and build
```

Add `?debug=1` to the browser URL to enable detailed client flow logging. Set `DEBUG_UKULELE_FLOW=1` when starting the MCP server to enable server flow logging.

## Known Limitations

- The audio detector is a lightweight FFT heuristic, not a robust music-analysis engine.
- Detection varies by device, input gain, room noise, and microphone placement.
- Only `C`, `Am`, `F`, `G`, and `G7` are supported.
- The MCP server uses permissive local-demo CORS and is not hardened for production hosting.
- The sandbox bridge is intended for this local trusted demo path.

## Built By

[Amanda Martin](https://www.linkedin.com/in/amandamartin-dev)

## License

MIT, via the `VapiAI/vapi-labs` repository root license.
