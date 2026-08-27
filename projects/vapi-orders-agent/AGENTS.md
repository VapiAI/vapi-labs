# Coding-agent runbook

This repository supports two separate deployment workflows. The primary/manual workflow deploys one Cloudflare Worker, one D1 database, three saved Vapi API Request tools, one Vapi custom credential, and one Vapi assistant. The secondary Deploy to Cloudflare workflow deploys only the Cloudflare Worker, D1 database/migrations, and Worker bearer secret.

## Workflow routing: choose exactly one

Before taking setup or deployment action, identify which workflow the user requested. Never combine the workflows in one run.

### A. Full setup (primary/manual)

Use this route when the user wants the complete voice assistant and can provide local/exported administrative credentials. Follow the credential checks and `npm ci`, `npm test`, `npm run check`, `npm run setup` sequence below. This route provisions and verifies both Cloudflare and Vapi.

### B. Deploy to Cloudflare (secondary/backend only)

Use this route only for a Deploy to Cloudflare button or Workers Builds installation. Cloudflare authenticates the user and provisions the draft `DB` binding from tracked `wrangler.json`. The detected production deploy command must remain `npm run deploy`, which applies D1 migrations by the `DB` binding and then runs `wrangler deploy`.

This route may handle only the `ORDERS_API_TOKEN` Worker runtime secret declared in `.dev.vars.example`. Never request, collect, copy, or configure `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, or `VAPI_API_KEY` in Workers Builds variables, Worker runtime bindings, `.env`, or `.dev.vars`. Never run `npm run setup` inside Workers Builds and never replace the button's deploy command with it.

Deploy-button completion proves only that the Worker, D1 database, migrations, and runtime secret were configured. It is not voice-assistant readiness and must not be reported using the full setup readiness wording. It creates no Vapi credential, tools, or assistant. Vapi provisioning is a separate follow-up that must preserve the same Worker origin and `ORDERS_API_TOKEN` through a Vapi custom credential; the Vapi private API key must remain outside Worker runtime configuration.

## Full-setup required user inputs

- `CLOUDFLARE_API_TOKEN` with account-scoped **Developer Platform → Workers Scripts Write** and **D1 Write** access, and nothing broader. The token-creation steps are in [README](./README.md#one-command-setup); no zone permissions are required for the `workers.dev` deploy.
- `CLOUDFLARE_ACCOUNT_ID`
- `VAPI_API_KEY` (private, server-side key)

Do not ask for another service account. Vapi supplies the configured model, transcriber, and voice. Do not print, commit, or place secrets in tool schemas or prompts.

Administrative credentials belong only in exported environment variables or ignored `.setup.env` with mode `0600`. Never put Cloudflare or Vapi administrative credentials, or `ORDERS_API_TOKEN`, in `.env`. `.dev.vars` may contain only the local Worker's `ORDERS_API_TOKEN`. Never run `wrangler dev --remote` while administrative credentials are available through `.env` or `.dev.vars`. If that happened, tell the human developer to remove and rotate the Cloudflare and Vapi keys as a manual precaution; do not print their values.

Use `npm run dev` for local development. Its wrapper disables Wrangler's `.env` fallback and rejects remote-preview arguments. Do not bypass the wrapper with `npx wrangler dev --remote`.

## Full-setup workflow

1. Confirm the three variables above are exported or present in `.setup.env` without printing their values. If `.setup.env` exists, confirm its mode is `0600`. Do not read credentials from `.env`.
2. Run `npm ci`.
3. Run `npm test` and `npm run check`.
4. Run `npm run setup`.
5. Only if the script prints `Production verification complete. Voice assistant is ready.`, report the Worker URL and assistant ID.
6. Give the user the dashboard link the verified script prints as `Voice test:` (`https://dashboard.vapi.ai/assistants/<assistantId>`) as a clickable URL, and ask them to open it and select **Talk to Assistant**. The voice call is the only step you cannot run yourself, so always hand over this link rather than describing where to click. A phone number is optional.

The setup script generates the shared Worker bearer token, stores it only under ignored `.state/`, discovers or creates D1, and writes the binding to ignored `wrangler.remote.json` (used via `--config` for remote commands; the tracked `wrangler.json` is never modified). The generated Path A config must omit the tracked `secrets.required` gate because setup deploys the Worker before it writes `ORDERS_API_TOKEN` with `wrangler secret put`; Path B must retain that gate in tracked `wrangler.json`. Setup then applies migrations, deploys the Worker, smoke-tests the canonical production origin, and creates or updates and reads back the Vapi resources. It is safe to rerun.

A localhost or remote-preview smoke test is diagnostic only. It cannot unlock Vapi provisioning and is never evidence that the voice assistant is ready. Do not add a smoke URL override to the production setup path. The base URL smoke-tested by setup must exactly match the base URL of every saved Vapi tool. If canonical smoke fails, stop without manually creating or updating Vapi resources and report that production remains unverified. If the exact canonical origin returns Cloudflare 1042 before any Worker logs, classify it as caller-side same-zone Worker egress; do not change Worker compatibility flags or claim readiness.

After any Vapi upsert, require an API read-back of the assistant and each tool, verify the assistant is attached to exactly those tools, and verify each persisted tool URL uses the canonical smoke-tested origin. Failure must exit nonzero and must not print readiness wording.

During intentional `ORDERS_API_TOKEN` rotation, reuse the same value when rerunning a failed setup. Setup updates Cloudflare before Vapi, so an interrupted run may require a rerun to converge. Administrative Cloudflare and Vapi credential rotation remains a manual dashboard operation.

## Change rules

- Preserve `callId` as a top-level Vapi static parameter. Never add it to the model-facing body schema.
- Keep order creation idempotent before enabling retries.
- Keep prices authoritative in `src/domain.js`; never place prices in the system prompt.
- Update the Worker validation, Vapi schema, prompt, and tests together when changing products or inputs.
- Keep the Worker runtime dependency-free unless a concrete requirement justifies a dependency.
- Use Cloudflare secrets and Vapi custom credentials; never add inline authorization headers.
