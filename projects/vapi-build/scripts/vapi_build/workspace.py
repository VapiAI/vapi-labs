"""Workspace layout, JSON helpers, digests, and identifiers shared by every stage."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


class BuildError(RuntimeError):
    """A stage failed closed. The message is safe to show the user."""


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(data: bytes | str) -> str:
    raw = data.encode("utf-8") if isinstance(data, str) else data
    return "sha256:" + hashlib.sha256(raw).hexdigest()


def digest_json(value: Any) -> str:
    return digest(canonical(value))


# A current mainstream browser signature. Cloudflare-fronted hosts (including api.vapi.ai)
# reject Python's default "Python-urllib/x.y" and custom bot strings with a 403 error 1010.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def slug(text: str, limit: int = 60) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", text.casefold()).strip("-")
    value = re.sub(r"-{2,}", "-", value)[:limit].strip("-")
    if not value or not value[0].isalpha():
        value = "x" + value
    return value


def read_json(path: Path) -> Any:
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise BuildError(f"Duplicate JSON key {key!r} in {path.name}.")
            result[key] = value
        return result

    try:
        return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=pairs)
    except FileNotFoundError as error:
        raise BuildError(f"Missing file: {path}") from error
    except json.JSONDecodeError as error:
        raise BuildError(f"{path.name} is not valid JSON: {error.msg} (line {error.lineno}).") from error


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=False) + "\n", encoding="utf-8")


class Workspace:
    """One project directory. Everything a run produces lives under it; nothing is written elsewhere."""

    STAGES = ("raw", "evidence", "ontology", "plan", "vapi")

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).expanduser().resolve()
        self.project_path = self.root / "project.json"
        self.project: dict[str, Any] = {}

    @classmethod
    def create(cls, root: str | Path, name: str) -> "Workspace":
        workspace = cls(root)
        if workspace.project_path.exists():
            raise BuildError(f"{workspace.root} already holds a project; choose another directory or reuse it with the other commands.")
        workspace.root.mkdir(parents=True, exist_ok=True)
        for stage in cls.STAGES:
            (workspace.root / stage).mkdir(exist_ok=True)
        workspace.project = {
            "name": name,
            "slug": slug(name, 40),
            "createdAt": utc_now(),
            "sources": [],
        }
        workspace.save()
        return workspace

    @classmethod
    def open(cls, root: str | Path) -> "Workspace":
        workspace = cls(root)
        if not workspace.project_path.exists():
            raise BuildError(f"No project.json in {workspace.root}. Run `init` first.")
        workspace.project = read_json(workspace.project_path)
        return workspace

    def save(self) -> None:
        self.project["updatedAt"] = utc_now()
        write_json(self.project_path, self.project)

    def path(self, *parts: str) -> Path:
        return self.root.joinpath(*parts)

    def sources(self, role: str | None = None) -> list[dict[str, Any]]:
        items = self.project.get("sources", [])
        return [item for item in items if role is None or item["role"] == role]
