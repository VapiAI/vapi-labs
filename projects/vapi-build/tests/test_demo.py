"""Sample datasets: registered by the CLI, never mixed with the user's own material."""
from __future__ import annotations

import pytest

from vapi_build import demo, sources
from vapi_build.cli import main
from vapi_build.workspace import BuildError, Workspace


def test_demo_init_registers_every_source_and_locks_the_workspace(tmp_path, capsys):
    assert main(["init", "--demo", "standard-charter", "--workspace", str(tmp_path / "ws")]) == 0
    out = capsys.readouterr().out
    assert "registered 5 sources" in out and "PIN 4380" in out and "bank.standardcharter.co/mcp" in out and "synthetic" in out
    workspace = Workspace.open(tmp_path / "ws")
    assert workspace.project["demo"] == "standard-charter" and workspace.project["s3Anonymous"] is True
    assert [s["role"] for s in workspace.sources()] == ["website", "openapi", "knowledge", "transcripts", "transcripts"]
    assert all(s["privacy"] == "synthetic" for s in workspace.sources("transcripts"))
    with pytest.raises(BuildError, match="holds only the demo sources"):
        sources.add_source(workspace, "knowledge", str(tmp_path))
    with pytest.raises(BuildError, match="already has sources"):
        demo.register(workspace, "standard-charter")


def test_own_workspace_refuses_demo_sources(tmp_path):
    workspace = Workspace.create(tmp_path / "own", "My Bank")
    with pytest.raises(BuildError, match="init --demo standard-charter"):
        sources.add_source(workspace, "knowledge", "s3://standardcharter-vapi-build/knowledge")
    with pytest.raises(BuildError, match="sample dataset"):
        sources.add_source(workspace, "website", "https://bank.standardcharter.co")
    sources.add_source(workspace, "knowledge", "s3://someone-elses-bucket/docs")


def test_demo_card_and_cli_listing(capsys):
    assert main(["demo", "list"]) == 0 and "standard-charter" in capsys.readouterr().out
    assert main(["demo", "show", "standard-charter"]) == 0
    text = capsys.readouterr().out
    assert "Ada Lovelace" in text and "verifyCallerPin" in text and "Authorization: Bearer scb_" in text
    assert main(["init"]) == 2  # neither a name nor a demo


def test_anonymous_s3_client_for_public_buckets(tmp_path, monkeypatch):
    workspace = Workspace.create(tmp_path / "ws", "x")
    workspace.project["s3Anonymous"] = True
    pytest.importorskip("boto3")
    from botocore import UNSIGNED

    client = sources._s3_client(workspace, None)
    assert client.meta.config.signature_version is UNSIGNED and client.meta.service_model.service_name == "s3"


def test_demo_handover_pairs_phone_pin_with_web_login():
    text = demo.handover(demo.get("standard-charter"))
    assert "858-460-0493" in text and "PIN is 4380" in text and "ada.lovelace.1000000000@scbank.example / VhLbMzpGDLzw" in text
    assert "https://bank.standardcharter.co" in text and "same customer record" in text


def test_build_tab_gets_a_try_it_card_only_for_applied_demo_workspaces(tmp_path):
    from vapi_build import render
    from vapi_build.workspace import Workspace

    d = demo.get("standard-charter")
    assert render.try_it_card(d, None) is None
    assert render.try_it_card(d, {"verified": False, "assistants": {}, "squad": {}}) is None
    card = render.try_it_card(d, {"verified": True, "assistants": {"assistant:a": "asst_1"}, "squad": {"id": "squad_1"}})
    assert card["phone"] == "858-460-0493" and card["pin"] == "4380" and card["targetKind"] == "squad" and card["dashboard"].endswith("/squads/squad_1")
    assert card["email"].startswith("ada.lovelace") and card["web"] == "https://bank.standardcharter.co"
    Workspace.create(tmp_path / "ws", "x")  # non-demo workspaces never get a card; covered by review_model's demo check
