# vapi-build

> 🧪 **This is a showcase demo, not an officially supported Vapi product.** Built by Jonathan Eisenzopf (Vapi) as an experimental reference workflow: an agent skill that derives a whole voice agent from an organization's own material. It is meant to inspire and to be adapted, not to be production ready. For ordinary Vapi builds use the skills in [VapiAI/skills](https://github.com/VapiAI/skills).

## What it does

`vapi-build` is an [Agent Skill](https://agentskills.io/specification) that builds a complete, working [Vapi](https://vapi.ai) voice agent from raw material you name in conversation: a public website, knowledge articles (local files, URLs, or S3), sampled call transcripts or speech IVR logs, and an OpenAPI document with the backend URL the live agent should call.

The AI agent running the skill is the ontologist and planner. A small Python CLI shipped inside the skill is the deterministic host: it fetches and pins the sources, verifies everything the agent writes against the evidence, renders one review page, and creates the Vapi resources. The result is an evidence-linked ontology, a reviewed plan (a single assistant or a squad with a front-door authenticator, structured outputs for every call, a simulation suite), a knowledge base, API Request tools for approved operations, and the applied assistants, squad, structured outputs, and simulations.

I built it to find out how far an agent can get from source material to a tested Vapi agent when a checker holds every citation, tool, and approval to the evidence, and the human only says yes at two gates.

## How it works

1. **Intake.** You say `/vapi-build` (Claude Code), `$vapi-build` (Codex), or ask Claude to use the skill, and name your material. The skill asks everything it needs in one message: sources and their roles, transcript privacy, the API base URL, audience, authentication, whether callers arrive by phone.
2. **Fetch and extract.** The CLI crawls the site within its host, reads the documents, samples transcripts, parses the OpenAPI document, and writes an evidence ledger of pinned text segments plus reading packets.
3. **Ontology and plan.** The agent writes an ontology (goals, products, types, procedures, rules, facts, observations) citing evidence IDs, then a plan (assistants, jobs, allowed operations with risk, structured outputs, simulation scenarios). `check ontology` and `check plan` reject anything unsupported: citations that do not exist, facts resting only on transcripts, rules without an authoritative source, unknown operations, invalid schemas, scenarios that would hit a live write unmocked.
4. **Gate 1: the review page.** One HTML page with an **Ontology** tab (graph, browse, every record's quoted evidence), a **Plan** tab (topology decision, jobs, the exact operations the agent may call, structured outputs, scenarios), and a **Build** tab. Served locally and self-refreshing; one yes approves ontology and plan together.
5. **Gate 2: the build.** `compile` turns the plan into Vapi payloads and the Build tab lists exactly what will be created. On yes the CLI applies it, runs the plan's chat tests and the simulation suite, and re-renders the page with resource IDs, transcripts, and every evaluation. `teardown` removes everything it created.

Approvals are bound to content digests: a changed ontology invalidates the plan, a changed plan invalidates the build, and `apply` refuses stale builds. Details for the agent are in [SKILL.md](SKILL.md) and `references/`.

## Setup

### Prerequisites

- Python 3.11 or newer with `jsonschema` (`pip install jsonschema`). Add `pyyaml` for YAML sources and `boto3` for S3 sources.
- A Vapi account and a **private** API key. Everything up to `compile` runs without one.
- Internet access to your sources and to `api.vapi.ai`.

### Steps

1. Clone this repository. The project is `projects/vapi-build/`; the skill folder is that same folder.
2. `cp .env.example .env` and fill in `VAPI_API_KEY`. The CLI reads the key from the environment first and otherwise copies it from a file or shell profile into `~/.config/vapi-build/env` without ever printing it, so exporting it in your shell also works.
3. Install the skill for your agent (below), then start a conversation and name your material.

The CLI needs no installation: `scripts/vapi-build` sets up its own path and works from any directory. Optional `pip install -e .` installs a `vapi-build` console script.

### Claude Code

```bash
npx skills add VapiAI/vapi-labs --skill vapi-build
```

Or symlink the folder: `ln -s "$PWD/projects/vapi-build" ~/.claude/skills/vapi-build` (or into a project's `.claude/skills/`). Say `/vapi-build` in any session. Claude Code gives the skill its best environment: a structured question tool for intake, subagents to read evidence packets in parallel, a browser for the review page, and the Artifact tool for a shareable link.

### Codex

Codex discovers skills in `.agents/skills/` (repository) and `~/.agents/skills/` (user):

```bash
ln -s "$PWD/projects/vapi-build" ~/.agents/skills/vapi-build
```

Invoke it explicitly with `$vapi-build`. The bundled `agents/openai.yaml` gives Codex the display name and default prompt and turns implicit invocation off, so Codex uses the skill only when asked. Codex asks for network approval the first time `fetch`, `apply`, or `simulate` reaches the network. The same `VAPI_API_KEY` handling applies.

### Claude (claude.ai and the desktop app)

1. Zip the folder without tests and caches: `zip -r vapi-build.zip vapi-build -x 'vapi-build/tests/*' '*/__pycache__/*' '*/.pytest_cache/*' '*/.ruff_cache/*'` (run from `projects/`).
2. In Claude, open **Customize > Skills**, click **+**, then **Create skill > Upload a skill**, and upload the zip. Code execution must be enabled (Settings > Capabilities; on Team and Enterprise an owner enables it under Organization settings > Skills).
3. Network access must reach your sources and `api.vapi.ai`. Team and Enterprise organizations have egress off by default; an owner can allow package managers plus specific domains, or all domains.
4. Do not paste your key into the chat. Upload a `.env` file with `VAPI_API_KEY=...` to the conversation and the skill copies it with `secrets set --from-file`, never displaying the value.

In Claude there is no browser and nothing persists across conversations, so the skill hands you `review.html` as a file after each render and reports every created resource ID in its final message. Reruns need the key file uploaded again.

### Other agents

Any agent that follows the Agent Skills specification can install the folder with `npx skills add VapiAI/vapi-labs --skill vapi-build -a <agent>` or by copying it into that agent's skills directory. The skill degrades gracefully: without a structured question tool it asks in plain text, without subagents it reads packets sequentially, without a browser it gives you the page as a file.

## Safety defaults

- Transcripts and IVR logs require a privacy attestation (`synthetic`, `redacted`, or `raw`); raw transcripts are never shown to the model or uploaded. A pattern scan reports emails, phone numbers, card-like and SSN-like strings.
- Every OpenAPI operation starts disabled. Administrative operations are refused unless explicitly allowed; every non-read operation must be marked `confirmBeforeCall`, which the compiled prompt turns into a read-back and explicit confirmation, unless the plan states a reason to skip it (a login or PIN check) that the user sees on the review page.
- API keys and tokens are read from the environment or `~/.config/vapi-build/env` at apply time, injected into request headers only in the live request, and never written into build files, receipts, or output. A plan cannot name a platform secret, and a token equal to the Vapi key is refused.
- Simulations never reach a live write: the checker requires a mock for every write tool a scenario can reach, and running the suite needs an explicit yes because it uses Vapi credits.
- HTTPS only for remote sources, no private-network hosts, bounded page counts, object counts, and byte budgets. The review-page server binds to localhost and serves one file.

## Known limitations

- Experimental. The ontology and plan schemas, the CLI commands, and the compiled Vapi payloads will change; there is no compatibility promise between versions.
- Tested with Claude Code on macOS and Linux. Codex and claude.ai paths follow their published skill conventions but have had less exercise; report what breaks.
- The website crawler stays on one host, fetches 40 pages by default, and reads static HTML only. Sites that render content with JavaScript yield thin evidence.
- Only Markdown, text, YAML, JSON, HTML, CSV, JSONL, PDF, and DOCX sources are understood; PDF and DOCX are uploaded to the knowledge base as-is and are not read into the ontology.
- Simulations cost Vapi credits and the plan's chat tests need a key with access to the chat API.
- The review page loads D3 from cdnjs.cloudflare.com, so viewing it needs internet access; it is one large HTML file and is not designed for very small screens.
- Vapi API fields change; `apply` reports the first rejected payload and stops rather than guessing.

## Layout

```
SKILL.md                    instructions for the agent
agents/openai.yaml          Codex interface metadata
references/                 ontology, plan, and Vapi guides for the agent
scripts/vapi-build          launcher (bash; sets PYTHONPATH and runs the package)
scripts/vapi_build/         the Python CLI and JSON schemas
scripts/validate-agent-skills.py, skill_validation.py   the VapiAI/skills validator, copied verbatim
tests/                      pytest suite (fictional ferry operator, fake Vapi transport; no network)
```

## Develop

```bash
python3 -m pytest -q
python3 -m ruff check scripts/vapi_build tests
python3 scripts/validate-agent-skills.py
```

The validator is the one VapiAI/skills runs, so a passing folder here can be copied there as an experimental reference workflow.

## Built by

[Jonathan Eisenzopf](https://github.com/vapi-eisen), Vapi.

## License

MIT, see [LICENSE](LICENSE).
