#!/usr/bin/env python3
"""Offline tests. No credentials, no network beyond localhost."""

from __future__ import annotations

import json
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import setup  # noqa: E402


def serve(responder) -> HTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            self.rfile.read(int(self.headers["Content-Length"]))
            status, body = responder()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args: object) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def expect_failure(label: str, call, *args) -> str:
    try:
        call(*args)
    except setup.Failure as exc:
        return str(exc)
    raise AssertionError(f"{label} should have failed")


def main() -> int:
    record = setup.RECORD

    # The blueprint carries the record and the live hook id, and restates neither.
    plan = setup.blueprint(42, "demo")
    assert plan["flow"][0]["parameters"]["hook"] == 42
    known, unknown = (route["flow"][0] for route in plan["flow"][1]["routes"])
    assert json.loads(known["mapper"]["body"]) == record
    # The unknown branch must echo the order asked for and never claim a status.
    missing = unknown["mapper"]["body"]
    assert '"found":false' in missing and "{{1.orderNumber}}" in missing
    assert "shipped" not in missing
    # Opposed filters, so exactly one branch answers any given webhook.
    assert known["filter"]["conditions"][0][0]["o"] == "text:equal"
    assert unknown["filter"]["conditions"][0][0]["o"] == "text:notequal"

    # The MCP scenario routes the same way and declares exactly the checked-in interface.
    mcp = setup.scenario_blueprint("demo")
    assert mcp["metadata"]["instant"] is False, "MCP scenario must be on-demand, not instant"
    mcp_known, mcp_unknown = (route["flow"][0] for route in mcp["flow"][1]["routes"])
    assert mcp_known["mapper"]["orderNumber"] == "{{1.orderNumber}}"
    assert mcp_unknown["mapper"] == {"found": False, "orderNumber": "{{1.orderNumber}}"}
    assert mcp_known["filter"]["conditions"][0][0]["o"] == "text:equal"
    assert mcp_unknown["filter"]["conditions"][0][0]["o"] == "text:notequal"
    for branch in (mcp_known, mcp_unknown):
        assert branch["metadata"]["expect"] == setup.INTERFACE["output"]
    # Every record field must be declared as an output, or the MCP tool silently drops it.
    assert {f["name"] for f in setup.INTERFACE["output"]} == set(record)
    # Only the fields both branches return may be required.
    required = {f["name"] for f in setup.INTERFACE["output"] if f["required"]}
    assert required == set(mcp_unknown["mapper"]), f"required outputs {required} are not always returned"

    # A team id that is not numeric must fail as an operator error, not a traceback.
    expect_failure("non-numeric team", setup.team_id, {"MAKE_TEAM_ID": "Team 12345"})
    assert setup.team_id({"MAKE_TEAM_ID": " 2927425 "}) == 2927425

    # A matching name is not ownership; only reuse an id this checkout recorded.
    with tempfile.TemporaryDirectory() as directory:
        state_path = Path(directory) / "state.json"
        lookalike = {"id": 7, "name": "demo"}
        assert setup.owned_scenario("mcp", 1, "demo", [lookalike], state_path) is None
        setup.remember_scenario("mcp", 1, 7, state_path)
        assert setup.owned_scenario("mcp", 1, "demo", [lookalike], state_path) == lookalike
        assert setup.owned_scenario("mcp", 2, "demo", [lookalike], state_path) is None
        assert setup.owned_scenario("mcp", 1, "renamed", [lookalike], state_path) is None

    # Webhook resolution: reuse a configured URL, otherwise demand Make credentials.
    assert setup.webhook_url({"MAKE_WEBHOOK_URL": "https://example.test/hook"}) == "https://example.test/hook"
    expect_failure("no credentials", setup.webhook_url, {})
    expect_failure("bad zone", setup.webhook_url, {"MAKE_API_KEY": "k", "MAKE_TEAM_ID": "1", "MAKE_ZONE": "nope"})

    # A Make scenario answers with the record, the wrong record, or not at all.
    good = serve(lambda: (200, json.dumps(record).encode()))
    setup.check_webhook(f"http://127.0.0.1:{good.server_address[1]}/hook")
    good.shutdown()

    wrong = serve(lambda: (200, b'{"found": false}'))
    expect_failure("wrong record", setup.check_webhook, f"http://127.0.0.1:{wrong.server_address[1]}/hook")
    wrong.shutdown()

    accepted = serve(lambda: (200, b"Accepted"))
    secret_url = f"http://127.0.0.1:{accepted.server_address[1]}/do-not-print?token=also-secret"
    message = expect_failure("unanswered webhook", setup.check_webhook, secret_url)
    assert "do-not-print" not in message and "also-secret" not in message
    accepted.shutdown()

    # Chat verification pairs a tool call with the result carrying its id.
    call = {"id": "c1", "type": "function",
            "function": {"name": "lookup_order_status", "arguments": '{"orderNumber": "ORD-1001"}'}}
    caller = {"role": "assistant", "tool_calls": [call]}
    setup.verify({"output": [caller, {"role": "tool", "content": json.dumps(record), "tool_call_id": "c1"}]})
    blocks = json.dumps([{"type": "text", "text": json.dumps(record)}])
    setup.verify({"output": [caller, {"role": "tool", "content": blocks, "tool_call_id": "c1"}]})
    expect_failure("uncorrelated result", setup.verify,
                   {"output": [caller, {"role": "tool", "content": "{}", "tool_call_id": "other"}]})

    print("PASS: both blueprints, the MCP contract, webhook resolution, and chat verification")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
