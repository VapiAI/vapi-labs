"""Check and approve the agent plan against the checked ontology and the OpenAPI inventory.

The plan also declares the structured outputs every call should yield and the simulations that
exercise the agent; both are checked here so that `compile` and `apply` never see a bad shape.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError

from . import openapi
from .ontology import approve_ontology, approver, checked_ontology, load_capability_inventory
from .vapi import KEY_FILE, KEY_VARIABLES
from .workspace import BuildError, Workspace, digest_json, read_json, utc_now, write_json

RESERVED_ENV = set(KEY_VARIABLES) | {"VAPI_BASE_URL"}

SCHEMA_PATH = Path(__file__).with_name("schemas") / "plan.schema.json"
DEFAULT_RUNTIME = {
    "model": {"provider": "openai", "model": "gpt-4.1", "temperature": 0.2},
    "voice": {"provider": "vapi", "voiceId": "Elliot"},
    "transcriber": {"provider": "deepgram", "model": "nova-3", "language": "en"},
}
DEFAULT_KNOWLEDGE = {"includeSourceDocuments": True, "includeWebsitePages": True, "includeDomainGuide": True, "excludeLocators": []}
PRIMITIVES = {"boolean", "string", "number", "integer"}
EQUALITY_ONLY = {"boolean", "string"}


def _leaf_type(schema: dict[str, Any], path: str | None) -> tuple[str | None, str | None]:
    """Resolve a dotted `path` into a JSON schema and return (leaf type, error)."""
    node: Any = schema
    for part in [p for p in (path or "").split(".") if p]:
        if not isinstance(node, dict) or node.get("type") != "object":
            return None, f"path {path!r} descends into a non-object"
        node = (node.get("properties") or {}).get(part)
        if node is None:
            return None, f"path {path!r} names a property the schema does not define"
    kind = node.get("type") if isinstance(node, dict) else None
    if kind not in PRIMITIVES:
        return None, "an evaluation must compare a primitive value (boolean, string, number, integer); use `path` to pick a leaf of an object output"
    return kind, None


def _value_matches(kind: str, value: Any) -> bool:
    if kind == "boolean":
        return isinstance(value, bool)
    if kind == "string":
        return isinstance(value, str)
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _check_outputs(plan: dict[str, Any], job_ids: set[str], assistant_ids: set[str], errors: list[str], warnings: list[str]) -> dict[str, dict[str, Any]]:
    outputs: dict[str, dict[str, Any]] = {}
    names: set[str] = set()
    for output in plan.get("structuredOutputs", []):
        if output["id"] in outputs:
            errors.append(f"Structured output {output['id']} is listed twice.")
        outputs[output["id"]] = output
        if output["name"].casefold() in names:
            errors.append(f"Structured output name “{output['name']}” is used twice; Vapi shows outputs by name.")
        names.add(output["name"].casefold())
        try:
            Draft202012Validator.check_schema(output["schema"])
        except SchemaError as error:
            errors.append(f"{output['id']} schema is not valid JSON Schema: {error.message[:160]}")
        if output["schema"].get("type") == "object" and not output["schema"].get("properties"):
            errors.append(f"{output['id']} is an object schema with no properties.")
        for job in output.get("jobs", []):
            if job not in job_ids:
                errors.append(f"{output['id']} lists unknown {job}.")
        for assistant in output.get("assistants", []):
            if assistant not in assistant_ids:
                errors.append(f"{output['id']} lists unknown assistant {assistant}.")
    if not outputs:
        warnings.append("No structured outputs declared; add at least a call-outcome record so every call yields reviewable data (see the plan guide).")
    return outputs


def _check_simulations(plan: dict[str, Any], jobs: dict[str, dict[str, Any]], tools_by_operation: dict[str, dict[str, Any]], operations: dict[str, dict[str, Any]],
                       outputs: dict[str, dict[str, Any]], errors: list[str], warnings: list[str]) -> None:
    sims = plan.get("simulations")
    if not sims:
        if plan.get("structuredOutputs"):
            warnings.append("No simulations declared; add one smoke scenario per job so the build can be exercised by Vapi (see the plan guide).")
        return
    personalities = {p["id"] for p in sims["personalities"]}
    if len(personalities) != len(sims["personalities"]):
        errors.append("Personality IDs must be unique.")
    scenario_ids: set[str] = set()
    for scenario in sims["scenarios"]:
        if scenario["id"] in scenario_ids:
            errors.append(f"Scenario {scenario['id']} is listed twice.")
        scenario_ids.add(scenario["id"])
        if scenario["personality"] not in personalities:
            errors.append(f"{scenario['id']} uses unknown {scenario['personality']}.")
        for job in scenario.get("jobs", []):
            if job not in jobs:
                errors.append(f"{scenario['id']} lists unknown {job}.")
        names: set[str] = set()
        for evaluation in scenario["evaluations"]:
            if evaluation["name"].casefold() in names:
                errors.append(f"{scenario['id']} has two evaluations named “{evaluation['name']}”.")
            names.add(evaluation["name"].casefold())
            if "output" in evaluation and "schema" in evaluation:
                errors.append(f"{scenario['id']} evaluation “{evaluation['name']}” gives both `output` and `schema`; keep one.")
                continue
            if "output" in evaluation:
                output = outputs.get(evaluation["output"])
                if output is None:
                    errors.append(f"{scenario['id']} evaluation “{evaluation['name']}” references unknown {evaluation['output']}.")
                    continue
                kind, problem = _leaf_type(output["schema"], evaluation.get("path"))
            elif "schema" in evaluation:
                kind, problem = _leaf_type(evaluation["schema"], None)
            else:
                errors.append(f"{scenario['id']} evaluation “{evaluation['name']}” needs `output` (a plan structured output) or an inline primitive `schema`.")
                continue
            if problem:
                errors.append(f"{scenario['id']} evaluation “{evaluation['name']}”: {problem}.")
                continue
            comparator = evaluation.get("comparator", "=")
            if kind in EQUALITY_ONLY and comparator not in {"=", "!="}:
                errors.append(f"{scenario['id']} evaluation “{evaluation['name']}” compares a {kind} with {comparator}; only = and != apply.")
            if not _value_matches(kind, evaluation["value"]):
                errors.append(f"{scenario['id']} evaluation “{evaluation['name']}” expects a {kind} but `value` is {type(evaluation['value']).__name__}.")
        mocked: set[str] = set()
        for mock in scenario.get("toolMocks", []):
            if mock["tool"] not in tools_by_operation:
                errors.append(f"{scenario['id']} mocks {mock['tool']}, which is not a declared tool.")
            mocked.add(mock["tool"])
        # A simulation calls the agent's real tools unless they are mocked; never let a test write to the live API.
        for job in scenario.get("jobs", []):
            for operation_id in jobs.get(job, {}).get("tools", []):
                classification = operations.get(operation_id, {}).get("classification", {})
                if (classification.get("write") or classification.get("confirmBeforeCall")) and operation_id not in mocked:
                    errors.append(f"{scenario['id']} exercises {job}, whose tool {operation_id} writes to the live API; add a toolMock for it.")


SINGLE_ASSISTANT_JOB_LIMIT = 5
SINGLE_ASSISTANT_TOOL_LIMIT = 6


AUTH_OPERATION = re.compile(r"(auth|login|log-in|signin|sign-in|verify|verif|pin\b|otp|passcode|identif|lookup|look-up|by-phone|byphone|\bani\b|customer|account)", re.IGNORECASE)
AUTH_ASSISTANT = re.compile(r"(auth|front|door|verif|ident|recept|triage|welcome)", re.IGNORECASE)


def _check_topology(plan: dict[str, Any], jobs: dict[str, dict[str, Any]], operations: dict[str, dict[str, Any]], errors: list[str], warnings: list[str]) -> None:
    """Single assistant or squad: the plan must say which and why, and the shape must match the decision.

    A squad earns its handoff latency only for genuine boundaries (distinct domains or personas, different tool or
    credential access, deliberate context isolation). One assistant per conversational step is a smell. When the API
    can identify callers, a front-door member that verifies them (ANI lookup, then PIN) before any handoff is the
    usual first boundary."""
    topology = plan["agent"].get("topology")
    assistants = plan["assistants"]
    squad = len(assistants) > 1
    authenticated_tools = [t["operationId"] for t in plan["tools"] if operations.get(t["operationId"], {}).get("classification", {}).get("requiresAuth")]
    identify_operations = [op for op, spec in operations.items() if AUTH_OPERATION.search(f"{op} {spec.get('path', '')} {spec.get('summary', '')}")]
    has_front_door = any(AUTH_ASSISTANT.search(f"{a['id']} {a['name']}") for a in assistants)
    if authenticated_tools and identify_operations and not has_front_door and not (topology and "front" in topology["why"].casefold()):
        warnings.append(f"The API has caller-identification operations ({', '.join(identify_operations[:4])}) and the plan calls authenticated ones ({', '.join(authenticated_tools[:4])}); "
                        "assess a front-door member that looks the caller up by ANI ({{customer.number}}), asks for their PIN, and hands off with the verified id (see the plan guide), "
                        "or say in agent.topology.why why not.")
    if topology and topology["choice"] == "squad" and not squad:
        errors.append("agent.topology says squad but the plan has one assistant.")
    if topology and topology["choice"] == "single" and squad:
        errors.append("agent.topology says single but the plan has several assistants.")
    if not squad:
        only = assistants[0]
        job_count, tool_count = len(only.get("jobs", [])), len(only.get("tools", []))
        auth_modes = {t.get("auth", {}).get("mode", "NONE") for t in plan["tools"] if t["operationId"] in set(only.get("tools", []))}
        handlings = {jobs[j]["handling"] for j in only.get("jobs", []) if j in jobs}
        crowded = job_count > SINGLE_ASSISTANT_JOB_LIMIT or tool_count > SINGLE_ASSISTANT_TOOL_LIMIT or (len(auth_modes - {"NONE"}) > 1)
        if crowded and not topology:
            warnings.append(f"One assistant carries {job_count} jobs, {tool_count} tools and {len(auth_modes)} auth mode(s); assess whether a squad of specialists "
                            f"(distinct domains, different credentials, isolated context) would serve callers better, and record the decision in agent.topology.")
        elif not topology and (job_count > 3 or "TOOL_ACTION" in handlings and "ANSWER" in handlings):
            warnings.append("Record the single-assistant decision in agent.topology (choice and why) so the reviewer sees that a squad was considered.")
    else:
        if not topology:
            warnings.append("Record the squad decision in agent.topology (choice and why): which boundary each specialist owns.")
        for assistant in assistants:
            if len(assistant.get("jobs", [])) <= 1 and not assistant.get("tools") and plan["squad"].get("entry") != assistant["id"]:
                warnings.append(f"Assistant {assistant['id']} owns at most one job and no tools; a squad member should own a domain, not a conversational step.")
        signatures = {}
        for assistant in assistants:
            signature = (tuple(sorted(assistant.get("tools", []))), assistant.get("knowledge", True))
            if signature in signatures and assistant.get("tools"):
                warnings.append(f"Assistants {signatures[signature]} and {assistant['id']} have identical tool access; make sure they differ in domain or persona, not just prompt wording.")
            signatures.setdefault(signature, assistant["id"])


def check_plan(workspace: Workspace) -> dict[str, Any]:
    path = workspace.path("plan", "plan.json")
    if not path.exists():
        raise BuildError(f"Write the plan to {path} first (see the skill's plan guide).")
    plan = read_json(path)
    ontology = checked_ontology(workspace)
    inventory = load_capability_inventory(workspace) or {"operations": [], "serverUrl": None}
    validator = Draft202012Validator(read_json(SCHEMA_PATH))
    errors = [f"/{'/'.join(map(str, e.absolute_path))}: {e.message[:200]}" for e in sorted(validator.iter_errors(plan), key=lambda e: list(map(str, e.absolute_path)))]
    warnings: list[str] = []
    if errors:
        return _finish(workspace, plan, None, errors, warnings)

    records = {r["id"]: r for group in ("types", "entities", "claims", "rules", "procedures", "goals", "observations", "capabilities") for r in ontology.get(group, [])}
    operations = {op["operationId"]: op for op in inventory["operations"]}
    for job in plan["jobs"]:
        for ref in job["goals"] + job.get("knowledge", []):
            if ref not in records:
                errors.append(f"{job['id']} references {ref}, which is not in the checked ontology.")
    job_ids = {job["id"] for job in plan["jobs"]}
    if len(job_ids) != len(plan["jobs"]):
        errors.append("Job IDs must be unique.")

    taken: set[str] = set()
    tools_by_operation: dict[str, dict[str, Any]] = {}
    for tool in plan["tools"]:
        operation = operations.get(tool["operationId"])
        if operation is None:
            errors.append(f"Tool {tool['operationId']} is not an operation in the OpenAPI source.")
            continue
        if tool["operationId"] in tools_by_operation:
            errors.append(f"Tool {tool['operationId']} is listed twice.")
        classification = operation["classification"]
        if classification["risk"] == "PRIVILEGED" and not plan["agent"].get("allowPrivileged"):
            errors.append(f"{tool['operationId']} looks administrative or internal ({operation['method']} {operation['path']}); set agent.allowPrivileged only if the user explicitly wants it exposed to callers.")
        if classification["confirmBeforeCall"] and not tool.get("confirmBeforeCall"):
            if tool.get("skipConfirmationReason"):
                warnings.append(f"{tool['operationId']} is a write that will run without a read-back: {tool['skipConfirmationReason']}")
            else:
                errors.append(f"{tool['operationId']} is a {operation['method']} (a write); set confirmBeforeCall: true, or give skipConfirmationReason for a login-style call with nothing to read back.")
        auth = tool.get("auth", {"mode": "NONE"})
        if auth["mode"] == "HEADER_ENV":
            if not auth.get("env"):
                errors.append(f"{tool['operationId']} auth HEADER_ENV needs `env`: the variable name the user saved in {KEY_FILE} holding the token.")
            elif auth["env"] in RESERVED_ENV or auth["env"].startswith(("AWS_", "ANTHROPIC_", "OPENAI_", "GITHUB_", "VAPI_")) or "SECRET" in auth["env"]:
                errors.append(f"{tool['operationId']} names {auth['env']}, which is a platform or provider secret; use a variable the user created for this API.")
        if auth["mode"] == "VAPI_CREDENTIAL" and not auth.get("credentialId"):
            errors.append(f"{tool['operationId']} auth VAPI_CREDENTIAL needs `credentialId` of an existing Vapi credential.")
        if classification["requiresAuth"] and auth["mode"] == "NONE" and not tool.get("headers"):
            warnings.append(f"{tool['operationId']} declares a security requirement but the tool has no auth; calls may fail with 401.")
        if any(name.casefold() == (auth.get("headerName") or "Authorization").casefold() for name in (tool.get("headers") or {})) and auth["mode"] == "HEADER_ENV":
            errors.append(f"{tool['operationId']} sets the same header through `headers` and `auth`; keep one.")
        name = tool.get("name") or openapi.tool_name(tool["operationId"], set(taken))
        if name in taken:
            errors.append(f"Tool name {name} is used twice.")
        taken.add(name)
        tools_by_operation[tool["operationId"]] = {**tool, "name": name, "auth": auth}

    jobs = {job["id"]: job for job in plan["jobs"]}
    for job in plan["jobs"]:
        for operation_id in job.get("tools", []):
            if operation_id not in tools_by_operation:
                errors.append(f"{job['id']} uses tool {operation_id}, which is not declared under tools.")
        if job["handling"] == "TOOL_ACTION" and not job.get("tools"):
            errors.append(f"{job['id']} is a TOOL_ACTION job but lists no tools.")

    assistant_ids = [assistant["id"] for assistant in plan["assistants"]]
    if len(set(assistant_ids)) != len(assistant_ids):
        errors.append("Assistant IDs must be unique.")
    names = [assistant["name"] for assistant in plan["assistants"]]
    if len(set(names)) != len(names):
        errors.append("Assistant names must be unique (handoffs address assistants by name).")
    covered_jobs: set[str] = set()
    for assistant in plan["assistants"]:
        if len(assistant["name"]) > 40:
            errors.append(f"Assistant name “{assistant['name']}” is longer than Vapi's 40-character limit.")
        for job_id in assistant["jobs"]:
            if job_id not in job_ids:
                errors.append(f"Assistant {assistant['id']} lists unknown {job_id}.")
            covered_jobs.add(job_id)
        for operation_id in assistant.get("tools", []):
            if operation_id not in tools_by_operation:
                errors.append(f"Assistant {assistant['id']} uses undeclared tool {operation_id}.")
        for handoff in assistant.get("handoffTo", []):
            if handoff["assistant"] not in assistant_ids:
                errors.append(f"Assistant {assistant['id']} hands off to unknown assistant {handoff['assistant']}.")
            if handoff["assistant"] == assistant["id"]:
                errors.append(f"Assistant {assistant['id']} cannot hand off to itself.")
    for job_id in job_ids - covered_jobs:
        warnings.append(f"{job_id} is not assigned to any assistant.")
    if len(plan["assistants"]) > 1:
        if "squad" not in plan:
            errors.append("More than one assistant requires a squad with an entry assistant.")
        elif plan["squad"]["entry"] not in assistant_ids:
            errors.append(f"squad.entry {plan['squad']['entry']} is not an assistant.")
    _check_topology(plan, jobs, operations, errors, warnings)
    runtime = {**DEFAULT_RUNTIME, **plan.get("runtime", {})}
    server_url = runtime.get("serverUrl") or inventory.get("serverUrl")
    if tools_by_operation and not server_url:
        errors.append("No server URL for the tools: set runtime.serverUrl (for example https://standardcharter.co).")
    if server_url and not str(server_url).startswith("https://"):
        errors.append(f"The tools' server URL must use https, got {server_url}; set runtime.serverUrl.")
    runtime["serverUrl"] = server_url
    tool_operations = {operation_id: operations[operation_id] for operation_id in tools_by_operation}
    used_tools = {t for a in plan["assistants"] for t in a.get("tools", [])}
    for operation_id in tools_by_operation:
        if operation_id not in used_tools:
            warnings.append(f"Tool {operation_id} is declared but no assistant uses it.")
    if not plan.get("tests"):
        warnings.append("No tests declared; add a few caller scenarios so the build can be verified.")
    outputs = _check_outputs(plan, job_ids, set(assistant_ids), errors, warnings)
    _check_simulations(plan, jobs, tools_by_operation, tool_operations, outputs, errors, warnings)
    if errors:
        return _finish(workspace, plan, None, errors, warnings)
    candidate = {
        **plan,
        "runtime": runtime,
        "knowledge": {**DEFAULT_KNOWLEDGE, **plan.get("knowledge", {})},
        "structuredOutputs": [{**o, "type": o.get("type", "ai"), "assistants": o.get("assistants") or list(assistant_ids)} for o in plan.get("structuredOutputs", [])],
        "resolvedTools": [{**tools_by_operation[op], "operation": {k: v for k, v in tool_operations[op].items() if k not in {"text"}}} for op in tools_by_operation],
        "ontologyDigest": ontology["digest"],
        "enabledOperations": sorted(f"{tool_operations[op]['method']} {tool_operations[op]['path']} ({op}) · risk {tool_operations[op]['classification']['risk']}"
                                    + (" · confirms first" if tools_by_operation[op].get("confirmBeforeCall") else " · NO read-back" if tool_operations[op]["classification"]["confirmBeforeCall"] else "")
                                    for op in tools_by_operation),
    }
    candidate["digest"] = plan_digest(candidate)
    candidate["checkedAt"] = utc_now()
    return _finish(workspace, plan, candidate, errors, warnings)


def plan_digest(candidate: dict[str, Any]) -> str:
    return digest_json({k: v for k, v in candidate.items() if k not in {"digest", "checkedAt"}})


def _finish(workspace: Workspace, plan: dict[str, Any], candidate: dict[str, Any] | None, errors: list[str], warnings: list[str]) -> dict[str, Any]:
    sims = plan.get("simulations") or {}
    report = {"stage": "plan", "status": "REJECTED" if errors else "CANDIDATE", "checkedAt": utc_now(), "errors": errors, "warnings": warnings,
              "digest": candidate["digest"] if candidate else None,
              "enabledOperations": candidate["enabledOperations"] if candidate else [],
              "counts": {"jobs": len(plan.get("jobs", [])), "tools": len(plan.get("tools", [])), "assistants": len(plan.get("assistants", [])), "tests": len(plan.get("tests", [])),
                         "structuredOutputs": len(plan.get("structuredOutputs", [])), "scenarios": len(sims.get("scenarios", []) if isinstance(sims, dict) else [])}}
    write_json(workspace.path("plan", "check.json"), report)
    candidate_path = workspace.path("plan", "candidate.json")
    if candidate:
        write_json(candidate_path, candidate)
    elif candidate_path.exists():
        candidate_path.unlink()
    return report


def load_candidate(workspace: Workspace) -> dict[str, Any]:
    path = workspace.path("plan", "candidate.json")
    if not path.exists():
        raise BuildError("No checked plan candidate. Run `check plan` until it passes.")
    return read_json(path)


def summarize(candidate: dict[str, Any], ontology: dict[str, Any]) -> str:
    labels = {r["id"]: r.get("label") or r.get("text", "")[:80] for group in ("goals", "claims", "rules", "procedures", "entities", "types") for r in ontology.get(group, [])}
    lines = [f"# Plan summary: {candidate['agent']['name']}", "", candidate["agent"]["purpose"], ""]
    lines.append(f"**Runtime:** model {candidate['runtime']['model']['provider']}/{candidate['runtime']['model']['model']}, voice {candidate['runtime']['voice']['provider']}/{candidate['runtime']['voice']['voiceId']}, tools call `{candidate['runtime'].get('serverUrl') or 'n/a'}`")
    lines += ["", "## Jobs the agent handles"]
    for job in candidate["jobs"]:
        goals = ", ".join(labels.get(g, g) for g in job["goals"])
        lines.append(f"- **{job['label']}** ({job['handling']}) → {goals}")
        if job.get("tools"):
            lines.append(f"  - tools: {', '.join(job['tools'])}")
        if job.get("knowledge"):
            lines.append(f"  - knowledge: {len(job['knowledge'])} records")
        if job.get("safeguards"):
            lines.append(f"  - safeguards: {'; '.join(job['safeguards'])}")
    lines += ["", "## Tools (operations the agent may call)"]
    if not candidate["resolvedTools"]:
        lines.append("- none")
    for tool in candidate["resolvedTools"]:
        op = tool["operation"]
        confirm = " · confirms before calling" if tool.get("confirmBeforeCall") else ""
        lines.append(f"- `{tool['name']}` → {op['method']} {op['path']} · risk {op['classification']['risk']} · auth {tool['auth']['mode']}{confirm}")
    knowledge = candidate["knowledge"]
    lines += ["", "## Knowledge base", f"- source documents: {'yes' if knowledge['includeSourceDocuments'] else 'no'}; website pages: {'yes' if knowledge['includeWebsitePages'] else 'no'}; generated domain guide: {'yes' if knowledge['includeDomainGuide'] else 'no'}"]
    if knowledge.get("excludeLocators"):
        lines.append(f"- excluded: {', '.join(knowledge['excludeLocators'])}")
    topology = candidate["agent"].get("topology")
    lines += ["", "## Assistants" + (f" · {topology['choice']}: {topology['why']}" if topology else "")]
    for assistant in candidate["assistants"]:
        handoffs = f"; hands off to {', '.join(h['assistant'] for h in assistant.get('handoffTo', []))}" if assistant.get("handoffTo") else ""
        lines.append(f"- **{assistant['name']}** ({assistant['id']}): jobs {', '.join(assistant['jobs'])}; tools {', '.join(assistant.get('tools', [])) or 'none'}; knowledge {'on' if assistant.get('knowledge', True) else 'off'}{handoffs}")
    if candidate.get("squad"):
        lines.append(f"- squad entry: {candidate['squad']['entry']}")
    if candidate.get("structuredOutputs"):
        lines += ["", f"## Structured outputs ({len(candidate['structuredOutputs'])}) — extracted from every call"]
        for output in candidate["structuredOutputs"]:
            fields = ", ".join((output["schema"].get("properties") or {}).keys()) if output["schema"].get("type") == "object" else output["schema"].get("type")
            lines.append(f"- **{output['name']}** ({output['id']}): {output['description']} · {fields}")
    sims = candidate.get("simulations")
    if sims:
        lines += ["", f"## Simulations ({len(sims['scenarios'])} scenarios, {len(sims['personalities'])} personalities, {sims.get('transport', 'vapi.webchat')})"]
        for scenario in sims["scenarios"]:
            checks = "; ".join(f"{e['name']} {e.get('comparator', '=')} {e['value']!r}" for e in scenario["evaluations"])
            mocks = f" · mocks {', '.join(m['tool'] for m in scenario['toolMocks'])}" if scenario.get("toolMocks") else ""
            lines.append(f"- **{scenario['name']}** as {scenario['personality']}: {checks}{mocks}")
    if candidate.get("tests"):
        lines += ["", f"## Chat tests ({len(candidate['tests'])})"]
        for test in candidate["tests"]:
            lines.append(f"- {test['scenario']}: caller says “{test['callerOpening']}” → expect {'; '.join(test['expect'])}")
    if candidate.get("exclusions"):
        lines += ["", "## Deliberately excluded"]
        for item in candidate["exclusions"]:
            lines.append(f"- {item['what']}: {item['why']}")
    return "\n".join(lines) + "\n"


def approve_plan(workspace: Workspace, *, by: str | None = None) -> dict[str, Any]:
    """Record the user's yes for the plan and, with it, for the ontology it was checked against.

    Both are reviewed on the same page, so one yes covers both. The ontology approval still refuses
    critical open issues and a candidate that changed after its check."""
    report_path = workspace.path("plan", "check.json")
    if not report_path.exists():
        raise BuildError("Run `check plan` before approving.")
    report = read_json(report_path)
    if report["status"] != "CANDIDATE":
        raise BuildError("The plan check did not pass; fix the errors first.")
    candidate = load_candidate(workspace)
    if candidate["digest"] != report["digest"]:
        raise BuildError("The plan changed after its last check. Run `check plan` again.")
    ontology = checked_ontology(workspace)
    if ontology["digest"] != candidate["ontologyDigest"]:
        raise BuildError("The ontology changed after the plan was checked. Run `check plan` again.")
    ontology_approval_path = workspace.path("ontology", "approval.json")
    ontology_approved = ontology_approval_path.exists() and read_json(ontology_approval_path).get("digest") == ontology["digest"]
    if not ontology_approved:
        approve_ontology(workspace, by=by)
    approval = {"stage": "plan", "digest": candidate["digest"], "ontologyDigest": candidate["ontologyDigest"], "enabledOperations": candidate["enabledOperations"],
                "ontologyApprovedHere": not ontology_approved, "by": approver(by), "at": utc_now()}
    write_json(workspace.path("plan", "approval.json"), approval)
    return approval


def approved_plan(workspace: Workspace) -> dict[str, Any]:
    from .ontology import approved_ontology

    approval_path = workspace.path("plan", "approval.json")
    if not approval_path.exists():
        raise BuildError("The plan has not been approved. Run `approve plan` after review.")
    approval = read_json(approval_path)
    candidate = load_candidate(workspace)
    if plan_digest(candidate) != approval["digest"] or candidate.get("digest") != approval["digest"]:
        raise BuildError("The plan candidate differs from what was approved. Run `check plan` and approve it again.")
    ontology = approved_ontology(workspace)
    if ontology["digest"] != approval["ontologyDigest"]:
        raise BuildError("The ontology changed after the plan was approved. Re-check and re-approve the plan.")
    return candidate
