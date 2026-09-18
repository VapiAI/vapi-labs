"""Visible-text extraction from static HTML. Markup is untrusted data: scripts, styles,
templates, and explicitly hidden regions never become evidence, and form values are dropped."""
from __future__ import annotations

import re
from html.parser import HTMLParser
from typing import Any

BLOCK_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "dt", "dd", "blockquote", "figcaption", "label", "legend", "th", "td", "pre"}
HIDDEN_TAGS = {"script", "style", "template", "noscript", "svg", "canvas", "head"}
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
CONTAINER_TAGS = {"body", "main", "article", "section", "div", "header", "footer", "nav", "aside", "form", "table", "ul", "ol", "tr"}
VALUE_TAGS = {"textarea", "select", "option"}
SPACE = re.compile(r"\s+")
MAX_BLOCKS = 200


def clean(value: str) -> str:
    return SPACE.sub(" ", value).strip()


class VisiblePageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, bool]] = []
        self.block_tag: str | None = None
        self.block_text: list[str] = []
        self.blocks: list[dict[str, str]] = []
        self.title_parts: list[str] = []
        self.in_title = False
        self.description = ""
        self.omitted = 0

    @property
    def hidden(self) -> bool:
        return bool(self.stack and self.stack[-1][1])

    def _flush(self) -> None:
        if self.block_tag is None:
            return
        text = clean("".join(self.block_text))
        if text:
            if len(self.blocks) < MAX_BLOCKS:
                self.blocks.append({"tag": self.block_tag, "text": text})
            else:
                self.omitted += 1
        self.block_tag, self.block_text = None, []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if any(name in {"textarea", "select"} for name, _ in self.stack):
            return
        attributes = {key.casefold(): value or "" for key, value in attrs}
        style = re.sub(r"\s+", "", attributes.get("style", "")).casefold()
        hidden_here = (tag in HIDDEN_TAGS or "hidden" in attributes or attributes.get("aria-hidden", "").casefold() == "true"
                       or "display:none" in style or "visibility:hidden" in style or tag in VALUE_TAGS
                       or (tag == "input"))
        hidden = hidden_here or self.hidden
        if tag not in VOID_TAGS:
            self.stack.append((tag, hidden))
        if tag == "title":
            self.in_title = True
            return
        if tag == "meta" and attributes.get("name", "").casefold() == "description":
            self.description = clean(attributes.get("content", ""))[:500]
            return
        if hidden:
            return
        if tag in BLOCK_TAGS:
            self._flush()
            self.block_tag = tag
        elif tag in CONTAINER_TAGS:
            self._flush()
        elif tag in {"br", "hr"} and self.block_tag is not None:
            self.block_text.append(" ")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        container = next((name for name, _ in reversed(self.stack) if name in {"textarea", "select"}), None)
        if container is not None and tag != container:
            return
        if tag in VOID_TAGS:
            return
        index = next((i for i in range(len(self.stack) - 1, -1, -1) if self.stack[i][0] == tag), None)
        if index is None:
            return
        if tag == "title":
            self.in_title = False
        if not self.hidden and (tag == self.block_tag or tag in BLOCK_TAGS or tag in CONTAINER_TAGS):
            self._flush()
        del self.stack[index:]

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_parts.append(data)
            return
        if self.hidden or any(tag == "nav" for tag, _ in self.stack):
            return
        if self.block_tag is None and data.strip():
            self.block_tag = "text"
        if self.block_tag is not None:
            self.block_text.append(data)

    def close(self) -> None:
        super().close()
        self._flush()


def extract_page(html: str) -> dict[str, Any]:
    parser = VisiblePageParser()
    parser.feed(html)
    parser.close()
    merged = parser.blocks
    return {"title": clean(" ".join(parser.title_parts))[:300], "description": parser.description, "blocks": merged, "omittedBlocks": parser.omitted}
