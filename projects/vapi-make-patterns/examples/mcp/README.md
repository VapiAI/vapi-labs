# Vapi MCP Tool → Make MCP Server

Make exposes active, on-demand scenarios as tools and Vapi discovers them at runtime. MCP handles correlation, so there is no Vapi envelope to build and no parameter schema to define in Vapi.

Use this when Make should own the tool surface. Scenario-level access control changes which scenario tools Vapi can discover without changing the Vapi tool.

## Limit the tool surface first

Vapi imports every tool the MCP server exposes into the model context. Unnecessarily broad tool surfaces can increase model context, latency, and timeout risk.

Make's scenario-level URL parameter restricts scenario tools only; it does not apply to management tools. Token scopes control that separate management surface, so use the `mcp:use` scope required for scenarios and grant no additional scopes unless the integration needs them.

## Make setup

Create a Make MCP token with the `mcp:use` scope and no additional scopes unless needed. Then run:

```bash
python3 scripts/setup.py mcp --provision-scenario
```

This creates the On demand scenario, declares the input and outputs in [scenario-interface.json](scenario-interface.json), activates it, and prints its scenario ID. Like the api-request example, it answers `ORD-1001` with the record in [../order.json](../order.json) and answers every other order with `found: false` and no shipment fields.

Use the printed scenario ID with Make's documented scenario-level access-control parameter:

```text
https://<MAKE_ZONE>/mcp/u/<MCP_TOKEN>?scenarioId=<SCENARIO_ID>
```

This is a Streamable HTTP connection URL. Put it in `.env` as `MAKE_MCP_URL` and treat it as a credential. See [Connect using an MCP token](https://developers.make.com/mcp-server/connect-using-mcp-token), [Scenarios as tools access control](https://developers.make.com/mcp-server/connect-using-mcp-token/scenarios-as-tools-access-control), and [Make's Vapi connection guide](https://developers.make.com/mcp-server/connect-using-mcp-token/usage-with-vapi).

## Run

```bash
python3 scripts/setup.py mcp --list-tools   # shows what Vapi would import
python3 scripts/setup.py mcp                # full round trip through Vapi
```

The script creates the MCP tool in [vapi-tool.template.json](vapi-tool.template.json), attaches it to the assistant in [assistant.template.json](assistant.template.json), starts a Vapi Chat, and prints the tool call and tool result it correlated.

`--list-tools` reports what the URL exposes without creating any Vapi resources. If the scenario is missing, confirm it is active and On demand, and that `MAKE_MCP_URL` contains its scenario ID.

Reference: [MCP tools](https://docs.vapi.ai/tools/mcp).
