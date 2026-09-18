# Writing `ontology/ontology.json`

The ontology is what the domain contains and how its pieces relate, with every record tied to evidence. It is not a prompt, a taxonomy from memory, or a summary of one article. The schema is `../scripts/vapi_build/schemas/ontology.schema.json` (relative to this guide); `check ontology` enforces it plus the rules below.

## Read the evidence
Packets under `evidence/packets/` list segments in this order: API operations, knowledge documents, website pages, transcript batches. Each block of text is preceded by its evidence ID in square brackets, for example `[evidence:kb-refund-policy-02]`. Those IDs are the only citations that exist. Segment titles show the source role and authority.

Work packet by packet. For large corpora, keep `ontology/notes.md` with candidate types, entities, goals, and the evidence IDs behind each, then consolidate into the JSON at the end. Do not pad the ontology to look thorough; discover what the evidence supports.

## Records

| Array | Purpose | Required fields |
|---|---|---|
| `domain` | one object: `name`, `summary`, optional `callerRoles` | |
| `types` | categories of things (products, roles, documents, events, symptoms, actions) | `id`, `label`, `definition`, `evidence`; optional `parents`, `status` |
| `entities` | named individuals: a specific product, plan, location, vessel | `id`, `label`, `types`, `definition`, `evidence`; optional `aliases` |
| `properties` (optional) | attributes with a value kind | `id`, `label`, `definition`, `domain`, `valueKind`, `evidence` |
| `relations` (optional) | typed links between types | `id`, `label`, `definition`, `from`, `to`, `evidence` |
| `claims` | atomic facts: one statement about one subject | `id`, `subject` (a type or entity id), `text`, `evidence`; optional `polarity`, `conditions`, `status` |
| `rules` | obligations, prohibitions, permissions | `id`, `modality` (MUST/MUST_NOT/SHOULD/SHOULD_NOT/MAY), `text`, `evidence`; optional `actors`, `applies`, `exceptions` |
| `procedures` | ordered steps with optional branching | `id`, `label`, `steps[]` (`id`, `instruction`, optional `capability`, `next`), `evidence`; optional `goals` |
| `goals` | what callers want, independent of how | `id`, `label`, `definition`, `evidence`; optional `callerPhrases` |
| `capabilities` | one entry per OpenAPI operation you want in the ontology | `id` from `evidence/capabilities.json`; optional `alignedGoals`, `preconditions`, `notes` |
| `observations` | what the transcripts and IVR logs show: demand, vocabulary, outcomes, what an existing IVR failed to recognize | `id`, `text`, `evidence`; optional `goals`, `count`, `sampleSize` |
| `issues` | conflicts, ambiguity, missing evidence, gaps | `id`, `kind`, `severity`, `description`; optional `records`, `evidence` |
| `uncovered` (optional) | segments you deliberately did not use | `segment`, `reason` |

IDs are `prefix:lower-kebab` and unique across the file: `type:crossing`, `entity:harbor-star`, `claim:adult-fare`, `step:show-reference`. Capability IDs are fixed by the host and printed at the top of each API operation segment (`capability: capability:...`) and in `evidence/capabilities.json`; copy them, do not derive them.

Enumerations: `status` is EXPLICIT, INFERRED, or HYPOTHESIS; claim `polarity` is POSITIVE or NEGATIVE; rule `modality` is MUST, MUST_NOT, SHOULD, SHOULD_NOT, or MAY; property `valueKind` is string, number, boolean, date, or reference; issue `kind` is CONFLICT, AMBIGUITY, MISSING_EVIDENCE, UNSUPPORTED_INFERENCE, COVERAGE_GAP, CAPABILITY_GAP, or FRAMEWORK_GAP with `severity` INFO, WARNING, or CRITICAL. The arrays `types`, `entities`, `claims`, `rules`, `procedures`, `goals`, `capabilities`, `observations`, and `issues` are all required, empty or not; `properties`, `relations`, and `uncovered` are optional. No other keys are allowed anywhere.

## Rules the checker enforces
- Every `evidence` entry must exist in the ledger. Every referenced record must exist and be of the right kind.
- Claims, rules, and procedures need at least one non-transcript source. Rules need at least one AUTHORITATIVE source. Something said on a call is an observation, never a fact or rule.
- Type `parents` cannot form a cycle. Procedure `next` targets must be steps of the same procedure.
- `observations.count` cannot exceed `sampleSize`. Capabilities are always disabled here; the plan enables them.
- At least one type and one goal. A CRITICAL issue blocks approval until it is resolved or downgraded with the user.
- Segments neither cited nor listed under `uncovered` are reported. Look at them before approval; `--strict` turns the report into an error.

## What good looks like
- Definitions distinguish things rather than restating labels. A symptom is not its cause; a request is not a permission; a plan is not an entitlement.
- Claims are atomic: one subject, one statement, a `conditions` string when scope matters, `polarity: NEGATIVE` for what is not the case. Keep contradictions as two claims plus a CONFLICT issue.
- Goals use the caller's words in `callerPhrases`, taken from transcripts or the website, not invented.
- Aliases capture the words customers and documents use for the same entity.
- Unknowns are explicit: an issue, an `INFERRED` or `HYPOTHESIS` status, or an `uncovered` reason.

## Skeleton
```json
{
  "domain": {"name": "…", "summary": "…", "callerRoles": ["customer"]},
  "types": [{"id": "type:account", "label": "Account", "definition": "…", "evidence": ["evidence:kb-products-01"]}],
  "entities": [{"id": "entity:money-market", "label": "Money Market Account", "types": ["type:account"], "definition": "…", "aliases": ["MMA"], "evidence": ["evidence:web-savings-02"]}],
  "claims": [{"id": "claim:mma-minimum", "subject": "entity:money-market", "text": "The minimum opening deposit is 2,500 dollars.", "evidence": ["evidence:kb-products-03"]}],
  "rules": [{"id": "rule:verify-first", "modality": "MUST", "actors": ["type:service-agent"], "text": "Verify identity before disclosing balances.", "evidence": ["evidence:kb-handbook-04"]}],
  "procedures": [{"id": "procedure:close-account", "label": "Close an account", "goals": ["goal:close-account"], "steps": [{"id": "step:verify", "instruction": "…", "next": ["step:confirm"]}, {"id": "step:confirm", "instruction": "…", "capability": "capability:prepareaction", "next": []}], "evidence": ["evidence:kb-handbook-07"]}],
  "goals": [{"id": "goal:close-account", "label": "Close an account", "definition": "…", "callerPhrases": ["I want to close my account"], "evidence": ["evidence:kb-handbook-07", "evidence:calls-batch-01-03"]}],
  "capabilities": [{"id": "capability:listofferings", "alignedGoals": ["goal:compare-products"]}],
  "observations": [{"id": "observation:closure-demand", "text": "Callers closing money market accounts often cite a competitor's rate.", "goals": ["goal:close-account"], "count": 6, "sampleSize": 40, "evidence": ["evidence:calls-batch-01-02"]}],
  "issues": [{"id": "issue:rate-conflict", "kind": "CONFLICT", "severity": "WARNING", "description": "Website and handbook state different rates.", "records": ["claim:mma-rate"], "evidence": ["evidence:web-savings-02", "evidence:kb-products-03"]}],
  "uncovered": [{"segment": "segment:web-careers", "reason": "Recruiting page; no customer-facing content."}]
}
```
