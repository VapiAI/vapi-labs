# Vapi Deepgram Assistant Configurations

> 🧪 **This is a showcase demo to support a livestream build** Built by [Amanda Martin](https://www.linkedin.com/in/amandamartin-dev) at Vapi to expose a Deepgram and Vapi web-sdk demo easy to reproduce as Vapi assistant configurations. It is meant to inspire, not to be production ready.

## What it does

This project provides two editable JSON payloads and a script that creates assistants through the Vapi API. The payloads reproduce the model choices from
[`dg-edcharbeneau/vapi-deepgram-client-javascript-react`](https://github.com/dg-edcharbeneau/vapi-deepgram-client-javascript-react).

## How this differs from the reference repo

The Deepgram reference is an interactive React demo. It uses the Vapi Web SDK
and a public web token, builds an assistant object in the browser, and passes
that object directly to `vapi.start(assistant)`. This creates a transient
assistant for that call; it does not save the assistant in the Vapi dashboard.

This project extracts the same model configurations into plain JSON files. Its script uses a private API key to send a `POST /assistant` request, which
creates a persistent assistant that can be opened, edited, published, and
reused from the Vapi dashboard. 

## How it works

Choose one of the payloads in `assistants/`, edit it if needed, and pass its path
to `create-assistant.js`. The script reads the JSON, sends it to Vapi's
`POST /assistant` endpoint, and prints the created assistant, including its ID.
The private API key is read only from the environment and is never included in
the assistant payload.

## Setup

### Prerequisites

- Node.js 18 or newer
- A Vapi account and private API key; use a test key when experimenting

### Steps

1. Copy the environment template and add your test key:

   ```bash
   cp .env.example .env
   ```

2. Load the key into your shell:

   ```bash
   set -a
   source .env
   set +a
   ```

3. Create either assistant:

   ```bash
   # Deepgram Flux with balanced end-of-turn settings
   node create-assistant.js assistants/flux.json

   # Deepgram Nova-3 with the reference silence-timer setting
   node create-assistant.js assistants/nova-3.json
   ```

The Flux assistant uses `flux-general-en` with an end-of-turn confidence of
`0.7` and timeout of `5000` ms. The Nova-3 assistant uses English transcription
and a start-speaking wait of `0.8` seconds. Both use OpenAI `gpt-3.5-turbo` at
temperature `0.7` and Deepgram Aura-2 `thalia`. The other reference voice
choices are `apollo` and `athena`.

## Add keyterms as needed

Add important vocabulary to the Deepgram `transcriber` object using the
singular `keyterm` field. For example, to improve recognition of “Vapi”:

```json
"transcriber": {
  "provider": "deepgram",
  "model": "flux-general-en",
  "eotThreshold": 0.7,
  "eotTimeoutMs": 5000,
  "keyterm": ["Vapi"]
}
```

The same `keyterm` array can be added to the Nova-3 configuration. Preserve the
exact spelling and capitalization you want Deepgram to recognize.

## Known limitations

- Each run creates a new assistant; the script does not update or delete an
  existing assistant.

## Built by

[Amanda Martin](https://www.linkedin.com/in/amandamartin-dev), Vapi.

## License

MIT, via the `VapiAI/vapi-labs` repository root [license](../../LICENSE). The
adapted reference configuration retains its original notice in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
