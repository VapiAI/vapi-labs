#!/usr/bin/env bash
# Creates the assistant in your Vapi org from assistant/assistant.json and
# assistant/system-prompt.md, filling in your server URL and shared secret.
#
# Usage: VAPI_PRIVATE_KEY=... SERVER_URL=https://your-app.example.com DEMO_SECRET=... \
#          ./scripts/create-assistant.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${VAPI_PRIVATE_KEY:?set VAPI_PRIVATE_KEY (Vapi dashboard > Org settings > API keys)}"
: "${SERVER_URL:?set SERVER_URL to where server.mjs is deployed, e.g. https://your-app.example.com}"
: "${DEMO_SECRET:?set DEMO_SECRET to the same value the server uses}"
SERVER_URL="${SERVER_URL%/}"

body=$(jq \
  --arg url "$SERVER_URL" \
  --arg secret "$DEMO_SECRET" \
  --rawfile prompt assistant/system-prompt.md \
  '.model.url = $url
   | .model.headers["x-demo-secret"] = $secret
   | .model.messages = [{role: "system", content: $prompt}]
   | .server.url = ($url + "/vapi")
   | .server.headers["x-demo-secret"] = $secret' \
  assistant/assistant.json)

curl -sS -X POST https://api.vapi.ai/assistant \
  -H "Authorization: Bearer $VAPI_PRIVATE_KEY" \
  -H 'Content-Type: application/json' \
  -d "$body" | jq '{id, name}'
