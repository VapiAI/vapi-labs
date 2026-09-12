"""Command line for the vapi-build skill. Every command prints a short, readable result."""
from __future__ import annotations

import argparse
import importlib
import os
import sys
from pathlib import Path

from . import __version__, compile as compiler, demo as demos, extract, keyfile, ontology, plan, preview, render, sources, vapi
from .workspace import BuildError, Workspace, read_json

DEFAULT_ROOT = "~/vapi-build-projects"
LAUNCHER = Path(__file__).resolve().parents[1] / "vapi-build"


def _workspace(args) -> Workspace:
    return Workspace.open(args.workspace)


def cmd_doctor(args) -> int:
    print(f"vapi-build {__version__} · python {sys.version.split()[0]}")
    for module, hint in (("jsonschema", "required"), ("yaml", "only for YAML sources: knowledge files or an OpenAPI document in YAML"), ("boto3", "only for s3:// sources")):
        try:
            importlib.import_module(module)
            print(f"  ok   {module}")
        except ImportError:
            print(f"  MISSING {module}  (pip install {'pyyaml' if module == 'yaml' else module}); {hint}")
    _, source = vapi.find_key()
    print(f"  {'ok  ' if source else 'unset'} Vapi private key" + (f" from {source}" if source else " (export VAPI_API_KEY, or run `secrets find` then `secrets set VAPI_API_KEY --from-env NAME --verify`; needed only for apply/test/simulate/teardown)"))
    aws = any(os.environ.get(k) for k in ("AWS_PROFILE", "AWS_ACCESS_KEY_ID")) or Path("~/.aws/credentials").expanduser().exists() or Path("~/.aws/config").expanduser().exists()
    print(f"  {'ok  ' if aws else 'unset'} AWS credentials (needed only for s3:// sources)")
    return 0


def cmd_init(args) -> int:
    if args.demo:
        demo = demos.get(args.demo)
        name = args.name or demo["name"]
        root = args.workspace or str(Path(DEFAULT_ROOT).expanduser() / f"demo-{demo['id']}")
        workspace = Workspace.create(root, name)
        registered = demos.register(workspace, demo["id"])
        print(f"Created demo project “{name}” at {workspace.root} and registered {len(registered)} sources; nothing else may be added to it.")
        print(demos.card(demo))
        print("Next: `fetch`, then `extract`. Use the demo customers above in simulations and chat tests; tell the user these are published synthetic credentials.")
        return 0
    if not args.name:
        raise BuildError("Give the project a name, or use --demo <id> to build from a sample dataset (`demo list`).")
    root = args.workspace or str(Path(DEFAULT_ROOT).expanduser() / _slug(args.name))
    workspace = Workspace.create(root, args.name)
    if args.aws_profile:
        workspace.project["awsProfile"] = args.aws_profile
        workspace.save()
    print(f"Created project “{args.name}” at {workspace.root}")
    print("Next: register sources with `add`, then `fetch`.")
    return 0


def cmd_demo(args) -> int:
    if args.action == "list":
        for demo in demos.DEMOS.values():
            print(f"  {demo['id']}: {demo['name']} — {demo['summary'].split('.')[0]}.")
        print("Start one with `init --demo <id>`.")
        return 0
    print(demos.card(demos.get(args.demo_id)))
    return 0


def _slug(name: str) -> str:
    from .workspace import slug

    return slug(name, 40)


def cmd_add(args) -> int:
    workspace = _workspace(args)
    options = {"maxPages": args.max_pages, "sample": args.sample, "seed": args.seed, "scanMb": args.scan_mb, "serverUrl": args.server_url,
               "allowedHosts": args.allowed_host or None}
    record = sources.add_source(workspace, args.role, args.location, privacy=args.privacy, authority=args.authority, **options)
    print(f"Registered {record['id']} ({record['role']}, authority {record['authority']}): {record['location']}")
    return 0


def cmd_fetch(args) -> int:
    workspace = _workspace(args)
    for inventory in sources.fetch_all(workspace, only=args.only):
        if inventory.get("error"):
            print(f"{inventory['source']}: FAILED — {inventory['error']}")
            continue
        print(f"{inventory['source']}: {inventory['itemCount']} items, {inventory['byteCount']:,} bytes")
        if inventory.get("sampling"):
            s = inventory["sampling"]
            print(f"  sampled {s['sampled']} of {s['candidatesSeen']} conversations seen (seed {s['seed']}{', scan truncated' if s['scanTruncated'] else ''})")
            scan = inventory["piiScan"]
            print(f"  privacy attestation: {inventory['privacy']}; pattern scan flagged {scan['conversationsWithHits']} conversations {scan['patternHits']}")
        if inventory.get("serverUrl"):
            print(f"  tools will call: {inventory['serverUrl']}")
        for note in inventory.get("notes", [])[:8]:
            print(f"  note: {note}")
    return 0


def cmd_extract(args) -> int:
    workspace = _workspace(args)
    summary = extract.extract_all(workspace, batch_size=args.batch_size)
    print(f"{summary['segments']} segments, {summary['evidence']} evidence spans, {summary['operations']} API operations, {summary['gaps']} gaps")
    for source_id, info in summary["bySource"].items():
        print(f"  {source_id}: {info['items']} items → {info['segments']} segments")
    print(f"Read these packets in order, then write {workspace.path('ontology', 'ontology.json')}:")
    for packet in summary["packetFiles"]:
        print(f"  {workspace.path(packet)}")
    if summary["gaps"]:
        print(f"Gaps are listed in {workspace.path('evidence', 'ledger.json')} under `gaps`.")
    for note in summary.get("oversizedPackets", []):
        print(f"  note: {note}")
    return 0


def _print_report(report: dict, workspace: Workspace) -> int:
    print(f"{report['stage']} check: {report['status']}")
    for key, value in report.get("counts", {}).items():
        if value:
            print(f"  {key}: {value}")
    for error in report["errors"]:
        print(f"  ERROR {error}")
    for warning in report["warnings"]:
        print(f"  warn  {warning}")
    if report["stage"] == "plan" and report.get("enabledOperations"):
        print("  operations the agent will be able to call:")
        for operation in report["enabledOperations"]:
            print(f"    - {operation}")
    if report["status"] == "CANDIDATE":
        print(f"  digest {report['digest']}")
        if report["stage"] == "ontology":
            print(f"Next: write {workspace.path('plan', 'plan.json')} and run `check plan`; the review page shows both.")
        else:
            print("Next: `render`, then `open`, and ask the user for their yes; `approve plan` records it for the ontology and the plan together.")
    return 0 if report["status"] == "CANDIDATE" else 1


def cmd_check(args) -> int:
    workspace = _workspace(args)
    report = ontology.check_ontology(workspace, strict=args.strict) if args.stage == "ontology" else plan.check_plan(workspace)
    return _print_report(report, workspace)


def cmd_summarize(args) -> int:
    workspace = _workspace(args)
    if args.stage == "ontology":
        text = ontology.summarize(ontology.load_candidate(workspace))
    else:
        text = plan.summarize(plan.load_candidate(workspace), ontology.load_candidate(workspace))
    print(text)
    return 0


def cmd_render(args) -> int:
    workspace = Workspace.open(args.args[-1])  # `render <ws>`; `render ontology|plan <ws>` still accepted
    path = render.render_review(workspace)
    live = preview.status(workspace)
    print(f"Wrote {path}")
    if live and live.get("viewerOpen"):
        print("The review page is open in the browser and refreshes itself; no need to open it again.")
    else:
        print("Run `open <workspace>` to show it (it refreshes itself on later renders); publish it with the Artifact tool when a shareable link is wanted.")
    return 0


def cmd_open(args) -> int:
    import webbrowser

    target = str(args.target)
    if target.startswith("https://"):
        opened = webbrowser.open(target, new=2)
        print(f"Opened {target} in the default browser." if opened else f"Could not open a browser; give the user the link: {target}")
        return 0
    result = preview.open_review(Workspace.open(target))
    if result["action"] == "refreshed":
        print(f"Already open at {result['url']} and refreshed itself; nothing launched.")
    elif result["action"] == "opened":
        print(f"Opened {result['url']} in the default browser. It refreshes itself after every `render`.")
    else:
        print(f"Could not open a browser; give the user the link: {result['url']}")
    return 0


def cmd_preview(args) -> int:
    workspace = Workspace.open(args.workspace)
    if args.action == "serve":
        preview.serve_forever(workspace.root, args.port)
        return 0
    if args.action == "stop":
        print("Stopped the preview server." if preview.stop(workspace) else "No preview server was running.")
        return 0
    live = preview.status(workspace)
    if not live:
        print("No preview server is running for this workspace.")
        return 1
    print(f"Serving {live['url']} (pid {live['pid']}); viewer {'open' if live['viewerOpen'] else 'closed'}"
          + (f", last poll {live['lastPollSecondsAgo']}s ago" if live.get("lastPollSecondsAgo") is not None else ""))
    return 0


def cmd_approve(args) -> int:
    workspace = _workspace(args)
    approval = ontology.approve_ontology(workspace, by=args.by) if args.stage == "ontology" else plan.approve_plan(workspace, by=args.by)
    print(f"Approved {approval['stage']} {approval['digest']} by {approval['by']} at {approval['at']}")
    if approval["stage"] == "plan":
        if approval.get("ontologyApprovedHere"):
            print(f"Also approved the ontology {approval['ontologyDigest']} it was checked against (one review page, one yes).")
        print("Next: `compile`, then `render` so the Build tab fills in, and ask for the go-ahead before `apply --yes`.")
    else:
        print(f"Next: write {workspace.path('plan', 'plan.json')} and run `check plan`.")
    return 0


def cmd_compile(args) -> int:
    workspace = _workspace(args)
    build = compiler.compile_build(workspace)
    print(compiler.render_build_summary(build))
    needed = sorted({header["env"] for tool in build["tools"] for header in tool.get("secretHeaders", [])})
    if needed:
        saved = {**vapi.demo_secrets(workspace), **vapi.load_env_file()}
        for name in needed:
            print(f"  token {name}: {'present in' if saved.get(name) else 'MISSING from'} {vapi.KEY_FILE}")
        if any(not saved.get(name) for name in needed):
            print("  Copy each missing token with `secrets set NAME --from-env NAME` (or --from-file) before `apply`.")
    print(f"Payloads: {workspace.path('vapi', 'build.json')}. Next: `render` and `open` so the Build tab shows this.")
    return 0


def cmd_apply(args) -> int:
    workspace = _workspace(args)
    if not args.yes:
        print("apply creates resources in the Vapi organization that owns VAPI_API_KEY. Re-run with --yes after the user confirms.")
        return 1
    client = vapi.client_from_env()
    receipts = vapi.apply(workspace, client)
    kb = receipts["knowledgeBase"]
    if kb.get("mode") == "query":
        print(f"Applied. knowledge: query tool {kb.get('toolId')} over {len(kb.get('attached', []))} files (organization has no Knowledge Bases V2)")
        if kb.get("failedFiles"):
            print(f"  warn  Vapi marks {len(kb['failedFiles'])} file(s) failed; the query tool's provider indexes them itself, so check a knowledge question in `test`.")
    else:
        print(f"Applied. knowledge base {kb.get('id')} (search tool {kb.get('toolId')})")
    for ref, identifier in receipts["tools"].items():
        print(f"  {ref} → {identifier}")
    for ref, identifier in receipts.get("structuredOutputs", {}).items():
        print(f"  {ref} → {identifier}")
    for ref, identifier in receipts["assistants"].items():
        print(f"  {ref} → {identifier}")
    if receipts["squad"].get("id"):
        print(f"  squad → {receipts['squad']['id']}")
    sims = receipts.get("simulations", {})
    if sims.get("suite", {}).get("id"):
        print(f"  simulation suite → {sims['suite']['id']} ({len(sims.get('simulations', {}))} simulations)")
    print("Verified every resource by reading it back. Next: `test` (chat scenarios) and `simulate --yes` (Vapi simulation suite), then `render`.")
    return 0


def cmd_merge(args) -> int:
    workspace = _workspace(args)
    report = ontology.merge_fragments(workspace)
    print(f"merge: {report['status']} from {len(report['fragments'])} fragments")
    for error in report.get("errors", []):
        print(f"  ERROR {error}")
    for key, value in report.get("counts", {}).items():
        if value:
            print(f"  {key}: {value}")
    for duplicate in report.get("possibleDuplicates", []):
        print(f"  same label, different ids → merge or distinguish: {duplicate}")
    for warning in report.get("warnings", []):
        print(f"  warn  {warning}")
    if report["status"] == "MERGED":
        print(f"Wrote {workspace.path('ontology', 'ontology.json')}. Next: review duplicates, then `check ontology`.")
    return 0 if report["status"] == "MERGED" else 1


def _require_applied(workspace: Workspace) -> None:
    if not vapi.load_receipts(workspace):
        raise BuildError("Nothing has been applied yet. Run `apply --yes` first.")


def cmd_test(args) -> int:
    workspace = _workspace(args)
    _require_applied(workspace)
    report = vapi.run_tests(workspace, vapi.client_from_env())
    if not report["results"]:
        print("The plan declares no tests; nothing to run. Talk to the assistant in the Vapi dashboard instead.")
        return 0
    print(vapi.render_test_report(report))
    print(f"Saved {workspace.path('vapi', 'test-results.json')}. Judge each transcript against its expectations and report the verdicts.")
    return 0


def cmd_simulate(args) -> int:
    workspace = _workspace(args)
    _require_applied(workspace)
    if not args.yes:
        print("simulate runs the Vapi simulation suite against the applied agent; it uses credits and concurrency, and unmocked tools call the live API. Re-run with --yes after the user confirms.")
        return 1
    report = vapi.run_simulations(workspace, vapi.client_from_env(), iterations=args.iterations)
    print(vapi.render_simulation_report(report))
    failed = [r for r in report["results"] if r.get("passed") is False]
    print(f"Saved {workspace.path('vapi', 'simulation-results.json')}: {len(report['results']) - len(failed)} passed, {len(failed)} failed. Run `render` so the Build tab shows the results.")
    return 0 if not failed else 1


def cmd_secrets(args) -> int:
    if args.action == "set":
        if args.from_env:
            result = keyfile.set_from_env(args.name, args.from_env)
        elif args.from_file:
            result = keyfile.set_from_file(args.name, args.from_file, args.var)
        elif args.from_profile:
            result = keyfile.set_from_profile(args.name, args.from_profile)
        else:
            raise BuildError("Say where to copy the value from: --from-env NAME, --from-file PATH [--var NAME], or --from-profile ALIAS.")
        print(f"Saved {result['name']} ({result['length']} characters) from {result['source']} into {vapi.KEY_FILE}.")
        if args.verify and args.name in vapi.KEY_VARIABLES:
            check = keyfile.verify_key(vapi.client_from_env())
            print("Verified with Vapi: key works" + (f", organization {check['orgId']}" if check.get("orgId") else "") + ".")
        return 0
    if args.action == "init":
        result = keyfile.init_placeholders(args.names or ["VAPI_API_KEY"])
        print(f"{result['path']}: present {', '.join(result['present']) or 'none'}; placeholders added for {', '.join(result['placeholders']) or 'none'}.")
        if result["placeholders"]:
            print("Ask the user to open that file and paste each value after its `=`; never paste values into the chat.")
        return 0
    if args.action == "find":
        candidates = keyfile.find_candidates()
        if not candidates:
            print("No file or shell profile on this machine declares a VAPI_* key or token.")
            print(f"Fallback: in a terminal, run `{LAUNCHER} secrets prompt VAPI_API_KEY` and paste the key at the hidden prompt.")
            return 1
        for candidate in candidates:
            hint = "--from-env NAME" if candidate["kind"] == "shell profile" else f"--from-file {candidate['path']} --var NAME"
            print(f"  {candidate['path']}: {', '.join(candidate['variables'])}  [{candidate['kind']}] → secrets set VAPI_API_KEY {hint} --verify")
        print("Ask the user which variable holds the private key (not the public key), then run the matching command.")
        return 0
    if args.action == "prompt":
        result = keyfile.prompt_and_save(args.name)
        print(f"Saved {result['name']} ({result['length']} characters) from a hidden prompt into {vapi.KEY_FILE}.")
        return 0
    if args.action == "verify":
        check = keyfile.verify_key(vapi.client_from_env())
        print("Vapi key works" + (f"; organization {check['orgId']}" if check.get("orgId") else "") + f"; {check['assistantsVisible']} assistant(s) visible in the first page.")
        return 0
    result = keyfile.status(args.names or None)
    print(f"{result['path']} ({'exists' if result['exists'] else 'missing'}): present {', '.join(result['present']) or 'none'}; missing {', '.join(result['missing']) or 'none'}.")
    return 0


def cmd_verify(args) -> int:
    workspace = _workspace(args)
    _require_applied(workspace)
    for line in vapi.verify(workspace, vapi.client_from_env()):
        print(f"  ok {line}")
    return 0


def cmd_status(args) -> int:
    workspace = _workspace(args)
    print(f"Project “{workspace.project['name']}” at {workspace.root}" + (f" · DEMO {workspace.project['demo']} (synthetic data only)" if workspace.project.get("demo") else ""))
    for source in workspace.sources():
        fetched = source.get("fetched")
        print(f"  {source['id']}: {source['location']}" + (f" · fetched {fetched['itemCount']} items" if fetched else " · not fetched"))
    for stage in ("ontology", "plan"):
        check = workspace.path(stage, "check.json")
        approval = workspace.path(stage, "approval.json")
        state = "approved" if approval.exists() else read_json(check)["status"] if check.exists() else "not checked"
        print(f"  {stage}: {state}")
    build_path = workspace.path("vapi", "build.json")
    plan_approval = workspace.path("plan", "approval.json")
    if build_path.exists() and plan_approval.exists():
        stale = read_json(build_path).get("planDigest") != read_json(plan_approval).get("digest")
        print(f"  build: {'STALE (plan changed; run compile)' if stale else 'compiled'}")
    else:
        print(f"  build: {'compiled' if build_path.exists() else 'not compiled'}")
    receipts = vapi.load_receipts(workspace)
    if receipts:
        sims = receipts.get("simulations", {})
        print(f"  applied: kb {receipts['knowledgeBase'].get('id') or receipts['knowledgeBase'].get('toolId')}, {len(receipts['tools'])} tools, {len(receipts.get('structuredOutputs', {}))} structured outputs, "
              f"{len(receipts['assistants'])} assistants, {len(sims.get('simulations', {}))} simulations, verified={receipts['verified']}")
    else:
        print("  applied: no")
    review = workspace.path(render.PAGE)
    live = preview.status(workspace)
    print(f"  review page: {'rendered' if review.exists() else 'not rendered'}" + (f", served at {live['url']} ({'open' if live['viewerOpen'] else 'no viewer'})" if live else ""))
    return 0


def cmd_teardown(args) -> int:
    workspace = _workspace(args)
    _require_applied(workspace)
    if not args.yes:
        print("teardown deletes every Vapi resource listed in vapi/receipts.json. Re-run with --yes after the user confirms.")
        return 1
    removed = vapi.teardown(workspace, vapi.client_from_env())
    for line in removed:
        print(f"  removed {line}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="vapi-build", description="Evidence → ontology → plan → Vapi agent with structured outputs and simulations.")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("doctor", help="check local prerequisites").set_defaults(func=cmd_doctor)

    p = sub.add_parser("init", help="create a project workspace (or a demo workspace with every sample source registered)")
    p.add_argument("name", nargs="?")
    p.add_argument("--workspace", help=f"directory for this project (default {DEFAULT_ROOT}/<slug>)")
    p.add_argument("--aws-profile")
    p.add_argument("--demo", metavar="ID", help="build from a sample dataset instead of the user's material; see `demo list`")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("demo", help="sample datasets: list, or show one (sources, auth, published synthetic credentials)")
    p.add_argument("action", choices=("list", "show"))
    p.add_argument("demo_id", nargs="?", default="standard-charter")
    p.set_defaults(func=cmd_demo)

    p = sub.add_parser("add", help="register raw material: website | knowledge | transcripts | openapi")
    p.add_argument("workspace")
    p.add_argument("role", choices=sources.ROLES)
    p.add_argument("location", help="https URL, local file or directory, or s3://bucket/prefix")
    p.add_argument("--authority", choices=("AUTHORITATIVE", "SUPPORTING"), help="knowledge/website only")
    p.add_argument("--privacy", choices=sources.PRIVACY, help="transcripts (call transcripts or speech IVR logs) only: synthetic, redacted, or raw (raw is never shown to the model)")
    p.add_argument("--max-pages", type=int, default=40, help="website crawl limit")
    p.add_argument("--allowed-host", action="append", help="extra hostnames the website crawl may follow")
    p.add_argument("--sample", type=int, default=40, help="transcripts: conversations to sample")
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--scan-mb", type=int, default=64, help="transcripts: megabytes of a large CSV to scan before sampling")
    p.add_argument("--server-url", help="openapi: base URL the agent's tools will call")
    p.set_defaults(func=cmd_add)

    p = sub.add_parser("fetch", help="download or crawl every registered source")
    p.add_argument("workspace")
    p.add_argument("--only", help="a source id or role")
    p.set_defaults(func=cmd_fetch)

    p = sub.add_parser("extract", help="build the evidence ledger and reading packets")
    p.add_argument("workspace")
    p.add_argument("--batch-size", type=int, default=10, help="conversations per transcript segment")
    p.set_defaults(func=cmd_extract)

    for name, func in (("check", cmd_check), ("summarize", cmd_summarize), ("approve", cmd_approve)):
        p = sub.add_parser(name, help={"check": "validate the candidate", "summarize": "plain-text summary", "approve": "record the user's yes (approve plan covers the ontology too)"}[name])
        p.add_argument("stage", choices=("ontology", "plan"))
        p.add_argument("workspace")
        if name == "check":
            p.add_argument("--strict", action="store_true", help="fail when segments are neither cited nor declared uncovered")
        if name == "approve":
            p.add_argument("--by", help="who approved (defaults to git user.email)")
        p.set_defaults(func=func)

    p = sub.add_parser("render", help="write <workspace>/review.html: Ontology, Plan, and Build tabs with graph, browse, and evidence")
    p.add_argument("args", nargs="+", metavar="workspace", help="the workspace (a leading `ontology` or `plan` word is ignored)")
    p.set_defaults(func=cmd_render)

    p = sub.add_parser("open", help="show the review page once; an open tab refreshes itself, so this never opens a second copy")
    p.add_argument("target", help="the workspace, or an https link (for example a published Artifact)")
    p.set_defaults(func=cmd_open)

    p = sub.add_parser("preview", help="the local review-page server: status | stop | serve")
    p.add_argument("action", choices=("status", "stop", "serve"))
    p.add_argument("workspace")
    p.add_argument("--port", type=int, default=0)
    p.set_defaults(func=cmd_preview)

    p = sub.add_parser("secrets", help="copy the Vapi key or a tool token into ~/.config/vapi-build/env without showing it")
    actions = p.add_subparsers(dest="action", required=True)
    a = actions.add_parser("set", help="copy one value from an environment variable, a file, or a Vapi GTM profile")
    a.add_argument("name", help="variable name to save, e.g. VAPI_API_KEY or SC_SERVICE_TOKEN")
    a.add_argument("--from-env", metavar="NAME", help="environment variable that holds the value")
    a.add_argument("--from-file", metavar="PATH", help="a NAME=value file or a single-line secret file")
    a.add_argument("--var", metavar="NAME", help="with --from-file: the variable to copy when the file holds several")
    a.add_argument("--from-profile", metavar="ALIAS", help="~/.config/agent-strategist/vapi-profiles.yaml alias")
    a.add_argument("--verify", action="store_true", help="after saving a Vapi key, make one read-only call to confirm it works")
    a.set_defaults(func=cmd_secrets)
    a = actions.add_parser("init", help="create the file with empty lines for the given names")
    a.add_argument("names", nargs="*")
    a.set_defaults(func=cmd_secrets)
    a = actions.add_parser("list", help="which names are present or missing (never values)")
    a.add_argument("names", nargs="*")
    a.set_defaults(func=cmd_secrets)
    a = actions.add_parser("verify", help="confirm the saved Vapi key works with one read-only call")
    a.set_defaults(func=cmd_secrets)
    a = actions.add_parser("find", help="list files and shell profiles on this machine that declare a VAPI_* key (names only)")
    a.set_defaults(func=cmd_secrets)
    a = actions.add_parser("prompt", help="interactive: paste a value at a hidden terminal prompt and save it")
    a.add_argument("name")
    a.set_defaults(func=cmd_secrets)

    p = sub.add_parser("merge", help="combine ontology/fragments/*.json into ontology/ontology.json")
    p.add_argument("workspace")
    p.set_defaults(func=cmd_merge)

    p = sub.add_parser("test", help="run the plan's chat test scenarios against the applied agent")
    p.add_argument("workspace")
    p.set_defaults(func=cmd_test)

    p = sub.add_parser("simulate", help="run the applied Vapi simulation suite and report every evaluation")
    p.add_argument("workspace")
    p.add_argument("--yes", action="store_true")
    p.add_argument("--iterations", type=int, default=1)
    p.set_defaults(func=cmd_simulate)

    p = sub.add_parser("compile", help="write Vapi payloads and knowledge files from the approved plan")
    p.add_argument("workspace")
    p.set_defaults(func=cmd_compile)

    for name, func, text in (("apply", cmd_apply, "create the Vapi resources"), ("teardown", cmd_teardown, "delete the Vapi resources this project created")):
        p = sub.add_parser(name, help=text)
        p.add_argument("workspace")
        p.add_argument("--yes", action="store_true")
        p.set_defaults(func=func)

    for name, func, text in (("verify", cmd_verify, "read back every applied resource"), ("status", cmd_status, "show where the project stands")):
        p = sub.add_parser(name, help=text)
        p.add_argument("workspace")
        p.set_defaults(func=func)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except BuildError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        return 130
