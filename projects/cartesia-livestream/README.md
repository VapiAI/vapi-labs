# Cartesia Livestream Vapi Assistant

> 🧪 **This is a showcase demo, not an officially supported Vapi product.** Built for the September 2, 2026 Voice AI Live session with Cartesia. It is meant to preserve the livestream demo and inspire experimentation, not serve as a production-ready configuration.

## What it does

This project contains a portable copy of the Vapi assistant used in the livestream. It preserves the assistant's prompt, first message, model, Cartesia voice, Cartesia transcriber, and call settings while excluding source-account IDs and read-only timestamps.

The included script can validate the local configuration or create a new assistant from it in another Vapi account.

## How it works

- `assistant.json` is the configuration snapshot shown during the livestream.
- `npm run check` verifies that the required assistant fields are present without making a network request.
- `npm run push` sends the configuration to Vapi's Create Assistant API and prints the new assistant ID.

Each push creates a new assistant. The script does not update or delete existing assistants.

## Setup

### Prerequisites

- Node.js 18 or newer
- A Vapi account
- A private Vapi API key for the destination account

There are no dependencies to install.

### Validate the configuration

From this project directory, run:

```sh
npm run check
```

This validates the local file without calling Vapi.

### Create the assistant

Set your private API key in the current shell, then run the push script:

```sh
export VAPI_API_KEY="your-private-vapi-api-key"
npm run push
```

The command creates a new assistant and prints its Vapi assistant ID. It does not modify the source assistant.

You can also pass the key directly, though the environment variable is safer because command-line arguments can be saved in shell history:

```sh
npm run push -- --api-key "your-private-vapi-api-key"
```

## Configuration fidelity

`assistant.json` intentionally matches the assistant demonstrated on the livestream. Provider settings and copy are preserved as shown rather than modernized to current defaults.

## Known limitations

- Provider models and API fields can change after the livestream; the snapshot may require adjustment in a future Vapi account.
- The assistant's transcriber is configured for English, so Hindi and Spanish input may not transcribe reliably. The prompt asks the model to infer intent when transcription is imperfect.
- The script creates an assistant only. It does not attach a phone number, place a call, or configure provider credentials.
- Re-running `npm run push` creates another assistant rather than updating the previous one.

## Project files

- `assistant.json` — portable assistant configuration sent to Vapi
- `scripts/push.mjs` — zero-dependency Vapi API client
- `.env.example` — environment-variable example; real `.env` files are ignored

Never commit a private Vapi API key. This repository does not contain the source test key.

## Built by

[Amanda Martin](https://www.linkedin.com/in/amandamartin-dev) for Vapi's Voice AI Live session with Cartesia.
