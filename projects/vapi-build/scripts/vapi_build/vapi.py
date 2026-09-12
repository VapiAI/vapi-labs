"""Create, verify, and remove the Vapi resources described by vapi/build.json.

Every created ID is written to vapi/receipts.json immediately, so an interrupted apply can
resume and a teardown can always find what it owns. The API key comes from the environment
and is never written to disk or printed.
"""
from __future__ import annotations

import json
import mimetypes
import os
import time
import uuid
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .workspace import USER_AGENT, BuildError, Workspace, read_json, utc_now, write_json

Transport = Callable[[str, str, dict[str, str], bytes | None], tuple[int, bytes]]
KEY_VARIABLES = ("VAPI_API_KEY", "VAPI_PRIVATE_KEY")
RATE_LIMIT_RETRIES = 5
RATE_LIMIT_BACKOFF_SECONDS = 2.0
# Vapi's accepted upload types; Python's mimetypes does not know some of these extensions (yaml, log, tsv).
UPLOAD_TYPES = {"md": "text/markdown", "markdown": "text/markdown", "txt": "text/plain", "yaml": "application/x-yaml", "yml": "application/x-yaml",
                "json": "application/json", "csv": "text/csv", "tsv": "text/tab-separated-values", "log": "text/x-log", "html": "text/html", "htm": "text/html",
                "xml": "application/xml", "pdf": "application/pdf", "doc": "application/msword",
                "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}


def default_transport(method: str, url: str, headers: dict[str, str], data: bytes | None) -> tuple[int, bytes]:
    request = Request(url, data=data, method=method, headers={"User-Agent": USER_AGENT, **headers})
    try:
        with urlopen(request, timeout=60) as response:  # noqa: S310 - fixed Vapi API host
            return response.status, response.read()
    except HTTPError as error:
        return error.code, error.read()
    except URLError as error:
        raise BuildError(f"Could not reach {url}: {error.reason}") from error


class VapiClient:
    def __init__(self, api_key: str, *, base_url: str = "https://api.vapi.ai", transport: Transport = default_transport) -> None:
        if not api_key:
            raise BuildError("Set VAPI_API_KEY (your Vapi private key) in the environment before applying.")
        self._key = api_key
        self.base_url = base_url.rstrip("/")
        self.transport = transport
        self.sleep: Callable[[float], None] = time.sleep
        self.calls: list[tuple[str, str]] = []

    def request(self, method: str, path: str, body: Any = None, *, allow_404: bool = False) -> Any:
        headers = {"Authorization": f"Bearer {self._key}", "Accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        status, raw = self.transport(method, self.base_url + path, headers, data)
        for attempt in range(RATE_LIMIT_RETRIES):
            if status != 429:
                break
            # Vapi rate-limits bursts (teardown deletes dozens of files); wait and retry with growing pauses.
            self.sleep(RATE_LIMIT_BACKOFF_SECONDS * (2 ** attempt))
            status, raw = self.transport(method, self.base_url + path, headers, data)
        self.calls.append((method, path))
        return self._decode(method, path, status, raw, allow_404)

    def upload(self, name: str, data: bytes, *, purpose: str = "knowledge-base-v2", metadata: dict[str, Any] | None = None) -> Any:
        boundary = f"----vapi-build-{uuid.uuid4().hex}"
        content_type = UPLOAD_TYPES.get(name.rsplit(".", 1)[-1].lower()) or mimetypes.guess_type(name)[0] or "text/plain"
        parts = [f"--{boundary}\r\nContent-Disposition: form-data; name=\"purpose\"\r\n\r\n{purpose}\r\n".encode()]
        if metadata:
            parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"metadata\"\r\n\r\n{json.dumps(metadata)}\r\n".encode())
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: {content_type}\r\n\r\n".encode() + data + b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode())
        headers = {"Authorization": f"Bearer {self._key}", "Accept": "application/json", "Content-Type": f"multipart/form-data; boundary={boundary}"}
        status, raw = self.transport("POST", self.base_url + "/file", headers, b"".join(parts))
        self.calls.append(("POST", "/file"))
        return self._decode("POST", "/file", status, raw, False)

    @staticmethod
    def _decode(method: str, path: str, status: int, raw: bytes, allow_404: bool) -> Any:
        if status == 404 and allow_404:
            return None
        if status >= 400:
            detail = raw.decode("utf-8", errors="replace")[:400]
            raise BuildError(f"Vapi {method} {path} failed with HTTP {status}: {detail}")
        if not raw:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return raw.decode("utf-8", errors="replace")


KEY_FILE = Path("~/.config/vapi-build/env")


def load_env_file(path: Path | None = None) -> dict[str, str]:
    """Read KEY=value lines (optionally prefixed with `export`). Missing file → empty."""
    path = (path or KEY_FILE).expanduser()
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.removeprefix("export ").partition("=")
        values[key.strip()] = value.strip().strip("'\"")
    return values


def find_key(env: dict[str, str] | None = None, key_file: Path | None = None) -> tuple[str, str | None]:
    """Return (key, where it came from). The key value is never logged by callers."""
    env = os.environ if env is None else env
    key_file = key_file or KEY_FILE
    for name in KEY_VARIABLES:
        if env.get(name):
            return env[name], f"environment variable {name}"
    file_values = load_env_file(key_file)
    for name in KEY_VARIABLES:
        if file_values.get(name):
            return file_values[name], str(key_file)
    return "", None


def client_from_env(env: dict[str, str] | None = None, *, transport: Transport = default_transport, key_file: Path | None = None) -> VapiClient:
    env = os.environ if env is None else env
    key_file = key_file or KEY_FILE
    key, source = find_key(env, key_file)
    if not key:
        raise BuildError(f"No Vapi private key found. Either export VAPI_API_KEY, or save a line `VAPI_API_KEY=<your private key>` in {key_file} "
                         "(create the file yourself; do not paste the key into the chat).")
    base = env.get("VAPI_BASE_URL") or load_env_file(key_file).get("VAPI_BASE_URL") or "https://api.vapi.ai"
    return VapiClient(key, base_url=base, transport=transport)


def demo_secrets(workspace: Workspace) -> dict[str, str]:
    """Tokens a sample dataset publishes on purpose (its MCP bearer), keyed by the variable names its plan guide uses."""
    demo_id = workspace.project.get("demo")
    if not demo_id:
        return {}
    from . import demo as demos

    return dict(demos.get(demo_id).get("secretsEnv", {}))


def load_build(workspace: Workspace) -> dict[str, Any]:
    path = workspace.path("vapi", "build.json")
    if not path.exists():
        raise BuildError("No compiled build. Run `compile` first.")
    return read_json(path)


def load_receipts(workspace: Workspace) -> dict[str, Any] | None:
    path = workspace.path("vapi", "receipts.json")
    return read_json(path) if path.exists() else None


def _save(workspace: Workspace, receipts: dict[str, Any]) -> None:
    receipts["updatedAt"] = utc_now()
    write_json(workspace.path("vapi", "receipts.json"), receipts)


def _check_build_is_current(workspace: Workspace, build: dict[str, Any]) -> None:
    from .plan import approved_plan  # local import: plan depends on this module for key constants

    approved = approved_plan(workspace)
    if build["planDigest"] != approved["digest"] or build["ontologyDigest"] != approved["ontologyDigest"]:
        raise BuildError("vapi/build.json was compiled from a different plan than the one approved. Run `compile` again.")
    from .extract import ledger_digest, load_ledger

    if build.get("ledgerDigest") != ledger_digest(load_ledger(workspace)):
        raise BuildError("The evidence changed after this build was compiled. Re-check the ontology and plan, then `compile` again.")


def apply(workspace: Workspace, client: VapiClient, *, secrets: dict[str, str] | None = None, sleep: Callable[[float], None] = time.sleep,
          poll_seconds: float = 5.0, timeout_seconds: float = 600.0) -> dict[str, Any]:
    build = load_build(workspace)
    _check_build_is_current(workspace, build)
    secrets = load_env_file() if secrets is None else secrets
    secrets = {**demo_secrets(workspace), **secrets}  # a demo's published tokens fill in unless the user saved their own
    receipts = load_receipts(workspace) or {"planDigest": build["planDigest"], "startedAt": utc_now(), "files": {}, "knowledgeBase": {}, "tools": {}, "assistants": {}, "squad": {}, "verified": False}
    receipts.setdefault("structuredOutputs", {})
    receipts.setdefault("simulations", {"personalities": {}, "scenarios": {}, "simulations": {}, "suite": {}})
    if receipts["planDigest"] != build["planDigest"]:
        raise BuildError("Receipts belong to a different build. Run `teardown` before applying a new plan, or delete vapi/receipts.json if those resources are already gone.")
    for file in build["knowledgeBase"]["files"]:
        previous = receipts["files"].get(file["path"])
        if previous and previous.get("sha256") != file["sha256"]:
            raise BuildError(f"{file['name']} changed since it was uploaded. Run `teardown --yes` and then `apply --yes` to rebuild the knowledge base.")

    # Resolve every secret header before touching Vapi, so a missing token fails with nothing created.
    for tool in build["tools"]:
        for header in tool.get("secretHeaders", []):
            token = secrets.get(header["env"])
            if not token:
                raise BuildError(f"{header['env']} is not set in {KEY_FILE}. Ask the user to add a line `{header['env']}=<token>` to that file.")
            if token == client._key:
                raise BuildError(f"{header['env']} holds the Vapi private key itself; a tool must never forward it. Use the API's own token.")

    mode = receipts["knowledgeBase"].get("mode", "v2")
    for file in build["knowledgeBase"]["files"]:
        if file["path"] in receipts["files"]:
            continue
        data = workspace.path("vapi", file["path"]).read_bytes()
        metadata = {"managedBy": "vapi-build", "project": build["projectSlug"], "origin": file["origin"]}
        try:
            created = client.upload(file["name"], data, purpose="knowledge-base-v2" if mode == "v2" else "assistant", metadata=metadata)
        except BuildError as error:
            if mode == "v2" and V2_DISABLED_MARKER in str(error):
                # The organization has no Knowledge Bases V2: use Vapi's query tool with Google as the provider instead.
                mode = "query"
                receipts["knowledgeBase"] = {"mode": "query", "attached": []}
                _save(workspace, receipts)
                created = client.upload(file["name"], data, purpose="assistant", metadata=metadata)
            else:
                raise
        if not created or not created.get("id"):
            raise BuildError(f"Vapi did not accept {file['name']}.")
        if mode == "v2" and created.get("status") == "failed":
            raise BuildError(f"Vapi did not accept {file['name']}.")
        receipts["files"][file["path"]] = {"id": created["id"], "sha256": file["sha256"]}
        _save(workspace, receipts)

    if mode == "query":
        _ensure_query_tool(workspace, client, build, receipts, sleep, poll_seconds, timeout_seconds)
    elif not receipts["knowledgeBase"].get("id"):
        created = client.request("POST", "/v2/knowledge-base", {"name": build["knowledgeBase"]["name"], "description": build["knowledgeBase"]["description"]})
        receipts["knowledgeBase"] = {"id": created["id"], "attached": [], "toolId": created.get("toolId")}
        _save(workspace, receipts)
    if mode == "v2":
        knowledge_base_id = receipts["knowledgeBase"]["id"]
        file_ids = [entry["id"] for entry in receipts["files"].values()]
        for file_id in file_ids:
            if file_id in receipts["knowledgeBase"]["attached"]:
                continue
            client.request("POST", f"/v2/knowledge-base/{knowledge_base_id}/file", {"fileId": file_id})
            receipts["knowledgeBase"]["attached"].append(file_id)
            _save(workspace, receipts)
        if not receipts["knowledgeBase"].get("toolId"):
            receipts["knowledgeBase"]["toolId"] = _wait_for_knowledge(client, knowledge_base_id, file_ids, sleep, poll_seconds, timeout_seconds)
            _save(workspace, receipts)

    for tool in build["tools"]:
        if tool["ref"] in receipts["tools"]:
            continue
        payload = json.loads(json.dumps(tool["payload"]))
        for header in tool.get("secretHeaders", []):
            if tool.get("mcp"):
                payload["server"].setdefault("headers", {})[header["name"]] = f"{header['prefix']}{secrets[header['env']]}"
            else:
                headers = payload.setdefault("headers", {"type": "object", "properties": {}})
                headers["properties"][header["name"]] = {"type": "string", "value": f"{header['prefix']}{secrets[header['env']]}"}
        created = client.request("POST", "/tool", payload)
        receipts["tools"][tool["ref"]] = created["id"]
        _save(workspace, receipts)

    # Structured outputs exist before the assistants so each assistant can be created already attached to them.
    for output in build.get("structuredOutputs", []):
        if output["ref"] in receipts["structuredOutputs"]:
            continue
        created = client.request("POST", "/structured-output", output["payload"])
        receipts["structuredOutputs"][output["ref"]] = created["id"]
        _save(workspace, receipts)

    for assistant in build["assistants"]:
        if assistant["ref"] in receipts["assistants"]:
            continue
        payload = json.loads(json.dumps(assistant["payload"]))
        tool_ids = [receipts["tools"][ref] for ref in assistant["toolRefs"]]
        if assistant["knowledge"]:
            tool_ids.insert(0, receipts["knowledgeBase"]["toolId"])
        if tool_ids:
            payload["model"]["toolIds"] = tool_ids
        if assistant.get("outputRefs"):
            payload["artifactPlan"] = {**payload.get("artifactPlan", {}), "structuredOutputIds": [receipts["structuredOutputs"][ref] for ref in assistant["outputRefs"]]}
        created = client.request("POST", "/assistant", payload)
        receipts["assistants"][assistant["ref"]] = created["id"]
        _save(workspace, receipts)

    if build["squad"] and not receipts["squad"].get("id"):
        members = [{"assistantId": receipts["assistants"][member["assistantRef"]], "assistantDestinations": member["assistantDestinations"]} for member in build["squad"]["members"]]
        created = client.request("POST", "/squad", {**build["squad"]["payload"], "members": members})
        receipts["squad"] = {"id": created["id"]}
        _save(workspace, receipts)

    if build.get("simulations"):
        _apply_simulations(workspace, client, build, receipts)

    verify(workspace, client, receipts)
    receipts["verified"] = True
    receipts["appliedAt"] = utc_now()
    _save(workspace, receipts)
    return receipts


def _target(receipts: dict[str, Any]) -> tuple[str, str]:
    """(kind, id) of what callers reach: the squad when there is one, else the only assistant."""
    if receipts.get("squad", {}).get("id"):
        return "squad", receipts["squad"]["id"]
    return "assistant", next(iter(receipts["assistants"].values()))


def _apply_simulations(workspace: Workspace, client: VapiClient, build: dict[str, Any], receipts: dict[str, Any]) -> None:
    """Personalities and scenarios, then one simulation per scenario, then the suite aimed at the applied target."""
    sims = build["simulations"]
    book = receipts["simulations"]
    for personality in sims["personalities"]:
        if personality["ref"] in book["personalities"]:
            continue
        created = client.request("POST", "/eval/simulation/personality", personality["payload"])
        book["personalities"][personality["ref"]] = created["id"]
        _save(workspace, receipts)
    for scenario in sims["scenarios"]:
        if scenario["ref"] in book["scenarios"]:
            continue
        payload = json.loads(json.dumps(scenario["payload"]))
        for evaluation in payload["evaluations"]:
            ref = evaluation.pop("structuredOutputRef", None)
            if ref:
                evaluation["structuredOutputId"] = receipts["structuredOutputs"][ref]
        created = client.request("POST", "/eval/simulation/scenario", payload)
        book["scenarios"][scenario["ref"]] = created["id"]
        _save(workspace, receipts)
    for simulation in sims["simulations"]:
        if simulation["ref"] in book["simulations"]:
            continue
        created = client.request("POST", "/eval/simulation", {"name": simulation["name"], "scenarioId": book["scenarios"][simulation["scenarioRef"]],
                                                              "personalityId": book["personalities"][simulation["personalityRef"]]})
        book["simulations"][simulation["ref"]] = created["id"]
        _save(workspace, receipts)
    if not book["suite"].get("id"):
        kind, identifier = _target(receipts)
        created = client.request("POST", "/eval/simulation/suite", {"name": sims["suite"]["name"], "simulationIds": list(book["simulations"].values()),
                                                                    "targetAssignments": [{"targetType": kind, "targetId": identifier}]})
        book["suite"] = {"id": created["id"], "transport": sims["transport"]}
        _save(workspace, receipts)


V2_DISABLED_MARKER = "Knowledge Bases V2 is not enabled"


def _ensure_query_tool(workspace: Workspace, client: VapiClient, build: dict[str, Any], receipts: dict[str, Any], sleep: Callable[[float], None],
                       poll_seconds: float, timeout_seconds: float) -> None:
    """Non-V2 organizations: one `query` tool whose Google knowledge base holds every uploaded file."""
    file_ids = [entry["id"] for entry in receipts["files"].values()]
    # Wait for Vapi to finish processing the uploads; a file Vapi marks failed is reported but does not stop the build,
    # because the query tool's provider indexes the files itself.
    waited = 0.0
    while True:
        statuses = {}
        for file_id in file_ids:
            record = client.request("GET", f"/file/{file_id}", allow_404=True) or {}
            statuses[file_id] = record.get("status") or "done"
        if all(status != "processing" for status in statuses.values()) or waited >= timeout_seconds:
            break
        sleep(poll_seconds)
        waited += poll_seconds
    failed = [fid for fid, status in statuses.items() if status == "failed"]
    receipts["knowledgeBase"]["fileStatuses"] = statuses
    if receipts["knowledgeBase"].get("toolId"):
        return
    slug = build["projectSlug"]
    payload = {
        "type": "query",
        "function": {"name": f"{slug}-knowledge"[:64], "description": "Search the knowledge base of product guides and website pages before answering a factual question."},
        "knowledgeBases": [{
            "provider": "google",
            "name": f"{slug}-knowledge"[:64],
            "description": build["knowledgeBase"]["description"][:1000],
            "fileIds": file_ids,
        }],
    }
    created = client.request("POST", "/tool", payload)
    receipts["knowledgeBase"]["toolId"] = created["id"]
    receipts["knowledgeBase"]["attached"] = list(file_ids)
    receipts["knowledgeBase"]["failedFiles"] = failed
    _save(workspace, receipts)


def _wait_for_knowledge(client: VapiClient, knowledge_base_id: str, file_ids: list[str], sleep: Callable[[float], None], poll_seconds: float, timeout_seconds: float) -> str:
    waited = 0.0
    while True:
        knowledge = client.request("GET", f"/v2/knowledge-base/{knowledge_base_id}") or {}
        files = knowledge.get("files")
        if files is None:
            files = client.request("GET", f"/v2/knowledge-base/{knowledge_base_id}/file") or []
        relevant = [f for f in files if f.get("fileId") in file_ids]
        failed = [f for f in relevant if f.get("status") == "failed"]
        if failed:
            raise BuildError(f"{len(failed)} knowledge file(s) failed to index in Vapi: {', '.join(f.get('fileName') or f.get('fileId') for f in failed)}")
        ready = len(relevant) == len(file_ids) and all(f.get("status") == "ready" for f in relevant)
        tool_id = knowledge.get("toolId")
        if ready and not tool_id:
            tool_id = next((t["id"] for t in (client.request("GET", "/tool?limit=1000") or []) if t.get("type") == "knowledgeBase" and t.get("knowledgeBaseId") == knowledge_base_id), None)
        if ready and tool_id:
            return tool_id
        if waited >= timeout_seconds:
            raise BuildError("The knowledge base did not finish indexing in time. Re-run `apply` to keep waiting; nothing is duplicated.")
        sleep(poll_seconds)
        waited += poll_seconds


def verify(workspace: Workspace, client: VapiClient, receipts: dict[str, Any] | None = None) -> list[str]:
    receipts = receipts or load_receipts(workspace)
    if not receipts:
        raise BuildError("Nothing has been applied yet.")
    sims = receipts.get("simulations", {})
    checks = [("eval/simulation/suite", sims["suite"]["id"])] if sims.get("suite", {}).get("id") else []
    checks += [("eval/simulation", i) for i in sims.get("simulations", {}).values()] + [("eval/simulation/scenario", i) for i in sims.get("scenarios", {}).values()]
    checks += [("eval/simulation/personality", i) for i in sims.get("personalities", {}).values()]
    checks += [("squad", receipts["squad"].get("id"))] if receipts.get("squad", {}).get("id") else []
    checks += [("assistant", i) for i in receipts["assistants"].values()] + [("tool", i) for i in receipts["tools"].values()]
    checks += [("structured-output", i) for i in receipts.get("structuredOutputs", {}).values()]
    if receipts["knowledgeBase"].get("id"):
        checks.append(("v2/knowledge-base", receipts["knowledgeBase"]["id"]))
    elif receipts["knowledgeBase"].get("mode") == "query" and receipts["knowledgeBase"].get("toolId"):
        checks.append(("tool", receipts["knowledgeBase"]["toolId"]))
    seen = []
    for kind, identifier in checks:
        resource = client.request("GET", f"/{kind}/{identifier}")
        if not resource or resource.get("id") != identifier:
            raise BuildError(f"Vapi returned the wrong {kind} for {identifier}.")
        seen.append(f"{kind} {identifier}")
    return seen


def teardown(workspace: Workspace, client: VapiClient) -> list[str]:
    """Delete everything in the receipts, in dependency order. A resource Vapi refuses to delete is
    reported and kept in the receipts; everything else is still removed."""
    receipts = load_receipts(workspace)
    if not receipts:
        raise BuildError("No receipts; nothing to remove.")
    removed: list[str] = []
    kept: list[str] = []

    def remove(kind: str, identifier: str) -> bool:
        try:
            client.request("DELETE", f"/{kind}/{identifier}", allow_404=True)
        except BuildError as error:
            kept.append(f"{kind} {identifier}: {error}")
            return False
        removed.append(f"{kind} {identifier}")
        return True

    sims = receipts.get("simulations") or {}
    if sims.get("suite", {}).get("id") and remove("eval/simulation/suite", sims["suite"]["id"]):
        sims["suite"] = {}
    for group, kind in (("simulations", "eval/simulation"), ("scenarios", "eval/simulation/scenario"), ("personalities", "eval/simulation/personality")):
        for ref in list(sims.get(group, {})):
            if remove(kind, sims[group][ref]):
                sims[group].pop(ref)
    if receipts["squad"].get("id") and remove("squad", receipts["squad"]["id"]):
        receipts["squad"] = {}
    for ref in list(receipts["assistants"]):
        if remove("assistant", receipts["assistants"][ref]):
            receipts["assistants"].pop(ref)
    for ref in list(receipts.get("structuredOutputs", {})):
        if remove("structured-output", receipts["structuredOutputs"][ref]):
            receipts["structuredOutputs"].pop(ref)
    for ref in list(receipts["tools"]):
        if remove("tool", receipts["tools"][ref]):
            receipts["tools"].pop(ref)
    if receipts["knowledgeBase"].get("id") and remove("v2/knowledge-base", receipts["knowledgeBase"]["id"]):
        receipts["knowledgeBase"] = {}
    elif receipts["knowledgeBase"].get("mode") == "query" and receipts["knowledgeBase"].get("toolId") and remove("tool", receipts["knowledgeBase"]["toolId"]):
        receipts["knowledgeBase"] = {}
    for path in list(receipts["files"]):
        entry = receipts["files"][path]
        if remove("file", entry["id"] if isinstance(entry, dict) else entry):
            receipts["files"].pop(path)
    if kept:
        _save(workspace, receipts)
        raise BuildError(f"Removed {len(removed)} resources; Vapi refused {len(kept)}: " + "; ".join(kept) + ". They stay in vapi/receipts.json; delete them in the dashboard and run teardown again.")
    workspace.path("vapi", "receipts.json").unlink(missing_ok=True)
    return removed


def _message_text(message: Any) -> str:
    if isinstance(message, str):
        return message
    if isinstance(message, dict):
        content = message.get("content") or message.get("message") or message.get("text") or ""
        if isinstance(content, list):
            content = " ".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in content)
        return str(content)
    return str(message)


def run_tests(workspace: Workspace, client: VapiClient) -> dict[str, Any]:
    """Drive every plan test through Vapi's chat API against the applied assistant or squad.

    Returns transcripts plus each test's expectations; judging whether they were met is left to
    the reviewer reading them, because expectations are written in plain language.
    """
    build = load_build(workspace)
    _check_build_is_current(workspace, build)
    receipts = load_receipts(workspace)
    if not receipts or not receipts.get("verified"):
        raise BuildError("Apply the build before testing it.")
    if not build.get("tests"):
        report = {"testedAt": utc_now(), "target": None, "results": [], "note": "The plan declares no tests."}
        write_json(workspace.path("vapi", "test-results.json"), report)
        return report
    target = {"squadId": receipts["squad"]["id"]} if receipts.get("squad", {}).get("id") else {"assistantId": next(iter(receipts["assistants"].values()))}
    results = []
    for test in build["tests"]:
        turns = []
        previous_chat = None
        for utterance in [test["callerOpening"], *test.get("followUps", [])]:
            body: dict[str, Any] = {**target, "input": utterance, "name": f"vapi-build {test['id']}"[:40]}
            if previous_chat:
                body["previousChatId"] = previous_chat
            chat = client.request("POST", "/chat", body) or {}
            previous_chat = chat.get("id")
            outputs = chat.get("output") or []
            spoken = [_message_text(m) for m in outputs if not isinstance(m, dict) or m.get("role") in (None, "assistant", "bot")]
            # Tool-call turns carry no words; keep only what the caller would have heard.
            turns.append({"caller": utterance, "agent": [s for s in spoken if s.strip()], "raw": outputs})
        results.append({"id": test["id"], "scenario": test["scenario"], "expect": test["expect"], "mustNot": test.get("mustNot", []), "turns": turns, "chatId": previous_chat})
    report = {"testedAt": utc_now(), "target": target, "results": results}
    write_json(workspace.path("vapi", "test-results.json"), report)
    return report


TERMINAL_RUN_STATES = {"ended", "failed", "canceled", "cancelled", "completed"}


def run_simulations(workspace: Workspace, client: VapiClient, *, sleep: Callable[[float], None] = time.sleep, poll_seconds: float = 10.0,
                    timeout_seconds: float = 1800.0, iterations: int = 1) -> dict[str, Any]:
    """Run the applied simulation suite against the applied target through Vapi, wait for it to end, and save every item's evaluations.

    Vapi judges each evaluation itself (a structured output compared with the expected value); this
    only collects and reports. Running costs credits and concurrency, so the CLI asks for --yes."""
    build = load_build(workspace)
    _check_build_is_current(workspace, build)
    receipts = load_receipts(workspace)
    if not receipts or not receipts.get("verified"):
        raise BuildError("Apply the build before running simulations.")
    suite = (receipts.get("simulations") or {}).get("suite", {})
    if not suite.get("id"):
        raise BuildError("The plan declares no simulations, so there is no suite to run. Add `simulations` to the plan (see the plan guide).")
    kind, identifier = _target(receipts)
    run = client.request("POST", "/eval/simulation/run", {
        "simulations": [{"type": "simulationSuite", "simulationSuiteId": suite["id"]}],
        "target": {"type": kind, f"{kind}Id": identifier},
        "iterations": iterations,
        "transport": {"provider": suite.get("transport") or "vapi.webchat"},
    }) or {}
    run_id = run.get("id")
    if not run_id:
        raise BuildError("Vapi did not return a simulation run id.")
    waited = 0.0
    status = run.get("status")
    while status not in TERMINAL_RUN_STATES:
        if waited >= timeout_seconds:
            raise BuildError(f"Simulation run {run_id} is still {status} after {int(timeout_seconds)} seconds; check it in the dashboard{': ' + run['url'] if run.get('url') else ''}.")
        sleep(poll_seconds)
        waited += poll_seconds
        run = client.request("GET", f"/eval/simulation/run/{run_id}") or {}
        status = run.get("status")
    items = client.request("GET", f"/eval/simulation/run/{run_id}/item") or []
    if isinstance(items, dict):
        items = items.get("results") or items.get("items") or []
    names = {v: k for k, v in (receipts.get("simulations") or {}).get("simulations", {}).items()}
    results = []
    for item in items:
        evaluations = [{"name": e.get("name") or e.get("structuredOutputName") or "", "expected": e.get("expectedValue"), "comparator": e.get("comparator"),
                        "actual": e.get("extractedValue"), "required": e.get("required", True), "passed": e.get("passed"), "error": e.get("error"),
                        "skipped": e.get("isSkipped"), "skipReason": e.get("skipReason")} for e in ((item.get("results") or {}).get("evaluations") or item.get("evaluations") or [])]
        results.append({"itemId": item.get("id"), "simulation": names.get(item.get("simulationId"), item.get("simulationId")), "status": item.get("status"),
                        "passed": (item.get("results") or {}).get("passed"), "failureReason": item.get("failureReason"), "iteration": item.get("iteration"),
                        "transcript": item.get("transcript") or (item.get("artifact") or {}).get("transcript"), "evaluations": evaluations})
    report = {"ranAt": utc_now(), "runId": run_id, "url": run.get("url"), "status": status, "itemCounts": run.get("itemCounts"), "target": {kind: identifier}, "results": results}
    write_json(workspace.path("vapi", "simulation-results.json"), report)
    return report


def render_simulation_report(report: dict[str, Any]) -> str:
    lines = [f"# Simulation run {report['runId']} · {report['status']}" + (f" · {report['url']}" if report.get("url") else ""), ""]
    counts = report.get("itemCounts") or {}
    if counts:
        lines.append("Items: " + ", ".join(f"{k} {v}" for k, v in counts.items()))
    for result in report["results"]:
        verdict = "PASS" if result.get("passed") else "FAIL" if result.get("passed") is False else (result.get("status") or "?")
        lines.append(f"## {result['simulation']} · {verdict}" + (f" · {result['failureReason']}" if result.get("failureReason") else ""))
        for evaluation in result["evaluations"]:
            flag = "ok  " if evaluation.get("passed") else "FAIL" if evaluation.get("passed") is False else "skip"
            detail = f"expected {evaluation.get('comparator') or '='} {evaluation.get('expected')!r}, got {evaluation.get('actual')!r}"
            extra = f" · {evaluation['error']}" if evaluation.get("error") else f" · {evaluation['skipReason']}" if evaluation.get("skipReason") else ""
            lines.append(f"- {flag} {evaluation['name']}: {detail}{'' if evaluation.get('required', True) else ' (optional)'}{extra}")
        lines.append("")
    return "\n".join(lines)


def render_test_report(report: dict[str, Any]) -> str:
    lines = [f"# Chat test transcripts ({len(report['results'])} scenarios)", ""]
    for result in report["results"]:
        lines.append(f"## {result['scenario']} ({result['id']})")
        for turn in result["turns"]:
            lines.append(f"- Caller: {turn['caller']}")
            for reply in turn["agent"] or ["(no assistant text in output)"]:
                lines.append(f"  - Agent: {reply}")
        lines.append(f"- Expect: {'; '.join(result['expect'])}")
        if result["mustNot"]:
            lines.append(f"- Must not: {'; '.join(result['mustNot'])}")
        lines.append("")
    return "\n".join(lines)
