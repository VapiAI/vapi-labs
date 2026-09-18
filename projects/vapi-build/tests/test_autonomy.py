from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from vapi_build import compile as compiler, extract, ontology, plan, vapi
from vapi_build.workspace import BuildError
from .conftest import FakeVapi, valid_ontology, valid_plan

LAUNCHER = Path(__file__).resolve().parents[1] / "scripts" / "vapi-build"


def test_key_is_found_in_env_or_config_file_and_never_required_elsewhere(tmp_path):
    key_file = tmp_path / "env"
    with pytest.raises(BuildError, match=str(key_file)):
        vapi.client_from_env({}, key_file=key_file)
    key_file.write_text("# comment\nexport VAPI_PRIVATE_KEY='from-file'\nVAPI_BASE_URL=https://api.example\n")
    client = vapi.client_from_env({}, key_file=key_file)
    assert client.base_url == "https://api.example"
    assert vapi.find_key({}, key_file)[1] == str(key_file)
    assert vapi.find_key({"VAPI_API_KEY": "env-wins"}, key_file) == ("env-wins", "environment variable VAPI_API_KEY")


def _built(project):
    data = valid_ontology(extract.load_ledger(project))
    data.pop("_api_evidence")
    project.path("ontology", "ontology.json").write_text(json.dumps(data))
    ontology.check_ontology(project)
    ontology.approve_ontology(project, by="tester")
    plan_data = valid_plan()
    plan_data["tests"].append({"id": "test:booking", "scenario": "Booking with follow-up", "callerOpening": "I want to book two seats.",
                               "followUps": ["Northport to Gull Island, tomorrow."], "expect": ["reads back the details before booking"]})
    project.path("plan", "plan.json").write_text(json.dumps(plan_data))
    plan.check_plan(project)
    plan.approve_plan(project, by="tester")
    compiler.compile_build(project)
    fake = FakeVapi()
    client = vapi.VapiClient("sk", transport=fake)
    vapi.apply(project, client, secrets={"FERRY_TOKEN": "t"}, sleep=lambda s: None)
    return fake, client


def test_chat_tests_run_against_the_applied_assistant(project):
    fake, client = _built(project)
    report = vapi.run_tests(project, client)
    chats = [(p, b) for m, p, b in fake.calls if p == "/chat"]
    assert len(chats) == 3 and all(b["assistantId"].startswith("assistant_") for _, b in chats)
    assert chats[2][1]["previousChatId"] == "chat_" + chats[1][1].get("previousChatId", "x").split("_")[-1] or chats[2][1]["previousChatId"]
    booking = next(r for r in report["results"] if r["id"] == "test:booking")
    assert [t["caller"] for t in booking["turns"]] == ["I want to book two seats.", "Northport to Gull Island, tomorrow."]
    assert booking["turns"][0]["agent"] == ["Reply to: I want to book two seats."]
    rendered = vapi.render_test_report(report)
    assert "Booking with follow-up" in rendered and "reads back the details" in rendered
    assert project.path("vapi", "test-results.json").exists()


def test_tests_require_an_applied_build(project):
    with pytest.raises(BuildError):
        vapi.run_tests(project, vapi.VapiClient("sk", transport=FakeVapi()))


def test_merge_fragments_concatenates_and_flags_collisions(project):
    fragments = project.path("ontology", "fragments")
    fragments.mkdir(parents=True)
    (fragments / "01.json").write_text(json.dumps({"domain": {"name": "Ferries", "summary": "Boats."}, "types": [{"id": "type:crossing-p01", "label": "Crossing", "definition": "x", "evidence": ["evidence:a"]}],
                                                    "goals": [{"id": "goal:travel-p01", "label": "Travel", "definition": "x", "evidence": ["evidence:a"]}]}))
    (fragments / "02.json").write_text(json.dumps({"types": [{"id": "type:crossing-p02", "label": "crossing", "definition": "y", "evidence": ["evidence:b"]}],
                                                    "claims": [{"id": "claim:fare-p02", "subject": "type:crossing-p02", "text": "Fare is 12.", "evidence": ["evidence:b"]}]}))
    report = ontology.merge_fragments(project)
    assert report["status"] == "MERGED" and report["counts"]["types"] == 2 and report["counts"]["claims"] == 1
    assert report["possibleDuplicates"] == ["types: type:crossing-p01, type:crossing-p02"]
    merged = json.loads(project.path("ontology", "ontology.json").read_text())
    assert merged["domain"]["name"] == "Ferries" and "properties" not in merged
    (fragments / "03.json").write_text(json.dumps({"types": [{"id": "type:crossing-p01", "label": "Dup", "definition": "z", "evidence": ["evidence:c"]}], "bogus": []}))
    report = ontology.merge_fragments(project)
    assert report["status"] == "REJECTED" and any("appears in both" in e for e in report["errors"]) and any("unknown key" in e for e in report["errors"])


def test_launcher_runs_from_any_directory(tmp_path):
    result = subprocess.run([str(LAUNCHER), "doctor"], cwd=tmp_path, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith("vapi-build ")
    link = tmp_path / "linked"
    link.symlink_to(LAUNCHER.parent)
    result = subprocess.run([str(link / "vapi-build"), "--help"], cwd=tmp_path, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0 and "extract" in result.stdout


def test_teardown_keeps_what_vapi_refuses_and_reports_it(project):
    fake, client = _built(project)
    original = fake.__call__

    def refusing(method, url, headers, data):
        if method == "DELETE" and "/assistant/" in url:
            return 409, b'{"message":"assistant_pinned"}'
        return original(method, url, headers, data)

    client.transport = refusing
    with pytest.raises(BuildError, match="refused 1"):
        vapi.teardown(project, client)
    receipts = vapi.load_receipts(project)
    assert receipts is not None and len(receipts["assistants"]) == 1 and not receipts["tools"] and not receipts["files"]
