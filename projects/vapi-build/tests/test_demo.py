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
