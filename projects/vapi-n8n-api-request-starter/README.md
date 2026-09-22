# Vapi + n8n API Request starter

Ask a Vapi assistant whether a business is open now. Its API Request tool calls a three-node n8n workflow that checks the current time against an editable schedule. No credentials are configured in this public-hours workflow.

## Run

1. In the n8n workflow editor, open the top-right three-dot menu, select **Import from File**, and choose `workflows/vapi-business-hours.json`.
2. In **Check business hours**, set `timeZone`, `openDays`, `opensAt`, and `closesAt`. The example is Monday–Friday, 09:00–17:00 in `America/Los_Angeles`.
3. Select **Publish**. Open **Receive Vapi request**, select **Production URL**, and copy it. Do not use the temporary Test URL.
4. Get a [Vapi private API key](https://dashboard.vapi.ai/org/api-keys). Copy `.env.example` to `.env.local` and fill in `VAPI_API_KEY` and `N8N_WEBHOOK_URL` (the Production URL). Do not commit `.env.local` or paste the key into an agent chat.
5. With Node.js 20.6 or newer, run `node --env-file=.env.local scripts/run.mjs`.

The runner checks the n8n webhook, sends a Vapi chat request with a transient assistant and inline API Request tool, and verifies that Vapi received an actual tool result before printing the answer. It creates no saved Vapi tool or assistant. An agent with both environment variables already set can run `node scripts/run.mjs`.

The workflow returns `openNow`, the local time and schedule, and `checkedAt`. It does not account for holidays or appointment availability.

## Security

Public business hours need no webhook credential. For private data or actions, configure [n8n Webhook Header Auth](https://docs.n8n.io/integrations/builtin/credentials/webhook/#using-header-auth) and a matching [Vapi Custom Credential](https://docs.vapi.ai/tools/api-request/configuration#authenticate-requests); never put secrets in exported JSON. This repo does not automate that optional auth setup.

The n8n integration guide will be linked here when published. See the [Vapi API Request docs](https://docs.vapi.ai/tools/api-request) for the tool contract.
