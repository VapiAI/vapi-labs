# Deployment

## OpenAI Sites

This repository includes `.openai/hosting.json` and a vinext Worker entry point
for OpenAI Sites. The `DB` binding is required and is created by the hosting
platform.

Set `ADMIN_API_KEY`, a long random secret for resetting workshop state, in the
hosting environment rather than source control. No Vapi credential is required
by the deployed app.

Build output is written to `dist/`:

```bash
npm ci
npm run check
```

The database schema is initialized idempotently on first use. The generated
Drizzle migration under `drizzle/` is also included for hosts that apply
migrations separately.

## Fork checklist

After forking:

1. update the repository links and license attribution if appropriate;
2. deploy with a Cloudflare D1 binding named `DB`;
3. set new runtime variables;
4. configure a new canonical assistant to send server events to
   `/api/v1/pets/main/vapi/events`;
5. point its API Request tools at the `main` state and feed endpoints; and
6. verify `/api/health`, a feed request, and one complete call.

Never place a Vapi private API key in a client-visible variable or commit it to
the repository. VapiGotchi does not need a private key at runtime.
