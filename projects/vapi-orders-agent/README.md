# Vapi Orders Agent

> 🧪 **This is an example repo** It is meant to educate and be a complementary resource to our documentation. It is unlikely to be production ready.

A Vapi voice assistant that checks a retail catalog and creates simulated orders through a Cloudflare Worker. 

The Worker has no runtime dependencies. Cloudflare D1 stores orders; Vapi supplies the model, voice, transcriber, credential, and API Request tools. 

## Choose one installation workflow

This repository has two alternative installation paths. Choose exactly one for the initial Cloudflare deployment; do not combine their commands or credentials.

| Path | Creates | Credentials handled | Result |
| --- | --- | --- | --- |
| **A. Full setup (primary/manual)** | Worker, D1 database and migration, Worker bearer secret, Vapi custom credential, three Vapi tools, and one Vapi assistant | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `VAPI_API_KEY` from exported environment variables or protected `.setup.env`; `ORDERS_API_TOKEN` is generated or supplied there | A verified voice assistant and direct Vapi test URL |
| **B. Deploy to Cloudflare (secondary)** | Worker, D1 database/binding and migration, and `ORDERS_API_TOKEN` Worker runtime secret only | Cloudflare authenticates the user in its own deployment flow; the user supplies only `ORDERS_API_TOKEN` as a Worker secret | A deployed orders API backend, **not** a Vapi assistant |

The Deploy to Cloudflare path must never receive `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, or `VAPI_API_KEY` as Worker variables, build variables, `.env` values, or `.dev.vars` values. Do not use `npm run setup` as a Workers Builds deploy command: it belongs only to Path A and provisions both providers.

## Path A: full voice-assistant setup (primary)

### What gets created

- Cloudflare Worker with `GET /health`, `GET /products`, `POST /orders`, and `GET /orders/:code`
- Cloudflare D1 database and migration
- Vapi bearer custom credential
- Three saved Vapi API Request tools
- One Vapi assistant named **Acme Market Orders**

No phone number is created. Test voice calls with **Talk to Assistant** in the Vapi dashboard, or attach your own Vapi phone number later.

### One-command setup

Prerequisites: Node.js 20 or newer, a Cloudflare account, and a Vapi account.

Create a custom, account-owned Cloudflare API token at **Manage Account → API Tokens → Create Token → Custom token**. Expand **Developer Platform** and select exactly these two account-level permissions:

- **Workers Scripts Write** — `wrangler deploy`, `wrangler secret put`, and the `workers.dev` subdomain lookup
- **D1 Write** — creating the database and applying migrations with `--remote`

The category counter should show **2/51** (Cloudflare may change the total). The broad Workers preset does not necessarily include D1 access, so do not use it for this project.

Scope **Account Resources** to the account matching `CLOUDFLARE_ACCOUNT_ID`. No zone permissions are needed because the Worker deploys to `workers.dev`; add **Workers Routes: Edit** on the zone only if you move it to a custom domain. Setup is safe to rerun, so prefer an expiring token and rotate it by updating the variable and running setup again.

Keep administrative setup credentials separate from Worker development bindings. Copy the ignored setup file, restrict its permissions, and fill in the three required values:

```bash
cp .setup.env.example .setup.env
chmod 600 .setup.env
```

`npm run setup` loads only its documented keys from `.setup.env`. Exported variables with the same names remain supported and take precedence. Never put `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `VAPI_API_KEY`, or `ORDERS_API_TOKEN` in `.env`; Wrangler can infer `.env` values as Worker bindings. Never run `wrangler dev --remote` while administrative credentials are present in `.env` or `.dev.vars`.

If administrative credentials were previously stored in `.env` or exposed to a remote preview, remove them and rotate both the Cloudflare token and Vapi API key as a manual precaution. This repository cannot rotate account credentials for you.

Install and provision:

```bash
npm ci
npm test
npm run check
npm run setup
```

`npm run setup` is non-interactive and safe to rerun. It automatically:

1. Discovers or creates D1 through Cloudflare's API, writes the account-specific binding to an ignored `wrangler.remote.json`, applies migrations, and deploys the Worker. The generated manual config removes the tracked `secrets.required` gate because Path A deploys first and then writes `ORDERS_API_TOKEN` explicitly with `wrangler secret put`. The tracked `wrangler.json` is never modified, so Path B keeps its required-secret behavior.
2. Generates a 256-bit Worker bearer token unless `ORDERS_API_TOKEN` is supplied.
3. Stores the token as a Cloudflare secret and in ignored local `.state/` for repeat setup.
4. Applies migrations and smoke-tests the canonical production Worker origin. A localhost or remote-preview pass cannot substitute for this check.
5. Only after the canonical smoke succeeds, creates or updates the Vapi credential, tools, and assistant.
6. Reads the saved Vapi tools and assistant back, confirms every tool uses that same canonical Worker origin, verifies the persisted method, credential, request schemas, retries, and static parameters, and only then prints `Voice assistant is ready`.

The final output includes the Worker URL, the assistant ID, and a direct dashboard link to the assistant for the voice test. If your account does not expose a `workers.dev` route, set `WORKER_BASE_URL` in `.setup.env` to the deployed custom-domain origin and rerun. If canonical smoke or Vapi read-back fails, setup exits without claiming readiness; preview success is diagnostic only.

Setup writes the Worker bearer secret before updating Vapi. If setup is interrupted during an intentional `ORDERS_API_TOKEN` rotation, rerun setup with the same token before testing calls so Worker and Vapi converge on one value. Rotate administrative Cloudflare and Vapi credentials in their respective dashboards, not by changing `ORDERS_API_TOKEN`.

## Path B: Deploy to Cloudflare (secondary, backend only)

Use this route when a user wants Cloudflare to authenticate and provision the backend through its browser-based Deploy to Cloudflare and Workers Builds flow, without placing Cloudflare administrative credentials in a local environment.

This path creates exactly:

- One Cloudflare Worker
- One automatically provisioned D1 database named `vapi-orders-agent-db`, bound as `DB`
- The D1 migrations in `migrations/`
- One Worker runtime secret named `ORDERS_API_TOKEN`

It does **not** create a Vapi custom credential, Vapi tools, a Vapi assistant, or a Vapi voice-test URL. A successful Workers Build means only that the Cloudflare backend was deployed. Vapi provisioning is a separate follow-up and must use the same `ORDERS_API_TOKEN` through a Vapi custom credential; never put `VAPI_API_KEY` in the Worker.

Cloudflare reads the draft D1 declaration in `wrangler.json` and provisions the account-specific database and ID. The tracked configuration intentionally has a usable default `database_name` but no account-specific `database_id`; Cloudflare supplies that ID during provisioning. Workers Builds detects the `deploy` script in `package.json`, which runs migrations by the stable `DB` binding and then deploys the Worker:

```text
npm run db:migrate:remote && wrangler deploy
```

The `.dev.vars.example` file declares only `ORDERS_API_TOKEN`, so the Deploy to Cloudflare form can request it as a secret. Generate a random value containing at least 32 characters and retain it securely for the later Vapi credential.

### Deploy to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/VapiAI/vapi-labs/tree/main/projects/vapi-orders-agent)

The repository must be public. In Cloudflare's flow, sign in, select the target account, review the Worker and D1 names, replace the example `ORDERS_API_TOKEN` with a random secret, and accept the detected `npm run deploy` command. Do not add the three Path A administrative credentials to Workers Builds or runtime bindings, and do not change its deploy command to `npm run setup`.

After deployment, `GET https://<worker-name>.<subdomain>.workers.dev/health` can confirm the backend is reachable. That health check is not evidence that a voice assistant exists or is ready. Complete Vapi configuration separately before attempting a call.

## Voice test

Setup prints a direct link to the assistant (`https://dashboard.vapi.ai/assistants/<assistantId>`, also saved in `.state/resources.json`). Open it and select **Talk to Assistant**. Try:

> I'd like two ceramic mugs. My name is Alex.

The assistant should check the catalog, read back the cart, request explicit confirmation, create one order, and speak the backend-confirmed total. It must not claim success before the tool returns.

Additional scenarios are in [`evals/scenarios.json`](./evals/scenarios.json).

## API contract

`GET /health` is public. All other routes require `Authorization: Bearer <token>`. Vapi supplies this through a reusable custom credential.

Vapi's API Request runtime adds `X-Call-Id` directly from server-side call state. The tools intentionally do not template that header themselves: configuring a second case-variant header causes the two values to be combined by HTTP. The order-creation tool also injects `callId: {{ call.id }}` through Vapi's top-level static `parameters`, outside the model-facing schema. The Worker requires the body value and trusted header to match.

Create an order:

```json
{
  "callId": "server-injected-vapi-call-id",
  "customerName": "Alex",
  "items": [
    { "productId": "ceramic-mug", "quantity": 2 }
  ]
}
```

Success returns `201`; an identical retry in the same call returns `200`, the original order, and `"replayed": true`. D1 enforces uniqueness on the trusted call ID plus a canonical request hash.

One tradeoff of this fingerprint: a caller who intentionally orders the identical cart twice in the same call gets the original order back rather than a second one. A real store that needs repeat orders would add a per-confirmation idempotency key generated by the client.

Errors use one stable shape:

```json
{
  "error": {
    "code": "INVALID_ORDER",
    "message": "Every quantity must be a whole number from 1 to 20.",
    "requestId": "..."
  }
}
```

## Local development

Local development works before `npm run setup`; the tracked `wrangler.json` already supports a local D1 database. Create `.dev.vars` without committing it:

```bash
cp .dev.vars.example .dev.vars
```

Replace the example `ORDERS_API_TOKEN` with a random value containing at least 32 characters. `.dev.vars` is only for this local Worker secret; never add Cloudflare or Vapi administrative credentials.

Then run:

```bash
npm run db:migrate:local
npm run dev
```

The supported development command is local-only, disables Wrangler's `.env` fallback, and rejects `--remote`. It still loads the Worker's local-only `ORDERS_API_TOKEN` from `.dev.vars`.

For a deployed Worker, rerun the smoke test with:

```bash
WORKER_BASE_URL="https://...workers.dev" npm run smoke
```

The smoke script reads the ignored token generated by setup. It verifies health, authentication, catalog output, order persistence, retry idempotency, and same-call lookup. This standalone command is diagnostic; only the full setup workflow also verifies persisted Vapi URLs and is allowed to print readiness.

## Known limitations

- The catalog, orders, and fulfillment are simulated. No real inventory, tax, shipping, payment, cancellation, or fulfillment provider is connected.
- The order lookup intentionally works only within the Vapi call that created the order. Cross-call lookup requires server-side customer authentication before returning order data.
- Path B deploys only the Cloudflare backend. It does not create a Vapi credential, tools, assistant, or voice-test URL.
- No phone number is created. Voice testing uses **Talk to Assistant** in the Vapi dashboard unless you attach your own Vapi phone number.
- The Worker has no runtime dependencies, but the setup and deployment workflows require Node.js 20 or newer, a Cloudflare account, and a Vapi account for the full assistant setup.

## Adapting for real commerce

The store and fulfillment are simulated. Before adapting this demo for real commerce, add business-specific inventory reservation, tax, shipping, payment, cancellation, identity, retention, rate-limit, and compliance policy. Do not collect payment data through this example.

## References

- [Vapi API Request tools](https://docs.vapi.ai/tools/default-tools)
- [Vapi static variables and aliases](https://docs.vapi.ai/tools/static-variables-and-aliases)
- [Vapi server authentication](https://docs.vapi.ai/server-url/server-authentication)
- [Vapi create tool API](https://docs.vapi.ai/api-reference/tools/create)
- [Vapi create assistant API](https://docs.vapi.ai/api-reference/assistants/create)
- [Cloudflare D1 create API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/)
- [Cloudflare D1 list API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/list/)
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [Cloudflare Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)

## Built by

[Amanda Martin](https://www.linkedin.com/in/amandamartin-dev), Vapi.
