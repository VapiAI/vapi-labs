"""Sample and normalize call transcripts from whatever shape they arrive in.

Supported shapes: a CSV with one conversation per row (including a nested-CSV transcript
column), a CSV of utterance rows grouped by a conversation id, JSON or JSONL objects with a
turns/messages/utterances array or a transcript string, and plain text files (one
conversation each). Speech IVR logs arrive as the second shape without a speaker column: one
recognized caller utterance per row with the prompt or menu it answered and the recognition
result. They are grouped by call, every row is the caller, and the prompt and a no-match or
no-input result are kept in the turn text, so what callers said to the IVR (and what it failed
to understand) becomes observation and simulation material like any other transcript. Large CSV objects are streamed up to a byte budget and sampled with a
seeded reservoir, so a multi-gigabyte corpus costs a bounded download.
"""
from __future__ import annotations

import codecs
import csv
import io
import itertools
import json
import random
import re
from typing import Any, Callable, Iterable, Iterator

from .workspace import BuildError

SPEAKER_COLUMNS = ("speaker", "role", "party", "speaker_role", "speaker_name", "from")
TEXT_COLUMNS = ("text", "content", "utterance", "message", "transcript", "body",
                # speech IVR recognition logs
                "asr_text", "recognized_text", "recognition_text", "recognized_utterance", "transcription", "caller_said", "input_text", "user_input")
ID_COLUMNS = ("conversation_id", "call_id", "conversationid", "callid", "session_id", "id", "transcript_id", "interaction_id", "call_uuid", "ucid")
# IVR-only columns: which prompt or menu the caller was answering, and whether the recognizer understood them.
PROMPT_COLUMNS = ("prompt", "prompt_name", "menu", "menu_name", "state", "dialog_state", "node", "step", "grammar", "application_state")
RESULT_COLUMNS = ("result", "recognition_result", "recognition_status", "reco_result", "outcome", "status", "event")
NOT_RECOGNIZED = re.compile(r"no.?match|no.?input|no.?reco|reject|fail|timeout|silence|max.?(retries|attempts)", re.IGNORECASE)
csv.field_size_limit(64 * 1024 * 1024)

Conversation = dict[str, Any]


class _Lines:
    """Yield decoded lines from a byte stream while counting bytes; stops at a byte budget."""

    def __init__(self, reader: Any, limit: int) -> None:
        self.reader, self.limit, self.read_bytes, self.truncated = reader, limit, 0, False
        self.decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        self.buffer = ""

    def __iter__(self) -> Iterator[str]:
        while True:
            remaining = self.limit - self.read_bytes
            if remaining <= 0:
                # Budget spent: truncated only if the source actually has more bytes.
                self.truncated = bool(self.reader.read(1))
                break
            chunk = self.reader.read(min(1024 * 1024, remaining))
            if not chunk:
                break
            self.read_bytes += len(chunk)
            self.buffer += self.decoder.decode(chunk)
            lines = self.buffer.split("\n")
            self.buffer = lines.pop()
            for line in lines:
                yield line + "\n"
        self.buffer += self.decoder.decode(b"", final=True)
        if self.buffer and not self.truncated:
            yield self.buffer
        self.buffer = ""


def _pick(header: Iterable[str], candidates: Iterable[str]) -> str | None:
    lowered = {h.casefold().strip(): h for h in header}
    for name in candidates:
        if name in lowered:
            return lowered[name]
    return None


def _nested_csv_column(row: dict[str, str]) -> str | None:
    for key, value in row.items():
        if not isinstance(value, str) or "\n" not in value:
            continue
        first = value.split("\n", 1)[0].casefold()
        if any(s in first for s in SPEAKER_COLUMNS) and any(t in first for t in TEXT_COLUMNS):
            return key
    return None


def _turns_from_rows(rows: list[dict[str, str]], speaker_col: str | None, text_col: str, *, prompt_col: str | None = None, result_col: str | None = None,
                     default_speaker: str = "unknown") -> list[dict[str, str]]:
    turns = []
    for row in rows:
        result = (row.get(result_col) or "").strip() if result_col else ""
        if prompt_col or result_col:
            # IVR rows: keep the prompt the caller answered and flag what the recognizer rejected; a no-input row is a silent turn.
            text = (row.get(text_col) or "").strip()
            if not text and result and NOT_RECOGNIZED.search(result):
                text = "(no speech)"
            if text:
                prompt = (row.get(prompt_col) or "").strip() if prompt_col else ""
                flag = f" (IVR result: {result})" if result and NOT_RECOGNIZED.search(result) else ""
                turns.append({"speaker": (row.get(speaker_col) or default_speaker).strip() if speaker_col else default_speaker, "text": f"[{prompt}] {text}{flag}" if prompt else f"{text}{flag}"})
            continue
        text = (row.get(text_col) or "").strip()
        if not text:
            continue
        turns.append({"speaker": (row.get(speaker_col) or default_speaker).strip() if speaker_col else default_speaker, "text": text})
    return turns


def conversation_from_row(row: dict[str, str], locator: str, index: int) -> Conversation | None:
    nested = _nested_csv_column(row)
    id_col = _pick(row.keys(), ID_COLUMNS)
    conversation_id = str(row.get(id_col) or index) if id_col else str(index)
    fields = {k: v for k, v in row.items() if k != nested and isinstance(v, str) and v and len(v) <= 200}
    if nested:
        inner = list(csv.DictReader(io.StringIO(row[nested])))
        if not inner:
            return None
        speaker_col, text_col = _pick(inner[0].keys(), SPEAKER_COLUMNS), _pick(inner[0].keys(), TEXT_COLUMNS)
        if not text_col:
            return None
        turns = _turns_from_rows(inner, speaker_col, text_col)
    else:
        text_col = _pick(row.keys(), TEXT_COLUMNS)
        if text_col and row.get(text_col):
            turns = [{"speaker": (row.get(_pick(row.keys(), SPEAKER_COLUMNS) or "") or "unknown"), "text": row[text_col].strip()}]
        else:
            turns = [{"speaker": "record", "text": "\n".join(f"{k}: {v}" for k, v in row.items() if v)}]
    if not turns:
        return None
    return {"id": conversation_id, "locator": locator, "turns": turns, "fields": fields}


ROLE_SPEAKERS = ("speaker", "role", "party", "speaker_role", "speaker_name")


def _complete_only(items: Iterator[Conversation], lines: Any) -> Iterator[Conversation]:
    """Hold back one conversation so a scan cut off by the byte budget never yields a partial last one."""
    pending = None
    for item in items:
        if pending is not None:
            yield pending
        pending = item
    if pending is not None and not getattr(lines, "truncated", False):
        yield pending


def conversations_from_csv(lines: Iterable[str], locator: str) -> Iterator[Conversation]:
    reader = csv.DictReader(lines)
    rows = iter(reader)
    first = next(rows, None)
    if first is None:
        return
    header = reader.fieldnames or []
    all_rows = itertools.chain([first], rows)
    nested = _nested_csv_column(first)
    speaker_col = _pick(header, ROLE_SPEAKERS) or (_pick(header, ("from",)) if not _pick(header, ("to",)) else None)
    text_col, id_col = _pick(header, TEXT_COLUMNS), _pick(header, ID_COLUMNS)
    single_line_text = bool(text_col and "\n" not in (first.get(text_col) or ""))
    prompt_col, result_col = _pick(header, PROMPT_COLUMNS), _pick(header, RESULT_COLUMNS)
    ivr = nested is None and text_col and id_col and not speaker_col and (prompt_col or result_col)
    if nested is None and text_col and id_col and (speaker_col or ivr) and single_line_text:
        skip = {text_col, speaker_col, id_col, prompt_col, result_col}

        def conversation(current_id: str, buffered: list[dict[str, str]]) -> Conversation:
            turns = _turns_from_rows(buffered, speaker_col, text_col, prompt_col=prompt_col if ivr else None, result_col=result_col if ivr else None,
                                     default_speaker="caller" if ivr else "unknown")
            fields = {k: v for k, v in buffered[0].items() if k not in skip and isinstance(v, str) and v and len(v) <= 200} if len(buffered) == 1 or ivr else {}
            return {"id": current_id, "locator": locator, "turns": turns, "fields": fields}

        def grouped() -> Iterator[Conversation]:
            current_id, buffered = None, []
            for row in all_rows:
                row_id = row.get(id_col) or ""
                if current_id is not None and row_id != current_id and buffered:
                    yield conversation(current_id, buffered)
                    buffered = []
                current_id = row_id
                buffered.append(row)
            if buffered and current_id is not None:
                yield conversation(current_id, buffered)
        yield from _complete_only((c for c in grouped() if c["turns"]), lines)
        return

    def per_row() -> Iterator[Conversation]:
        for index, row in enumerate(all_rows, start=1):
            conversation = conversation_from_row(row, locator, index)
            if conversation:
                yield conversation
    yield from _complete_only(per_row(), lines)


def conversations_from_json(data: bytes, locator: str) -> list[Conversation]:
    text = data.decode("utf-8-sig", errors="replace")
    records: list[Any] = []
    try:
        loaded = json.loads(text)
        records = loaded if isinstance(loaded, list) else [loaded]
    except json.JSONDecodeError:
        try:
            records = [json.loads(line) for line in text.splitlines() if line.strip()]
        except json.JSONDecodeError as error:
            raise BuildError(f"{locator} is neither JSON nor JSON Lines (line {error.lineno}: {error.msg}).") from error
    conversations = []
    for index, record in enumerate(records, start=1):
        if not isinstance(record, dict):
            continue
        turns_source = next((record[key] for key in ("turns", "messages", "utterances", "transcript", "dialogue") if isinstance(record.get(key), list)), None)
        if turns_source is not None:
            turns = []
            for turn in turns_source:
                if isinstance(turn, dict):
                    text_value = next((turn[k] for k in ("text", "content", "utterance", "message") if isinstance(turn.get(k), str)), "")
                    speaker = next((turn[k] for k in ("speaker", "role", "party", "from") if isinstance(turn.get(k), str)), "unknown")
                    if text_value.strip():
                        turns.append({"speaker": speaker, "text": text_value.strip()})
                elif isinstance(turn, str) and turn.strip():
                    turns.append({"speaker": "unknown", "text": turn.strip()})
        elif isinstance(record.get("transcript"), str):
            turns = _turns_from_text(record["transcript"])
        else:
            continue
        if turns:
            identity = str(record.get("id") or record.get("conversation_id") or record.get("call_id") or index)
            fields = {k: v for k, v in record.items() if isinstance(v, (str, int, float)) and k not in ("transcript",) and len(str(v)) <= 200}
            conversations.append({"id": identity, "locator": locator, "turns": turns, "fields": fields})
    return conversations


def _turns_from_text(text: str) -> list[dict[str, str]]:
    turns = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        match = re.match(r"^([A-Za-z][A-Za-z0-9 _.-]{0,30}):\s*(.+)$", line)
        if match:
            turns.append({"speaker": match.group(1).strip(), "text": match.group(2).strip()})
        elif turns:
            turns[-1]["text"] += " " + line
        else:
            turns.append({"speaker": "unknown", "text": line})
    return turns


def sample_from_objects(objects: list[tuple[str, Callable[[], Any], int]], *, sample: int, seed: int, scan_bytes: int) -> dict[str, Any]:
    """objects: (locator, open() -> bytes or binary reader, size). Returns sampled normalized conversations."""
    rng = random.Random(seed)
    reservoir: list[Conversation] = []
    seen = 0
    notes: list[str] = []
    truncated = False

    def consider(conversation: Conversation) -> None:
        nonlocal seen
        seen += 1
        if len(reservoir) < sample:
            reservoir.append(conversation)
        else:
            slot = rng.randrange(seen)
            if slot < sample:
                reservoir[slot] = conversation

    many_small = len(objects) > 1 and all(size <= 2 * 1024 * 1024 for _, _, size in objects)
    order = list(objects)
    if many_small and len(order) > sample * 4:
        rng.shuffle(order)
        order = order[: sample * 4]
        notes.append(f"Scanned a seeded subset of {len(order)} of {len(objects)} objects.")
    for locator, opener, size in order:
        handle = opener()
        name = locator.split("?", 1)[0].casefold()
        if name.endswith(".csv") or (size > 2 * 1024 * 1024 and not name.endswith((".json", ".jsonl", ".txt", ".md"))):
            reader = handle if hasattr(handle, "read") else io.BytesIO(handle)
            lines = _Lines(reader, scan_bytes)
            for conversation in conversations_from_csv(lines, locator):
                consider(conversation)
            if lines.truncated:
                truncated = True
                notes.append(f"{locator}: scanned the first {lines.read_bytes // (1024 * 1024)} MB only; sample drawn from that prefix.")
            continue
        data = handle.read() if hasattr(handle, "read") else handle
        if name.endswith((".json", ".jsonl")):
            for conversation in conversations_from_json(data, locator):
                consider(conversation)
        else:
            turns = _turns_from_text(data.decode("utf-8-sig", errors="replace"))
            if turns:
                consider({"id": locator.rsplit("/", 1)[-1], "locator": locator, "turns": turns, "fields": {}})
    if not reservoir:
        raise BuildError("No conversations could be parsed from the transcript source.")
    reservoir.sort(key=lambda c: (c["locator"], c["id"]))
    return {"conversations": reservoir, "notes": notes,
            "sampling": {"method": "seeded-reservoir", "seed": seed, "requested": sample, "sampled": len(reservoir), "candidatesSeen": seen, "scanTruncated": truncated}}


def conversation_text(conversation: Conversation) -> str:
    return "\n".join(f"{turn['speaker']}: {turn['text']}" for turn in conversation["turns"])


PII_PATTERNS = {
    "email": re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),
    "phone": re.compile(r"(?<!\d)(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}(?!\d)"),
    "longDigits": re.compile(r"(?<!\d)\d{13,19}(?!\d)"),
    "ssn": re.compile(r"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)"),
}


def scan_conversations(conversations: list[Conversation]) -> dict[str, Any]:
    counts = {name: 0 for name in PII_PATTERNS}
    flagged = 0
    for conversation in conversations:
        text = conversation_text(conversation) + "\n" + " ".join(str(v) for v in conversation.get("fields", {}).values())
        hit = False
        for name, pattern in PII_PATTERNS.items():
            found = len(pattern.findall(text))
            counts[name] += found
            hit = hit or found > 0
        flagged += hit
    return {"conversationsScanned": len(conversations), "conversationsWithHits": flagged, "patternHits": counts,
            "note": "Pattern counts only; synthetic data trips these too. Not a redaction certificate."}
