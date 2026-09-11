"""Check, summarize, and approve the model-authored ontology against the evidence ledger."""
from __future__ import annotations

import json
import subprocess
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from .extract import ledger_digest, load_ledger
from .workspace import BuildError, Workspace, digest_json, read_json, utc_now, write_json

SCHEMA_PATH = Path(__file__).with_name("schemas") / "ontology.schema.json"
GROUPS = (("types", "type"), ("entities", "entity"), ("properties", "property"), ("relations", "relation"), ("claims", "claim"),
          ("rules", "rule"), ("procedures", "procedure"), ("goals", "goal"), ("capabilities", "capability"), ("observations", "observation"), ("issues", "issue"))


def schema_errors(value: Any) -> list[str]:
    validator = Draft202012Validator(read_json(SCHEMA_PATH))
    return [f"/{'/'.join(map(str, e.absolute_path))}: {e.message[:200]}" for e in sorted(validator.iter_errors(value), key=lambda e: list(map(str, e.absolute_path)))]


def load_capability_inventory(workspace: Workspace) -> dict[str, Any] | None:
    path = workspace.path("evidence", "capabilities.json")
    return read_json(path) if path.exists() else None


def check_ontology(workspace: Workspace, *, strict: bool = False) -> dict[str, Any]:
    path = workspace.path("ontology", "ontology.json")
    if not path.exists():
        raise BuildError(f"Write the ontology to {path} first (see the skill's ontology guide).")
    ontology = read_json(path)
    ledger = load_ledger(workspace)
    inventory = load_capability_inventory(workspace)
    errors: list[str] = schema_errors(ontology)
    warnings: list[str] = []
    if errors:
        return _finish(workspace, ontology, None, errors, warnings, {})

    evidence_by_id = {e["id"]: e for e in ledger["evidence"]}
    segment_by_id = {s["id"]: s for s in ledger["segments"]}
    source_by_id = {s["id"]: s for s in ledger["sources"]}
    drafts = {c["id"]: c for c in (inventory or {}).get("operations", [])}

    # Identity: unique IDs with the prefix that matches their array.
    records: dict[str, dict[str, Any]] = {}
    counts = Counter()
    for group, prefix in GROUPS:
        for record in ontology.get(group, []):
            counts[record["id"]] += 1
            records[record["id"]] = record
            if not record["id"].startswith(prefix + ":"):
                errors.append(f"{record['id']} is listed under {group} but does not use the {prefix}: prefix.")
            if group == "procedures":
                for step in record["steps"]:
                    counts[step["id"]] += 1
                    records[step["id"]] = step
                    if not step["id"].startswith("step:"):
                        errors.append(f"{step['id']} in {record['id']} must use the step: prefix.")
    for identifier, count in counts.items():
        if count > 1:
            errors.append(f"Duplicate ID: {identifier}")

    def role_of(evidence_id: str) -> tuple[str, str]:
        source = source_by_id[segment_by_id[evidence_by_id[evidence_id]["segment"]]["source"]]
        return source["role"], source["authority"]

    def check_refs(owner: str, refs: list[str], allowed: set[str], field: str) -> None:
        for ref in refs or []:
            if ref not in records:
                errors.append(f"{owner}.{field} references unknown {ref}")
            elif ref.split(":")[0] not in allowed:
                errors.append(f"{owner}.{field} must reference {'/'.join(sorted(allowed))}, not {ref}")

    def check_evidence(owner: str, refs: list[str]) -> list[str]:
        missing = [ref for ref in refs or [] if ref not in evidence_by_id]
        for ref in missing:
            errors.append(f"{owner} cites {ref}, which is not in the evidence ledger.")
        return [ref for ref in refs or [] if ref in evidence_by_id]

    cited_segments: set[str] = set()
    for group, _ in GROUPS:
        for record in ontology.get(group, []):
            valid = check_evidence(record["id"], record.get("evidence", []))
            cited_segments.update(evidence_by_id[ref]["segment"] for ref in valid)
            if group in {"claims", "rules", "procedures"} and valid:
                roles = [role_of(ref) for ref in valid]
                if all(role == "transcripts" for role, _ in roles):
                    errors.append(f"{record['id']} rests only on transcripts; a claim, rule, or procedure needs documentary or interface evidence. Record it as an observation instead.")
                if group == "rules" and not any(authority == "AUTHORITATIVE" for _, authority in roles):
                    errors.append(f"{record['id']} is a rule but cites no AUTHORITATIVE source.")
    for record in ontology["types"]:
        check_refs(record["id"], record.get("parents", []), {"type"}, "parents")
    for record in ontology["entities"]:
        check_refs(record["id"], record["types"], {"type"}, "types")
    for record in ontology.get("properties", []):
        check_refs(record["id"], record["domain"], {"type"}, "domain")
    for record in ontology.get("relations", []):
        check_refs(record["id"], record["from"], {"type"}, "from")
        check_refs(record["id"], record["to"], {"type"}, "to")
    for record in ontology["claims"]:
        check_refs(record["id"], [record["subject"]], {"type", "entity"}, "subject")
    for record in ontology["rules"]:
        check_refs(record["id"], record.get("actors", []), {"type", "entity"}, "actors")
    for record in ontology["procedures"]:
        check_refs(record["id"], record.get("goals", []), {"goal"}, "goals")
        local_steps = {step["id"] for step in record["steps"]}
        for step in record["steps"]:
            for target in step.get("next", []):
                if target not in local_steps:
                    errors.append(f"{step['id']} points to {target}, which is not a step of {record['id']}.")
            if step.get("capability"):
                if step["capability"] not in drafts and step["capability"] not in records:
                    errors.append(f"{step['id']} uses unknown capability {step['capability']}.")
    for record in ontology["capabilities"]:
        if record["id"] not in drafts:
            errors.append(f"{record['id']} is not one of the capabilities compiled from the OpenAPI source" + (": run `extract` with an openapi source." if not drafts else "."))
        else:
            cited_segments.update(evidence_by_id[ref]["segment"] for ref in drafts[record["id"]].get("evidence", []) if ref in evidence_by_id)
        check_refs(record["id"], record.get("alignedGoals", []), {"goal"}, "alignedGoals")
    for record in ontology["observations"]:
        check_refs(record["id"], record.get("goals", []), {"goal"}, "goals")
        if "count" in record and "sampleSize" in record and record["count"] > record["sampleSize"]:
            errors.append(f"{record['id']} has count above sampleSize.")
    for record in ontology["issues"]:
        for ref in record.get("records", []):
            if ref not in records:
                errors.append(f"{record['id']} references unknown record {ref}")
        check_evidence(record["id"], record.get("evidence", []))
    for record in ontology.get("uncovered", []):
        if record["segment"] not in segment_by_id:
            errors.append(f"uncovered lists unknown {record['segment']}")

    # Type hierarchy must be acyclic.
    parents = {t["id"]: t.get("parents", []) for t in ontology["types"]}
    state: dict[str, int] = {}

    def visit(node: str) -> None:
        if state.get(node) == 1:
            errors.append(f"Type hierarchy cycle through {node}")
            return
        if state.get(node) == 2:
            return
        state[node] = 1
        for parent in parents.get(node, []):
            if parent in parents:
                visit(parent)
        state[node] = 2

    for type_id in parents:
        visit(type_id)

    if not ontology["types"]:
        errors.append("No types were discovered; an empty ontology cannot be reviewed.")
    if not ontology["goals"]:
        errors.append("No caller goals were discovered; the plan needs at least one goal.")
    if not ontology["claims"] and not ontology["procedures"]:
        warnings.append("No claims or procedures: the agent will have nothing to answer from beyond the raw knowledge files.")

    declared = {u["segment"] for u in ontology.get("uncovered", [])}
    uncited = sorted(s for s in segment_by_id if s not in cited_segments and s not in declared)
    coverage = {"segments": len(segment_by_id), "cited": len(cited_segments), "declaredUncovered": len(declared), "uncited": uncited}
    if uncited:
        message = f"{len(uncited)} of {len(segment_by_id)} segments are neither cited nor listed under `uncovered`: {', '.join(uncited[:12])}{'…' if len(uncited) > 12 else ''}"
        (errors if strict else warnings).append(message)
    critical = [issue["id"] for issue in ontology["issues"] if issue["severity"] == "CRITICAL"]
    if critical:
        warnings.append(f"Critical open issues block approval until resolved or downgraded: {', '.join(critical)}")
    if errors:
        return _finish(workspace, ontology, None, errors, warnings, coverage)

    candidate = json.loads(json.dumps(ontology))
    merged_capabilities = []
    for record in ontology["capabilities"]:
        draft = drafts[record["id"]]
        merged_capabilities.append({**{k: v for k, v in draft.items() if k not in {"text"}}, "alignedGoals": record.get("alignedGoals", []),
                                    "preconditions": record.get("preconditions", ""), "notes": record.get("notes", ""), "enabled": False})
    candidate["capabilities"] = merged_capabilities
    candidate["coverage"] = coverage
    candidate["ledgerDigest"] = ledger_digest(ledger)
    candidate["digest"] = ontology_digest(candidate)
    candidate["checkedAt"] = utc_now()
    return _finish(workspace, ontology, candidate, errors, warnings, coverage, critical)


def ontology_digest(candidate: dict[str, Any]) -> str:
    """Content digest of a checked candidate: everything except the coverage report and run metadata."""
    return digest_json({k: v for k, v in candidate.items() if k not in {"coverage", "digest", "checkedAt"}})


def _finish(workspace: Workspace, ontology: dict[str, Any], candidate: dict[str, Any] | None, errors: list[str], warnings: list[str], coverage: dict[str, Any], critical: list[str] | None = None) -> dict[str, Any]:
    status = "REJECTED" if errors else "BLOCKED_BY_CRITICAL_ISSUES" if critical else "CANDIDATE"
    report = {"stage": "ontology", "status": status, "checkedAt": utc_now(), "errors": errors, "warnings": warnings, "coverage": coverage,
              "counts": {group: len(ontology.get(group, [])) for group, _ in GROUPS} if isinstance(ontology, dict) else {},
              "digest": candidate["digest"] if candidate else None}
    write_json(workspace.path("ontology", "check.json"), report)
    candidate_path = workspace.path("ontology", "candidate.json")
    if candidate:
        write_json(candidate_path, candidate)
    elif candidate_path.exists():
        candidate_path.unlink()
    return report


def load_candidate(workspace: Workspace) -> dict[str, Any]:
    path = workspace.path("ontology", "candidate.json")
    if not path.exists():
        raise BuildError("No checked ontology candidate. Run `check ontology` until it passes.")
    return read_json(path)


def summarize(candidate: dict[str, Any]) -> str:
    by_id = {r["id"]: r for group, _ in GROUPS for r in candidate.get(group, [])}
    label = lambda ref: by_id.get(ref, {}).get("label") or by_id.get(ref, {}).get("operationId") or ref  # noqa: E731
    lines = [f"# Ontology summary: {candidate['domain']['name']}", "", candidate["domain"]["summary"], ""]
    counts = ", ".join(f"{len(candidate.get(group, []))} {group}" for group, _ in GROUPS if candidate.get(group))
    lines += [f"**Records:** {counts}", ""]
    roots = [t for t in candidate["types"] if not t.get("parents")]
    children = defaultdict(list)
    for t in candidate["types"]:
        for parent in t.get("parents", []):
            children[parent].append(t)
    lines.append("## Types")
    for root in roots:
        lines.append(f"- **{root['label']}** ({root['id']}): {root['definition']}")
        for child in children.get(root["id"], [])[:12]:
            lines.append(f"  - {child['label']} ({child['id']}): {child['definition']}")
    if candidate["entities"]:
        lines += ["", "## Entities"]
        for entity in candidate["entities"][:40]:
            aliases = f" — also called {', '.join(entity['aliases'])}" if entity.get("aliases") else ""
            lines.append(f"- **{entity['label']}** ({', '.join(label(t) for t in entity['types'])}): {entity['definition']}{aliases}")
        if len(candidate["entities"]) > 40:
            lines.append(f"- … {len(candidate['entities']) - 40} more")
    lines += ["", "## Caller goals"]
    for goal in candidate["goals"]:
        phrases = f" · e.g. “{'” / “'.join(goal.get('callerPhrases', [])[:3])}”" if goal.get("callerPhrases") else ""
        lines.append(f"- **{goal['label']}** ({goal['id']}): {goal['definition']}{phrases}")
    if candidate["claims"]:
        lines += ["", f"## Claims ({len(candidate['claims'])})"]
        grouped = defaultdict(list)
        for claim in candidate["claims"]:
            grouped[claim["subject"]].append(claim)
        for subject, claims in list(grouped.items())[:25]:
            lines.append(f"- **{label(subject)}**")
            for claim in claims[:6]:
                flag = " (NEGATIVE)" if claim.get("polarity") == "NEGATIVE" else ""
                cond = f" [when: {claim['conditions']}]" if claim.get("conditions") else ""
                lines.append(f"  - {claim['text']}{flag}{cond}")
            if len(claims) > 6:
                lines.append(f"  - … {len(claims) - 6} more")
    if candidate["rules"]:
        lines += ["", "## Rules"]
        for rule in candidate["rules"]:
            lines.append(f"- {rule['modality']}: {rule['text']}" + (f" (exceptions: {'; '.join(rule['exceptions'])})" if rule.get("exceptions") else ""))
    if candidate["procedures"]:
        lines += ["", "## Procedures"]
        for procedure in candidate["procedures"]:
            goals = f" → {', '.join(label(g) for g in procedure.get('goals', []))}" if procedure.get("goals") else ""
            lines.append(f"- **{procedure['label']}** ({len(procedure['steps'])} steps){goals}")
    if candidate["capabilities"]:
        lines += ["", "## Capabilities (from the OpenAPI source; all disabled until the plan enables them)"]
        for capability in candidate["capabilities"]:
            aligned = f" → {', '.join(label(g) for g in capability.get('alignedGoals', []))}" if capability.get("alignedGoals") else ""
            lines.append(f"- `{capability['method']} {capability['path']}` {capability['operationId']} · risk {capability['classification']['risk']}{aligned}")
    if candidate["observations"]:
        lines += ["", "## Observations from transcripts (demand and language, never policy)"]
        for observation in candidate["observations"][:30]:
            count = f" ({observation['count']}/{observation['sampleSize']})" if "count" in observation and "sampleSize" in observation else ""
            lines.append(f"- {observation['text']}{count}")
    if candidate["issues"]:
        lines += ["", "## Open issues"]
        for issue in sorted(candidate["issues"], key=lambda i: {"CRITICAL": 0, "WARNING": 1, "INFO": 2}[i["severity"]]):
            lines.append(f"- {issue['severity']} {issue['kind']}: {issue['description']}")
    coverage = candidate.get("coverage", {})
    lines += ["", f"## Coverage: {coverage.get('cited', 0)} of {coverage.get('segments', 0)} segments cited; {coverage.get('declaredUncovered', 0)} declared uncovered; {len(coverage.get('uncited', []))} unaccounted."]
    return "\n".join(lines) + "\n"


def approver(explicit: str | None) -> str:
    if explicit:
        return explicit
    try:
        email = subprocess.run(["git", "config", "user.email"], capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:  # noqa: BLE001
        email = ""
    return email or "user"


def approve_ontology(workspace: Workspace, *, by: str | None = None) -> dict[str, Any]:
    report_path = workspace.path("ontology", "check.json")
    if not report_path.exists():
        raise BuildError("Run `check ontology` before approving.")
    report = read_json(report_path)
    if report["status"] != "CANDIDATE":
        raise BuildError(f"The ontology check status is {report['status']}; resolve errors or critical issues first.")
    candidate = load_candidate(workspace)
    if candidate["digest"] != report["digest"]:
        raise BuildError("The candidate changed after its last check. Run `check ontology` again.")
    approval = {"stage": "ontology", "digest": candidate["digest"], "ledgerDigest": candidate["ledgerDigest"], "by": approver(by), "at": utc_now()}
    write_json(workspace.path("ontology", "approval.json"), approval)
    return approval


def checked_ontology(workspace: Workspace) -> dict[str, Any]:
    """The ontology candidate as last checked, whether or not it has been approved yet.

    Planning starts from here: the plan and the ontology are reviewed together on one page, and
    `approve plan` records both approvals. A critical open issue still blocks approval."""
    report_path = workspace.path("ontology", "check.json")
    if not report_path.exists():
        raise BuildError("Run `check ontology` before writing the plan.")
    report = read_json(report_path)
    if report["status"] not in {"CANDIDATE", "BLOCKED_BY_CRITICAL_ISSUES"}:
        raise BuildError(f"The ontology check status is {report['status']}; fix its errors before planning.")
    candidate = load_candidate(workspace)
    if candidate.get("digest") != report["digest"] or ontology_digest(candidate) != candidate.get("digest"):
        raise BuildError("The ontology candidate changed after its last check. Run `check ontology` again.")
    if candidate.get("ledgerDigest") != ledger_digest(load_ledger(workspace)):
        raise BuildError("The evidence changed after the ontology was checked (a source was re-fetched or re-extracted). Run `check ontology` again.")
    return candidate


def approved_ontology(workspace: Workspace) -> dict[str, Any]:
    approval_path = workspace.path("ontology", "approval.json")
    if not approval_path.exists():
        raise BuildError("The ontology has not been approved. Run `approve ontology` after review.")
    approval = read_json(approval_path)
    candidate = load_candidate(workspace)
    if ontology_digest(candidate) != approval["digest"] or candidate.get("digest") != approval["digest"]:
        raise BuildError("The ontology candidate differs from what was approved. Run `check ontology` and approve it again.")
    if candidate.get("ledgerDigest") != ledger_digest(load_ledger(workspace)):
        raise BuildError("The evidence changed after the ontology was approved (a source was re-fetched or re-extracted). Re-check and re-approve the ontology.")
    return candidate


FRAGMENT_KEYS = {"domain", "types", "entities", "properties", "relations", "claims", "rules", "procedures", "goals", "capabilities", "observations", "issues", "uncovered"}


def merge_fragments(workspace: Workspace) -> dict[str, Any]:
    """Combine ontology/fragments/*.json (partial ontologies from a packet fan-out) into ontology/ontology.json.

    Purely mechanical: arrays are concatenated, ID collisions are errors, and equal labels under
    different IDs are reported so the consolidator can merge or distinguish them deliberately.
    """
    directory = workspace.path("ontology", "fragments")
    paths = sorted(directory.glob("*.json")) if directory.exists() else []
    if not paths:
        raise BuildError(f"No fragments in {directory}.")
    merged: dict[str, Any] = {key: [] for key in FRAGMENT_KEYS if key != "domain"}
    domain = None
    errors: list[str] = []
    seen_ids: dict[str, str] = {}
    for path in paths:
        fragment = read_json(path)
        if not isinstance(fragment, dict):
            errors.append(f"{path.name} is not an object.")
            continue
        for key in fragment:
            if key not in FRAGMENT_KEYS:
                errors.append(f"{path.name} has unknown key {key!r}.")
        if isinstance(fragment.get("domain"), dict) and domain is None:
            domain = fragment["domain"]
        for key in merged:
            for record in fragment.get(key, []) or []:
                identifier = record.get("id") if isinstance(record, dict) else None
                if key != "uncovered" and identifier:
                    if identifier in seen_ids:
                        errors.append(f"{identifier} appears in both {seen_ids[identifier]} and {path.name}.")
                        continue
                    seen_ids[identifier] = path.name
                merged[key].append(record)
    warnings: list[str] = []
    if domain is None:
        domain = {"name": workspace.project["name"], "summary": "WRITE ME: one paragraph on what this domain contains."}
        warnings.append("No fragment supplied `domain`; a placeholder was written. Replace its summary before checking.")
    labels: dict[tuple[str, str], list[str]] = defaultdict(list)
    for key in ("types", "entities", "goals", "claims"):
        for record in merged[key]:
            if isinstance(record, dict) and record.get("id"):
                labels[(key, str(record.get("label") or record.get("text") or "").casefold())].append(record["id"])
    duplicates = [f"{key}: {', '.join(ids)}" for (key, _), ids in labels.items() if len(ids) > 1]
    if errors:
        return {"status": "REJECTED", "errors": errors, "fragments": [p.name for p in paths]}
    ontology = {"domain": domain, **{key: merged[key] for key in ("types", "entities", "properties", "relations", "claims", "rules", "procedures", "goals", "capabilities", "observations", "issues", "uncovered")}}
    for key in ("properties", "relations", "uncovered"):
        if not ontology[key]:
            ontology.pop(key)
    write_json(workspace.path("ontology", "ontology.json"), ontology)
    return {"status": "MERGED", "fragments": [p.name for p in paths], "counts": {key: len(value) for key, value in ontology.items() if isinstance(value, list)},
            "possibleDuplicates": duplicates, "warnings": warnings, "errors": []}
