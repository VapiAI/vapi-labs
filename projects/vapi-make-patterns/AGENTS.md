# Agent Instructions

This repository contains two Vapi↔Make examples: an API Request Tool webhook and an MCP Tool.

## Goal

Configure and run one example after the operator supplies the keys named in `.env.example`.

## Before changing anything

1. Read the selected example's `README.md`.
2. Copy `.env.example` to `.env`.
3. Ask only for the missing keys named in `.env.example`.
4. Never print or commit the Vapi API key.

## Allowed sources

Use only:

- official Vapi documentation at `docs.vapi.ai`, and the Vapi OpenAPI spec at `api.vapi.ai/api-json`;
- official Make documentation at `help.make.com`, `apps.make.com`, or `developers.make.com`.

Do not use forum posts, videos, community templates, third-party blog posts, or guessed Make blueprints as implementation authority.

## Run

Repository checks, runnable anywhere with no credentials:

```bash
python3 scripts/check.py
python3 scripts/test.py
```

The api-request example runs end to end unattended:

```bash
python3 scripts/setup.py api-request --check-webhook   # Make only
python3 scripts/setup.py api-request                   # full round trip
```

The mcp example cannot. It stops after the first command until a person publishes the scenario
in a Make MCP toolbox and puts that toolbox URL in `.env` as `MAKE_MCP_URL`. Ask the operator to
do that step; there is no API for it:

```bash
python3 scripts/setup.py mcp --provision-scenario   # creates the scenario, then stop and ask
python3 scripts/setup.py mcp --list-tools           # after MAKE_MCP_URL is set
python3 scripts/setup.py mcp                        # full round trip
```

The setup script creates Vapi tools and assistants, and creates both examples' Make scenarios and the api-request webhook. It must never delete Make resources or change ones it did not create.

## Contract rules

- An API Request Tool uses any 2xx JSON response as the tool result directly. Make returns the
  record and nothing else. A non-2xx response or invalid JSON fails the call.
- Do not add a Function Tool example. It needs Make to rebuild Vapi's `tool-calls` envelope, which
  only earns its cost when a scenario needs Vapi call context, and documenting how to assemble that
  envelope inside Make is Make instruction this repository does not carry. Link to the Vapi docs.
- MCP correlation is handled by the protocol; do not add a Vapi callback envelope.
- Vapi imports every tool an MCP server exposes and cannot filter them, so `MAKE_MCP_URL` must
  point at a curated MCP toolbox. A URL scenario parameter does not reduce a token's tool list,
  and a broad management token is large enough to time the chat out. Check with `--list-tools`.
- Keep secrets out of model-visible tool parameters and response strings.

## Updating the examples

- `examples/order.json` defines the demo record and `examples/mcp/scenario-interface.json` the
  MCP contract. Both blueprints are generated from them, so do not restate either one.
- Add every new template variable to `.env.example`, unless the script computes it, as it does
  for `VAPI_MCP_TOOL_ID`.
- Keep instructions specific to this demo, and do not document general Make usage.
- Validate any blueprint change by provisioning it and exercising every branch before shipping it.
  Make's MCP server also offers a `validate_blueprint_schema` tool when a token is available.
- Both demo scenarios must answer an unknown order with `found: false` and echo the order asked
  for. A stub that always succeeds teaches a lookup that cannot fail.
- A blueprint does not declare a scenario's interface. Set it with `PATCH /scenarios/{id}/interface`
  or Make rejects every input before any module runs.
- Do not add Make UI walkthroughs, unverified blueprint fields, or Make URLs that Make can change.

## Completion checklist

- `python3 scripts/check.py` and `python3 scripts/test.py` pass.
- All JSON templates parse before and after rendering.
- No `.env`, API key, webhook URL, token-bearing MCP URL, or real account ID is committed.
