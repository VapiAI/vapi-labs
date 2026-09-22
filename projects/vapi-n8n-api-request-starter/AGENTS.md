# Agent instructions

This repo demonstrates a Vapi API Request tool calling an n8n business-hours webhook. Read `README.md` before running or changing the demo.

## Run the demo

- Use Node.js 20.6 or newer.
- Obtain `VAPI_API_KEY` from the user's local environment. Never ask for it in chat, print it, or add it to a tracked file.
- Obtain `N8N_WEBHOOK_URL` from the user's local environment. It must be the HTTPS **Production URL** of the published workflow, not the temporary Test URL.
- Run `node scripts/run.mjs` when both variables are already set. If the user has prepared `.env.local`, run `node --env-file=.env.local scripts/run.mjs` instead.
- Treat the run as successful only when it prints `n8n webhook OK`, `Vapi API Request confirmed`, and a Vapi answer based on the returned hours.

If the n8n workflow is not yet published, guide the user through the one-time import and publish steps in `README.md`. Do not assume n8n API access is available.

## Keep the example focused

- Keep the Vapi tool as `apiRequest`, not a Function tool. The runner uses a transient assistant and an inline tool; it creates no saved Vapi resources.
- Keep n8n limited to the Webhook, Code, and Respond to Webhook nodes. Do not add a CRM, calendar, sample customer record, or external credential to the baseline demo.
- The schedule in `workflows/vapi-business-hours.json` is editable example data. Do not describe the response as holiday-aware or as appointment availability.
- Do not commit secrets, real customer data, or instance-specific webhook URLs. Make only changes needed for the requested demo or documentation task.
