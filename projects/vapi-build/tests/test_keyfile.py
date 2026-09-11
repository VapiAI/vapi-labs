from __future__ import annotations

import json
import stat

import pytest

from vapi_build import keyfile, vapi
from vapi_build.workspace import BuildError


def test_set_from_env_and_file_write_owner_only_and_never_echo(tmp_path, capsys):
    key_file = tmp_path / "cfg" / "env"
    result = keyfile.set_from_env("VAPI_API_KEY", "MY_VAPI", env={"MY_VAPI": "sk-secret-value"}, key_file=key_file)
    assert result == {"name": "VAPI_API_KEY", "source": "environment variable MY_VAPI", "length": 15}
    assert stat.S_IMODE(key_file.stat().st_mode) == 0o600
    assert vapi.load_env_file(key_file) == {"VAPI_API_KEY": "sk-secret-value"}
    dotenv = tmp_path / "project.env"
    dotenv.write_text("OTHER=1\nexport FERRY_TOKEN='tok-abc'\n")
    keyfile.set_from_file("FERRY_TOKEN", str(dotenv), key_file=key_file)
    bare = tmp_path / "key.txt"
    bare.write_text("# my key\nsk-bare\n")
    keyfile.set_from_file("SC_SERVICE_TOKEN", str(bare), key_file=key_file)
    entries = vapi.load_env_file(key_file)
    assert entries == {"VAPI_API_KEY": "sk-secret-value", "FERRY_TOKEN": "tok-abc", "SC_SERVICE_TOKEN": "sk-bare"}
    assert "secret" not in capsys.readouterr().out
    with pytest.raises(BuildError, match="not set"):
        keyfile.set_from_env("VAPI_API_KEY", "NOPE", env={}, key_file=key_file, shell_reader=lambda v: "")
    shell = keyfile.set_from_env("VAPI_API_KEY", "FROM_RC", env={}, key_file=key_file, shell_reader=lambda v: "sk-rc-value" if v == "FROM_RC" else "")
    assert shell["source"] == "FROM_RC exported in the login shell profile" and vapi.load_env_file(key_file)["VAPI_API_KEY"] == "sk-rc-value"
    with pytest.raises(BuildError, match="no line for"):
        keyfile.set_from_file("X_TOKEN", str(dotenv), "MISSING", key_file=key_file)
    with pytest.raises(BuildError, match="not a valid variable name"):
        keyfile.set_from_env("bad-name", "MY_VAPI", env={"MY_VAPI": "x"}, key_file=key_file)
    with pytest.raises(BuildError, match="whitespace"):
        keyfile.set_from_env("VAPI_API_KEY", "MY_VAPI", env={"MY_VAPI": "two words"}, key_file=key_file)


def test_init_and_status_report_names_only(tmp_path):
    key_file = tmp_path / "env"
    result = keyfile.init_placeholders(["VAPI_API_KEY", "FERRY_TOKEN"], key_file=key_file)
    assert result["placeholders"] == ["VAPI_API_KEY", "FERRY_TOKEN"] and key_file.read_text().count("=\n") == 2
    keyfile.set_from_env("FERRY_TOKEN", "TOKEN_SOURCE", env={"TOKEN_SOURCE": "value"}, key_file=key_file)
    status = keyfile.status(["VAPI_API_KEY", "FERRY_TOKEN"], key_file=key_file)
    assert status["present"] == ["FERRY_TOKEN"] and status["missing"] == ["VAPI_API_KEY"]
    assert "value" not in json.dumps(status)
    again = keyfile.init_placeholders(["VAPI_API_KEY", "FERRY_TOKEN"], key_file=key_file)
    assert again["present"] == ["FERRY_TOKEN"] and again["placeholders"] == ["VAPI_API_KEY"]
    assert vapi.load_env_file(key_file)["FERRY_TOKEN"] == "value", "existing values survive init"


def test_find_candidates_lists_paths_and_names_not_values(tmp_path):
    project = tmp_path / "Developer" / "demo"
    project.mkdir(parents=True)
    (project / ".env.local").write_text("VAPI_PRIVATE_KEY=sk-live-value\nDATABASE_URL=x\n")
    (project / "node_modules").mkdir()
    (project / "node_modules" / ".env").write_text("VAPI_API_KEY=ignored\n")
    (tmp_path / "unrelated.txt").write_text("VAPI_API_KEY=not-an-env-file\n")
    found = keyfile.find_candidates([tmp_path], profiles=())
    assert found == [{"path": str(project / ".env.local"), "variables": ["VAPI_PRIVATE_KEY"], "kind": "file"}]
    rc = tmp_path / "zshrc"
    rc.write_text('export PATH="$PATH:/x"\nexport VAPI_PRIVATE_KEY="sk-from-rc"\n')
    found = keyfile.find_candidates([tmp_path / "nowhere"], profiles=(str(rc),))
    assert found == [{"path": str(rc), "variables": ["VAPI_PRIVATE_KEY"], "kind": "shell profile"}]
    assert "sk-live-value" not in json.dumps(found)


def test_verify_key_uses_one_read_only_call():
    calls = []

    def transport(method, url, headers, data):
        calls.append((method, url))
        return 200, json.dumps([{"id": "a1", "orgId": "org_9"}]).encode()

    check = keyfile.verify_key(vapi.VapiClient("sk", transport=transport))
    assert check == {"ok": True, "assistantsVisible": 1, "orgId": "org_9"} and calls == [("GET", "https://api.vapi.ai/assistant?limit=1")]


def test_prompt_requires_a_terminal(tmp_path, monkeypatch):
    monkeypatch.setattr("sys.stdin", type("S", (), {"isatty": staticmethod(lambda: False)})())
    with pytest.raises(BuildError, match="Terminal tab"):
        keyfile.prompt_and_save("VAPI_API_KEY", key_file=tmp_path / "env")


def test_cli_secrets_commands(tmp_path, monkeypatch, capsys):
    from vapi_build.cli import main

    key_file = tmp_path / "env"
    monkeypatch.setattr(vapi, "KEY_FILE", key_file)
    monkeypatch.setenv("SOURCE_KEY", "sk-from-shell")
    assert main(["secrets", "set", "VAPI_API_KEY", "--from-env", "SOURCE_KEY"]) == 0
    out = capsys.readouterr().out
    assert "Saved VAPI_API_KEY (13 characters)" in out and "sk-from-shell" not in out
    assert main(["secrets", "list"]) == 0 and "present VAPI_API_KEY" in capsys.readouterr().out
    assert main(["secrets", "set", "X_TOKEN"]) == 2
    assert "Say where to copy" in capsys.readouterr().err
