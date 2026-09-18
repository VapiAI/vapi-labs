from __future__ import annotations

import json

import pytest

from vapi_build import compile as compiler, extract, ontology, plan, vapi
from vapi_build.cli import main
from vapi_build.workspace import BuildError, read_json
from .conftest import FakeVapi, evidence_for, valid_ontology, valid_plan


def write_ontology(project, data):
    data = dict(data)
    data.pop("_api_evidence", None)
    (project.path("ontology", "ontology.json")).write_text(json.dumps(data))


def test_fetch_and_extract_build_verifiable_ledger(project):
    ledger = extract.load_ledger(project)
    roles = {s["role"] for s in ledger["segments"]}
    assert roles == {"website", "knowledge", "openapi", "transcripts"}
    texts = {}
    for evidence in ledger["evidence"]:
        segment = next(s for s in ledger["segments"] if s["id"] == evidence["segment"])
        text = texts.setdefault(segment["id"], extract.segment_text(project, segment))
        assert text[evidence["start"]:evidence["end"]].strip()
    joined = "\n".join(texts.values())
    assert "staff discount code" not in joined and "ignore all previous instructions" not in joined
    assert "Children under five travel free" in joined
    assert "Conversation c1" in joined
    assert any(g["reason"].startswith("pdf") for g in ledger["gaps"])
    capabilities = read_json(project.path("evidence", "capabilities.json"))
    by_id = {op["operationId"]: op for op in capabilities["operations"]}
    assert by_id["adminReset"]["classification"]["risk"] == "PRIVILEGED"
    assert by_id["createBooking"]["classification"]["confirmBeforeCall"] is True
    assert by_id["getSchedule"]["classification"]["public"] is True
    assert by_id["getSchedule"]["toolSchema"]["properties"]["route"]["enum"] == ["northport-gull", "gull-northport"]
    assert by_id["createBooking"]["toolSchema"]["required"] == ["route", "passengers"]
    packets = sorted(project.path("evidence", "packets").glob("*.md"))
    assert packets and "[evidence:" in packets[0].read_text()
    inventory = read_json(project.path("raw", "source-transcripts", "inventory.json"))
    assert inventory["sampling"]["sampled"] == 4 and inventory["privacy"] == "synthetic"


def test_ontology_check_passes_and_summarizes(project):
    write_ontology(project, valid_ontology(extract.load_ledger(project)))
    report = ontology.check_ontology(project)
    assert report["status"] == "CANDIDATE", report["errors"]
    assert report["coverage"]["uncited"]  # informational: not every segment was cited
    candidate = ontology.load_candidate(project)
    assert candidate["capabilities"][0]["operationId"] in {"getSchedule", "getBooking", "createBooking"}
    assert all(c["enabled"] is False for c in candidate["capabilities"])
    summary = ontology.summarize(candidate)
    assert "Harbor Light Ferries" in summary and "getSchedule" in summary and "Get a refund" in summary
    assert ontology.approve_ontology(project, by="tester")["digest"] == candidate["digest"]


@pytest.mark.parametrize("mutation", ["phantom-evidence", "rule-from-calls", "unknown-capability", "cycle", "dangling-step", "duplicate-id", "no-goals", "bad-prefix"])
def test_ontology_defects_are_rejected(project, mutation):
    ledger = extract.load_ledger(project)
    data = valid_ontology(ledger)
    if mutation == "phantom-evidence":
        data["types"][0]["evidence"] = ["evidence:made-up"]
    elif mutation == "rule-from-calls":
        data["rules"][0]["evidence"] = [evidence_for(ledger, "transcripts")]
    elif mutation == "unknown-capability":
        data["capabilities"].append({"id": "capability:teleport"})
    elif mutation == "cycle":
        data["types"][0]["parents"] = ["type:booking"]
        data["types"][1]["parents"] = ["type:crossing"]
    elif mutation == "dangling-step":
        data["procedures"][0]["steps"][0]["next"] = ["step:missing"]
    elif mutation == "duplicate-id":
        data["claims"].append(dict(data["claims"][0]))
    elif mutation == "no-goals":
        data["goals"] = []
        data["procedures"][0]["goals"] = []
        data["observations"][0]["goals"] = []
        data["capabilities"] = [{"id": "capability:getbooking"}]
    else:
        data["types"][0]["id"] = "entity:crossing"
    write_ontology(project, data)
    report = ontology.check_ontology(project)
    assert report["status"] == "REJECTED" and report["errors"]
    assert not project.path("ontology", "candidate.json").exists()
    with pytest.raises(BuildError):
        ontology.approve_ontology(project)


def test_critical_issue_blocks_approval(project):
    data = valid_ontology(extract.load_ledger(project))
    data["issues"].append({"id": "issue:blocker", "kind": "CONFLICT", "severity": "CRITICAL", "description": "Two refund windows conflict."})
    write_ontology(project, data)
    assert ontology.check_ontology(project)["status"] == "BLOCKED_BY_CRITICAL_ISSUES"
    with pytest.raises(BuildError, match="critical"):
        ontology.approve_ontology(project)


def approved(project):
    write_ontology(project, valid_ontology(extract.load_ledger(project)))
    ontology.check_ontology(project)
    ontology.approve_ontology(project, by="tester")


def test_plan_check_resolves_tools_and_requires_confirmation(project):
    approved(project)
    project.path("plan", "plan.json").write_text(json.dumps(valid_plan()))
    report = plan.check_plan(project)
    assert report["status"] == "CANDIDATE", report["errors"]
    assert any("POST /bookings (createBooking)" in op for op in report["enabledOperations"])
    candidate = plan.load_candidate(project)
    assert candidate["runtime"]["serverUrl"] == "https://ferries.example"
    assert candidate["runtime"]["model"]["provider"] == "openai"
    assert plan.summarize(candidate, ontology.approved_ontology(project)).startswith("# Plan summary")
    plan.approve_plan(project, by="tester")


@pytest.mark.parametrize("mutation", ["privileged", "no-confirm", "undeclared-tool", "unknown-goal", "bearer-no-env", "reserved-env", "long-name", "two-assistants-no-squad", "stale-ontology"])
def test_plan_defects_are_rejected(project, mutation):
    approved(project)
    data = valid_plan()
    if mutation == "privileged":
        data["tools"].append({"operationId": "adminReset", "description": "Reset", "auth": {"mode": "NONE"}})
    elif mutation == "no-confirm":
        data["tools"][2].pop("confirmBeforeCall")
    elif mutation == "undeclared-tool":
        data["jobs"][0]["tools"] = ["cancelBooking"]
    elif mutation == "unknown-goal":
        data["jobs"][0]["goals"] = ["goal:teleport"]
    elif mutation == "bearer-no-env":
        data["tools"][1]["auth"] = {"mode": "HEADER_ENV"}
    elif mutation == "reserved-env":
        data["tools"][1]["auth"] = {"mode": "HEADER_ENV", "env": "VAPI_API_KEY"}
    elif mutation == "long-name":
        data["assistants"][0]["name"] = "Harbor Light Ferries Passenger Concierge Desk"
    elif mutation == "two-assistants-no-squad":
        data["assistants"].append({**data["assistants"][0], "id": "second", "name": "Second"})
    project.path("plan", "plan.json").write_text(json.dumps(data))
    if mutation == "stale-ontology":
        plan.check_plan(project)
        plan.approve_plan(project, by="tester")
        changed = valid_ontology(extract.load_ledger(project))
        changed["claims"][0]["text"] = "An adult single fare is 13 dollars."
        write_ontology(project, changed)
        ontology.check_ontology(project)
        with pytest.raises(BuildError, match="differs from what was approved|changed"):
            plan.approved_plan(project)
        return
    report = plan.check_plan(project)
    assert report["status"] == "REJECTED" and report["errors"], mutation


def test_compile_apply_resume_verify_teardown(project, monkeypatch):
    approved(project)
    project.path("plan", "plan.json").write_text(json.dumps(valid_plan()))
    plan.check_plan(project)
    plan.approve_plan(project, by="tester")
    build = compiler.compile_build(project)
    names = {f["name"] for f in build["knowledgeBase"]["files"]}
    assert "harbor-light-ferries-domain-guide.md" in names and "refund-policy.md" in names and "brochure.pdf" in names
    assert not any("january" in n or "extra" in n for n in names), "transcripts must never reach the knowledge base"
    guide = project.path("vapi", "knowledge", "harbor-light-ferries-domain-guide.md").read_text()
    assert "12 dollars" in guide and "(source: " in guide and "Callers say things like" in guide
    tools = {t["payload"]["name"]: t for t in build["tools"]}
    assert tools["getSchedule"]["payload"]["url"] == "https://ferries.example/public/schedules?route={{route}}"
    assert tools["getBooking"]["payload"]["url"] == "https://ferries.example/bookings/{{bookingId}}"
    assert tools["getBooking"]["secretHeaders"] == [{"name": "Authorization", "env": "FERRY_TOKEN", "prefix": "Bearer "}]
    assert tools["createBooking"]["secretHeaders"] == [{"name": "X-Ferry-Token", "env": "FERRY_TOKEN", "prefix": ""}]
    assert tools["createBooking"]["payload"]["headers"]["properties"]["X-Client"]["value"].startswith("vapi-build ")
    assert tools["createBooking"]["payload"]["body"]["required"] == ["route", "passengers"]
    assert "secret" not in json.dumps(build).casefold().replace("secretheaders", "")
    assert tools["getBooking"]["payload"]["variableExtractionPlan"] == {"aliases": [{"key": "bookingRoute", "value": "{{route}}"}]}
    assistant = build["assistants"][0]["payload"]
    prompt = assistant["model"]["messages"][0]["content"]
    assert "read back every value" in prompt and "Group charters" in prompt and "search the knowledge base" in prompt
    assert "# Jobs you handle" in prompt and "Read back route, date, and passenger count" in prompt and "Passengers may cancel for a full refund" in prompt
    assert assistant["firstMessage"] == "Harbor Light Ferries, how can I help?" and build["squad"] is None
    assert "Callers ask to cancel and be refunded" not in guide, "observations from transcripts stay out of the knowledge base"
    fake = FakeVapi()
    client = vapi.VapiClient("sk-test", transport=fake)
    with pytest.raises(BuildError, match="FERRY_TOKEN"):
        vapi.apply(project, client, secrets={}, sleep=lambda s: None)
    with pytest.raises(BuildError, match="private key itself"):
        vapi.apply(project, client, secrets={"FERRY_TOKEN": "sk-test"}, sleep=lambda s: None)
    assert not fake.calls, "a missing or unsafe token must fail before anything is created"
    receipts = vapi.apply(project, client, secrets={"FERRY_TOKEN": "secret-token"}, sleep=lambda s: None)
    order = [p for m, p, _ in fake.calls if m == "POST"]
    assert "/credential" not in order
    assert order.index("/file") < order.index("/v2/knowledge-base") < order.index("/tool") < order.index("/assistant")
    tool_calls = {b["name"]: b for m, p, b in fake.calls if p == "/tool" and m == "POST"}
    assert tool_calls["getBooking"]["headers"]["properties"]["Authorization"] == {"type": "string", "value": "Bearer secret-token"}
    assert tool_calls["createBooking"]["headers"]["properties"]["X-Ferry-Token"] == {"type": "string", "value": "secret-token"}
    assert "X-Client" in tool_calls["createBooking"]["headers"]["properties"]
    assert "secret-token" not in project.path("vapi", "receipts.json").read_text() and "secret-token" not in project.path("vapi", "build.json").read_text()
    assistant_call = next(b for m, p, b in fake.calls if p == "/assistant")
    assert assistant_call["model"]["toolIds"][0] == "tool_kb" and len(assistant_call["model"]["toolIds"]) == 4
    assert receipts["verified"] and len(receipts["files"]) == len(build["knowledgeBase"]["files"])
    assert all(entry["sha256"] for entry in receipts["files"].values())
    before = len(fake.calls)
    vapi.apply(project, client, secrets={"FERRY_TOKEN": "secret-token"}, sleep=lambda s: None)
    assert not [c for c in fake.calls[before:] if c[0] == "POST"], "resume must not create anything twice"
    assert vapi.verify(project, client)
    removed = vapi.teardown(project, client)
    kinds = [r.split(" ")[0] for r in removed]
    assert kinds.index("assistant") < kinds.index("tool") < kinds.index("v2/knowledge-base") < kinds.index("file")
    assert not project.path("vapi", "receipts.json").exists()


def test_knowledge_tool_falls_back_to_tool_listing(project):
    approved(project)
    project.path("plan", "plan.json").write_text(json.dumps(valid_plan()))
    plan.check_plan(project)
    plan.approve_plan(project, by="tester")
    compiler.compile_build(project)
    fake = FakeVapi(kb_tool_in_get=False)
    receipts = vapi.apply(project, vapi.VapiClient("sk", transport=fake), secrets={"FERRY_TOKEN": "t"}, sleep=lambda s: None)
    assert receipts["knowledgeBase"]["toolId"] == "tool_kb_listed"


def test_squad_with_handoffs(project):
    approved(project)
    data = valid_plan()
    data["assistants"] = [
        {"id": "front", "name": "Front Desk", "systemPrompt": "You greet passengers and route them to the right specialist without guessing.", "jobs": ["job:refund"],
         "knowledge": True, "handoffTo": [{"assistant": "booker", "when": "the caller wants to book or check a departure"}]},
        {"id": "booker", "name": "Booking Desk", "systemPrompt": "You book crossings and look up departures for passengers using the tools.", "jobs": ["job:schedule", "job:book"],
         "tools": ["getSchedule", "getBooking", "createBooking"], "handoffTo": [{"assistant": "front", "when": "the caller asks about refunds"}]},
    ]
    data["squad"] = {"entry": "front"}
    data["agent"]["topology"] = {"choice": "squad", "why": "Refund policy questions and booking actions have different tool access; a front desk routes callers."}
    project.path("plan", "plan.json").write_text(json.dumps(data))
    assert plan.check_plan(project)["status"] == "CANDIDATE"
    plan.approve_plan(project, by="tester")
    build = compiler.compile_build(project)
    assert build["squad"]["members"][0]["assistantRef"] == "assistant:front"
    front = build["assistants"][0]["payload"]["model"]
    assert front["tools"][0]["type"] == "handoff" and front["tools"][0]["destinations"][0]["assistantName"] == "Booking Desk"
    fake = FakeVapi()
    receipts = vapi.apply(project, vapi.VapiClient("sk", transport=fake), secrets={"FERRY_TOKEN": "t"}, sleep=lambda s: None)
    squad_call = next(b for m, p, b in fake.calls if p == "/squad")
    assert squad_call["members"][0]["assistantId"] == receipts["assistants"]["assistant:front"]


def test_cli_status_and_guards(project, capsys):
    assert main(["status", str(project.root)]) == 0
    out = capsys.readouterr().out
    assert "not checked" in out and "source:website" in out
    assert main(["apply", str(project.root)]) == 1  # refuses without --yes
    assert main(["check", "ontology", str(project.root)]) == 2  # no ontology written yet → BuildError


def test_stale_build_and_edited_candidates_are_refused(project):
    approved(project)
    project.path("plan", "plan.json").write_text(json.dumps(valid_plan()))
    plan.check_plan(project)
    plan.approve_plan(project, by="tester")
    compiler.compile_build(project)
    # Gate 2 revisited: drop createBooking, re-check, re-approve, but forget to compile.
    reduced = valid_plan()
    reduced["tools"] = [t for t in reduced["tools"] if t["operationId"] != "createBooking"]
    reduced["jobs"][1]["tools"] = ["getBooking"]
    reduced["assistants"][0]["tools"] = ["getSchedule", "getBooking"]
    project.path("plan", "plan.json").write_text(json.dumps(reduced))
    assert plan.check_plan(project)["status"] == "CANDIDATE"
    plan.approve_plan(project, by="tester")
    fake = FakeVapi()
    with pytest.raises(BuildError, match="compiled from a different plan"):
        vapi.apply(project, vapi.VapiClient("sk", transport=fake), secrets={"FERRY_TOKEN": "t"}, sleep=lambda s: None)
    assert not fake.calls
    compiler.compile_build(project)
    assert {t["operationId"] for t in read_json(project.path("vapi", "build.json"))["tools"]} == {"getSchedule", "getBooking"}
    # Hand-editing a candidate without re-checking is caught too.
    candidate = read_json(project.path("plan", "candidate.json"))
    candidate["agent"]["purpose"] = "tampered"
    project.path("plan", "candidate.json").write_text(json.dumps(candidate))
    with pytest.raises(BuildError, match="differs from what was approved"):
        plan.approved_plan(project)


def test_re_extract_invalidates_ontology_approval(project):
    approved(project)
    ontology.approved_ontology(project)
    import hashlib
    inventory_path = project.path("raw", "source-knowledge", "inventory.json")
    inventory = read_json(inventory_path)
    for item in inventory["items"]:
        if item["file"].endswith("refund-policy.md"):
            path = project.path("raw", "source-knowledge", item["file"])
            path.write_text("# Refund policy\n\n## Cancellations\nEverything changed.\n")
            item["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    project.path("raw", "source-knowledge", "inventory.json").write_text(json.dumps(inventory))
    extract.extract_all(project, batch_size=2)
    with pytest.raises(BuildError, match="evidence changed"):
        ontology.approved_ontology(project)


def test_render_review_page_grows_tab_by_tab(project):
    from vapi_build import render

    with pytest.raises(BuildError, match="Nothing to render"):
        render.render_review(project)
    write_ontology(project, valid_ontology(extract.load_ledger(project)))
    assert ontology.check_ontology(project)["status"] == "CANDIDATE"
    page = render.render_review(project).read_text()
    assert page.startswith('<meta charset="utf-8">\n<title>') and "cdnjs.cloudflare.com/ajax/libs/d3/" in page and 'data-digest="sha256:' in page
    assert "Get a refund" in page and "getSchedule" in page and '"evidence":{' in page and '"plan":null' in page and '"build":null' in page
    assert "</script" not in page.split('<script id="data"')[1].split("</script>")[0]  # embedded JSON cannot close the script early
    assert 'data-tab="ontology"' in page and 'data-tab="plan"' in page and 'data-tab="build"' in page
    project.path("plan", "plan.json").write_text(json.dumps(valid_plan()))
    assert plan.check_plan(project)["status"] == "CANDIDATE"
    page = render.render_review(project).read_text()
    assert "Harbor Light Concierge" in page and "createBooking" in page and "enabledOperations" in page and '"topology":{"choice":"single"' in page
    assert project.path("review.html").exists() and not project.path("plan", "plan.html").exists()


def test_apply_falls_back_to_query_tool_without_knowledge_v2(project, monkeypatch):
    approved(project)
    project.path("plan", "plan.json").write_text(json.dumps(valid_plan()))
    assert plan.check_plan(project)["status"] == "CANDIDATE"
    plan.approve_plan(project, by="tester")
    compiler.compile_build(project)
    fake = FakeVapi(v2_enabled=False)
    client = vapi.VapiClient("sk-test", transport=fake)
    receipts = vapi.apply(project, client, secrets={"FERRY_TOKEN": "t"}, sleep=lambda s: None)
    assert receipts["knowledgeBase"]["mode"] == "query"
    query_posts = [c for c in fake.calls if c[0] == "POST" and c[1] == "/tool" and c[2].get("type") == "query"]
    assert len(query_posts) == 1
    kb = query_posts[0][2]["knowledgeBases"][0]
    assert kb["provider"] == "google" and set(kb["fileIds"]) == {e["id"] for e in receipts["files"].values()}
    assert not any(c[1].startswith("/v2/knowledge-base") for c in fake.calls)
    for assistant in [c for c in fake.calls if c[0] == "POST" and c[1] == "/assistant"]:
        assert assistant[2]["model"]["toolIds"][0] == receipts["knowledgeBase"]["toolId"]
    removed = vapi.teardown(project, client)
    assert any(r == f"tool {receipts['knowledgeBase']['toolId']}" for r in removed)
