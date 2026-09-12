"""Render the review page: one HTML file with an Ontology tab, a Plan tab, and a Build tab.

The ontology and plan tabs each carry a graph of their records (d3 force layout), a browse view for
everything that does not belong on a graph (facts, observations, issues, tests, scenarios), and an
overview. A shared detail panel opens on click and shows every record's evidence as the quoted source
text from the ledger. The build tab lists exactly what `compile` produced and what `apply` created.

The page is written for the user, who reads it before anything is built. It carries its own content
digest and polls the local preview server (or, when served elsewhere, itself) so a re-render refreshes
the tab that is already open instead of needing a new one. Data is embedded as JSON; the only external
asset is d3 from cdnjs, which the Artifact content-security policy admits.
"""
from __future__ import annotations

import html
import json
from pathlib import Path
from typing import Any

from .extract import load_ledger
from .workspace import BuildError, Workspace, digest, digest_json, read_json, utc_now

D3_SRC = "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"
QUOTE_LIMIT = 900
PAGE = "review.html"

# --------------------------------------------------------------------------- evidence


def evidence_index(workspace: Workspace, ledger: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Every evidence ID with the quoted source text and where it came from."""
    segments = {s["id"]: s for s in ledger["segments"]}
    sources = {s["id"]: s for s in ledger["sources"]}
    texts: dict[str, str] = {}
    out: dict[str, dict[str, Any]] = {}
    for item in ledger["evidence"]:
        segment = segments.get(item["segment"])
        if not segment:
            continue
        if segment["id"] not in texts:
            path = workspace.path("evidence", *segment["file"].split("/"))
            texts[segment["id"]] = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
        quote = texts[segment["id"]][item["start"]:item["end"]].strip()
        if len(quote) > QUOTE_LIMIT:
            quote = quote[:QUOTE_LIMIT].rstrip() + " …"
        source = sources.get(segment["source"], {})
        out[item["id"]] = {
            "id": item["id"], "segment": segment["id"], "title": segment.get("title") or segment["id"],
            "role": segment.get("role"), "authority": source.get("authority"), "locator": segment.get("locator"),
            "label": item.get("label"), "text": quote,
        }
    return out


# --------------------------------------------------------------------------- ontology model


def _ids(value: Any) -> list[str]:
    """Schema fields that may hold one ID or a list of IDs."""
    if not value:
        return []
    return [value] if isinstance(value, str) else [v for v in value if isinstance(v, str)]


def _link(record_id: str, label: str | None = None) -> dict[str, str]:
    return {"id": record_id, "label": label or record_id}


def _rule_subjects(rule: dict[str, Any], by_id: dict[str, dict[str, Any]]) -> list[str]:
    """Types and entities a rule is about: found by matching their labels and aliases in the rule text and scope."""
    haystack = f"{rule.get('text', '')} {rule.get('applies', '') or ''}".casefold()
    hits: list[tuple[int, str]] = []
    for rid, rec in by_id.items():
        if not (rid.startswith("type:") or rid.startswith("entity:")):
            continue
        names = [rec.get("label", "")] + list(rec.get("aliases", []))
        for n in names:
            n = n.casefold().strip()
            if len(n) >= 4 and n in haystack:
                hits.append((len(n), rid))
                break
    hits.sort(reverse=True)
    out: list[str] = []
    for _, rid in hits:
        if rid not in out:
            out.append(rid)
    return out[:4]


def ontology_model(candidate: dict[str, Any], ledger: dict[str, Any], check: dict[str, Any] | None) -> dict[str, Any]:
    groups = ("types", "entities", "properties", "relations", "claims", "rules", "procedures", "goals", "capabilities", "observations", "issues")
    by_id: dict[str, dict[str, Any]] = {r["id"]: r for g in groups for r in candidate.get(g, [])}

    def name(record_id: str) -> str:
        r = by_id.get(record_id)
        if not r:
            return record_id
        return r.get("label") or r.get("operationId") or r.get("text", "")[:60] or record_id

    def links(ids: list[str] | None) -> list[dict[str, str]]:
        return [_link(i, name(i)) for i in ids or [] if i in by_id]

    children: dict[str, list[str]] = {}
    instances: dict[str, list[str]] = {}
    claims_about: dict[str, list[dict[str, Any]]] = {}
    rules_for: dict[str, list[str]] = {}
    procedures_for_goal: dict[str, list[str]] = {}
    procedures_using: dict[str, list[str]] = {}
    caps_for_goal: dict[str, list[str]] = {}
    observations_for: dict[str, list[dict[str, Any]]] = {}
    issues_for: dict[str, list[str]] = {}
    properties_of: dict[str, list[str]] = {}
    relations_of: dict[str, list[str]] = {}
    for t in candidate.get("types", []):
        for p in t.get("parents", []):
            children.setdefault(p, []).append(t["id"])
    for e in candidate.get("entities", []):
        for t in e.get("types", []):
            instances.setdefault(t, []).append(e["id"])
    for c in candidate.get("claims", []):
        claims_about.setdefault(c["subject"], []).append(c)
    for r in candidate.get("rules", []):
        for target in r.get("actors") or []:
            rules_for.setdefault(target, []).append(r["id"])
        for subject in _rule_subjects(r, by_id):
            rules_for.setdefault(subject, []).append(r["id"])
    for p in candidate.get("procedures", []):
        for g in p.get("goals", []):
            procedures_for_goal.setdefault(g, []).append(p["id"])
        for s in p.get("steps", []):
            if s.get("capability"):
                procedures_using.setdefault(s["capability"], []).append(p["id"])
    for c in candidate.get("capabilities", []):
        for g in c.get("alignedGoals", []):
            caps_for_goal.setdefault(g, []).append(c["id"])
    for o in candidate.get("observations", []):
        for g in o.get("goals", []):
            observations_for.setdefault(g, []).append(o)
    for i in candidate.get("issues", []):
        for rid in i.get("records", []):
            issues_for.setdefault(rid, []).append(i["id"])
    for p in candidate.get("properties", []):
        for d in p.get("domain", []):
            properties_of.setdefault(d, []).append(p["id"])
    for rel in candidate.get("relations", []):
        for end in _ids(rel.get("from")) + _ids(rel.get("to")):
            relations_of.setdefault(end, []).append(rel["id"])

    def claim_items(subject: str) -> list[dict[str, Any]]:
        return [{"id": c["id"], "text": c["text"], "polarity": c.get("polarity"), "conditions": c.get("conditions"), "status": c.get("status"), "evidence": c.get("evidence", [])}
                for c in claims_about.get(subject, [])]

    def observation_items(goal: str) -> list[dict[str, Any]]:
        return [{"id": o["id"], "text": o["text"], "count": o.get("count"), "sampleSize": o.get("sampleSize"), "evidence": o.get("evidence", [])}
                for o in observations_for.get(goal, [])]

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    records: dict[str, dict[str, Any]] = {}

    def add(record: dict[str, Any], kind: str, label: str, details: list[dict[str, Any]], *, graph: bool, summary: str = "", meta: dict[str, Any] | None = None) -> None:
        rec = {"id": record["id"], "kind": kind, "label": label, "summary": summary, "details": details, "evidence": record.get("evidence", []), "meta": meta or {}}
        records[record["id"]] = rec
        if graph:
            nodes.append({"id": record["id"], "kind": kind, "label": label, "weight": 1 + len(claims_about.get(record["id"], []))})

    def edge(a: str, b: str, kind: str) -> None:
        if a in by_id and b in by_id:
            edges.append({"source": a, "target": b, "kind": kind})

    def common(record: dict[str, Any]) -> list[dict[str, Any]]:
        out = []
        if record.get("status"):
            out.append({"label": "Status", "kind": "pills", "value": [record["status"]]})
        if issues_for.get(record["id"]):
            out.append({"label": "Open issues", "kind": "links", "value": links(issues_for[record["id"]])})
        return out

    for t in candidate.get("types", []):
        details = [{"label": "Definition", "kind": "text", "value": t["definition"]}]
        if t.get("parents"):
            details.append({"label": "Is a kind of", "kind": "links", "value": links(t["parents"])})
        if children.get(t["id"]):
            details.append({"label": "Kinds", "kind": "links", "value": links(children[t["id"]])})
        if instances.get(t["id"]):
            details.append({"label": "Named products and things", "kind": "links", "value": links(instances[t["id"]])})
        if properties_of.get(t["id"]):
            details.append({"label": "Attributes", "kind": "links", "value": links(properties_of[t["id"]])})
        if relations_of.get(t["id"]):
            details.append({"label": "Relations", "kind": "links", "value": links(relations_of[t["id"]])})
        if rules_for.get(t["id"]):
            details.append({"label": "Rules that apply", "kind": "links", "value": links(rules_for[t["id"]])})
        if claims_about.get(t["id"]):
            details.append({"label": f"Facts ({len(claims_about[t['id']])})", "kind": "claims", "value": claim_items(t["id"])})
        details += common(t)
        add(t, "type", t["label"], details, graph=True, summary=t["definition"])
        for p in t.get("parents", []):
            edge(t["id"], p, "is-a")

    for e in candidate.get("entities", []):
        details = [{"label": "Definition", "kind": "text", "value": e["definition"]}]
        if e.get("aliases"):
            details.append({"label": "Also called", "kind": "pills", "value": e["aliases"]})
        details.append({"label": "Kind", "kind": "links", "value": links(e["types"])})
        if rules_for.get(e["id"]):
            details.append({"label": "Rules that apply", "kind": "links", "value": links(rules_for[e["id"]])})
        if claims_about.get(e["id"]):
            details.append({"label": f"Facts ({len(claims_about[e['id']])})", "kind": "claims", "value": claim_items(e["id"])})
        if relations_of.get(e["id"]):
            details.append({"label": "Relations", "kind": "links", "value": links(relations_of[e["id"]])})
        details += common(e)
        add(e, "entity", e["label"], details, graph=True, summary=e["definition"])
        for t in e["types"]:
            edge(e["id"], t, "instance-of")

    for p in candidate.get("properties", []):
        details = [{"label": "Definition", "kind": "text", "value": p["definition"]},
                   {"label": "Value", "kind": "pills", "value": [p["valueKind"]]},
                   {"label": "Attribute of", "kind": "links", "value": links(p["domain"])}] + common(p)
        add(p, "property", p["label"], details, graph=False, summary=p["definition"])

    for rel in candidate.get("relations", []):
        details = [{"label": "Definition", "kind": "text", "value": rel["definition"]},
                   {"label": "From", "kind": "links", "value": links(_ids(rel.get("from")))},
                   {"label": "To", "kind": "links", "value": links(_ids(rel.get("to")))}] + common(rel)
        add(rel, "relation", rel["label"], details, graph=False, summary=rel["definition"])
        for a in _ids(rel.get("from")):
            for b in _ids(rel.get("to")):
                edge(a, b, "relation")

    for g in candidate.get("goals", []):
        details = [{"label": "What the caller wants", "kind": "text", "value": g["definition"]}]
        if g.get("callerPhrases"):
            details.append({"label": "How callers say it", "kind": "quotes", "value": g["callerPhrases"]})
        if procedures_for_goal.get(g["id"]):
            details.append({"label": "Procedures", "kind": "links", "value": links(procedures_for_goal[g["id"]])})
        if caps_for_goal.get(g["id"]):
            details.append({"label": "API capabilities", "kind": "links", "value": links(caps_for_goal[g["id"]])})
        if observations_for.get(g["id"]):
            details.append({"label": f"Seen in the calls ({len(observations_for[g['id']])})", "kind": "observations", "value": observation_items(g["id"])})
        details += common(g)
        add(g, "goal", g["label"], details, graph=True, summary=g["definition"], meta={"phrases": len(g.get("callerPhrases", []))})

    for p in candidate.get("procedures", []):
        steps = [{"id": s["id"], "instruction": s["instruction"], "capability": _link(s["capability"], name(s["capability"])) if s.get("capability") in by_id else None,
                  "next": list(s.get("next", []))} for s in p["steps"]]
        details = []
        if p.get("goals"):
            details.append({"label": "Serves", "kind": "links", "value": links(p["goals"])})
        details.append({"label": f"Steps ({len(steps)})", "kind": "steps", "value": steps})
        details += common(p)
        add(p, "procedure", p["label"], details, graph=True, summary=f"{len(steps)} steps")
        for g in p.get("goals", []):
            edge(p["id"], g, "serves")
        for s in p["steps"]:
            if s.get("capability"):
                edge(p["id"], s["capability"], "uses")

    for c in candidate.get("capabilities", []):
        cls = c.get("classification", {})
        label = c.get("operationId") or c["id"]
        details = [{"label": "Operation", "kind": "mono", "value": f"{c.get('method', '')} {c.get('path', '')}".strip()}]
        pills = [f"risk {cls.get('risk', '?')}"]
        if cls.get("requiresAuth"):
            pills.append("needs a session")
        if cls.get("write"):
            pills.append("writes")
        if cls.get("confirmBeforeCall"):
            pills.append("confirm before calling")
        if cls.get("adminOrInternal"):
            pills.append("admin only")
        details.append({"label": "Classification", "kind": "pills", "value": pills})
        if c.get("description") or c.get("summary"):
            details.append({"label": "Described as", "kind": "text", "value": c.get("description") or c.get("summary")})
        if c.get("alignedGoals"):
            details.append({"label": "Serves goals", "kind": "links", "value": links(c["alignedGoals"])})
        if c.get("preconditions"):
            details.append({"label": "Before calling", "kind": "text", "value": c["preconditions"]})
        if c.get("notes"):
            details.append({"label": "Notes", "kind": "text", "value": c["notes"]})
        if procedures_using.get(c["id"]):
            details.append({"label": "Used by procedures", "kind": "links", "value": links(procedures_using[c["id"]])})
        details.append({"label": "Enabled", "kind": "pills", "value": ["disabled until the plan enables it" if not c.get("enabled") else "enabled"]})
        details += common(c)
        add(c, "capability", label, details, graph=True, summary=f"{c.get('method', '')} {c.get('path', '')}", meta={"risk": cls.get("risk")})
        for g in c.get("alignedGoals", []):
            edge(c["id"], g, "aligned")

    for r in candidate.get("rules", []):
        details = [{"label": "Rule", "kind": "text", "value": r["text"]},
                   {"label": "Modality", "kind": "pills", "value": [r["modality"]]}]
        if r.get("actors"):
            details.append({"label": "Who", "kind": "links", "value": links(r["actors"])})
        if r.get("applies"):
            details.append({"label": "Applies to", "kind": "text", "value": r["applies"]})
        subjects = _rule_subjects(r, by_id)
        if subjects:
            details.append({"label": "About", "kind": "links", "value": links(subjects)})
        if r.get("exceptions"):
            details.append({"label": "Exceptions", "kind": "bullets", "value": r["exceptions"]})
        details += common(r)
        add(r, "rule", r["text"][:90] + ("…" if len(r["text"]) > 90 else ""), details, graph=True, summary=r["text"], meta={"modality": r["modality"]})
        for target in list(dict.fromkeys((r.get("actors") or []) + subjects)):
            edge(r["id"], target, "applies")

    for c in candidate.get("claims", []):
        details = [{"label": "Fact", "kind": "text", "value": c["text"]}, {"label": "About", "kind": "links", "value": links([c["subject"]])}]
        pills = [x for x in (c.get("polarity"), c.get("status")) if x]
        if pills:
            details.append({"label": "Flags", "kind": "pills", "value": pills})
        if c.get("conditions"):
            details.append({"label": "When", "kind": "text", "value": c["conditions"]})
        details += common(c)
        add(c, "claim", c["text"], details, graph=False, summary=name(c["subject"]), meta={"subject": c["subject"], "subjectLabel": name(c["subject"])})

    for o in candidate.get("observations", []):
        details = [{"label": "Observation", "kind": "text", "value": o["text"]}]
        if o.get("count") is not None and o.get("sampleSize"):
            details.append({"label": "Frequency", "kind": "text", "value": f"{o['count']} of {o['sampleSize']} sampled conversations"})
        if o.get("goals"):
            details.append({"label": "Goals", "kind": "links", "value": links(o["goals"])})
        details += common(o)
        add(o, "observation", o["text"][:100] + ("…" if len(o["text"]) > 100 else ""), details, graph=False, summary=o["text"],
            meta={"count": o.get("count"), "sampleSize": o.get("sampleSize")})

    for i in candidate.get("issues", []):
        details = [{"label": "Issue", "kind": "text", "value": i["description"]},
                   {"label": "Kind", "kind": "pills", "value": [i["kind"].replace("_", " ").lower(), i["severity"]]}]
        if i.get("records"):
            details.append({"label": "Records involved", "kind": "links", "value": links(i["records"])})
        add(i, "issue", i["description"][:110] + ("…" if len(i["description"]) > 110 else ""), details, graph=False, summary=i["description"],
            meta={"severity": i["severity"], "issueKind": i["kind"]})

    uncovered = [{"segment": u["segment"], "reason": u["reason"], "title": next((s.get("title") for s in ledger["segments"] if s["id"] == u["segment"]), u["segment"])}
                 for u in candidate.get("uncovered", [])]
    domain = candidate.get("domain", {})
    sources = [{"id": s["id"], "role": s["role"], "authority": s.get("authority"), "location": s.get("location"), "items": s.get("itemCount"), "segments": s.get("segmentCount")}
               for s in ledger["sources"]]
    return {
        "page": "ontology",
        "title": domain.get("name") or "Ontology",
        "summary": domain.get("summary", ""),
        "callerRoles": domain.get("callerRoles", []),
        "status": (check or {}).get("status"), "digest": candidate.get("digest"), "checkedAt": candidate.get("checkedAt"),
        "warnings": (check or {}).get("warnings", []),
        "counts": {g: len(candidate.get(g, [])) for g in groups}, "coverage": candidate.get("coverage", {}), "uncovered": uncovered, "sources": sources,
        "nodes": nodes, "edges": edges, "records": records,
        "kinds": [
            {"kind": "goal", "label": "Caller goals", "graph": True}, {"kind": "entity", "label": "Products and things", "graph": True},
            {"kind": "type", "label": "Types", "graph": True}, {"kind": "procedure", "label": "Procedures", "graph": True},
            {"kind": "capability", "label": "API capabilities", "graph": True}, {"kind": "rule", "label": "Rules", "graph": True},
            {"kind": "claim", "label": "Facts", "graph": False}, {"kind": "observation", "label": "Call observations", "graph": False},
            {"kind": "issue", "label": "Open issues", "graph": False}, {"kind": "property", "label": "Attributes", "graph": False},
            {"kind": "relation", "label": "Relations", "graph": False},
        ],
    }


# --------------------------------------------------------------------------- plan model


def _schema_fields(schema: dict[str, Any]) -> list[str]:
    if schema.get("type") == "object":
        return [f"{k}: {v.get('type', '?')}" + (f" ∈ {v['enum']}" if isinstance(v, dict) and v.get("enum") else "") for k, v in (schema.get("properties") or {}).items()]
    return [str(schema.get("type", "?")) + (f" ∈ {schema['enum']}" if schema.get("enum") else "")]


def plan_model(candidate: dict[str, Any], ontology: dict[str, Any], check: dict[str, Any] | None) -> dict[str, Any]:
    o_by_id: dict[str, dict[str, Any]] = {r["id"]: r for g in ("types", "entities", "claims", "rules", "procedures", "goals", "capabilities") for r in ontology.get(g, [])}

    def oname(record_id: str) -> str:
        r = o_by_id.get(record_id)
        return (r.get("label") or r.get("text", "")[:80] or record_id) if r else record_id

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    records: dict[str, dict[str, Any]] = {}
    ids: set[str] = set()

    def add(record_id: str, kind: str, label: str, details: list[dict[str, Any]], *, graph: bool, summary: str = "", evidence_ids: list[str] | None = None, meta: dict[str, Any] | None = None) -> None:
        records[record_id] = {"id": record_id, "kind": kind, "label": label, "summary": summary, "details": details, "evidence": evidence_ids or [], "meta": meta or {}}
        ids.add(record_id)
        if graph:
            nodes.append({"id": record_id, "kind": kind, "label": label, "weight": 1})

    def edge(a: str, b: str, kind: str) -> None:
        if a in ids and b in ids:
            edges.append({"source": a, "target": b, "kind": kind})

    def links(pairs: list[tuple[str, str]]) -> list[dict[str, str]]:
        return [_link(i, lbl) for i, lbl in pairs]

    tools = {t["operationId"]: t for t in candidate.get("tools", [])}
    resolved = {t["operationId"]: t for t in candidate.get("resolvedTools", [])}
    jobs = {j["id"]: j for j in candidate.get("jobs", [])}
    assistants = {a["id"]: a for a in candidate.get("assistants", [])}
    outputs = {o["id"]: o for o in candidate.get("structuredOutputs", [])}
    sims = candidate.get("simulations") or {}
    goal_ids = {g for j in jobs.values() for g in j.get("goals", [])}
    knowledge_ids = {k for j in jobs.values() for k in j.get("knowledge", [])}

    for gid in sorted(goal_ids):
        g = o_by_id.get(gid, {"id": gid, "label": gid, "definition": ""})
        details = [{"label": "What the caller wants", "kind": "text", "value": g.get("definition", "")}]
        if g.get("callerPhrases"):
            details.append({"label": "How callers say it", "kind": "quotes", "value": g["callerPhrases"]})
        owners = [(j["id"], j["label"]) for j in jobs.values() if gid in j.get("goals", [])]
        details.append({"label": "Handled by", "kind": "links", "value": links(owners)})
        add(gid, "goal", g.get("label", gid), details, graph=True, summary=g.get("definition", ""), evidence_ids=g.get("evidence", []))

    for kid in sorted(knowledge_ids):
        k = o_by_id.get(kid)
        if not k:
            continue
        kind = "rule" if kid.startswith("rule:") else "claim" if kid.startswith("claim:") else "procedure"
        text = k.get("text") or k.get("label") or kid
        details = [{"label": "Text", "kind": "text", "value": text}]
        if k.get("modality"):
            details.append({"label": "Modality", "kind": "pills", "value": [k["modality"]]})
        if k.get("subject"):
            details.append({"label": "About", "kind": "text", "value": oname(k["subject"])})
        if k.get("steps"):
            details.append({"label": "Steps", "kind": "steps", "value": [{"id": s["id"], "instruction": s["instruction"], "capability": None, "next": s.get("next", [])} for s in k["steps"]]})
        details.append({"label": "Compiled into", "kind": "links", "value": links([(j["id"], j["label"]) for j in jobs.values() if kid in j.get("knowledge", [])])})
        add(kid, kind, text[:90] + ("…" if len(text) > 90 else ""), details, graph=False, summary=text, evidence_ids=k.get("evidence", []))

    for op, t in tools.items():
        r = resolved.get(op, {})
        operation = r.get("operation", {})
        cls = operation.get("classification", {})
        auth = t.get("auth", {"mode": "NONE"})
        auth_text = {"NONE": "no authentication", "HEADER_ENV": f"fixed header from key-file variable {auth.get('env')}", "VAPI_CREDENTIAL": f"Vapi credential {auth.get('credentialId')}"}.get(auth.get("mode"), auth.get("mode"))
        details = [{"label": "Operation", "kind": "mono", "value": f"{operation.get('method', '')} {candidate.get('runtime', {}).get('serverUrl', '')}{operation.get('path', '')}".strip()},
                   {"label": "What it does", "kind": "text", "value": t.get("description", "")},
                   {"label": "Authentication", "kind": "text", "value": auth_text}]
        pills = [f"risk {cls.get('risk', '?')}"]
        if t.get("confirmBeforeCall"):
            pills.append("reads back and confirms first")
        elif t.get("skipConfirmationReason"):
            pills.append("NO read-back")
        details.append({"label": "Safety", "kind": "pills", "value": pills})
        if t.get("skipConfirmationReason"):
            details.append({"label": "Why no read-back", "kind": "text", "value": t["skipConfirmationReason"]})
        if t.get("headers"):
            details.append({"label": "Headers", "kind": "mono", "value": "\n".join(f"{k}: {v}" for k, v in t["headers"].items())})
        if t.get("extract"):
            details.append({"label": "Remembers from the response", "kind": "mono", "value": "\n".join(f"{k} ← {v}" for k, v in t["extract"].items())})
        if t.get("startMessage"):
            details.append({"label": "Says while calling", "kind": "quotes", "value": [t["startMessage"]]})
        users = [(a["id"], a["name"]) for a in assistants.values() if op in a.get("tools", [])]
        details.append({"label": "Used by", "kind": "links", "value": links(users)})
        details.append({"label": "Needed for", "kind": "links", "value": links([(j["id"], j["label"]) for j in jobs.values() if op in j.get("tools", [])])})
        mocked_in = [(s["id"], s["name"]) for s in sims.get("scenarios", []) if any(m["tool"] == op for m in s.get("toolMocks", []))]
        if mocked_in:
            details.append({"label": "Mocked in simulations", "kind": "links", "value": links(mocked_in)})
        add(f"tool:{op}", "tool", op, details, graph=True, summary=f"{operation.get('method', '')} {operation.get('path', '')}", evidence_ids=operation.get("evidence", []),
            meta={"risk": cls.get("risk"), "confirm": bool(t.get("confirmBeforeCall"))})

    for j in jobs.values():
        details = [{"label": "Handling", "kind": "pills", "value": [j["handling"].replace("_", " ").lower()]}]
        details.append({"label": "Goals", "kind": "links", "value": links([(g, oname(g)) for g in j.get("goals", [])])})
        if j.get("steps"):
            details.append({"label": "Steps", "kind": "steps", "value": [{"id": f"{j['id']}-step-{n}", "instruction": s, "capability": None, "next": []} for n, s in enumerate(j["steps"], 1)]})
        if j.get("slots"):
            details.append({"label": "Asks for", "kind": "pills", "value": [f"{s['name']}{' (required)' if s.get('required') else ''}" for s in j["slots"]]})
        if j.get("tools"):
            details.append({"label": "Tools", "kind": "links", "value": links([(f"tool:{t}", t) for t in j["tools"]])})
        if j.get("knowledge"):
            details.append({"label": "Knowledge in the prompt", "kind": "links", "value": links([(k, oname(k)) for k in j["knowledge"] if k in o_by_id])})
        if j.get("safeguards"):
            details.append({"label": "Safeguards", "kind": "bullets", "value": j["safeguards"]})
        if j.get("escalation"):
            details.append({"label": "Escalation", "kind": "text", "value": j["escalation"]})
        if j.get("examples"):
            details.append({"label": "Examples", "kind": "dialog", "value": j["examples"]})
        details.append({"label": "Owned by", "kind": "links", "value": links([(a["id"], a["name"]) for a in assistants.values() if j["id"] in a.get("jobs", [])])})
        recorded = [(o["id"], o["name"]) for o in outputs.values() if j["id"] in o.get("jobs", [])]
        if recorded:
            details.append({"label": "Recorded by structured outputs", "kind": "links", "value": links(recorded)})
        exercised = [(s["id"], s["name"]) for s in sims.get("scenarios", []) if j["id"] in s.get("jobs", [])]
        if exercised:
            details.append({"label": "Exercised by simulations", "kind": "links", "value": links(exercised)})
        add(j["id"], "job", j["label"], details, graph=True, summary=j["handling"], meta={"handling": j["handling"]})

    for a in assistants.values():
        details = [{"label": "First message", "kind": "quotes", "value": [a["firstMessage"]]} if a.get("firstMessage") else {"label": "First message", "kind": "text", "value": "Generated by the model"},
                   {"label": "System prompt", "kind": "prompt", "value": a["systemPrompt"]},
                   {"label": "Jobs", "kind": "links", "value": links([(jid, jobs[jid]["label"]) for jid in a.get("jobs", []) if jid in jobs])},
                   {"label": "Tools", "kind": "links", "value": links([(f"tool:{t}", t) for t in a.get("tools", [])])},
                   {"label": "Knowledge base", "kind": "text", "value": "Searches the knowledge base" if a.get("knowledge", True) else "No knowledge base"}]
        if a.get("handoffTo"):
            details.append({"label": "Hands off to", "kind": "links", "value": links([(h["assistant"], f"{assistants.get(h['assistant'], {}).get('name', h['assistant'])} — {h['when']}") for h in a["handoffTo"]])})
        attached = [(o["id"], o["name"]) for o in outputs.values() if a["id"] in o.get("assistants", [])]
        if attached:
            details.append({"label": "Structured outputs", "kind": "links", "value": links(attached)})
        add(a["id"], "assistant", a["name"], details, graph=True, summary=a["systemPrompt"][:160])

    for m in candidate.get("mcpServers", []):
        auth = m.get("auth", {"mode": "NONE"})
        details = [{"label": "Server", "kind": "mono", "value": f"{m['url']} ({m.get('protocol', 'shttp')})"},
                   {"label": "What it offers", "kind": "text", "value": m["description"]},
                   {"label": "Authentication", "kind": "text", "value": f"bearer from key-file variable {auth.get('env')}" if auth["mode"] == "HEADER_ENV" else "none"},
                   {"label": "Used by", "kind": "links", "value": links([(a["id"], a["name"]) for a in assistants.values() if m["id"] in a.get("mcp", [])])}]
        add(m["id"], "mcp", m["name"], details, graph=True, summary=m["url"])

    for o in outputs.values():
        details = [{"label": "What it records", "kind": "text", "value": o["description"]},
                   {"label": "Fields", "kind": "bullets", "value": _schema_fields(o["schema"])},
                   {"label": "Schema", "kind": "mono", "value": json.dumps(o["schema"], indent=1, ensure_ascii=False)},
                   {"label": "Extracted after calls to", "kind": "links", "value": links([(a, assistants[a]["name"]) for a in o.get("assistants", []) if a in assistants])}]
        if o.get("jobs"):
            details.append({"label": "About jobs", "kind": "links", "value": links([(j, jobs[j]["label"]) for j in o["jobs"] if j in jobs])})
        used_by = [(s["id"], s["name"]) for s in sims.get("scenarios", []) if any(e.get("output") == o["id"] for e in s["evaluations"])]
        if used_by:
            details.append({"label": "Judges simulations", "kind": "links", "value": links(used_by)})
        add(o["id"], "output", o["name"], details, graph=True, summary=o["description"], meta={"fields": len(_schema_fields(o["schema"]))})

    for p in sims.get("personalities", []):
        used = [(s["id"], s["name"]) for s in sims.get("scenarios", []) if s["personality"] == p["id"]]
        add(p["id"], "personality", p["name"], [{"label": "How the AI caller behaves", "kind": "prompt", "value": p["prompt"]}, {"label": "Plays in", "kind": "links", "value": links(used)}],
            graph=False, summary=p["prompt"][:160])

    for s in sims.get("scenarios", []):
        evaluations = [{"caller": f"{e['name']} {e.get('comparator', '=')} {json.dumps(e['value'])}" + ("" if e.get("required", True) else " (optional)"),
                        "agent": (f"from {e['output']}" + (f" · {e['path']}" if e.get("path") else "")) if e.get("output") else f"inline {e['schema'].get('type')}: {e.get('description') or e['name']}"}
                       for e in s["evaluations"]]
        details = [{"label": "The AI caller is told", "kind": "text", "value": s["instructions"]},
                   {"label": "Personality", "kind": "links", "value": links([(s["personality"], next((p["name"] for p in sims.get("personalities", []) if p["id"] == s["personality"]), s["personality"]))])},
                   {"label": f"Passes when ({len(s['evaluations'])})", "kind": "checks", "value": evaluations}]
        if s.get("toolMocks"):
            details.append({"label": "Tools mocked (never hit the live API)", "kind": "mono", "value": "\n".join(f"{m['tool']} → {m['result']}" for m in s["toolMocks"])})
        if s.get("jobs"):
            details.append({"label": "Exercises jobs", "kind": "links", "value": links([(j, jobs[j]["label"]) for j in s["jobs"] if j in jobs])})
        if s.get("variables"):
            details.append({"label": "Variables", "kind": "mono", "value": "\n".join(f"{k} = {v}" for k, v in s["variables"].items())})
        add(s["id"], "scenario", s["name"], details, graph=False, summary=s["instructions"][:140], meta={"evaluations": len(s["evaluations"]), "mocks": len(s.get("toolMocks", []))})

    for t in candidate.get("tests", []):
        details = [{"label": "Caller opens with", "kind": "quotes", "value": [t["callerOpening"]] + list(t.get("followUps", []))},
                   {"label": "Expect", "kind": "bullets", "value": t.get("expect", [])}]
        if t.get("mustNot"):
            details.append({"label": "Must not", "kind": "bullets", "value": t["mustNot"]})
        add(t["id"], "test", t["scenario"], details, graph=False, summary=t["callerOpening"])

    for n, x in enumerate(candidate.get("exclusions", []), 1):
        add(f"exclusion:{n}", "exclusion", x["what"], [{"label": "Why", "kind": "text", "value": x["why"]}], graph=False, summary=x["why"])

    for j in jobs.values():
        for g in j.get("goals", []):
            edge(j["id"], g, "serves")
        for t in j.get("tools", []):
            edge(j["id"], f"tool:{t}", "uses")
    for a in assistants.values():
        for jid in a.get("jobs", []):
            edge(a["id"], jid, "owns")
        for t in a.get("tools", []):
            edge(a["id"], f"tool:{t}", "uses")
        for m in a.get("mcp", []):
            edge(a["id"], m, "uses")
        for h in a.get("handoffTo", []):
            edge(a["id"], h["assistant"], "handoff")
    for o in outputs.values():
        for target in o.get("jobs") or o.get("assistants", []):
            edge(o["id"], target, "records")

    runtime = candidate.get("runtime", {})
    agent = candidate.get("agent", {})
    return {
        "page": "plan",
        "title": agent.get("name") or "Agent plan",
        "summary": agent.get("purpose", ""),
        "callerRoles": [agent.get("audience", "customers")],
        "topology": agent.get("topology") or {"choice": "squad" if len(assistants) > 1 else "single", "why": "(not recorded in the plan)"},
        "status": (check or {}).get("status"), "digest": candidate.get("digest"), "checkedAt": candidate.get("checkedAt"),
        "warnings": (check or {}).get("warnings", []),
        "counts": {"assistants": len(assistants), "jobs": len(jobs), "tools": len(tools), "goals": len(goal_ids), "structuredOutputs": len(outputs),
                   "scenarios": len(sims.get("scenarios", [])), "tests": len(candidate.get("tests", [])), "exclusions": len(candidate.get("exclusions", []))},
        "runtime": {"serverUrl": runtime.get("serverUrl"), "model": runtime.get("model"), "voice": runtime.get("voice"), "transcriber": runtime.get("transcriber"), "language": agent.get("language", "en"),
                    "simulationTransport": sims.get("transport", "vapi.webchat") if sims else None},
        "enabledOperations": candidate.get("enabledOperations", []),
        "nodes": nodes, "edges": edges, "records": records,
        "kinds": [
            {"kind": "assistant", "label": "Assistants", "graph": True}, {"kind": "job", "label": "Jobs", "graph": True},
            {"kind": "goal", "label": "Caller goals", "graph": True}, {"kind": "tool", "label": "Tools", "graph": True},
            {"kind": "mcp", "label": "MCP servers", "graph": True}, {"kind": "output", "label": "Structured outputs", "graph": True},
            {"kind": "scenario", "label": "Simulation scenarios", "graph": False}, {"kind": "personality", "label": "Simulation personalities", "graph": False},
            {"kind": "test", "label": "Chat tests", "graph": False}, {"kind": "exclusion", "label": "Out of scope", "graph": False},
            {"kind": "rule", "label": "Rules in prompts", "graph": False}, {"kind": "claim", "label": "Facts in prompts", "graph": False},
            {"kind": "procedure", "label": "Procedures in prompts", "graph": False},
        ],
    }


# --------------------------------------------------------------------------- build model


def _flatten_receipts(receipts: dict[str, Any]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []

    def walk(prefix: str, value: Any) -> None:
        if isinstance(value, str):
            out.append((prefix, value))
        elif isinstance(value, dict):
            if "id" in value and isinstance(value["id"], str) and prefix:
                out.append((prefix, value["id"]))
                return
            for k, v in value.items():
                if k in {"files", "updatedAt", "startedAt", "appliedAt", "planDigest", "verified", "attached", "fileStatuses", "failedFiles", "sha256", "transport", "mode"}:
                    continue
                walk(f"{prefix}.{k}" if prefix else k, v)

    walk("", receipts)
    if receipts.get("files"):
        out.append(("files", f"{len(receipts['files'])} uploaded"))
    return out


def try_it_card(demo: dict[str, Any], receipts: dict[str, Any] | None) -> dict[str, Any] | None:
    """Demo workspaces only: how to try the applied agent as one synthetic customer, by voice and on the web, once it exists in Vapi."""
    if not receipts or not receipts.get("verified"):
        return None
    c = demo["auth"]["customers"][0]
    phone = c["phone"]
    spoken = f"{phone[2:5]}-{phone[5:8]}-{phone[8:]}" if phone.startswith("+1") and len(phone) == 12 else phone
    target = ("squad", receipts["squad"]["id"]) if receipts.get("squad", {}).get("id") else ("assistant", next(iter(receipts["assistants"].values()), ""))
    return {"customer": c["name"], "phone": spoken, "pin": c["pin"], "web": demo["auth"]["web"].split(" ")[0], "email": c["email"], "password": c["password"],
            "targetKind": target[0], "targetId": target[1], "dashboard": f"https://dashboard.vapi.ai/{'squads' if target[0] == 'squad' else 'assistants'}/{target[1]}",
            "note": "Synthetic demo customer, published on purpose. One record behind both channels: a transfer made by voice shows in the web account activity."}


def build_model(build: dict[str, Any], receipts: dict[str, Any] | None, test_results: dict[str, Any] | None, simulation_results: dict[str, Any] | None,
                try_it: dict[str, Any] | None = None) -> dict[str, Any]:
    sims = build.get("simulations")
    return {
        "tryIt": try_it,
        "compiledAt": build.get("compiledAt"), "planDigest": build.get("planDigest"), "applied": bool(receipts and receipts.get("verified")),
        "knowledgeBase": {"name": build["knowledgeBase"]["name"], "files": [{"name": f["name"], "origin": f["origin"], "locator": f["locator"], "bytes": f["bytes"]} for f in build["knowledgeBase"]["files"]]},
        "tools": [{"name": t["payload"].get("name") or t["payload"].get("function", {}).get("name") or t["ref"], "method": "MCP" if t.get("mcp") else t["payload"].get("method"),
                   "url": t["payload"].get("url") or t["payload"].get("server", {}).get("url"), "secretHeaders": [h["name"] for h in t.get("secretHeaders", [])]} for t in build.get("tools", [])],
        "assistants": [{"name": a["payload"]["name"], "tools": [x.replace("tool:", "") for x in a.get("toolRefs", [])], "knowledge": a.get("knowledge", True),
                        "firstMessage": a["payload"].get("firstMessage"), "outputs": [x.split(":", 1)[1] for x in a.get("outputRefs", [])]} for a in build.get("assistants", [])],
        "squad": build.get("squad", {}).get("payload", {}).get("name") if build.get("squad") else None,
        "structuredOutputs": [{"name": o["payload"]["name"], "description": o["payload"]["description"], "type": o["payload"]["type"], "fields": _schema_fields(o["payload"]["schema"]),
                               "assistants": [r.split(":", 1)[1] for r in o["assistantRefs"]]} for o in build.get("structuredOutputs", [])],
        "simulations": {"suite": sims["suite"]["name"], "transport": sims["transport"], "personalities": [p["payload"]["name"] for p in sims["personalities"]],
                        "scenarios": [{"name": s["payload"]["name"], "personality": s["personalityRef"].split(":", 1)[1], "evaluations": s["evaluationLabels"],
                                       "mocks": [m["toolName"] for m in s["payload"].get("toolMocks", [])]} for s in sims["scenarios"]]} if sims else None,
        "receipts": _flatten_receipts(receipts) if receipts else [],
        "testResults": [{"scenario": r["scenario"], "expect": r["expect"], "mustNot": r.get("mustNot", []),
                         "turns": [{"caller": t["caller"], "agent": t["agent"]} for t in r["turns"]]} for r in (test_results or {}).get("results", [])],
        "simulationResults": {"runId": simulation_results["runId"], "status": simulation_results["status"], "url": simulation_results.get("url"),
                              "results": [{"simulation": r["simulation"], "passed": r.get("passed"), "failureReason": r.get("failureReason"),
                                           "evaluations": [{"name": e["name"], "expected": e.get("expected"), "actual": e.get("actual"), "comparator": e.get("comparator"), "passed": e.get("passed"),
                                                            "required": e.get("required", True), "error": e.get("error") or e.get("skipReason")} for e in r["evaluations"]]}
                                          for r in simulation_results["results"]]} if simulation_results else None,
        "tests": len(build.get("tests", [])),
    }


# --------------------------------------------------------------------------- html


def _json_for_script(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def render_page(model: dict[str, Any]) -> str:
    title = html.escape(model["title"])
    data = _json_for_script(model)
    return f"""<meta charset="utf-8">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>{CSS}</style>
<div id="app" class="app" data-digest="{html.escape(model['digest'])}">
  <header class="top">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <div><h1 id="title">{title}</h1><div class="sub" id="subtitle"></div></div>
    </div>
    <nav class="tabs" role="tablist" id="tabs">
      <button class="tab" data-tab="ontology" role="tab">Ontology</button>
      <button class="tab" data-tab="plan" role="tab">Plan</button>
      <button class="tab" data-tab="build" role="tab">Build</button>
    </nav>
    <nav class="views" role="tablist" id="views">
      <button class="view-btn" data-view="graph" role="tab">Graph</button>
      <button class="view-btn" data-view="browse" role="tab">Browse</button>
      <button class="view-btn" data-view="overview" role="tab">Overview</button>
    </nav>
    <label class="search"><span class="sr">Search</span><input id="search" type="search" placeholder="Search records, facts, phrases…" autocomplete="off"></label>
  </header>
  <div class="body">
    <main class="stage" id="stage"></main>
    <aside id="detail" class="detail" aria-live="polite">
      <div class="detail-empty"><p>Select a node or a row to see its definition, related records, and the evidence behind it.</p></div>
    </aside>
  </div>
</div>
<script id="data" type="application/json">{data}</script>
<script>{REFRESH_JS}</script>
<script src="{D3_SRC}"></script>
<script>{JS}</script>
"""


REFRESH_JS = r"""
(function () {
  // Reload when a newer render exists. Served locally by `vapi-build open`, /version answers in a few bytes;
  // served anywhere else, the page re-reads itself. Failures are silent: the page is complete without this.
  var digest = document.getElementById('app').getAttribute('data-digest');
  var local = /^https?:$/.test(location.protocol) && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname);
  function reload() { try { sessionStorage.setItem('vb-scroll', String(window.scrollY)); } catch (e) {} location.reload(); }
  function tick() {
    try {
      if (local) {
        fetch('/version?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); })
          .then(function (j) { if (j && j.digest && j.digest !== digest) reload(); }).catch(function () {});
      } else if (/^https?:$/.test(location.protocol)) {
        fetch(location.href, { cache: 'no-store' }).then(function (r) { return r.text(); })
          .then(function (t) { var m = t.match(/data-digest="([^"]+)"/); if (m && m[1] !== digest) reload(); }).catch(function () {});
      }
    } catch (e) {}
  }
  setInterval(tick, local ? 2000 : 20000);
})();
"""


CSS = r"""
:root {
  --bg:#F5F7F6; --surface:#FFFFFF; --surface-2:#EDF1EF; --ink:#16201E; --muted:#5F6C69; --line:#D8DFDC; --line-strong:#B8C3BF;
  --accent:#0E6F66; --accent-ink:#0A5750; --accent-soft:#DDEFEC; --focus:#0E6F66;
  --k-goal:#C2622B; --k-entity:#0E9E8A; --k-type:#3B6FB6; --k-procedure:#7A4FB5; --k-capability:#A8780A; --k-rule:#B03A48;
  --k-claim:#5F6C69; --k-observation:#8A6D3B; --k-issue:#B03A48; --k-property:#3B6FB6; --k-relation:#3B6FB6;
  --k-assistant:#0E6F66; --k-job:#C2622B; --k-tool:#A8780A; --k-test:#7A4FB5; --k-exclusion:#5F6C69;
  --k-output:#3B6FB6; --k-scenario:#7A4FB5; --k-personality:#8A6D3B; --k-mcp:#0E9E8A;
  --sev-critical:#B3372F; --sev-warning:#B7791F; --sev-info:#4A6FA5; --ok:#2E7D5B;
  --quote-bg:#F7F4EC; --quote-line:#E2D9C2;
  --sans:"IBM Plex Sans", "Helvetica Neue", Arial, sans-serif; --mono:"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg:#0F1514; --surface:#171F1E; --surface-2:#1F2927; --ink:#E6ECEA; --muted:#93A29D; --line:#2A3634; --line-strong:#3C4B48;
  --accent:#52BBAF; --accent-ink:#8FD8CF; --accent-soft:#163430; --focus:#52BBAF;
  --k-goal:#E48B55; --k-entity:#3FC4B0; --k-type:#6D9BE0; --k-procedure:#A98AE0; --k-capability:#E0B23A; --k-rule:#E0707D;
  --k-claim:#93A29D; --k-observation:#C9A26A; --k-issue:#E0707D; --k-property:#6D9BE0; --k-relation:#6D9BE0;
  --k-assistant:#52BBAF; --k-job:#E48B55; --k-tool:#E0B23A; --k-test:#A98AE0; --k-exclusion:#93A29D;
  --k-output:#6D9BE0; --k-scenario:#A98AE0; --k-personality:#C9A26A; --k-mcp:#3FC4B0;
  --sev-critical:#E06A62; --sev-warning:#E0A53F; --sev-info:#7FA3DA; --ok:#5DBE8F;
  --quote-bg:#1C1F1B; --quote-line:#3A3A2E;
  color-scheme: dark;
}}
:root[data-theme="dark"] {
  --bg:#0F1514; --surface:#171F1E; --surface-2:#1F2927; --ink:#E6ECEA; --muted:#93A29D; --line:#2A3634; --line-strong:#3C4B48;
  --accent:#52BBAF; --accent-ink:#8FD8CF; --accent-soft:#163430; --focus:#52BBAF;
  --k-goal:#E48B55; --k-entity:#3FC4B0; --k-type:#6D9BE0; --k-procedure:#A98AE0; --k-capability:#E0B23A; --k-rule:#E0707D;
  --k-claim:#93A29D; --k-observation:#C9A26A; --k-issue:#E0707D; --k-property:#6D9BE0; --k-relation:#6D9BE0;
  --k-assistant:#52BBAF; --k-job:#E48B55; --k-tool:#E0B23A; --k-test:#A98AE0; --k-exclusion:#93A29D;
  --k-output:#6D9BE0; --k-scenario:#A98AE0; --k-personality:#C9A26A; --k-mcp:#3FC4B0;
  --sev-critical:#E06A62; --sev-warning:#E0A53F; --sev-info:#7FA3DA; --ok:#5DBE8F;
  --quote-bg:#1C1F1B; --quote-line:#3A3A2E;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin:0; background:var(--bg); color:var(--ink); font-family:var(--sans); font-size:14px; line-height:1.45; }
.sr { position:absolute; left:-9999px; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.app { display:flex; flex-direction:column; height:100vh; min-height:560px; }
.top { display:flex; align-items:center; gap:16px; padding:10px 18px; border-bottom:1px solid var(--line); background:var(--surface); flex-wrap:wrap; }
.brand { display:flex; align-items:center; gap:12px; min-width:0; flex:1 1 240px; }
.brand-mark { width:12px; height:28px; background:linear-gradient(180deg,var(--accent),var(--k-goal)); border-radius:2px; flex:none; }
.top h1 { font-size:17px; font-weight:600; margin:0; letter-spacing:-0.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.top .sub { font-size:12px; color:var(--muted); }
.tabs { display:flex; gap:2px; border-bottom:2px solid transparent; }
.tab { border:0; background:transparent; padding:8px 14px; cursor:pointer; color:var(--muted); font-weight:600; font-size:14px; border-bottom:2px solid transparent; margin-bottom:-12px; padding-bottom:12px; }
.tab.is-on { color:var(--ink); border-bottom-color:var(--accent); }
.tab .n { font-weight:400; color:var(--muted); font-size:12px; margin-left:4px; }
.tab.is-empty { opacity:.55; }
.views { display:flex; gap:2px; background:var(--surface-2); padding:3px; border-radius:8px; }
.views[hidden] { display:none; }
.view-btn { border:0; background:transparent; padding:6px 14px; border-radius:6px; cursor:pointer; color:var(--muted); font-weight:500; }
.view-btn.is-on { background:var(--surface); color:var(--ink); box-shadow:0 1px 2px rgba(0,0,0,.08); }
.search { flex:0 1 300px; min-width:170px; }
.search input { width:100%; padding:8px 12px; border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--ink); font: inherit; }
.search input:focus { border-color:var(--accent); outline:none; box-shadow:0 0 0 3px var(--accent-soft); }
.body { display:flex; flex:1; min-height:0; }
.stage { flex:1; min-width:0; position:relative; display:flex; flex-direction:column; }
.panel { display:none; flex:1; min-height:0; flex-direction:column; }
.panel.is-on { display:flex; }
.view { display:none; flex:1; min-height:0; flex-direction:column; }
.view.is-on { display:flex; }
.graph-bar { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 14px; flex-wrap:wrap; }
.legend { display:flex; gap:6px; flex-wrap:wrap; }
.legend button { display:inline-flex; align-items:center; gap:6px; padding:4px 10px 4px 6px; border:1px solid var(--line); background:var(--surface); border-radius:999px; cursor:pointer; font-size:12px; }
.legend button .dot { width:10px; height:10px; border-radius:50%; background:var(--c); }
.legend button.is-off { opacity:.45; text-decoration:line-through; }
.legend button .n { color:var(--muted); font-variant-numeric:tabular-nums; }
.graph-hint { font-size:12px; color:var(--muted); }
svg.graph { flex:1; width:100%; height:100%; display:block; cursor:grab; }
svg.graph:active { cursor:grabbing; }
svg.graph .link { stroke:var(--line-strong); stroke-opacity:.6; fill:none; }
svg.graph .link.dim { stroke-opacity:.08; }
svg.graph .link.lit { stroke:var(--ink); stroke-opacity:.9; }
svg.graph .node circle { stroke:var(--surface); stroke-width:1.5px; cursor:pointer; }
svg.graph .node.dim { opacity:.15; }
svg.graph .node.is-selected circle { stroke:var(--ink); stroke-width:2.5px; }
svg.graph .node text { font-size:10px; fill:var(--ink); pointer-events:none; paint-order:stroke; stroke:var(--bg); stroke-width:3px; stroke-linejoin:round; }
svg.graph .node.small text { display:none; }
svg.graph .node.quiet text { display:none; }
svg.graph.zoomed .node.quiet text, svg.graph .node.quiet.lit-label text { display:block; }
.view-browse, .view-overview, .panel-build { overflow:auto; }
.browse, .overview { padding:14px 18px 40px; max-width:980px; }
.section { margin-bottom:26px; }
.section h2 { font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:0 0 8px; display:flex; align-items:center; gap:8px; }
.section h2 .dot { width:9px; height:9px; border-radius:50%; background:var(--c); }
.section h2 .n { font-weight:400; font-variant-numeric:tabular-nums; }
.rows { border-top:1px solid var(--line); }
.row { display:grid; grid-template-columns: 1fr auto; gap:6px 14px; padding:9px 6px; border-bottom:1px solid var(--line); cursor:pointer; align-items:start; }
.row:hover { background:var(--surface); }
.row.is-selected { background:var(--accent-soft); }
.row .lbl { font-weight:500; }
.row .sum { color:var(--muted); font-size:12.5px; grid-column:1 / -1; }
.row .sum.mono { font-family:var(--mono); font-size:12px; }
.row .side { display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
.group-h { font-size:12px; color:var(--muted); padding:12px 6px 4px; font-weight:500; }
.pill { display:inline-block; font-size:11px; padding:2px 8px; border-radius:999px; border:1px solid var(--line); color:var(--muted); background:var(--surface); white-space:nowrap; }
.pill.sev-CRITICAL { color:var(--sev-critical); border-color:var(--sev-critical); }
.pill.sev-WARNING { color:var(--sev-warning); border-color:var(--sev-warning); }
.pill.sev-INFO { color:var(--sev-info); border-color:var(--sev-info); }
.pill.kind { color:var(--c); border-color:var(--c); }
.pill.mod-MUST, .pill.mod-MUST_NOT { color:var(--k-rule); border-color:var(--k-rule); }
.pill.NEGATIVE { color:var(--k-rule); border-color:var(--k-rule); }
.pill.ok { color:var(--ok); border-color:var(--ok); }
.pill.fail { color:var(--sev-critical); border-color:var(--sev-critical); }
.empty { color:var(--muted); padding:10px 6px; }
.notice { margin:14px 18px; padding:12px 14px; border:1px solid var(--line); border-left:3px solid var(--sev-warning); background:var(--surface); border-radius:6px; max-width:900px; }
.notice.err { border-left-color:var(--sev-critical); }
.notice h3 { margin:0 0 6px; font-size:13px; }
.notice ul { margin:0; padding-left:18px; }
.detail { width:420px; flex:none; border-left:1px solid var(--line); background:var(--surface); overflow:auto; display:flex; flex-direction:column; }
.detail-empty { padding:24px; color:var(--muted); }
.detail-head { padding:14px 18px 10px; border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--surface); z-index:1; }
.detail-head .crumbs { display:flex; gap:8px; align-items:center; margin-bottom:8px; }
.detail-head .crumbs button { border:1px solid var(--line); background:var(--bg); border-radius:6px; padding:3px 9px; cursor:pointer; font-size:12px; }
.detail-head .crumbs button:disabled { opacity:.4; cursor:default; }
.detail-head h2 { font-size:16px; margin:0 0 6px; line-height:1.3; text-wrap:balance; }
.detail-head .id { font-family:var(--mono); font-size:11px; color:var(--muted); word-break:break-all; }
.detail-body { padding:6px 18px 30px; }
.field { padding:12px 0; border-bottom:1px solid var(--line); }
.field:last-child { border-bottom:0; }
.field h3 { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:0 0 6px; font-weight:500; }
.field p { margin:0; max-width:62ch; }
.field .mono { font-family:var(--mono); font-size:12px; white-space:pre-wrap; word-break:break-word; background:var(--surface-2); padding:8px 10px; border-radius:6px; }
.field .prompt { font-family:var(--mono); font-size:12px; white-space:pre-wrap; background:var(--surface-2); padding:10px; border-radius:6px; max-height:320px; overflow:auto; }
.links { display:flex; flex-wrap:wrap; gap:6px; }
.chip { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--line); background:var(--bg); border-radius:6px; padding:3px 9px; cursor:pointer; font-size:12.5px; text-align:left; }
.chip:hover { border-color:var(--c, var(--accent)); }
.chip .dot { width:8px; height:8px; border-radius:50%; background:var(--c, var(--muted)); flex:none; }
.pills { display:flex; flex-wrap:wrap; gap:6px; }
.quotes { margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:6px; }
.quotes li { padding:6px 10px 6px 12px; border-left:3px solid var(--k-goal); background:var(--quote-bg); border-radius:0 6px 6px 0; font-style:italic; }
.bullets { margin:0; padding-left:18px; }
.bullets li { margin:3px 0; }
.dialog, .checks { margin:0; padding:0; list-style:none; }
.dialog li, .checks li { margin:6px 0; }
.dialog .who, .checks .who { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
.checks li { padding:6px 10px; background:var(--surface-2); border-radius:6px; }
.checks .cond { font-family:var(--mono); font-size:12px; }
.steps { margin:0; padding-left:0; list-style:none; counter-reset: step; }
.steps li { position:relative; padding:6px 0 6px 30px; counter-increment: step; }
.steps li::before { content: counter(step); position:absolute; left:0; top:6px; width:20px; height:20px; border-radius:50%; background:var(--accent-soft); color:var(--accent-ink); font-size:11px; display:flex; align-items:center; justify-content:center; font-variant-numeric:tabular-nums; }
.steps .cap { margin-top:4px; }
.subrec { padding:8px 0; border-top:1px dashed var(--line); }
.subrec:first-child { border-top:0; }
.subrec p { margin:0 0 4px; }
.subrec .meta { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
.freq { display:inline-flex; align-items:center; gap:6px; font-size:11px; color:var(--muted); font-variant-numeric:tabular-nums; }
.freq i { display:inline-block; height:6px; width:60px; background:var(--surface-2); border-radius:3px; overflow:hidden; }
.freq i b { display:block; height:100%; width:var(--w); background:var(--k-observation); }
.ev { display:inline-flex; align-items:center; gap:5px; font-family:var(--mono); font-size:11px; padding:2px 7px; border-radius:5px; border:1px solid var(--line); background:var(--surface); cursor:pointer; color:var(--muted); }
.ev:hover, .ev.is-open { border-color:var(--accent); color:var(--accent-ink); }
.ev .a { width:6px; height:6px; border-radius:50%; background:var(--muted); }
.ev .a.AUTHORITATIVE { background:var(--accent); }
.ev .a.INTERFACE { background:var(--k-capability); }
.ev .a.OBSERVATIONAL { background:var(--k-observation); }
.evs { display:flex; flex-wrap:wrap; gap:5px; margin-top:6px; }
.quote { margin:8px 0 2px; padding:10px 12px; background:var(--quote-bg); border:1px solid var(--quote-line); border-radius:6px; }
.quote .q { font-family:var(--mono); font-size:12px; white-space:pre-wrap; word-break:break-word; margin:0 0 8px; max-height:260px; overflow:auto; }
.quote .src { font-size:11.5px; color:var(--muted); display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.quote .src a { color:var(--accent-ink); word-break:break-all; }
.ov-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:10px; margin:14px 0 22px; }
.tile { background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:12px 14px; cursor:pointer; text-align:left; }
.tile .big { font-size:26px; font-weight:600; font-variant-numeric:tabular-nums; letter-spacing:-0.02em; color:var(--c, var(--ink)); }
.tile .lbl { font-size:12px; color:var(--muted); }
.lede { font-size:15.5px; line-height:1.55; max-width:70ch; margin:6px 0 14px; }
.meta-line { color:var(--muted); font-size:12.5px; display:flex; gap:14px; flex-wrap:wrap; font-family:var(--mono); }
table.plain { border-collapse:collapse; width:100%; font-size:13px; }
table.plain th, table.plain td { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
table.plain th { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:500; }
table.plain td.mono, .ops li { font-family:var(--mono); font-size:12px; }
.ops { margin:0; padding-left:0; list-style:none; }
.ops li { padding:7px 8px; border-bottom:1px solid var(--line); }
.ops li.risk-PRIVILEGED { color:var(--sev-critical); }
.ops li .flag { color:var(--sev-warning); }
.overflow { overflow-x:auto; }
.transcript { margin:0; padding:0; list-style:none; }
.transcript li { padding:5px 0; }
.transcript .who { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin-right:6px; }
mark { background:var(--accent-soft); color:inherit; padding:0 1px; border-radius:2px; }
@media (max-width: 900px) {
  .body { flex-direction:column; }
  .detail { width:auto; border-left:0; border-top:1px solid var(--line); max-height:48vh; }
  .app { height:auto; min-height:100vh; }
  .stage { min-height:52vh; }
}
@media (prefers-reduced-motion: reduce) { * { transition:none !important; animation:none !important; } }
"""


JS = r"""
(function () {
  const DATA = JSON.parse(document.getElementById('data').textContent);
  const color = k => `var(--k-${k})`;
  const $ = (s, el) => (el || document).querySelector(s);
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v != null) n.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  const EV = DATA.evidence || {};
  const stage = $('#stage'), detail = $('#detail'), viewsNav = $('#views'), searchBox = $('#search');
  const remember = (k, v) => { try { sessionStorage.setItem('vb-' + k, v); } catch (e) {} };
  const recall = k => { try { return sessionStorage.getItem('vb-' + k); } catch (e) { return null; } };

  // ---------- evidence chips (shared)
  function evChip(id) {
    const e = EV[id];
    const chip = el('button', { class: 'ev', type: 'button', title: e ? e.title : id }, el('span', { class: 'a ' + (e ? e.authority || '' : '') }), id.replace(/^evidence:/, ''));
    chip.addEventListener('click', () => {
      const open = chip.nextElementSibling && chip.nextElementSibling.classList.contains('quote');
      if (open) { chip.nextElementSibling.remove(); chip.classList.remove('is-open'); return; }
      chip.classList.add('is-open');
      const q = el('div', { class: 'quote' },
        el('p', { class: 'q' }, e ? (e.text || '(no text captured)') : 'Evidence not found in the ledger.'),
        e ? el('div', { class: 'src' }, el('span', { class: 'pill' }, e.role || 'source'), e.authority ? el('span', { class: 'pill' }, e.authority) : null, el('span', null, e.title),
          e.locator ? (/^https?:/.test(e.locator) ? el('a', { href: e.locator, target: '_blank', rel: 'noopener' }, e.locator) : el('span', { class: 'mono-inline' }, e.locator)) : null) : null);
      chip.after(q);
    });
    return chip;
  }
  function evRow(ids) {
    if (!ids || !ids.length) return null;
    const wrap = el('div', { class: 'evs' });
    ids.forEach(id => { const s = el('span', { style: 'display:contents' }); s.append(evChip(id)); wrap.append(s); });
    return wrap;
  }
  function section(title, ...kids) { return el('section', { class: 'section' }, el('h2', null, title), ...kids); }
  function table(headers, rows) {
    return el('div', { class: 'overflow' }, el('table', { class: 'plain' }, headers ? el('thead', null, el('tr', null, headers.map(h => el('th', null, h)))) : null,
      el('tbody', null, rows.map(r => el('tr', null, r.map((c, i) => el(headers || i ? 'td' : 'th', typeof c === 'object' && c && c.mono ? { class: 'mono' } : null, typeof c === 'object' && c && 'v' in c ? c.v : c)))))));
  }
  function notice(kind, title, items) { return el('div', { class: 'notice ' + kind }, el('h3', null, title), el('ul', null, items.map(i => el('li', null, i)))); }

  // ---------- a record panel: graph + browse + overview over one model
  function makePanel(name, M) {
    const root = el('section', { class: 'panel', 'data-panel': name });
    const P = { name, M, root, selected: null, hist: { back: [], fwd: [] }, hidden: new Set(), query: '', view: recall('view-' + name) || (name === 'ontology' ? 'graph' : 'overview'), hasViews: true };
    if (!M) {
      P.hasViews = false;
      const check = (DATA.checks || {})[name];
      root.append(el('div', { class: 'overview' }, el('p', { class: 'lede' }, name === 'plan' ? 'No checked plan yet. The plan is written after the ontology and appears here as soon as `check plan` passes.' : 'No checked ontology yet.'),
        check && check.errors && check.errors.length ? notice('err', `Last check: ${check.status}`, check.errors) : null));
      return P;
    }
    const R = M.records;
    const kindMeta = Object.fromEntries(M.kinds.map(k => [k.kind, k]));
    const vGraph = el('section', { class: 'view view-graph' }, el('div', { class: 'graph-bar' }, el('div', { class: 'legend' }), el('div', { class: 'graph-hint' }, 'Drag to move · scroll to zoom · click a node for details and evidence')), null);
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svgEl.setAttribute('class', 'graph'); svgEl.setAttribute('role', 'img'); svgEl.setAttribute('aria-label', 'Record graph'); vGraph.append(svgEl);
    const browse = el('div', { class: 'browse' }), overview = el('div', { class: 'overview' });
    const vBrowse = el('section', { class: 'view view-browse' }, browse), vOverview = el('section', { class: 'view view-overview' }, overview);
    root.append(vGraph, vBrowse, vOverview);

    P.showView = v => { P.view = v; remember('view-' + name, v); [vGraph, vBrowse, vOverview].forEach(x => x.classList.toggle('is-on', x.classList.contains('view-' + v))); if (v === 'graph') resize(); syncViewButtons(); };
    function linkChip(l) {
      const r = R[l.id]; const k = r ? r.kind : 'claim';
      const c = el('button', { class: 'chip', type: 'button', style: `--c:${color(k)}` }, el('span', { class: 'dot' }), l.label);
      c.addEventListener('click', () => P.open(l.id));
      return c;
    }
    P.open = (id, opts) => {
      const r = R[id]; if (!r) return;
      if (P.selected && P.selected !== id && !(opts && opts.noHistory)) { P.hist.back.push(P.selected); P.hist.fwd = []; }
      P.selected = id; location.hash = encodeURIComponent(name + '/' + id);
      P.renderDetail(); highlight(id);
      browse.querySelectorAll('.row').forEach(x => x.classList.toggle('is-selected', x.dataset.id === id));
    };
    P.renderDetail = () => {
      detail.innerHTML = '';
      const r = R[P.selected];
      if (!r) { detail.append(el('div', { class: 'detail-empty' }, el('p', null, 'Select a node or a row to see its definition, related records, and the evidence behind it.'))); return; }
      const back = el('button', { type: 'button', disabled: P.hist.back.length ? null : 'disabled', onclick: () => { if (!P.hist.back.length) return; P.hist.fwd.push(P.selected); P.open(P.hist.back.pop(), { noHistory: true }); } }, '← Back');
      const fwd = el('button', { type: 'button', disabled: P.hist.fwd.length ? null : 'disabled', onclick: () => { if (!P.hist.fwd.length) return; P.hist.back.push(P.selected); P.open(P.hist.fwd.pop(), { noHistory: true }); } }, 'Forward →');
      const head = el('div', { class: 'detail-head' },
        el('div', { class: 'crumbs' }, back, fwd, el('span', { class: 'pill kind', style: `--c:${color(r.kind)}` }, kindMeta[r.kind] ? kindMeta[r.kind].label.replace(/s$/, '') : r.kind)),
        el('h2', null, r.label), el('div', { class: 'id' }, r.id));
      const body = el('div', { class: 'detail-body' });
      for (const f of r.details) body.append(field(f));
      if (r.evidence && r.evidence.length) body.append(el('div', { class: 'field' }, el('h3', null, `Evidence (${r.evidence.length})`), evRow(r.evidence)));
      detail.append(head, body); detail.scrollTop = 0;
    };
    function field(f) {
      const w = el('div', { class: 'field' }, el('h3', null, f.label));
      switch (f.kind) {
        case 'text': w.append(el('p', null, f.value)); break;
        case 'mono': w.append(el('div', { class: 'mono' }, f.value)); break;
        case 'prompt': w.append(el('div', { class: 'prompt' }, f.value)); break;
        case 'links': if (f.value.length) w.append(el('div', { class: 'links' }, f.value.map(linkChip))); else w.append(el('p', { class: 'empty' }, 'none')); break;
        case 'pills': w.append(el('div', { class: 'pills' }, f.value.map(p => el('span', { class: 'pill ' + p.replace(/\s.*/, '') + ' mod-' + p + ' sev-' + p }, p)))); break;
        case 'quotes': w.append(el('ul', { class: 'quotes' }, f.value.map(q => el('li', null, q)))); break;
        case 'bullets': w.append(el('ul', { class: 'bullets' }, f.value.map(q => el('li', null, q)))); break;
        case 'dialog': w.append(el('ul', { class: 'dialog' }, f.value.map(x => [el('li', null, el('div', { class: 'who' }, 'Caller'), x.caller), el('li', null, el('div', { class: 'who' }, 'Agent'), x.agent)]))); break;
        case 'checks': w.append(el('ul', { class: 'checks' }, f.value.map(x => el('li', null, el('div', { class: 'cond' }, x.caller), el('div', null, el('span', { class: 'who' }, 'measured'), x.agent))))); break;
        case 'steps': w.append(el('ol', { class: 'steps' }, f.value.map(s => el('li', null, s.instruction, s.capability ? el('div', { class: 'cap' }, linkChip(s.capability)) : null)))); break;
        case 'claims': w.append(...f.value.map(c => el('div', { class: 'subrec' }, el('p', null, c.text), el('div', { class: 'meta' },
            c.polarity === 'NEGATIVE' ? el('span', { class: 'pill NEGATIVE' }, 'not the case') : null, c.status ? el('span', { class: 'pill' }, c.status) : null, c.conditions ? el('span', { class: 'pill' }, 'when: ' + c.conditions) : null),
            evRow(c.evidence)))); break;
        case 'observations': w.append(...f.value.map(o => el('div', { class: 'subrec' }, el('p', null, o.text),
            o.sampleSize ? el('span', { class: 'freq' }, el('i', null, el('b', { style: `--w:${Math.round(100 * (o.count || 0) / o.sampleSize)}%` })), `${o.count} of ${o.sampleSize} calls`) : null, evRow(o.evidence)))); break;
        default: w.append(el('p', null, JSON.stringify(f.value)));
      }
      return w;
    }

    // browse
    function renderBrowse() {
      browse.innerHTML = '';
      const q = P.query.trim().toLowerCase();
      const match = r => !q || (r.label + ' ' + r.summary + ' ' + JSON.stringify(r.details)).toLowerCase().includes(q);
      for (const k of M.kinds) {
        let rs = Object.values(R).filter(r => r.kind === k.kind).filter(match);
        if (!rs.length) continue;
        const sec = el('section', { class: 'section' }, el('h2', null, el('span', { class: 'dot', style: `--c:${color(k.kind)}` }), k.label, el('span', { class: 'n' }, `${rs.length}`)));
        const rows = el('div', { class: 'rows' });
        if (k.kind === 'claim') {
          const groups = new Map();
          rs.forEach(r => { const s = r.meta.subjectLabel || '—'; if (!groups.has(s)) groups.set(s, []); groups.get(s).push(r); });
          [...groups.keys()].sort((a, b) => a.localeCompare(b)).forEach(s => { rows.append(el('div', { class: 'group-h' }, s)); groups.get(s).forEach(r => rows.append(row(r))); });
        } else if (k.kind === 'issue') {
          const order = { CRITICAL: 0, WARNING: 1, INFO: 2 };
          rs.sort((a, b) => (order[a.meta.severity] ?? 3) - (order[b.meta.severity] ?? 3)).forEach(r => rows.append(row(r)));
        } else rs.sort((a, b) => a.label.localeCompare(b.label)).forEach(r => rows.append(row(r)));
        sec.append(rows); browse.append(sec);
      }
      if (!browse.children.length) browse.append(el('p', { class: 'empty' }, 'Nothing matches that search.'));
    }
    function row(r) {
      const side = el('div', { class: 'side' });
      if (r.kind === 'issue') side.append(el('span', { class: 'pill sev-' + r.meta.severity }, r.meta.severity), el('span', { class: 'pill' }, (r.meta.issueKind || '').replace(/_/g, ' ').toLowerCase()));
      if (r.kind === 'rule') side.append(el('span', { class: 'pill mod-' + r.meta.modality }, r.meta.modality));
      if (r.kind === 'capability' || r.kind === 'tool') { side.append(el('span', { class: 'pill' }, 'risk ' + (r.meta.risk || '?'))); if (r.meta.confirm) side.append(el('span', { class: 'pill' }, 'confirms first')); }
      if (r.kind === 'goal' && r.meta.phrases) side.append(el('span', { class: 'pill' }, `${r.meta.phrases} caller phrases`));
      if (r.kind === 'job') side.append(el('span', { class: 'pill' }, (r.meta.handling || '').replace(/_/g, ' ').toLowerCase()));
      if (r.kind === 'output') side.append(el('span', { class: 'pill' }, `${r.meta.fields} field${r.meta.fields === 1 ? '' : 's'}`));
      if (r.kind === 'scenario') { side.append(el('span', { class: 'pill' }, `${r.meta.evaluations} check${r.meta.evaluations === 1 ? '' : 's'}`)); if (r.meta.mocks) side.append(el('span', { class: 'pill' }, `${r.meta.mocks} mocked`)); }
      if (r.kind === 'observation' && r.meta.sampleSize) side.append(el('span', { class: 'freq' }, el('i', null, el('b', { style: `--w:${Math.round(100 * (r.meta.count || 0) / r.meta.sampleSize)}%` })), `${r.meta.count}/${r.meta.sampleSize}`));
      if (r.evidence && r.evidence.length) side.append(el('span', { class: 'pill' }, `${r.evidence.length} evidence`));
      const summary = r.kind === 'claim' || r.kind === 'observation' || r.kind === 'issue' ? null : el('div', { class: 'sum' + (r.kind === 'capability' || r.kind === 'tool' ? ' mono' : '') }, r.summary);
      const n = el('div', { class: 'row', 'data-id': r.id, tabindex: '0', role: 'button' }, el('div', { class: 'lbl' }, r.label), side, summary);
      n.addEventListener('click', () => P.open(r.id));
      n.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); P.open(r.id); } });
      return n;
    }

    // overview
    function renderOverview() {
      overview.innerHTML = '';
      overview.append(el('p', { class: 'lede' }, M.summary));
      if (M.callerRoles && M.callerRoles.length) overview.append(el('div', { class: 'meta-line' }, 'callers: ' + M.callerRoles.join(', ')));
      if (M.warnings && M.warnings.length) overview.append(notice('', `Check warnings (${M.warnings.length})`, M.warnings));
      const grid = el('div', { class: 'ov-grid' });
      for (const k of M.kinds) {
        const n = Object.values(R).filter(r => r.kind === k.kind).length;
        if (!n) continue;
        grid.append(el('button', { class: 'tile', type: 'button', style: `--c:${color(k.kind)}`, onclick: () => { P.showView('browse'); const h = [...browse.querySelectorAll('.section h2')].find(x => x.textContent.includes(k.label)); if (h) h.scrollIntoView({ block: 'start' }); } },
          el('div', { class: 'big' }, n), el('div', { class: 'lbl' }, k.label)));
      }
      overview.append(grid);
      if (M.page === 'ontology') {
        const sev = { CRITICAL: 0, WARNING: 0, INFO: 0 };
        Object.values(R).filter(r => r.kind === 'issue').forEach(r => sev[r.meta.severity] = (sev[r.meta.severity] || 0) + 1);
        overview.append(section('Issues by severity', el('div', { class: 'pills' }, Object.entries(sev).filter(([, n]) => n).map(([s, n]) => el('span', { class: 'pill sev-' + s }, `${n} ${s.toLowerCase()}`)))));
        if (M.coverage && M.coverage.segments) overview.append(section('Evidence coverage', el('p', null, `${M.coverage.cited} of ${M.coverage.segments} source segments are cited by at least one record; ${M.coverage.declaredUncovered} were set aside on purpose; ${(M.coverage.uncited || []).length} are unaccounted for.`)));
        if (M.sources && M.sources.length) overview.append(section('Sources', table(['Source', 'Role', 'Authority', 'Items', 'Segments'], M.sources.map(s => [{ mono: true, v: s.location || s.id }, s.role, s.authority || '—', s.items ?? '—', s.segments ?? '—']))));
        if (M.uncovered && M.uncovered.length) overview.append(section('Set aside on purpose', table(['Segment', 'Reason'], M.uncovered.map(u => [u.title, u.reason]))));
      }
      if (M.page === 'plan') {
        const rt = M.runtime || {}, t = M.topology || {};
        overview.append(section(`Topology · ${t.choice === 'squad' ? 'squad of specialists' : 'single assistant'}`, el('p', null, t.why)));
        overview.append(section('Runtime', table(null,
          [['Tools call', { mono: true, v: rt.serverUrl || '—' }], ['Model', { mono: true, v: rt.model ? `${rt.model.provider} · ${rt.model.model}` + (rt.model.temperature != null ? ` · temperature ${rt.model.temperature}` : '') : '—' }],
           ['Voice', { mono: true, v: rt.voice ? `${rt.voice.provider} · ${rt.voice.voiceId}` : '—' }], ['Transcriber', { mono: true, v: rt.transcriber ? `${rt.transcriber.provider} · ${rt.transcriber.model}` : '—' }], ['Language', { mono: true, v: rt.language }],
           rt.simulationTransport ? ['Simulations run over', { mono: true, v: rt.simulationTransport }] : null].filter(Boolean))));
        if (M.enabledOperations && M.enabledOperations.length) overview.append(section('Operations the agent will be able to call', el('ul', { class: 'ops' }, M.enabledOperations.map(op => {
          const li = el('li', { class: /risk PRIVILEGED/.test(op) ? 'risk-PRIVILEGED' : '' });
          const parts = op.split(' · NO read-back'); li.append(parts[0]); if (parts.length > 1) li.append(el('span', { class: 'flag' }, ' · NO read-back'));
          return li; }))));
        const outs = Object.values(R).filter(r => r.kind === 'output');
        if (outs.length) overview.append(section('Structured outputs extracted after every call', el('div', { class: 'links' }, outs.map(o => linkChip({ id: o.id, label: o.label })))));
        const scs = Object.values(R).filter(r => r.kind === 'scenario');
        if (scs.length) overview.append(section('Simulation scenarios', el('div', { class: 'links' }, scs.map(o => linkChip({ id: o.id, label: o.label })))));
      }
    }

    // graph
    const svg = d3.select(svgEl);
    const gRoot = svg.append('g'); const gLinks = gRoot.append('g'), gNodes = gRoot.append('g');
    const nodes = M.nodes.map(n => ({ ...n })); const nodeById = new Map(nodes.map(n => [n.id, n]));
    const links = M.edges.filter(e => nodeById.has(e.source) && nodeById.has(e.target)).map(e => ({ ...e }));
    const neighbors = new Map();
    links.forEach(l => { (neighbors.get(l.source) || neighbors.set(l.source, new Set()).get(l.source)).add(l.target); (neighbors.get(l.target) || neighbors.set(l.target, new Set()).get(l.target)).add(l.source); });
    const radius = n => Math.min(16, 4 + Math.sqrt(n.weight || 1) * 2.2 + (n.kind === 'goal' || n.kind === 'assistant' ? 3 : 0));
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(l => l.kind === 'instance-of' || l.kind === 'is-a' ? 40 : 70).strength(0.6))
      .force('charge', d3.forceManyBody().strength(-140)).force('collide', d3.forceCollide().radius(d => radius(d) + 6))
      .force('center', d3.forceCenter(0, 0)).force('x', d3.forceX(0).strength(0.03)).force('y', d3.forceY(0).strength(0.03));
    const link = gLinks.selectAll('line').data(links).join('line').attr('class', 'link').attr('stroke-width', l => l.kind === 'serves' || l.kind === 'owns' ? 1.4 : 1);
    const QUIET = new Set(['type', 'procedure', 'rule', 'claim']);
    const node = gNodes.selectAll('g').data(nodes).join('g').attr('class', d => 'node' + (radius(d) < 6 ? ' small' : '') + (QUIET.has(d.kind) ? ' quiet' : ''))
      .call(d3.drag().on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; }).on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
    node.append('circle').attr('r', radius).attr('fill', d => color(d.kind));
    node.append('text').attr('dx', d => radius(d) + 3).attr('dy', '0.35em').text(d => d.label.length > 34 ? d.label.slice(0, 32) + '…' : d.label);
    node.append('title').text(d => d.label);
    node.on('click', (e, d) => { e.stopPropagation(); P.open(d.id); });
    node.on('mouseenter', (e, d) => { if (!P.selected) lit(d.id); }).on('mouseleave', () => { if (!P.selected) lit(null); });
    sim.on('tick', () => { link.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y); node.attr('transform', d => `translate(${d.x},${d.y})`); });
    svg.call(d3.zoom().scaleExtent([0.2, 4]).on('zoom', e => { gRoot.attr('transform', e.transform); svg.classed('zoomed', e.transform.k >= 1.35); gNodes.selectAll('g').classed('small', d => radius(d) * e.transform.k < 7); }));
    function resize() {
      const box = svgEl.getBoundingClientRect();
      if (!box.width) { const shown = root.classList.contains('is-on'); root.style.display = 'flex'; vGraph.style.display = 'flex'; vGraph.style.visibility = 'hidden'; const b = svgEl.getBoundingClientRect(); svg.attr('viewBox', [-b.width / 2, -b.height / 2, b.width || 800, b.height || 500].join(' ')); vGraph.style.display = ''; vGraph.style.visibility = ''; root.style.display = shown ? '' : ''; return; }
      svg.attr('viewBox', [-box.width / 2, -box.height / 2, box.width, box.height].join(' '));
    }
    P.resize = resize;
    function lit(id) {
      if (!id) { node.classed('dim', false).classed('lit-label', false); link.classed('dim', false).classed('lit', false); return; }
      const near = neighbors.get(id) || new Set();
      node.classed('dim', d => d.id !== id && !near.has(d.id)).classed('lit-label', d => d.id === id || near.has(d.id));
      link.classed('lit', l => l.source.id === id || l.target.id === id).classed('dim', l => l.source.id !== id && l.target.id !== id);
    }
    function highlight(id) { node.classed('is-selected', d => d.id === id); if (nodeById.has(id)) lit(id); else lit(null); }
    function applyHidden() { node.style('display', d => P.hidden.has(d.kind) ? 'none' : null); link.style('display', l => P.hidden.has(l.source.kind) || P.hidden.has(l.target.kind) ? 'none' : null); }
    const legend = $('.legend', vGraph);
    for (const k of M.kinds.filter(k => k.graph)) {
      const n = nodes.filter(x => x.kind === k.kind).length; if (!n) continue;
      const b = el('button', { type: 'button', style: `--c:${color(k.kind)}` }, el('span', { class: 'dot' }), k.label, el('span', { class: 'n' }, `${n}`));
      b.addEventListener('click', () => { if (P.hidden.has(k.kind)) P.hidden.delete(k.kind); else P.hidden.add(k.kind); b.classList.toggle('is-off', P.hidden.has(k.kind)); applyHidden(); });
      legend.append(b);
    }
    P.search = q => { P.query = q; renderBrowse(); const s = q.trim().toLowerCase(); node.classed('dim', d => s && !(d.label + ' ' + (R[d.id] ? R[d.id].summary : '')).toLowerCase().includes(s)); if (q && P.view === 'overview') P.showView('browse'); };
    renderBrowse(); renderOverview(); P.showView(P.view);
    return P;
  }

  // ---------- build panel
  function makeBuild(B) {
    const root = el('section', { class: 'panel panel-build', 'data-panel': 'build' });
    const P = { name: 'build', root, hasViews: false, renderDetail: () => {
      detail.innerHTML = '';
      const T = B && B.tryIt;
      if (!T) { detail.append(el('div', { class: 'detail-empty' }, el('p', null, 'The Build tab lists exactly what compile produced and what apply created in Vapi.'))); return; }
      const mono = v => el('div', { class: 'mono' }, v);
      const link = href => el('a', { href, target: '_blank', rel: 'noopener' }, href);
      detail.append(
        el('div', { class: 'detail-head' }, el('div', { class: 'crumbs' }, el('span', { class: 'pill kind', style: '--c:var(--k-assistant)' }, 'Try it')), el('h2', null, `Call as ${T.customer}`), el('div', { class: 'id' }, `${T.targetKind} ${T.targetId}`)),
        el('div', { class: 'detail-body' },
          el('div', { class: 'field' }, el('h3', null, 'Open in the Vapi dashboard'), el('p', null, link(T.dashboard)), el('p', null, 'Use the talk button, or call the number the ' + T.targetKind + ' is attached to.')),
          el('div', { class: 'field' }, el('h3', null, 'On the phone'), el('p', null, 'Say your number is'), mono(T.phone), el('p', null, 'and your PIN is'), mono(T.pin), el('p', null, 'Then ask for a balance, recent transactions, or to move money between checking and savings.')),
          el('div', { class: 'field' }, el('h3', null, 'On the web, same customer'), el('p', null, link(T.web)), mono(`${T.email}\n${T.password}`)),
          el('div', { class: 'field' }, el('h3', null, 'Note'), el('p', null, T.note))));
    } };
    const o = el('div', { class: 'overview' }); root.append(o);
    if (!B) { o.append(el('p', { class: 'lede' }, 'Not compiled yet. Once the ontology and plan are approved, `compile` fills this tab with the exact knowledge files, tools, assistants, structured outputs, and simulations that will be created.')); return P; }
    o.append(el('p', { class: 'lede' }, `Compiled ${B.compiledAt}${B.applied ? ' · applied to Vapi and verified' : ' · not applied yet'}`));
    o.append(section(`Knowledge base “${B.knowledgeBase.name}” (${B.knowledgeBase.files.length} files)`, table(['File', 'Origin', 'From', 'Bytes'], B.knowledgeBase.files.map(f => [{ mono: true, v: f.name }, f.origin, { mono: true, v: f.locator }, f.bytes]))));
    o.append(section(`Tools (${B.tools.length})`, B.tools.length ? table(['Tool', 'Method', 'URL', 'Secret headers'], B.tools.map(t => [t.name, { mono: true, v: t.method }, { mono: true, v: t.url }, t.secretHeaders.join(', ') || '—'])) : el('p', { class: 'empty' }, 'none')));
    o.append(section(`Assistants (${B.assistants.length})` + (B.squad ? ` · squad “${B.squad}”` : ''), table(['Assistant', 'Tools', 'Knowledge base', 'Structured outputs', 'First message'],
      B.assistants.map(a => [a.name, { mono: true, v: a.tools.join(', ') || '—' }, a.knowledge ? 'yes' : 'no', a.outputs.join(', ') || '—', a.firstMessage || 'model-generated']))));
    if (B.structuredOutputs.length) o.append(section(`Structured outputs (${B.structuredOutputs.length}) · extracted by Vapi after every call`, table(['Output', 'Records', 'Fields', 'Attached to'],
      B.structuredOutputs.map(s => [s.name, s.description, { mono: true, v: s.fields.join('\n') }, s.assistants.join(', ')]))));
    if (B.simulations) o.append(section(`Simulations · suite “${B.simulations.suite}” · ${B.simulations.transport} · ${B.simulations.personalities.length} personalities`, table(['Scenario', 'AI caller', 'Passes when', 'Mocked tools'],
      B.simulations.scenarios.map(s => [s.name, s.personality, s.evaluations.join('; '), s.mocks.join(', ') || 'none (no writes exercised)']))));
    if (B.receipts.length) o.append(section('Applied resource IDs', table(null, B.receipts.map(([k, v]) => [k, { mono: true, v }]))));
    if (B.simulationResults) {
      const S = B.simulationResults;
      o.append(section(`Simulation run ${S.runId} · ${S.status}` + (S.url ? ' · ' : ''), S.url ? el('p', null, el('a', { href: S.url, target: '_blank', rel: 'noopener' }, S.url)) : null,
        ...S.results.map(r => el('div', { class: 'subrec' }, el('p', null, el('span', { class: 'pill ' + (r.passed ? 'ok' : r.passed === false ? 'fail' : '') }, r.passed ? 'PASS' : r.passed === false ? 'FAIL' : '?'), ' ', r.simulation, r.failureReason ? ` · ${r.failureReason}` : ''),
          table(['Check', 'Expected', 'Actual', 'Result'], r.evaluations.map(e => [e.name + (e.required ? '' : ' (optional)'), { mono: true, v: `${e.comparator || '='} ${JSON.stringify(e.expected)}` }, { mono: true, v: JSON.stringify(e.actual) }, e.passed ? 'pass' : e.passed === false ? 'fail' : (e.error || 'skipped')]))))));
    }
    if (B.testResults.length) o.append(section(`Chat test transcripts (${B.testResults.length})`, ...B.testResults.map(r => el('div', { class: 'subrec' }, el('p', null, el('b', null, r.scenario)),
      el('ul', { class: 'transcript' }, r.turns.map(t => [el('li', null, el('span', { class: 'who' }, 'caller'), t.caller), ...t.agent.map(a => el('li', null, el('span', { class: 'who' }, 'agent'), a))])),
      el('div', { class: 'meta-line' }, 'expect: ' + r.expect.join('; ') + (r.mustNot.length ? ' · must not: ' + r.mustNot.join('; ') : ''))))));
    return P;
  }

  // ---------- tabs
  let active = null;
  const panels = { ontology: makePanel('ontology', DATA.tabs.ontology), plan: makePanel('plan', DATA.tabs.plan), build: makeBuild(DATA.tabs.build) };
  for (const p of Object.values(panels)) stage.append(p.root);
  const counts = { ontology: DATA.tabs.ontology ? Object.keys(DATA.tabs.ontology.records).length : 0, plan: DATA.tabs.plan ? Object.keys(DATA.tabs.plan.records).length : 0, build: DATA.tabs.build ? (DATA.tabs.build.assistants.length + DATA.tabs.build.tools.length) : 0 };
  document.querySelectorAll('.tab').forEach(b => {
    const n = counts[b.dataset.tab];
    if (n) b.append(el('span', { class: 'n' }, n)); else b.classList.add('is-empty');
    if (b.dataset.tab === 'build' && DATA.tabs.build && DATA.tabs.build.applied) b.append(el('span', { class: 'n' }, '· applied'));
    b.addEventListener('click', () => showTab(b.dataset.tab));
  });
  function syncViewButtons() { if (!active) return; document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('is-on', b.dataset.view === active.view)); }
  document.querySelectorAll('.view-btn').forEach(b => b.addEventListener('click', () => { if (active && active.showView) active.showView(b.dataset.view); }));
  function showTab(name) {
    active = panels[name]; remember('tab', name);
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('is-on', b.dataset.tab === name));
    for (const p of Object.values(panels)) p.root.classList.toggle('is-on', p === active);
    viewsNav.hidden = !active.hasViews; searchBox.disabled = !active.hasViews;
    if (active.hasViews) { active.search(searchBox.value); active.showView(active.view); }
    active.renderDetail();
    $('#subtitle').textContent = active.M ? `${active.M.page === 'ontology' ? 'Evidence-linked ontology' : 'Agent plan'} · check ${active.M.status || '—'} · ${(active.M.digest || '').slice(0, 19)}` : (name === 'build' ? 'What compile produced and apply created' : 'Nothing checked yet') ;
  }
  searchBox.addEventListener('input', e => { if (active && active.hasViews) active.search(e.target.value); });
  const fromHash = decodeURIComponent(location.hash.slice(1));
  const [hashTab, hashId] = fromHash.includes('/') ? [fromHash.split('/')[0], fromHash.slice(fromHash.indexOf('/') + 1)] : [null, null];
  const start = (hashTab && panels[hashTab]) ? hashTab : (recall('tab') && panels[recall('tab')] ? recall('tab') : (DATA.defaultTab || 'ontology'));
  showTab(start);
  if (hashId && active.open) active.open(hashId);
  try { const y = sessionStorage.getItem('vb-scroll'); if (y) { sessionStorage.removeItem('vb-scroll'); window.scrollTo(0, Number(y)); } } catch (e) {}
})();
"""


# --------------------------------------------------------------------------- entry point


def review_model(workspace: Workspace) -> dict[str, Any]:
    from . import ontology as ontology_module
    from . import plan as plan_module

    ledger = load_ledger(workspace)
    evidence = evidence_index(workspace, ledger)

    def optional(path: Path) -> dict[str, Any] | None:
        return read_json(path) if path.exists() else None

    checks = {"ontology": optional(workspace.path("ontology", "check.json")), "plan": optional(workspace.path("plan", "check.json"))}
    try:
        ontology_candidate = ontology_module.load_candidate(workspace)
    except BuildError:
        ontology_candidate = None
    ontology_view = ontology_model(ontology_candidate, ledger, checks["ontology"]) if ontology_candidate else None
    plan_view = None
    try:
        plan_candidate = plan_module.load_candidate(workspace)
    except BuildError:
        plan_candidate = None
    if plan_candidate and ontology_candidate:
        plan_view = plan_model(plan_candidate, ontology_candidate, checks["plan"])
    build = optional(workspace.path("vapi", "build.json"))
    receipts = optional(workspace.path("vapi", "receipts.json"))
    try_it = None
    if workspace.project.get("demo"):
        from . import demo as demos

        try_it = try_it_card(demos.get(workspace.project["demo"]), receipts)
    build_view = build_model(build, receipts, optional(workspace.path("vapi", "test-results.json")), optional(workspace.path("vapi", "simulation-results.json")), try_it) if build else None
    default_tab = "build" if build_view and build_view["applied"] else "plan" if plan_view else "ontology"
    title = (plan_view or {}).get("title") or (ontology_view or {}).get("title") or workspace.project["name"]
    model = {"title": title, "defaultTab": default_tab, "tabs": {"ontology": ontology_view, "plan": plan_view, "build": build_view}, "checks": checks, "evidence": evidence}
    # The page's own digest: its data plus its script and style, so a re-render with new behaviour also refreshes an open tab.
    model["digest"] = digest_json({"model": model, "assets": digest(CSS + JS + REFRESH_JS)})
    model["renderedAt"] = utc_now()
    return model


def render_review(workspace: Workspace) -> Path:
    """Write <workspace>/review.html with whatever has been checked so far. Never raises for a missing plan or build."""
    if not workspace.path("ontology", "candidate.json").exists() and not workspace.path("plan", "candidate.json").exists():
        raise BuildError("Nothing to render yet: run `check ontology` (and `check plan`) first.")
    out = workspace.path(PAGE)
    out.write_text(render_page(review_model(workspace)), encoding="utf-8")
    return out
