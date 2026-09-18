# Vapi MCP Tool → Make MCP Server

Make publishes scenarios as tools and Vapi discovers them at runtime. MCP handles correlation, so there is no Vapi envelope to build and no parameter schema to define in Vapi.

Use this when Make should own the tool surface. Adding a scenario to the toolbox adds a tool without touching Vapi.

## Curate the tool surface first

Vapi imports every tool the MCP server exposes and cannot filter them, so whatever you point it at is what the model sees on every turn. Connect through an **MCP toolbox**, which holds a chosen set of scenarios, and not through a broad MCP token, whose scopes expose Make's full management surface including destructive scenario, team, and organization tools.

This is a latency and reliability constraint, not only a safety one. Measured against a management token exposing 147 tools, the tool definitions alone came to 137,901 bytes, roughly 34,500 tokens on every turn, and `POST /chat` failed with HTTP 524 after two minutes. The same scenario through a toolbox is one tool and 328 bytes, and passes in seconds.

## Make setup

```bash
python3 scripts/setup.py mcp --provision-scenario
```

This creates the On demand scenario, declares the input and outputs in [scenario-interface.json](scenario-interface.json), and activates it. Like the api-request example, it answers `ORD-1001` with the record in [../order.json](../order.json) and answers every other order with `found: false` and no shipment fields.

Then publish it, which is the one step Make exposes no API for: under **MCP toolboxes**, create a toolbox whose **Tools** hold only that scenario, copy the key it shows once, and copy the toolbox's MCP server URL with the key and the **Streamable HTTP** transport appended, as Make's documentation describes. Put the result in `.env` as `MAKE_MCP_URL`.

Vapi also accepts the key as an `Authorization` header on the tool's `server` instead of in the URL. Make documents a plain MCP token URL too; it works, but it exposes everything the token's scopes allow, so prefer a toolbox.

## Run

```bash
python3 scripts/setup.py mcp --list-tools   # shows what Vapi would import
python3 scripts/setup.py mcp                # full round trip through Vapi
```

The script creates the MCP tool in [vapi-tool.template.json](vapi-tool.template.json), attaches it to the assistant in [assistant.template.json](assistant.template.json), starts a Vapi Chat, and prints the tool call and tool result it correlated.

`--list-tools` reports what the URL exposes and how large those definitions are, without creating any Vapi resources. If the scenario is missing, confirm it is active, On demand, and in the toolbox. If the chat times out, the tool surface is almost certainly too large.

Reference: [MCP tools](https://docs.vapi.ai/tools/mcp).
