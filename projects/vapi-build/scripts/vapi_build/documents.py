"""Deterministic sectioning for Markdown, YAML, JSON, and plain text knowledge documents."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from .workspace import BuildError

HEADING = re.compile(r"^ {0,3}(#{1,6})[\t ]+(.+?)(?:[\t ]+#+)?[\t ]*$")
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
LINK = re.compile(r"\[([^\]]+)\]\(([^\)]+)\)")
EMPHASIS = re.compile(r"(?<!\w)(\*{1,2}|_{1,2})(?=\S)(.+?)(?<=\S)\1(?!\w)", re.DOTALL)


@dataclass(frozen=True)
class Section:
    title: str
    text: str
    locator: str


def plain_text(value: str) -> str:
    value = LINK.sub(r"\1 (\2)", value)
    parts = re.split(r"(`+[^`]*`+)", value)
    value = "".join(part.strip("`") if index % 2 else EMPHASIS.sub(r"\2", part) for index, part in enumerate(parts))
    value = re.sub(r"^\s*[-+*]\s+", "- ", value, flags=re.MULTILINE)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def _front_matter(lines: list[str]) -> tuple[dict[str, Any], int]:
    if not lines or lines[0].strip() != "---":
        return {}, 0
    for index in range(1, min(len(lines), 200)):
        if lines[index].strip() == "---":
            import yaml

            try:
                parsed = yaml.safe_load("\n".join(lines[1:index])) or {}
            except yaml.YAMLError:
                parsed = {}
            return (parsed if isinstance(parsed, dict) else {}), index + 1
    return {}, 0


def markdown_sections(text: str) -> tuple[dict[str, Any], list[Section]]:
    lines = text.splitlines()
    metadata, start = _front_matter(lines)
    headings: list[tuple[int, int, str]] = []
    fence = None
    for index in range(start, len(lines)):
        marker = FENCE.match(lines[index])
        if fence:
            if marker and marker[1][0] == fence[0] and len(marker[1]) >= len(fence) and not marker[2].strip():
                fence = None
            continue
        if marker:
            fence = marker[1]
            continue
        match = HEADING.match(lines[index])
        if match:
            headings.append((index, len(match.group(1)), match.group(2).strip()))
    sections: list[Section] = []
    prelude_end = headings[0][0] if headings else len(lines)
    prelude = plain_text("\n".join(lines[start:prelude_end]))
    if prelude:
        sections.append(Section(str(metadata.get("title") or "Introduction"), prelude, f"lines:{start + 1}-{prelude_end}"))
    parents: list[tuple[int, str]] = []
    for position, (line, level, title) in enumerate(headings):
        while parents and parents[-1][0] >= level:
            parents.pop()
        end = headings[position + 1][0] if position + 1 < len(headings) else len(lines)
        body = plain_text("\n".join(lines[line + 1:end]))
        crumbs = [label for _, label in parents] + [title]
        parents.append((level, title))
        if not body:
            continue
        sections.append(Section(" › ".join(crumbs), body, f"lines:{line + 1}-{end}"))
    return metadata, sections


def yaml_sections(text: str) -> list[Section]:
    import yaml

    try:
        parsed = yaml.safe_load(text)
    except yaml.YAMLError as error:
        raise BuildError(f"YAML document is invalid: {error}") from error
    if isinstance(parsed, dict) and parsed and all(isinstance(key, str) for key in parsed):
        return [Section(str(key), yaml.safe_dump(value, sort_keys=False, allow_unicode=True).strip(), "/" + str(key).replace("~", "~0").replace("/", "~1"))
                for key, value in parsed.items()]
    return [Section("Document", yaml.safe_dump(parsed, sort_keys=False, allow_unicode=True).strip(), "")]


def json_sections(text: str) -> list[Section]:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as error:
        raise BuildError(f"JSON document is invalid: {error.msg}") from error
    if isinstance(parsed, dict) and parsed:
        return [Section(str(key), json.dumps(value, indent=2, ensure_ascii=False), "/" + str(key).replace("~", "~0").replace("/", "~1")) for key, value in parsed.items()]
    return [Section("Document", json.dumps(parsed, indent=2, ensure_ascii=False), "")]


def text_sections(text: str) -> list[Section]:
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    sections, buffer, start = [], [], 1
    for paragraph in paragraphs:
        buffer.append(paragraph)
        if sum(len(p) for p in buffer) >= 600:
            sections.append(Section(f"Paragraphs {start}-{start + len(buffer) - 1}", "\n\n".join(buffer), f"paragraphs:{start}-{start + len(buffer) - 1}"))
            start += len(buffer)
            buffer = []
    if buffer:
        sections.append(Section(f"Paragraphs {start}-{start + len(buffer) - 1}", "\n\n".join(buffer), f"paragraphs:{start}-{start + len(buffer) - 1}"))
    return sections


def sections_for(kind: str, data: bytes) -> tuple[str, list[Section]]:
    """Return (document title, sections) for a supported text kind; raise for unsupported kinds."""
    text = data.decode("utf-8-sig", errors="replace")
    if kind == "markdown":
        metadata, sections = markdown_sections(text)
        title = str(metadata.get("title") or next((line.lstrip("# ").strip() for line in text.splitlines() if line.startswith("#")), ""))
        return title, sections
    if kind == "yaml":
        return "", yaml_sections(text)
    if kind == "json":
        return "", json_sections(text)
    if kind in {"text", "csv"}:
        return "", text_sections(text)
    raise BuildError(f"No deterministic extractor for {kind} documents.")
