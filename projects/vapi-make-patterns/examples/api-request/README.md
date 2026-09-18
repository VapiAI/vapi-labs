# API Request Tool → Make webhook

Vapi sends a direct HTTPS request to Make and uses the JSON response as the tool result. Make returns plain JSON, so there is no Vapi envelope to build.

Start here. Vapi recommends an API Request tool for any ordinary HTTPS endpoint.

## Run

```bash
cp .env.example .env    # add VAPI_API_KEY, MAKE_API_KEY, MAKE_TEAM_ID, MAKE_ZONE

python3 scripts/setup.py api-request --check-webhook   # tests Make alone
python3 scripts/setup.py api-request                   # full round trip through Vapi
```

The script creates the Make side itself: a webhook, a scenario that routes on the order number, and the activation. Set `MAKE_WEBHOOK_URL` instead to point at a webhook you already have and skip that step.

The scenario answers `ORD-1001` with the record in [../order.json](../order.json) and answers every other order with `{"found": false}` and the number that was asked for. Ask for `ORD-9999` to hear that path. The two response modules are the stub: replace them with a real lookup, keep the two shapes, and the assistant needs no change.

Vapi builds the request body from the tool's `body` schema in [assistant.template.json](assistant.template.json) and posts [request.json](request.json)-shaped JSON. Any 2xx response containing valid JSON becomes the tool result; a non-2xx response or invalid JSON fails the call.

Reference: [When to use API Request or Function tools](https://docs.vapi.ai/tools/api-request-vs-function) and [API Request tool](https://docs.vapi.ai/tools/api-request).
