# Vapi + Make

> 🧪 **This is an example demo repo** Built by Amanda Martin at Vapi to showcase two Vapi↔Make integration patterns. It is show basic integration patterns, not serve as a production-ready integration.

Two runnable examples that connect a Vapi assistant to Make. Both look up demo order `ORD-1001` and return the record in [examples/order.json](examples/order.json). Both also report any other order as not found, so both halves of a real lookup are visible.

This repository is a companion to the Vapi documentation. Running an example creates demo resources in Vapi, and the api-request example creates its own Make webhook and scenario so there is nothing to click through.

| Path | What Vapi sends | What Make returns |
| --- | --- | --- |
| [API Request Tool → Make webhook](examples/api-request/README.md) | A direct HTTPS request built from the tool's `body` schema | Plain JSON, used as the tool result |
| [Vapi MCP Tool → Make MCP Server](examples/mcp/README.md) | An MCP call over Streamable HTTP | An MCP result, correlated by the protocol |

Start with the API Request tool. Vapi recommends it for any ordinary HTTPS endpoint, and Make only has to return the JSON you want the assistant to read. Use MCP when Make should own the tool surface, pointing Vapi at a curated Make toolbox rather than a broad token.

If a Make scenario needs Vapi's call context, such as the call id or the transcript artifact, it needs a [Function tool](https://docs.vapi.ai/tools/custom-tools) instead, and Make has to rebuild Vapi's `tool-calls` response envelope.

## Run

Requires Python 3.9+ and no third-party packages.

Both examples build their own Make scenario, so both need a Make API token that can read and write
scenarios and hooks, plus a free slot under your plan's active-scenario limit. The mcp example
additionally needs an MCP toolbox that you create in Make, because Make exposes no API for
toolboxes.

1. Copy `.env.example` to `.env` and fill in the keys it names.
2. Run it:

   ```bash
   python3 scripts/setup.py api-request
   ```

   The mcp example needs its scenario published in a Make toolbox first, which is the one
   step Make exposes no API for:

   ```bash
   python3 scripts/setup.py mcp --provision-scenario   # creates the scenario
   # publish it in an MCP toolbox, then set MAKE_MCP_URL
   python3 scripts/setup.py mcp
   ```

Each run creates new Vapi resources, prints the tool call and tool result it correlated, and prints `PASS` only after the expected record comes back.
Make scenarios created by this checkout are recorded in the gitignored `.vapi-make-state.json`; only those recorded scenarios are updated on later runs.

Two commands create no Vapi resources. The first sends the sample request to Make and checks the
reply, building the Make scenario first if it does not exist yet. The second reports what an MCP
URL would expose, since Vapi imports all of it and cannot filter:

```bash
python3 scripts/setup.py api-request --check-webhook
python3 scripts/setup.py mcp --list-tools
```

Check the repository itself with:

```bash
python3 scripts/check.py
python3 scripts/test.py
```

Never commit `.env`.

## Known limitations

- The examples use a fixed demo order rather than a real order system.
- The API Request example's generated webhook is suitable for a demo, but a production endpoint should authenticate requests.
- Make must have an available active-scenario slot, and the API token must be able to manage scenarios and hooks.
- Make does not expose toolbox publishing through its API, so the MCP example requires one manual publishing step.
- Full runs create Vapi assistants and, for the MCP example, a Vapi tool. The scripts do not delete those resources.

## Built by

[Amanda Martin](https://www.linkedin.com/in/amandamartin-dev)

## License

[MIT](LICENSE)
