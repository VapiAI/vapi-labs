#!/usr/bin/env python3
"""Small dependency-free repository check."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LINK = re.compile(r"\[[^]]+\]\(([^)]+)\)")
VARIABLE = re.compile(r"\$\{([A-Z][A-Z0-9_]*)\}")
SECRETS = [
    re.compile(r"Bearer\s+[A-Za-z0-9._-]{20,}"),
    re.compile(r"https://hook\.[a-z0-9-]+\.make\.com/[A-Za-z0-9_-]{16,}", re.I),
    re.compile(r"/mcp/u/[A-Za-z0-9_-]{12,}"),
    re.compile(r"/mcp/server/[0-9a-f-]{16,}/t/[A-Za-z0-9_-]{12,}"),
    re.compile(r"Token\s+[0-9a-f]{8}-[0-9a-f-]{20,}"),
]
VALUES = {
    "MAKE_WEBHOOK_URL": "https://example.test/webhook",
    "MAKE_MCP_URL": "https://example.test/mcp",
    "VAPI_MCP_TOOL_ID": "00000000-0000-4000-8000-000000000000",
}


def main() -> int:
    errors: list[str] = []
    count = 0
    for path in sorted(ROOT.rglob("*.json")):
        if ".git" in path.parts:
            continue
        count += 1
        text = path.read_text(encoding="utf-8")
        rendered = VARIABLE.sub(lambda match: VALUES.get(match.group(1), match.group(0)), text)
        if VARIABLE.search(rendered):
            errors.append(f"undeclared template variable: {path.relative_to(ROOT)}")
            continue
        try:
            json.loads(rendered)
        except json.JSONDecodeError as exc:
            errors.append(f"invalid JSON: {path.relative_to(ROOT)}: {exc}")

    for path in sorted(ROOT.rglob("*.md")):
        if ".git" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        for target in LINK.findall(text):
            target = target.split("#", 1)[0]
            if not target or target.startswith(("https://", "http://", "mailto:")):
                continue
            if not (path.parent / target).resolve().exists():
                errors.append(f"broken link: {path.relative_to(ROOT)} → {target}")

    for path in ROOT.rglob("*"):
        if not path.is_file() or ".git" in path.parts or path.name == ".env":
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if any(pattern.search(text) for pattern in SECRETS):
            errors.append(f"possible secret: {path.relative_to(ROOT)}")

    if errors:
        print("\n".join(f"ERROR: {error}" for error in errors), file=sys.stderr)
        return 1
    print(f"PASS: {count} JSON files, local links, templates, and secrets checked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
