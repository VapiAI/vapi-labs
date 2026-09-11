"""Compile the approved plan into exact Vapi payloads and knowledge-base files. No network."""
from __future__ import annotations

import hashlib
import re
import shutil
from collections import defaultdict
from typing import Any

from . import sources
from .extract import load_ledger, segment_text
from .ontology import approved_ontology
from .plan import approved_plan
from .workspace import BuildError, Workspace, slug, utc_now, write_json

TEXT_LIKE = {"markdown", "text", "yaml", "json", "csv", "pdf", "docx", "html"}


def _display_locator(locator: str) -> str:
    """Public URLs are cited as-is; local paths and S3 keys are cited by document name only, never by full path."""
    if locator.startswith("https://") or locator.startswith("http://"):
        return locator
    return locator.rstrip("/").rsplit("/", 1)[-1] or locator


def _locators(ledger: dict[str, Any]) -> dict[str, str]:
    segment_locator = {s["id"]: _display_locator(s["locator"]) for s in ledger["segments"]}
    return {e["id"]: segment_locator[e["segment"]] for e in ledger["evidence"]}


def render_domain_guide(ontology: dict[str, Any], ledger: dict[str, Any]) -> str:
    locator_of = _locators(ledger)
    by_id = {r["id"]: r for group in ("types", "entities", "claims", "rules", "procedures", "goals", "observations", "capabilities") for r in ontology.get(group, [])}
    label = lambda ref: by_id.get(ref, {}).get("label") or by_id.get(ref, {}).get("operationId") or ref  # noqa: E731

    def cite(record: dict[str, Any]) -> str:
        seen = []
        for ref in record.get("evidence", []):
            locator = locator_of.get(ref)
            if locator and locator not in seen:
                seen.append(locator)
        return f" (source: {'; '.join(seen[:2])})" if seen else ""

    lines = [f"# {ontology['domain']['name']}: domain guide", "", ontology["domain"]["summary"], "",
             "This guide was compiled from the organization's own material. Every statement carries its source.", ""]
    lines += ["## Glossary", ""]
    for record in ontology["types"]:
        lines.append(f"- **{record['label']}**: {record['definition']}")
    for record in ontology["entities"]:
        aliases = f" Also called: {', '.join(record['aliases'])}." if record.get("aliases") else ""
        lines.append(f"- **{record['label']}** ({', '.join(label(t) for t in record['types'])}): {record['definition']}{aliases}")
    if ontology["claims"]:
        lines += ["", "## Facts", ""]
        grouped = defaultdict(list)
        for claim in ontology["claims"]:
            grouped[claim["subject"]].append(claim)
        for subject, claims in grouped.items():
            lines.append(f"### {label(subject)}")
            for claim in claims:
                prefix = "Not the case: " if claim.get("polarity") == "NEGATIVE" else ""
                condition = f" Applies when: {claim['conditions']}." if claim.get("conditions") else ""
                status = " (inferred, not stated verbatim)" if claim.get("status") == "INFERRED" else " (hypothesis, unverified)" if claim.get("status") == "HYPOTHESIS" else ""
                lines.append(f"- {prefix}{claim['text']}{condition}{status}{cite(claim)}")
            lines.append("")
    if ontology["rules"]:
        lines += ["## Rules and policies", ""]
        for rule in ontology["rules"]:
            actors = f" For {', '.join(label(a) for a in rule['actors'])}:" if rule.get("actors") else ""
            applies = f" Applies: {rule['applies']}." if rule.get("applies") else ""
            exceptions = f" Exceptions: {'; '.join(rule['exceptions'])}." if rule.get("exceptions") else ""
            lines.append(f"- {rule['modality'].replace('_', ' ')}:{actors} {rule['text']}{applies}{exceptions}{cite(rule)}")
        lines.append("")
    if ontology["procedures"]:
        lines += ["## Procedures", ""]
        for procedure in ontology["procedures"]:
            goals = f" Serves: {', '.join(label(g) for g in procedure['goals'])}." if procedure.get("goals") else ""
            lines.append(f"### {procedure['label']}{goals}{cite(procedure)}")
            for index, step in enumerate(procedure["steps"], start=1):
                tool = f" [uses {label(step['capability'])}]" if step.get("capability") else ""
                lines.append(f"{index}. {step['instruction']}{tool}")
            lines.append("")
    lines += ["## What callers ask for", ""]
    for goal in ontology["goals"]:
        phrases = f" Callers say things like: “{'”, “'.join(goal['callerPhrases'][:5])}”." if goal.get("callerPhrases") else ""
        lines.append(f"- **{goal['label']}**: {goal['definition']}{phrases}")
    # Observations come from transcripts and stay out of the knowledge base by rule.
    return "\n".join(lines).rstrip() + "\n"


def _tool_payload(tool: dict[str, Any], server_url: str) -> dict[str, Any]:
    operation = tool["operation"]
    url = server_url.rstrip("/") + re.sub(r"\{([^}]+)\}", r"{{\1}}", operation["path"])
    if operation["queryParams"]:
        url += "?" + "&".join(f"{name}={{{{{name}}}}}" for name in operation["queryParams"])
    payload: dict[str, Any] = {"type": "apiRequest", "name": tool["name"], "description": tool["description"], "method": operation["method"], "url": url}
    if operation["toolSchema"].get("properties"):
        payload["body"] = operation["toolSchema"]
    if tool.get("headers"):
        # Fixed or Liquid header values: Vapi reads `value` on a header property and never asks the model for it.
        payload["headers"] = {"type": "object", "properties": {name: {"type": "string", "value": value} for name, value in tool["headers"].items()}}
    if tool.get("timeoutSeconds"):
        payload["timeoutSeconds"] = tool["timeoutSeconds"]
    if tool.get("startMessage"):
        payload["messages"] = [{"type": "request-start", "content": tool["startMessage"]}]
    if tool.get("extract"):
        payload["variableExtractionPlan"] = {"aliases": [{"key": key, "value": value} for key, value in tool["extract"].items()]}
    if tool.get("staticParameters"):
        # Fixed or Liquid body values the model never fills, e.g. the caller's ANI as {{customer.number}}.
        body = payload.setdefault("body", {"type": "object", "properties": {}})
        body.setdefault("properties", {})
        for key, value in tool["staticParameters"].items():
            existing = body["properties"].get(key, {})
            body["properties"][key] = {**existing, "type": existing.get("type") or ("string" if isinstance(value, str) else "boolean" if isinstance(value, bool) else "number"), "value": value}
            if key in (body.get("required") or []):
                body["required"] = [r for r in body["required"] if r != key]
    if tool["auth"]["mode"] == "VAPI_CREDENTIAL":
        payload["credentialId"] = tool["auth"]["credentialId"]
    return payload


def _job_section(jobs: list[dict[str, Any]], ontology: dict[str, Any], tool_names: dict[str, str]) -> str:
    by_id = {r["id"]: r for group in ("claims", "rules", "procedures", "goals") for r in ontology.get(group, [])}
    names = {r["id"]: r.get("label") for group in ("types", "entities") for r in ontology.get(group, [])}
    lines = ["# Jobs you handle"]
    for job in jobs:
        goals = ", ".join(by_id[g]["label"] for g in job["goals"] if g in by_id)
        lines.append(f"## {job['label']} ({job['handling'].replace('_', ' ').lower()}) — caller goal: {goals}")
        if job.get("steps"):
            lines += [f"{index}. {step}" for index, step in enumerate(job["steps"], start=1)]
        if job.get("slots"):
            lines.append("Collect: " + "; ".join(f"{slot['name']} ({slot['description']}{', required' if slot.get('required') else ''}{', confirm it back' if slot.get('confirm') else ''})" for slot in job["slots"]))
        if job.get("tools"):
            lines.append("Tools: " + ", ".join(tool_names.get(op, op) for op in job["tools"]))
        knowledge = [by_id[ref] for ref in job.get("knowledge", []) if ref in by_id]
        if knowledge:
            lines.append("Know:")
            for record in knowledge:
                if "text" in record:
                    # A fact must name its subject, or the model attaches the right number to the wrong product.
                    subject = names.get(record.get("subject", ""), "")
                    prefix = f"{record['modality'].replace('_', ' ')}: " if record.get("modality") else f"{subject}: " if subject else ""
                    suffix = f" (when {record['conditions']})" if record.get("conditions") else ""
                    negative = " [this is NOT the case]" if record.get("polarity") == "NEGATIVE" else ""
                    lines.append(f"- {prefix}{record['text']}{suffix}{negative}")
                elif "steps" in record:
                    lines.append(f"- Procedure “{record['label']}”: " + " → ".join(step["instruction"] for step in record["steps"]))
        if job.get("safeguards"):
            lines.append("Safeguards: " + " ".join(job["safeguards"]))
        if job.get("escalation"):
            lines.append(f"Escalate: {job['escalation']}")
        for example in job.get("examples", [])[:2]:
            lines.append(f"Example — caller: “{example['caller']}” → you: “{example['agent']}”")
    return "\n".join(lines)


def _destination(handoff: dict[str, Any], assistant_name: str) -> dict[str, Any]:
    """A handoff destination: the named assistant, when to go there, and which variables travel with the caller."""
    destination = {"type": "assistant", "assistantName": assistant_name, "description": handoff["when"], "contextEngineeringPlan": {"type": "userAndAssistantMessages"}}
    if handoff.get("carry"):
        destination["variableExtractionPlan"] = {"schema": {"type": "object", "properties": {key: {"type": "string", "description": what} for key, what in handoff["carry"].items()}}}
    return destination


def _system_prompt(assistant: dict[str, Any], plan: dict[str, Any], tools: dict[str, dict[str, Any]], ontology: dict[str, Any] | None = None) -> str:
    parts = [assistant["systemPrompt"].strip()]
    jobs = [job for job in plan["jobs"] if job["id"] in set(assistant.get("jobs", []))]
    if jobs and ontology is not None:
        parts.append(_job_section(jobs, ontology, {tool["operationId"]: name for name, tool in tools.items()}))
    if assistant.get("knowledge", True):
        parts.append("# Knowledge\nBefore answering a factual question, search the knowledge base and answer only from what it returns. "
                     "If it has nothing relevant, say so plainly and offer the next step; never invent facts, prices, policies, or eligibility.")
    used = [tools[name] for name in assistant.get("tools", []) if name in tools]
    if used:
        lines = ["# Tools"]
        for tool in used:
            lines.append(f"- {tool['name']}: {tool['description']}")
            if tool.get("confirmBeforeCall"):
                lines.append("  Before calling it, read back every value you will send and wait for an explicit yes. Call it once; do not retry on your own.")
        lines.append("Only pass values the caller gave you or that an earlier tool returned. Never guess identifiers, amounts, or account details.")
        parts.append("\n".join(lines))
    if assistant.get("handoffTo"):
        lines = ["# Handoffs"]
        for handoff in assistant["handoffTo"]:
            carry = f" Carry along: {', '.join(f'{k} ({v})' for k, v in handoff['carry'].items())}." if handoff.get("carry") else ""
            lines.append(f"- Hand off to {handoff['assistant']} when {handoff['when']}.{carry}")
        parts.append("\n".join(lines))
    if plan.get("exclusions"):
        parts.append("# Out of scope\n" + "\n".join(f"- {item['what']}: {item['why']}" for item in plan["exclusions"]))
    return "\n\n".join(parts)


def compile_build(workspace: Workspace) -> dict[str, Any]:
    plan = approved_plan(workspace)
    ontology = approved_ontology(workspace)
    ledger = load_ledger(workspace)
    out = workspace.path("vapi")
    knowledge_dir = out / "knowledge"
    if knowledge_dir.exists():
        shutil.rmtree(knowledge_dir)
    knowledge_dir.mkdir(parents=True)
    project_slug = workspace.project["slug"]
    selection = plan["knowledge"]
    excluded = set(selection.get("excludeLocators", []))
    files: list[dict[str, Any]] = []
    taken_names: set[str] = set()

    def unique(name: str) -> str:
        base, ext = (name.rsplit(".", 1) + [""])[:2] if "." in name else (name, "")
        candidate, counter = name, 2
        while candidate.casefold() in taken_names:
            candidate = f"{base}-{counter}" + (f".{ext}" if ext else "")
            counter += 1
        taken_names.add(candidate.casefold())
        return candidate

    def record(path_name: str, origin: str, locator: str, **extra: Any) -> None:
        data = (knowledge_dir / path_name).read_bytes()
        if not data.strip():
            (knowledge_dir / path_name).unlink()
            return
        files.append({"path": f"knowledge/{path_name}", "name": path_name, "origin": origin, "locator": locator, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), **extra})

    if selection["includeDomainGuide"]:
        name = unique(f"{project_slug}-domain-guide.md")
        (knowledge_dir / name).write_text(render_domain_guide(ontology, ledger), encoding="utf-8")
        record(name, "generated", "ontology")
    if selection["includeWebsitePages"]:
        for segment in ledger["segments"]:
            if segment["role"] != "website" or segment["locator"] in excluded:
                continue
            name = unique(f"{segment['id'].split(':', 1)[1]}.md")
            body = f"# {segment['title']}\n\nSource: {segment['locator']}\n\n{segment_text(workspace, segment)}\n"
            (knowledge_dir / name).write_text(body, encoding="utf-8")
            record(name, "website", segment["locator"])
    if selection["includeSourceDocuments"]:
        for source in workspace.sources("knowledge"):
            inventory = sources.load_inventory(workspace, source)
            raw = sources.raw_dir(workspace, source)
            for item in inventory["items"]:
                if item["locator"] in excluded or item["kind"] not in TEXT_LIKE and item["kind"] != "other":
                    continue
                original = item["locator"].rstrip("/").rsplit("/", 1)[-1] or item["file"]
                if item["kind"] == "html":
                    segment = next((s for s in ledger["segments"] if s.get("item") == item["id"] and s["source"] == source["id"]), None)
                    if segment is None:
                        continue
                    name = unique(slug(original.rsplit(".", 1)[0], 50) + ".md")
                    (knowledge_dir / name).write_text(f"# {segment['title']}\n\nSource: {_display_locator(segment['locator'])}\n\n{segment_text(workspace, segment)}\n", encoding="utf-8")
                else:
                    if not item.get("bytes"):
                        continue
                    name = unique(re.sub(r"[^A-Za-z0-9._-]+", "-", original)[:80] or item["file"])
                    shutil.copyfile(raw / item["file"], knowledge_dir / name)
                record(name, "source", item["locator"], kind=item["kind"])
    if not files:
        raise BuildError("The plan selects no knowledge files; enable at least the domain guide or source documents.")

    server_url = plan["runtime"].get("serverUrl") or ""
    tools_by_name = {tool["name"]: tool for tool in plan["resolvedTools"]}
    by_operation = {tool["operationId"]: tool for tool in plan["resolvedTools"]}
    tool_records = []
    for tool in plan["resolvedTools"]:
        secret_headers = []
        if tool["auth"]["mode"] == "HEADER_ENV":
            # The value is injected at apply time from the key file; build.json never holds it.
            secret_headers.append({"name": tool["auth"].get("headerName") or "Authorization", "env": tool["auth"]["env"], "prefix": tool["auth"].get("prefix", "Bearer ")})
        tool_records.append({"ref": f"tool:{tool['name']}", "operationId": tool["operationId"], "payload": _tool_payload(tool, server_url), "secretHeaders": secret_headers})

    assistant_records = []
    names = {assistant["id"]: assistant["name"] for assistant in plan["assistants"]}
    for assistant in plan["assistants"]:
        tool_names = [by_operation[op]["name"] for op in assistant.get("tools", []) if op in by_operation]
        prompt = _system_prompt({**assistant, "tools": tool_names, "handoffTo": [{**h, "assistant": names[h["assistant"]]} for h in assistant.get("handoffTo", [])]}, plan, tools_by_name, ontology)
        model = {**plan["runtime"]["model"], "messages": [{"role": "system", "content": prompt}]}
        if assistant.get("handoffTo"):
            model["tools"] = [{"type": "handoff", "destinations": [_destination(h, names[h["assistant"]]) for h in assistant["handoffTo"]]}]
        payload = {
            "name": assistant["name"],
            "firstMessageMode": "assistant-speaks-first" if assistant.get("firstMessage") else "assistant-speaks-first-with-model-generated-message",
            "model": model,
            "voice": plan["runtime"]["voice"],
            "transcriber": plan["runtime"]["transcriber"],
            "metadata": {"managedBy": "vapi-build", "project": project_slug, "planDigest": plan["digest"], "ontologyDigest": plan["ontologyDigest"]},
        }
        if assistant.get("firstMessage"):
            payload["firstMessage"] = assistant["firstMessage"]
        assistant_records.append({"ref": f"assistant:{assistant['id']}", "payload": payload, "toolRefs": [f"tool:{name}" for name in tool_names],
                                  "knowledge": assistant.get("knowledge", True),
                                  "outputRefs": [output["id"] for output in plan.get("structuredOutputs", []) if assistant["id"] in output["assistants"]]})
    # Structured outputs: one saved definition each; apply attaches them through artifactPlan.structuredOutputIds.
    output_records = [{"ref": output["id"], "payload": {"name": output["name"], "description": output["description"], "type": output["type"], "schema": output["schema"]},
                       "assistantRefs": [f"assistant:{a}" for a in output["assistants"]], "jobs": output.get("jobs", [])} for output in plan.get("structuredOutputs", [])]
    simulations = _simulation_records(plan, by_operation) if plan.get("simulations") else None
    squad = None
    if len(plan["assistants"]) > 1:
        entry = plan["squad"]["entry"]
        ordered = sorted(plan["assistants"], key=lambda a: a["id"] != entry)
        squad = {"ref": "squad:main", "payload": {"name": plan["squad"].get("name") or f"{plan['agent']['name']} squad"},
                 "members": [{"assistantRef": f"assistant:{a['id']}", "assistantDestinations": [_destination(h, names[h["assistant"]]) for h in a.get("handoffTo", [])]} for a in ordered]}
    build = {
        "compiledAt": utc_now(), "project": workspace.project["name"], "projectSlug": project_slug,
        "planDigest": plan["digest"], "ontologyDigest": plan["ontologyDigest"], "ledgerDigest": ontology["ledgerDigest"],
        "knowledgeBase": {"name": (selection.get("name") or f"{plan['agent']['name']} knowledge")[:80],
                          "description": f"Compiled by vapi-build from {len(files)} files; plan {plan['digest'][:23]}"[:1000], "files": files},
        "tools": tool_records, "assistants": assistant_records, "squad": squad,
        "structuredOutputs": output_records, "simulations": simulations,
        "tests": plan.get("tests", []),
    }
    write_json(out / "build.json", build)
    (out / "summary.md").write_text(render_build_summary(build), encoding="utf-8")
    return build


def _simulation_records(plan: dict[str, Any], by_operation: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Vapi simulation payloads: personalities (AI testers), scenarios with evaluations and tool mocks, one simulation per scenario, one suite."""
    sims = plan["simulations"]
    model = plan["runtime"]["model"]
    personalities = [{
        "ref": personality["id"],
        "payload": {"name": personality["name"][:80],
                    "assistant": {"name": personality["name"][:40],
                                  "model": {"provider": model["provider"], "model": model["model"], "messages": [{"role": "system", "content": personality["prompt"]}]}}},
    } for personality in sims["personalities"]]
    scenarios = []
    for scenario in sims["scenarios"]:
        evaluations, labels = [], []
        for evaluation in scenario["evaluations"]:
            item: dict[str, Any] = {"comparator": evaluation.get("comparator", "="), "value": evaluation["value"], "required": evaluation.get("required", True)}
            if evaluation.get("path"):
                item["path"] = evaluation["path"]
            if "output" in evaluation:
                item["structuredOutputRef"] = evaluation["output"]  # resolved to structuredOutputId at apply time
            else:
                item["structuredOutput"] = {"name": evaluation["name"], "description": evaluation.get("description") or evaluation["name"], "type": "ai", "schema": evaluation["schema"]}
            evaluations.append(item)
            labels.append(evaluation["name"])
        payload: dict[str, Any] = {"name": scenario["name"][:80], "instructions": scenario["instructions"], "evaluations": evaluations}
        if scenario.get("toolMocks"):
            payload["toolMocks"] = [{"toolName": by_operation[m["tool"]]["name"] if m["tool"] in by_operation else m["tool"], "result": m["result"], "enabled": True} for m in scenario["toolMocks"]]
        if scenario.get("variables"):
            payload["targetOverrides"] = {"variableValues": scenario["variables"]}
        scenarios.append({"ref": scenario["id"], "personalityRef": scenario["personality"], "payload": payload, "evaluationLabels": labels, "jobs": scenario.get("jobs", [])})
    return {
        "transport": sims.get("transport", "vapi.webchat"),
        "personalities": personalities,
        "scenarios": scenarios,
        "simulations": [{"ref": "simulation:" + s["ref"].split(":", 1)[1], "name": s["payload"]["name"], "scenarioRef": s["ref"], "personalityRef": s["personalityRef"]} for s in scenarios],
        "suite": {"name": (sims.get("suiteName") or f"{plan['agent']['name']} simulations")[:80]},
    }


def render_build_summary(build: dict[str, Any]) -> str:
    lines = [f"# Vapi build for {build['project']}", "", f"Plan {build['planDigest'][:23]} · ontology {build['ontologyDigest'][:23]}", "",
             f"## Knowledge base “{build['knowledgeBase']['name']}” ({len(build['knowledgeBase']['files'])} files)"]
    for file in build["knowledgeBase"]["files"]:
        lines.append(f"- {file['name']} ({file['origin']}) ← {file['locator']}")
    lines += ["", f"## Tools ({len(build['tools'])})"]
    for tool in build["tools"]:
        payload = tool["payload"]
        auth = "".join(f" · {h['name']} header from key-file variable {h['env']}" for h in tool.get("secretHeaders", []))
        if payload.get("credentialId"):
            auth += f" · credentialId {payload['credentialId']}"
        lines.append(f"- {payload['name']}: {payload['method']} {payload['url']}{auth}")
    lines += ["", f"## Assistants ({len(build['assistants'])})"]
    for assistant in build["assistants"]:
        lines.append(f"- {assistant['payload']['name']}: {len(assistant['toolRefs'])} API tools" + (" + knowledge base" if assistant["knowledge"] else ""))
    if build["squad"]:
        lines.append(f"- Squad “{build['squad']['payload']['name']}” starting with {build['squad']['members'][0]['assistantRef']}")
    secrets = sorted({h["env"] for tool in build["tools"] for h in tool.get("secretHeaders", [])})
    if secrets:
        lines += ["", "## Tokens read from ~/.config/vapi-build/env at apply time (never written to disk here)"]
        for env in secrets:
            lines.append(f"- {env}")
    if build.get("structuredOutputs"):
        lines += ["", f"## Structured outputs ({len(build['structuredOutputs'])}), extracted after every call"]
        for output in build["structuredOutputs"]:
            schema = output["payload"]["schema"]
            fields = ", ".join((schema.get("properties") or {}).keys()) if schema.get("type") == "object" else schema.get("type", "")
            lines.append(f"- {output['payload']['name']} → {', '.join(r.split(':', 1)[1] for r in output['assistantRefs'])}: {fields}")
    if build.get("simulations"):
        sims = build["simulations"]
        lines += ["", f"## Simulations: suite “{sims['suite']['name']}” ({len(sims['scenarios'])} scenarios, {sims['transport']})"]
        for scenario in sims["scenarios"]:
            mocks = f" · mocks {', '.join(m['toolName'] for m in scenario['payload'].get('toolMocks', []))}" if scenario["payload"].get("toolMocks") else ""
            lines.append(f"- {scenario['payload']['name']} as {scenario['personalityRef']}: {'; '.join(scenario['evaluationLabels'])}{mocks}")
    if build["tests"]:
        lines += ["", f"## Chat test scenarios ({len(build['tests'])})"]
        for test in build["tests"]:
            lines.append(f"- {test['scenario']}: “{test['callerOpening']}” → {'; '.join(test['expect'])}")
    return "\n".join(lines) + "\n"
