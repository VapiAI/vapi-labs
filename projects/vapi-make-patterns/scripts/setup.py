#!/usr/bin/env python3
"""Create and run one Vapi + Make demo."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples"
RECORD = json.loads((EXAMPLES / "order.json").read_text(encoding="utf-8"))
VARIABLE = re.compile(r"\$\{([A-Z][A-Z0-9_]*)\}")
PATTERNS = ("api-request", "mcp")
STATE_PATH = ROOT / ".vapi-make-state.json"


class Failure(Exception):
    """An operator-facing error, reported without a traceback."""


def environment() -> dict[str, str]:
    """Read .env over the process environment, so an edit to .env always wins."""
    values = dict(os.environ)
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                # A blank line in .env means "unset here", not "override the environment".
                if value.strip():
                    values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def require(values: dict[str, str], name: str) -> str:
    value = values.get(name, "").strip()
    if not value:
        raise Failure(f"Set {name} in .env. See .env.example.")
    return value


def render(path: Path, values: dict[str, str]) -> dict[str, Any]:
    return json.loads(VARIABLE.sub(lambda m: require(values, m.group(1)), path.read_text(encoding="utf-8")))


def safe_endpoint(url: str) -> str:
    """Keep useful connection context without printing credential-bearing URL parts."""
    parsed = urllib.parse.urlsplit(url)
    host = parsed.hostname or "endpoint"
    if ":" in host:
        host = f"[{host}]"
    return f"{parsed.scheme or 'https'}://{host}{f':{parsed.port}' if parsed.port else ''}"


def request(
    url: str, body: bytes, headers: dict[str, str], method: str = "POST", timeout: int = 120
) -> dict[str, Any]:
    """Send one JSON request, retrying the rate limits Vapi and Make both enforce."""
    endpoint = safe_endpoint(url)
    # urllib's default User-Agent is rejected by the edge in front of the Vapi API.
    call = urllib.request.Request(
        url, data=body, method=method, headers={"User-Agent": "vapi-make-examples/1.0", **headers}
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(call, timeout=timeout) as response:
                raw = response.read().decode("utf-8")
            # MCP answers over SSE; take the JSON out of the data frame. Ping and comment
            # frames carry none, so do not assume one is there.
            if raw.startswith("event:"):
                frames = [line[6:] for line in raw.splitlines() if line.startswith("data: ")]
                if not frames:
                    raise Failure(f"{method} {endpoint} sent an SSE reply with no data frame.")
                raw = frames[0]
            return json.loads(raw)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace").strip()[:400]
            if exc.code == 429 and attempt < 2:
                time.sleep(2**attempt)
                continue
            raise Failure(f"{method} {endpoint} returned HTTP {exc.code}: {detail}") from None
        except urllib.error.URLError as exc:
            raise Failure(f"{method} {endpoint} could not be reached: {exc.reason}") from None
        # A read that exceeds `timeout` raises socket.timeout, an OSError and not a URLError.
        except OSError as exc:
            raise Failure(f"{method} {endpoint} timed out after {timeout}s: {exc}") from None
        except json.JSONDecodeError:
            # Make answers "Accepted" when nothing responds synchronously, which is the usual
            # sign that the scenario is missing a Webhook response module or is not active.
            hint = " Add a Webhook response module and activate the scenario." if raw.strip() == "Accepted" else ""
            raise Failure(f"{method} {endpoint} did not return JSON: {raw[:200]!r}.{hint}") from None
    raise Failure(f"{method} {endpoint} could not be completed.")  # unreachable, keeps the type honest


def vapi(method: str, path: str, token: str, body: dict[str, Any]) -> dict[str, Any]:
    return request(
        f"https://api.vapi.ai{path}",
        json.dumps(body).encode("utf-8"),
        {"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method,
    )


def respond(module_id: int, body: str, y: int, condition: dict[str, str], label: str) -> dict[str, Any]:
    """One router branch: a filter, and the JSON it answers the webhook with."""
    return {
        "id": module_id, "module": "gateway:WebhookRespond", "version": 1,
        "mapper": {"body": body, "status": "200",
                   "headers": [{"key": "Content-Type", "value": "application/json"}]},
        "parameters": {},
        "filter": {"name": label, "conditions": [[condition]]},
        "metadata": {"designer": {"x": 600, "y": y},
                     "restore": {"expect": {"headers": {"mode": "chose"}}}},
    }


def blueprint(hook_id: int, name: str) -> dict[str, Any]:
    """The demo scenario: answer the known order, and report every other one as not found.

    The unknown branch echoes the order asked for; the known branch answers with the record,
    which the filter guarantees is the same order. A stub that answered every request
    identically would teach a lookup that cannot fail, which is the one behavior a voice agent
    must never copy. Replace the two response modules with a real lookup.
    """
    known = RECORD["orderNumber"]
    # Routes carry opposed filters rather than one filter and a fallback, because a route
    # with no filter also matches, and two response modules would answer the same webhook.
    return {
        "name": name,
        "flow": [
            {"id": 1, "module": "gateway:CustomWebHook", "version": 1, "mapper": {},
             "parameters": {"hook": hook_id, "maxResults": 1},
             "metadata": {"designer": {"x": 0, "y": 0},
                          "restore": {"parameters": {"hook": {"data": {"editable": "true"},
                                                              "label": name}}}}},
            {"id": 2, "module": "builtin:BasicRouter", "version": 1, "mapper": None,
             "metadata": {"designer": {"x": 300, "y": 0}},
             "routes": [
                 {"flow": [respond(3, json.dumps(RECORD, separators=(",", ":")), -150,
                                   {"a": "{{1.orderNumber}}", "b": known, "o": "text:equal"},
                                   f"{known} is the demo order")]},
                 {"flow": [respond(4, '{"found":false,"orderNumber":"{{1.orderNumber}}"}', 150,
                                   {"a": "{{1.orderNumber}}", "b": known, "o": "text:notequal"},
                                   "every other order is unknown")]},
             ]},
        ],
        "metadata": {"instant": True, "version": 1, "designer": {"orphans": []},
                     "scenario": {"maxErrors": 3, "autoCommit": True, "roundtrips": 1,
                                  "sequential": False, "autoCommitTriggerLast": True}},
    }


INTERFACE = json.loads((EXAMPLES / "mcp" / "scenario-interface.json").read_text(encoding="utf-8"))


def scenario_blueprint(name: str) -> dict[str, Any]:
    """The MCP demo scenario: declared inputs and outputs, routed the same way.

    The shipment fields are optional so the unknown branch can leave them out rather than
    return an empty status, which a model reads as a value it may fill in.
    """
    known = RECORD["orderNumber"]
    outputs = INTERFACE["output"]

    def give(module_id: int, values: dict[str, Any], y: int, operator: str, label: str) -> dict[str, Any]:
        return {
            "id": module_id, "module": "scenario-service:ReturnData", "version": 2,
            "mapper": values, "parameters": {},
            "filter": {"name": label,
                       "conditions": [[{"a": "{{1.orderNumber}}", "b": known, "o": operator}]]},
            "metadata": {"designer": {"x": 600, "y": y}, "expect": outputs},
        }

    return {
        "name": name,
        "flow": [
            {"id": 1, "module": "scenario-service:StartSubscenario", "version": 2,
             "mapper": {}, "parameters": {},
             "metadata": {"designer": {"x": 0, "y": 0}, "interface": INTERFACE["input"]}},
            {"id": 2, "module": "builtin:BasicRouter", "version": 1, "mapper": None,
             "metadata": {"designer": {"x": 300, "y": 0}},
             "routes": [
                 {"flow": [give(3, dict(RECORD, orderNumber="{{1.orderNumber}}"), -150,
                                "text:equal", f"{known} is the demo order")]},
                 {"flow": [give(4, {"found": False, "orderNumber": "{{1.orderNumber}}"}, 150,
                                "text:notequal", "every other order is unknown")]},
             ]},
        ],
        "metadata": {"instant": False, "version": 1, "designer": {"orphans": []},
                     "scenario": {"maxErrors": 3, "autoCommit": True, "roundtrips": 1,
                                  "sequential": False, "autoCommitTriggerLast": True}},
    }


def team_id(values: dict[str, str]) -> int:
    raw = require(values, "MAKE_TEAM_ID")
    if not raw.isdigit():
        raise Failure(f"MAKE_TEAM_ID must be the numeric team id from the Make URL, not {raw!r}.")
    return int(raw)


def make_api(values: dict[str, str]):
    """Bind a caller to the Make API for this team and zone."""
    token = require(values, "MAKE_API_KEY")
    team_id(values)
    zone = require(values, "MAKE_ZONE").removeprefix("https://").rstrip("/")
    if not re.fullmatch(r"[a-z0-9.-]+\.make\.com", zone):
        raise Failure(f"MAKE_ZONE must be a Make host like eu2.make.com, not {zone!r}.")
    base = f"https://{zone}/api/v2"
    headers = {"Authorization": f"Token {token}", "Content-Type": "application/json"}

    def api(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        return request(f"{base}{path}", data, headers, method)

    return api


def state_read(path: Path = STATE_PATH) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise Failure(f"Could not read {path.name}: {exc}") from None
    if not isinstance(state, dict):
        raise Failure(f"{path.name} must contain a JSON object.")
    return state


def owned_scenario(
    pattern: str, team: int, name: str, scenarios: list[dict[str, Any]], path: Path = STATE_PATH
) -> dict[str, Any] | None:
    """Return only a scenario previously recorded as created by this checkout."""
    saved = state_read(path).get(pattern)
    if not isinstance(saved, dict) or saved.get("teamId") != team:
        return None
    scenario_id = saved.get("scenarioId")
    return next((item for item in scenarios
                 if item.get("id") == scenario_id and item.get("name") == name), None)


def remember_scenario(pattern: str, team: int, scenario_id: int, path: Path = STATE_PATH) -> None:
    state = state_read(path)
    state[pattern] = {"teamId": team, "scenarioId": scenario_id}
    try:
        path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    except OSError as exc:
        raise Failure(f"Could not write {path.name}: {exc}") from None


def provision_scenario(values: dict[str, str]) -> int:
    """Create and activate the on-demand scenario the MCP toolbox will publish."""
    api = make_api(values)
    team = team_id(values)
    name = "vapi_demo_mcp_order_status"
    scenarios = api("GET", f"/scenarios?teamId={team}&pg[limit]=1000").get("scenarios", [])
    existing = owned_scenario("mcp", team, name, scenarios)
    if existing:
        scenario_id, active = existing["id"], bool(existing.get("isActive"))
        # Refresh it, so editing examples/order.json actually changes what Make answers.
        api("PATCH", f"/scenarios/{scenario_id}",
            {"blueprint": json.dumps(scenario_blueprint(name), separators=(",", ":"))})
        print(f"Reusing Make scenario {scenario_id}")
    else:
        created = api("POST", "/scenarios?confirmed=true", {
            "teamId": team,
            "blueprint": json.dumps(scenario_blueprint(name), separators=(",", ":")),
            "scheduling": json.dumps({"type": "on-demand"}, separators=(",", ":")),
        }).get("scenario", {})
        scenario_id, active = created.get("id"), bool(created.get("isActive"))
        if not isinstance(scenario_id, int):
            raise Failure(f"Make created no scenario: {json.dumps(created)[:200]}")
        remember_scenario("mcp", team, scenario_id)
        print(f"Created Make scenario {scenario_id}")
    # A blueprint does not declare the scenario interface, and Make rejects every input until
    # it does. Without this the scenario fails validation before a single module runs.
    api("PATCH", f"/scenarios/{scenario_id}/interface",
        {"interface": INTERFACE})

    if not active:
        try:
            api("POST", f"/scenarios/{scenario_id}/start")
        except Failure as exc:
            if "IM324" in str(exc) or "active scenarios" in str(exc):
                raise Failure(f"Make scenario {scenario_id} exists but cannot start: the team is at its "
                              "active-scenario limit. Deactivate one in Make, then rerun.") from None
            raise
    print(f"Make scenario {scenario_id} is active and On demand")
    return scenario_id


def provision_make(values: dict[str, str]) -> str:
    """Create and activate the demo scenario in Make, returning its webhook address."""
    api = make_api(values)
    team = team_id(values)
    name = "vapi_demo_order_status"
    scenarios = api("GET", f"/scenarios?teamId={team}&pg[limit]=1000").get("scenarios", [])
    existing = owned_scenario("api-request", team, name, scenarios)
    if existing:
        scenario_id = existing["id"]
        active = bool(existing.get("isActive"))
        url = api("GET", f"/scenarios/{scenario_id}/triggers").get("url")
        if not isinstance(url, str):
            raise Failure(f"Make scenario {scenario_id} exposes no webhook address; delete it and rerun.")
        hook_id = api("GET", f"/scenarios/{scenario_id}/triggers").get("id")
        if isinstance(hook_id, int):
            # Refresh it, so editing examples/order.json actually changes what Make answers.
            api("PATCH", f"/scenarios/{scenario_id}",
                {"blueprint": json.dumps(blueprint(hook_id, name), separators=(",", ":"))})
        print(f"Reusing Make scenario {scenario_id}")
    else:
        hook = api("POST", "/hooks", {
            "name": name, "teamId": str(team), "typeName": "gateway-webhook",
            "method": False, "headers": False, "stringify": False,
        }).get("hook", {})
        hook_id, url = hook.get("id"), hook.get("url")
        if not isinstance(hook_id, int) or not isinstance(url, str):
            raise Failure(f"Make created no usable webhook: {json.dumps(hook)[:200]}")
        scenario = api("POST", "/scenarios?confirmed=true", {
            "teamId": team,
            "blueprint": json.dumps(blueprint(hook_id, name), separators=(",", ":")),
            "scheduling": json.dumps({"type": "immediately"}, separators=(",", ":")),
        }).get("scenario", {})
        scenario_id = scenario.get("id")
        active = bool(scenario.get("isActive"))
        if not isinstance(scenario_id, int):
            raise Failure(f"Make created webhook {hook_id} but no scenario: {json.dumps(scenario)[:200]}")
        remember_scenario("api-request", team, scenario_id)
        print(f"Created Make webhook {hook_id} and scenario {scenario_id}")

    if not active:
        try:
            api("POST", f"/scenarios/{scenario_id}/start")
        except Failure as exc:
            # Make plans cap how many scenarios may be active at once.
            if "IM324" in str(exc) or "active scenarios" in str(exc):
                raise Failure(f"Make scenario {scenario_id} exists but cannot start: the team is at its "
                              "active-scenario limit. Deactivate one in Make, then rerun.") from None
            raise
    print(f"Make scenario {scenario_id} is active")
    return url


def webhook_url(values: dict[str, str]) -> str:
    """Reuse MAKE_WEBHOOK_URL when set, otherwise build the scenario in Make."""
    existing = values.get("MAKE_WEBHOOK_URL", "").strip()
    if existing:
        return existing
    if not values.get("MAKE_API_KEY", "").strip():
        raise Failure("Set MAKE_API_KEY, MAKE_TEAM_ID and MAKE_ZONE in .env so the scenario can be "
                      "created, or set MAKE_WEBHOOK_URL to an existing one. See .env.example.")
    return provision_make(values)


def check_webhook(url: str) -> None:
    """Exercise the Make scenario alone, without creating any Vapi resources."""
    sample = (EXAMPLES / "api-request" / "request.json").read_bytes()
    # An API Request tool uses any 2xx JSON response as the tool result directly.
    body = request(url, sample, {"Content-Type": "application/json"})
    print(f"Make returned: {json.dumps(body)}")
    if body != RECORD:
        raise Failure(f"Make returned {body}, expected {RECORD}.")
    print("PASS: the Make webhook returns a valid tool result")


def list_mcp_tools(url: str) -> None:
    """Show what the MCP URL exposes. Vapi imports all of it, on every turn."""
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}

    def rpc(method: str, params: dict[str, Any], ident: int) -> dict[str, Any]:
        payload = {"jsonrpc": "2.0", "id": ident, "method": method, "params": params}
        body = request(url, json.dumps(payload).encode("utf-8"), headers)
        if "result" not in body:
            raise Failure(f"MCP {method} failed: {json.dumps(body)[:300]}")
        return body["result"]

    rpc("initialize", {"protocolVersion": "2025-03-26", "capabilities": {},
                       "clientInfo": {"name": "vapi-make-examples", "version": "1.0"}}, 1)
    tools = rpc("tools/list", {}, 2)["tools"]
    size = len(json.dumps(tools))
    for tool in tools:
        print(f"  {tool['name']}")
    print(f"{len(tools)} tool(s), {size:,} bytes of definitions (~{size // 4:,} tokens per turn)")
    if len(tools) > 10:
        print("WARNING: Vapi cannot filter these. Point MAKE_MCP_URL at a toolbox holding only the")
        print("         scenarios this assistant needs, or the chat may time out.")


def verify(chat: dict[str, Any]) -> None:
    """Pair each tool call with the result carrying its id, and print the round trip."""
    output = chat.get("output", [])
    calls = {c["id"]: c for m in output for c in m.get("tool_calls") or []}
    results = {m["tool_call_id"]: m for m in output if m.get("role") == "tool"}
    paired = [(calls[i], results[i]) for i in calls if i in results]
    if not paired:
        raise Failure(f"Vapi returned no correlated tool result. Chat output: {json.dumps(output)}")

    call, result = paired[0]
    print(f"Tool call   {call['id']} {json.dumps(call.get('function', {}))}")
    print(f"Tool result {result['tool_call_id']} {result['content']}")
    try:
        returned = json.loads(result["content"])
        if isinstance(returned, list):  # MCP results arrive as content blocks
            returned = json.loads(returned[0]["text"])
    except (KeyError, IndexError, TypeError, json.JSONDecodeError):
        raise Failure(f"The tool result was not the expected JSON: {result['content']}") from None
    if returned != RECORD:
        raise Failure(f"The tool returned {returned}, expected {RECORD}.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pattern", choices=PATTERNS)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--check-webhook",
        action="store_true",
        help="api-request only: post request.json to the Make webhook and stop",
    )
    mode.add_argument(
        "--provision-scenario",
        action="store_true",
        help="mcp only: create the on-demand Make scenario to publish in a toolbox, and stop",
    )
    mode.add_argument(
        "--list-tools",
        action="store_true",
        help="mcp only: list what the MCP URL exposes to Vapi and stop",
    )
    args = parser.parse_args()
    values = environment()

    if args.check_webhook:
        if args.pattern != "api-request":
            parser.error("--check-webhook applies to the api-request pattern")
        check_webhook(webhook_url(values))
        return 0

    if args.provision_scenario:
        if args.pattern != "mcp":
            parser.error("--provision-scenario applies to the mcp pattern")
        scenario_id = provision_scenario(values)
        print(f"\nPublish scenario {scenario_id} in a Make MCP toolbox, then put the toolbox's")
        print("Streamable HTTP connection URL in .env as MAKE_MCP_URL.")
        return 0

    if args.list_tools:
        if args.pattern != "mcp":
            parser.error("--list-tools applies to the mcp pattern")
        list_mcp_tools(require(values, "MAKE_MCP_URL"))
        return 0

    token = require(values, "VAPI_API_KEY")
    if args.pattern == "api-request":
        values["MAKE_WEBHOOK_URL"] = webhook_url(values)
    example = EXAMPLES / args.pattern
    if args.pattern == "mcp":
        tool = vapi("POST", "/tool", token, render(example / "vapi-tool.template.json", values))
        if not isinstance(tool.get("id"), str):
            raise Failure(f"Vapi returned no MCP tool id: {json.dumps(tool)}")
        values["VAPI_MCP_TOOL_ID"] = tool["id"]
        print(f"Created Vapi MCP tool {tool['id']}")

    # The Make webhook accepts any caller that knows its address. For production, send a
    # shared secret from assistant.template.json and check it in Make: an apiRequest tool
    # takes "headers", and "credentialId" for a stored Vapi credential.
    assistant = vapi("POST", "/assistant", token, render(example / "assistant.template.json", values))
    if not isinstance(assistant.get("id"), str):
        raise Failure(f"Vapi returned no assistant id: {json.dumps(assistant)}")

    chat = vapi("POST", "/chat", token, {"assistantId": assistant["id"], "input": "Check order ORD-1001."})
    verify(chat)
    print(f"PASS: {args.pattern} demo completed through Vapi and Make")
    print(f"Assistant {assistant['id']} is ready to talk to in the Vapi Dashboard.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Failure as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1) from None
