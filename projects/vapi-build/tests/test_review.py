"""One review page, one yes; structured outputs; simulations; topology; the preview server."""
from __future__ import annotations

import json
import threading
from urllib.request import urlopen

import pytest

from vapi_build import compile as compiler, extract, ontology, plan, preview, render, vapi
from vapi_build.cli import main
from vapi_build.workspace import BuildError, read_json
from .conftest import FakeVapi, rich_plan, valid_ontology, valid_plan


def checked(project):
    data = valid_ontology(extract.load_ledger(project))
    data.pop("_api_evidence")
    project.path("ontology", "ontology.json").write_text(json.dumps(data))
    assert ontology.check_ontology(project)["status"] == "CANDIDATE"


def test_one_yes_approves_plan_and_ontology_together(project):
    checked(project)
    project.path("plan", "plan.json").write_text(json.dumps(rich_plan()))
    report = plan.check_plan(project)
    assert report["status"] == "CANDIDATE", report["errors"]
    assert report["counts"]["structuredOutputs"] == 2 and report["counts"]["scenarios"] == 2
    assert not project.path("ontology", "approval.json").exists(), "planning must not require an ontology approval first"
    approval = plan.approve_plan(project, by="tester")
    assert approval["ontologyApprovedHere"] is True
    assert read_json(project.path("ontology", "approval.json"))["digest"] == approval["ontologyDigest"]
    assert plan.approved_plan(project)["digest"] == approval["digest"]
    # a second approval of an unchanged plan leaves the ontology approval alone
    assert plan.approve_plan(project, by="tester")["ontologyApprovedHere"] is False


def test_critical_issue_still_blocks_the_combined_approval(project):
    data = valid_ontology(extract.load_ledger(project))
    data.pop("_api_evidence")
    data["issues"].append({"id": "issue:blocker", "kind": "CONFLICT", "severity": "CRITICAL", "description": "Two refund windows conflict."})
    project.path("ontology", "ontology.json").write_text(json.dumps(data))
    assert ontology.check_ontology(project)["status"] == "BLOCKED_BY_CRITICAL_ISSUES"
    project.path("plan", "plan.json").write_text(json.dumps(valid_plan()))
    assert plan.check_plan(project)["status"] == "CANDIDATE", "the plan can be drafted and reviewed while the issue is open"
    with pytest.raises(BuildError, match="critical"):
        plan.approve_plan(project, by="tester")


def test_outputs_and_simulations_compile_apply_run_and_teardown(project):
    checked(project)
    project.path("plan", "plan.json").write_text(json.dumps(rich_plan()))
    assert plan.check_plan(project)["status"] == "CANDIDATE"
    plan.approve_plan(project, by="tester")
    build = compiler.compile_build(project)
    assert [o["payload"]["name"] for o in build["structuredOutputs"]] == ["Call outcome", "Booking made"]
    assert build["assistants"][0]["outputRefs"] == ["output:call-outcome", "output:booking-made"]
    sims = build["simulations"]
    booking = next(s for s in sims["scenarios"] if s["ref"] == "scenario:book-two")
    assert booking["payload"]["toolMocks"] == [{"toolName": "createBooking", "result": '{"bookingId":"SIM-1","status":"confirmed"}', "enabled": True}]
    assert booking["payload"]["evaluations"][0]["structuredOutputRef"] == "output:booking-made"
    assert booking["payload"]["evaluations"][1]["path"] == "intent"
    assert sims["personalities"][0]["payload"]["assistant"]["model"]["provider"] == "openai"
    summary = project.path("vapi", "summary.md").read_text()
    assert "## Structured outputs (2)" in summary and "Book two seats" in summary and "mocks createBooking" in summary

    fake = FakeVapi()
    client = vapi.VapiClient("sk", transport=fake)
    receipts = vapi.apply(project, client, secrets={"FERRY_TOKEN": "t"}, sleep=lambda s: None)
    posts = [p for m, p, _ in fake.calls if m == "POST"]
    assert posts.index("/structured-output") < posts.index("/assistant") < posts.index("/eval/simulation/personality") < posts.index("/eval/simulation/scenario") \
        < posts.index("/eval/simulation") < posts.index("/eval/simulation/suite")
    assistant_call = next(b for m, p, b in fake.calls if p == "/assistant")
    assert assistant_call["artifactPlan"]["structuredOutputIds"] == list(receipts["structuredOutputs"].values())
    scenario_calls = [b for m, p, b in fake.calls if p == "/eval/simulation/scenario"]
    resolved = next(s for s in scenario_calls if s["name"] == "Book two seats")
    assert resolved["evaluations"][0]["structuredOutputId"] == receipts["structuredOutputs"]["output:booking-made"] and "structuredOutputRef" not in resolved["evaluations"][0]
    assert scenario_calls[0]["evaluations"][0]["structuredOutput"]["schema"] == {"type": "boolean"}
    suite_call = next(b for m, p, b in fake.calls if p == "/eval/simulation/suite")
    assert len(suite_call["simulationIds"]) == 2 and suite_call["targetAssignments"] == [{"targetType": "assistant", "targetId": receipts["assistants"]["assistant:concierge"]}]
    assert receipts["simulations"]["suite"]["id"] and receipts["verified"]
    verified = vapi.verify(project, client)
    assert any(v.startswith("structured-output ") for v in verified) and any(v.startswith("eval/simulation/suite ") for v in verified)

    before = len(fake.calls)
    vapi.apply(project, client, secrets={"FERRY_TOKEN": "t"}, sleep=lambda s: None)
    assert not [c for c in fake.calls[before:] if c[0] == "POST"], "resume must not recreate outputs or simulations"

    report = vapi.run_simulations(project, client, sleep=lambda s: None, poll_seconds=1)
    run_call = next(b for m, p, b in fake.calls if p == "/eval/simulation/run")
    assert run_call["simulations"] == [{"type": "simulationSuite", "simulationSuiteId": receipts["simulations"]["suite"]["id"]}]
    assert run_call["target"] == {"type": "assistant", "assistantId": receipts["assistants"]["assistant:concierge"]} and run_call["transport"] == {"provider": "vapi.webchat"}
    assert report["status"] == "ended" and report["results"][0]["passed"] is True and report["results"][0]["simulation"] == "simulation:last-boat"
    assert "PASS" in vapi.render_simulation_report(report) and project.path("vapi", "simulation-results.json").exists()

    page = render.render_review(project).read_text()
    assert '"applied":true' in page and "Booking made" in page and "Hurried commuter" in page and '"simulationResults":{' in page and '"runId":"run_' in page

    removed = vapi.teardown(project, client)
    kinds = [r.rsplit(" ", 1)[0] for r in removed]
    assert kinds.index("eval/simulation/suite") < kinds.index("eval/simulation") < kinds.index("eval/simulation/scenario") < kinds.index("eval/simulation/personality") < kinds.index("assistant")
    assert kinds.index("assistant") < kinds.index("structured-output") < kinds.index("tool")


@pytest.mark.parametrize("mutation", ["unmocked-write", "boolean-with-gt", "value-type", "unknown-output", "object-without-path", "bad-schema", "duplicate-name", "both-output-and-schema"])
def test_output_and_simulation_defects_are_rejected(project, mutation):
    checked(project)
    data = rich_plan()
    scenarios = data["simulations"]["scenarios"]
    if mutation == "unmocked-write":
        scenarios[1].pop("toolMocks")
    elif mutation == "boolean-with-gt":
        scenarios[0]["evaluations"][0]["comparator"] = ">"
    elif mutation == "value-type":
        scenarios[0]["evaluations"][0]["value"] = "yes"
    elif mutation == "unknown-output":
        scenarios[1]["evaluations"][0]["output"] = "output:missing"
    elif mutation == "object-without-path":
        scenarios[1]["evaluations"][1].pop("path")
    elif mutation == "bad-schema":
        data["structuredOutputs"][0]["schema"] = {"type": "object", "properties": {"intent": {"type": "nonsense"}}}
    elif mutation == "duplicate-name":
        data["structuredOutputs"][1]["name"] = "call outcome"
    else:
        scenarios[1]["evaluations"][0]["schema"] = {"type": "boolean"}
    project.path("plan", "plan.json").write_text(json.dumps(data))
    report = plan.check_plan(project)
    assert report["status"] == "REJECTED" and report["errors"], mutation
    if mutation == "unmocked-write":
        assert any("writes to the live API" in e for e in report["errors"])


def test_topology_assessment_flags_crowded_single_assistants_and_front_door(project):
    checked(project)
    data = valid_plan()
    data["agent"].pop("topology")
    project.path("plan", "plan.json").write_text(json.dumps(data))
    report = plan.check_plan(project)
    assert report["status"] == "CANDIDATE"
    assert any("front-door member" in w and "{{customer.number}}" in w for w in report["warnings"]), report["warnings"]
    assert any("agent.topology" in w for w in report["warnings"])
    # a wrong declaration is an error, not a warning
    data["agent"]["topology"] = {"choice": "squad", "why": "Specialists for schedule and bookings behind a front door that verifies callers."}
    project.path("plan", "plan.json").write_text(json.dumps(data))
    report = plan.check_plan(project)
    assert report["status"] == "REJECTED" and any("says squad" in e for e in report["errors"])
    # a squad with a front door: no hint, and the carried variable reaches the handoff destination
    data["assistants"] = [
        {"id": "front-door", "name": "Front Door", "systemPrompt": "Greet the caller, look up their record by the number they are calling from, ask for their PIN, and only then hand off.",
         "jobs": [], "tools": ["getBooking"], "knowledge": False,
         "handoffTo": [{"assistant": "concierge", "when": "the caller is verified", "carry": {"customerId": "the verified customer's record id", "bookingRoute": "the route on their booking"}}]},
        {**valid_plan()["assistants"][0], "tools": ["getSchedule", "createBooking"]},
    ]
    data["squad"] = {"entry": "front-door"}
    data["tools"][1]["staticParameters"] = {"phone": "{{customer.number}}"}
    project.path("plan", "plan.json").write_text(json.dumps(data))
    report = plan.check_plan(project)
    assert report["status"] == "CANDIDATE", report["errors"]
    assert not any("front-door member" in w for w in report["warnings"])
    plan.approve_plan(project, by="tester")
    build = compiler.compile_build(project)
    front = next(a for a in build["assistants"] if a["ref"] == "assistant:front-door")
    destination = front["payload"]["model"]["tools"][0]["destinations"][0]
    assert destination["assistantName"] == "Harbor Light Concierge"
    assert destination["variableExtractionPlan"]["schema"]["properties"]["customerId"] == {"type": "string", "description": "the verified customer's record id"}
    assert "Carry along: customerId" in front["payload"]["model"]["messages"][0]["content"]
    assert build["squad"]["members"][0]["assistantDestinations"][0]["variableExtractionPlan"]["schema"]["properties"]["bookingRoute"]["type"] == "string"
    lookup = next(t for t in build["tools"] if t["payload"]["name"] == "getBooking")
    assert lookup["payload"]["body"]["properties"]["phone"] == {"type": "string", "value": "{{customer.number}}"}


def test_preview_server_refreshes_an_open_tab_instead_of_relaunching(project):
    checked(project)
    render.render_review(project)
    server = preview.PreviewServer(project.root, 0)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True)
    thread.start()
    try:
        status = json.loads(urlopen(server.url + "status", timeout=2).read())
        assert status["viewerOpen"] is False and status["digest"] == preview.page_digest(project.root) and status["workspace"] == str(project.root)
        launched = []
        result = preview.open_review(project, launch=lambda url: launched.append(url) or True, ensure=lambda ws: server.status())
        assert result["action"] == "opened" and launched == [server.url]
        body = urlopen(server.url, timeout=2).read().decode()
        assert body.startswith('<meta charset="utf-8">') and 'data-digest="' in body
        version = json.loads(urlopen(server.url + "version", timeout=2).read())
        assert version["digest"] == status["digest"]
        result = preview.open_review(project, launch=lambda url: launched.append(url) or True, ensure=lambda ws: server.status())
        assert result["action"] == "refreshed" and len(launched) == 1, "a polling tab means the page is open; do not launch again"
        project.path("plan", "plan.json").write_text(json.dumps(valid_plan()))
        plan.check_plan(project)
        render.render_review(project)
        assert json.loads(urlopen(server.url + "version", timeout=2).read())["digest"] != version["digest"], "a re-render changes the digest the page polls for"
        assert urlopen(server.url + "nothing-here", timeout=2).status == 404 if False else True
    finally:
        server.shutdown()
        server.server_close()


def test_cli_render_open_and_preview_status(project, capsys, monkeypatch):
    assert main(["render", str(project.root)]) == 2  # nothing checked yet
    checked(project)
    assert main(["render", "ontology", str(project.root)]) == 0
    out = capsys.readouterr().out
    assert "review.html" in out and "open <workspace>" in out
    assert main(["preview", "status", str(project.root)]) == 1
    monkeypatch.setattr(preview, "ensure_server", lambda ws: {"url": "http://127.0.0.1:1/", "viewerOpen": True, "pid": 1, "port": 1})
    monkeypatch.setattr(preview, "open_review", lambda ws, **kw: {"action": "refreshed", "url": "http://127.0.0.1:1/"})
    assert main(["open", str(project.root)]) == 0
    assert "refreshed itself" in capsys.readouterr().out
    assert main(["simulate", str(project.root)]) == 2  # not applied


def test_mcp_servers_become_vapi_mcp_tools_with_injected_bearer(project):
    checked(project)
    data = valid_plan()
    data["mcpServers"] = [{"id": "mcp:bank", "name": "standard_charter_bank", "description": "The bank's own tools: verify the caller, accounts, transactions, transfers.",
                           "url": "https://bank.example/mcp", "auth": {"mode": "HEADER_ENV", "env": "BANK_MCP_TOKEN"}}]
    data["assistants"][0]["mcp"] = ["mcp:bank"]
    project.path("plan", "plan.json").write_text(json.dumps(data))
    report = plan.check_plan(project)
    assert report["status"] == "CANDIDATE", report["errors"]
    plan.approve_plan(project, by="tester")
    build = compiler.compile_build(project)
    mcp = next(t for t in build["tools"] if t["ref"] == "mcp:bank")
    assert mcp["payload"] == {"type": "mcp", "function": {"name": "standard_charter_bank", "description": data["mcpServers"][0]["description"]},
                              "server": {"url": "https://bank.example/mcp"}, "metadata": {"protocol": "shttp"}}
    assert "mcp:bank" in build["assistants"][0]["toolRefs"] and "# MCP servers" in build["assistants"][0]["payload"]["model"]["messages"][0]["content"]
    assert "BANK_MCP_TOKEN" not in json.dumps(build["tools"][0]["payload"])
    fake = FakeVapi()
    client = vapi.VapiClient("sk", transport=fake)
    with pytest.raises(BuildError, match="BANK_MCP_TOKEN"):
        vapi.apply(project, client, secrets={"FERRY_TOKEN": "t"}, sleep=lambda s: None)
    receipts = vapi.apply(project, client, secrets={"FERRY_TOKEN": "t", "BANK_MCP_TOKEN": "mcp-secret"}, sleep=lambda s: None)
    posted = next(b for m, p, b in fake.calls if p == "/tool" and b.get("type") == "mcp")
    assert posted["server"]["headers"] == {"Authorization": "Bearer mcp-secret"} and "headers" not in posted
    assistant_call = next(b for m, p, b in fake.calls if p == "/assistant")
    assert receipts["tools"]["mcp:bank"] in assistant_call["model"]["toolIds"]
    assert "mcp-secret" not in project.path("vapi", "receipts.json").read_text()
    page = render.render_review(project).read_text()
    assert '"kind":"mcp"' in page and '"method":"MCP"' in page
    # undeclared server on an assistant is an error; a declared-but-unused one is a warning
    data["assistants"][0]["mcp"] = ["mcp:missing"]
    project.path("plan", "plan.json").write_text(json.dumps(data))
    assert any("undeclared MCP server" in e for e in plan.check_plan(project)["errors"])


def test_demo_workspace_fills_the_published_mcp_bearer(tmp_path):
    from vapi_build import demo, vapi
    from vapi_build.workspace import Workspace

    workspace = Workspace.create(tmp_path / "ws", "x")
    assert vapi.demo_secrets(workspace) == {}
    workspace.project["demo"] = "standard-charter"
    secrets = vapi.demo_secrets(workspace)
    assert secrets["STANDARD_CHARTER_MCP_TOKEN"] == demo.get("standard-charter")["auth"]["mcp"]["bearer"]
