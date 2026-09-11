from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

from vapi_build import openapi, sources, transcripts, website
from vapi_build.workspace import BuildError
from .conftest import nested_csv


def test_website_parser_drops_hidden_and_scripts_keeps_visible():
    page = website.extract_page('<html><head><title>T</title><script>alert(1)</script></head><body><nav><a href="/x">Nav</a></nav>'
                                '<h1>Hello</h1><div hidden>SECRET</div><p style="display:none">HIDDEN</p><p>Visible <b>bold</b> text.</p>'
                                '<form><input value="PRIVATE"><textarea>NOTES</textarea></form><ul><li>One</li><li>Two</li></ul></body></html>')
    texts = [b["text"] for b in page["blocks"]]
    assert page["title"] == "T"
    assert texts == ["Hello", "Visible bold text.", "One", "Two"]


def test_nested_csv_and_utterance_rows_and_json_and_text():
    conversations = list(transcripts.conversations_from_csv(io.StringIO(nested_csv().decode()), "x.csv"))
    assert [c["id"] for c in conversations] == ["c1", "c2", "c3"]
    assert conversations[0]["turns"][0] == {"speaker": "Customer", "text": "I need to cancel my crossing tomorrow and get my money back."}
    assert conversations[0]["fields"]["reason"] == "Refund"
    flat = "conversation_id,speaker,text\n1,Customer,Hi\n1,Agent,Hello\n2,Customer,Bye\n"
    grouped = list(transcripts.conversations_from_csv(io.StringIO(flat), "flat.csv"))
    assert [len(c["turns"]) for c in grouped] == [2, 1]
    from_json = transcripts.conversations_from_json(json.dumps({"call_id": "k", "turns": [{"speaker": "A", "text": "x"}, "plain line"]}).encode(), "k.json")
    assert from_json[0]["id"] == "k" and len(from_json[0]["turns"]) == 2
    assert transcripts._turns_from_text("Agent: hi\nthere\nCustomer: yo")[0]["text"] == "hi there"


def test_reservoir_sampling_is_seeded_and_bounded():
    rows = "conversation_id,text\n" + "".join(f"{i},hello number {i}\n" for i in range(200))
    objects = [("big.csv", lambda: io.BytesIO(rows.encode()), len(rows))]
    first = transcripts.sample_from_objects(objects, sample=5, seed=7, scan_bytes=10 ** 9)
    second = transcripts.sample_from_objects(objects, sample=5, seed=7, scan_bytes=10 ** 9)
    assert [c["id"] for c in first["conversations"]] == [c["id"] for c in second["conversations"]]
    assert first["sampling"]["candidatesSeen"] == 200 and first["sampling"]["sampled"] == 5
    truncated = transcripts.sample_from_objects(objects, sample=5, seed=7, scan_bytes=500)
    assert truncated["sampling"]["scanTruncated"] and truncated["sampling"]["candidatesSeen"] < 200


def test_pii_scan_counts_patterns():
    scan = transcripts.scan_conversations([{"id": "1", "locator": "x", "turns": [{"speaker": "c", "text": "mail me at a@b.co or call 555-123-4567, card 4111111111111111"}], "fields": {}}])
    assert scan["conversationsWithHits"] == 1 and scan["patternHits"]["email"] == 1 and scan["patternHits"]["longDigits"] == 1


def test_openapi_schema_projection_and_names():
    document = {"openapi": "3.0.3", "paths": {"/things/{id}": {"put": {"operationId": "update-thing", "requestBody": {"content": {"application/json": {"schema": {
        "allOf": [{"$ref": "#/components/schemas/A"}, {"type": "object", "properties": {"extra": {"oneOf": [{"type": "integer"}, {"type": "null"}]}}}]}}}},
        "parameters": [{"name": "id", "in": "path", "required": True, "schema": {"type": "string", "format": "uuid"}}], "responses": {"200": {"description": "ok"}}}}},
        "components": {"schemas": {"A": {"type": "object", "required": ["name"], "properties": {"name": {"type": "string", "maxLength": 5}, "tags": {"type": "array", "items": {"type": ["string", "null"]}}}}}}}
    result = openapi.inventory(document, server_url="https://api.example")
    op = result["operations"][0]
    schema = op["toolSchema"]
    assert schema["properties"]["id"] == {"type": "string", "format": "uuid"}
    assert schema["properties"]["name"] == {"type": "string"} and schema["properties"]["tags"]["items"] == {"type": "string"}
    assert schema["properties"]["extra"]["type"] == "integer" and schema["required"] == ["id", "name"]
    assert op["classification"]["risk"] == "MEDIUM" and op["classification"]["confirmBeforeCall"] is True  # every write confirms
    taken = set()
    assert openapi.tool_name("update-thing", taken) == "update-thing"
    assert openapi.tool_name("update-thing", taken) == "update-thing_2"
    assert len(openapi.tool_name("x" * 60, set())) == 40


def test_openapi_parse_rejects_non_openapi_and_external_refs():
    with pytest.raises(BuildError):
        sources.parse_openapi(b'{"swagger": "2.0"}')
    with pytest.raises(BuildError, match="not local"):
        sources.parse_openapi(json.dumps({"openapi": "3.1.0", "paths": {"/a": {"get": {"responses": {"200": {"$ref": "https://x/y"}}}}}}).encode())
    parsed = sources.parse_openapi(json.dumps({"openapi": "3.1.0", "servers": [{"url": "/api"}], "paths": {}}).encode(), document_url="https://host.example/spec.json")
    assert parsed["serverUrl"] == "https://host.example/api"


def test_source_registration_guards(tmp_path):
    from vapi_build.workspace import Workspace

    workspace = Workspace.create(tmp_path / "w", "Guards")
    with pytest.raises(BuildError, match="privacy attestation"):
        sources.add_source(workspace, "transcripts", str(tmp_path))
    with pytest.raises(BuildError, match="HTTPS"):
        sources.add_source(workspace, "website", "http://insecure.example")
    with pytest.raises(BuildError, match="does not exist"):
        sources.add_source(workspace, "knowledge", str(tmp_path / "missing"))
    sources.add_source(workspace, "knowledge", "s3://bucket/prefix/")
    with pytest.raises(BuildError, match="already registered"):
        sources.add_source(workspace, "knowledge", "s3://bucket/prefix/")


def test_crawl_stays_on_host_and_records_failures():
    pages = {"https://a.example/": (b'<a href="/b">b</a><a href="https://other.example/">o</a><a href="/c.png">img</a>', "text/html"),
             "https://a.example/b": (b"<p>B</p>", "text/html")}

    def fetch(url):
        if url not in pages:
            raise BuildError("404")
        return pages[url][0], pages[url][1], url

    crawled, truncated = sources.crawl_site("https://a.example/", fetch, max_pages=10)
    assert [p["locator"] for p in crawled] == ["https://a.example/", "https://a.example/b"] and truncated is False
    limited, truncated = sources.crawl_site("https://a.example/", fetch, max_pages=1)
    assert len(limited) == 1 and truncated is True


def test_classifier_uses_word_boundaries_and_every_write_confirms():
    document = {"openapi": "3.0.3", "paths": {
        "/messages": {"post": {"operationId": "sendMessage", "summary": "Send a message", "responses": {"200": {"description": "ok"}}}},
        "/members": {"post": {"operationId": "addMember", "responses": {"200": {"description": "ok"}}}},
        "/presets": {"post": {"operationId": "savePreset", "responses": {"200": {"description": "ok"}}}},
        "/borders": {"get": {"operationId": "listBorders", "responses": {"200": {"description": "ok"}}}},
        "/api/v1/me": {"get": {"operationId": "getCustomer", "responses": {"200": {"description": "ok"}}}},
        "/auth/login": {"post": {"operationId": "customerLogin", "responses": {"200": {"description": "ok"}}}},
        "/admin/reset": {"post": {"operationId": "resetDemo", "responses": {"204": {"description": "reset"}}}},
        "/payments": {"post": {"operationId": "createPayment", "responses": {"201": {"description": "ok"}}}},
    }}
    ops = {op["operationId"]: op["classification"] for op in openapi.inventory(document, server_url="https://x.example")["operations"]}
    for write in ("sendMessage", "addMember", "savePreset", "customerLogin", "resetDemo", "createPayment"):
        assert ops[write]["confirmBeforeCall"] is True, write
    assert not ops["sendMessage"]["identitySensitive"] and not ops["addMember"]["identitySensitive"]
    assert ops["getCustomer"]["identitySensitive"] and ops["customerLogin"]["identitySensitive"]
    assert not ops["savePreset"]["adminOrInternal"] and ops["resetDemo"]["risk"] == "PRIVILEGED"
    assert not ops["listBorders"]["financial"] and ops["createPayment"]["risk"] == "HIGH"


def test_recursive_schema_does_not_crash_inventory():
    document = {"openapi": "3.1.0", "paths": {"/categories": {"post": {"operationId": "createCategory", "requestBody": {"content": {"application/json": {"schema": {"$ref": "#/components/schemas/Category"}}}}, "responses": {"201": {"description": "ok"}}}}},
                "components": {"schemas": {"Category": {"type": "object", "properties": {"name": {"type": "string"}, "children": {"type": "array", "items": {"$ref": "#/components/schemas/Category"}}, "parent": {"$ref": "#/components/schemas/Category"}}}}}}
    op = openapi.inventory(document, server_url="https://x.example")["operations"][0]
    schema = op["toolSchema"]["properties"]
    assert schema["name"] == {"type": "string"}
    assert schema["children"]["items"]["type"] == "object" and "recursive reference" in schema["children"]["items"]["description"]
    assert schema["parent"]["type"] == "object" and "recursive reference" in schema["parent"]["description"]


def test_missing_operation_ids_get_stable_unique_fallbacks():
    document = {"openapi": "3.0.0", "paths": {"/a/b": {"get": {"responses": {}}, "post": {"responses": {}}}, "/a-b": {"get": {"responses": {}}}}}
    ids = [op["operationId"] for op in openapi.inventory(document, server_url="https://x.example")["operations"]]
    assert ids == ["get_a-b", "get_a-b_2", "post_a-b"] or len(set(ids)) == 3


def test_nested_transcript_column_wins_over_from_to_columns():
    rows = "call_id,from,to,transcript\n" + '1,+15551234567,+15550000000,"speaker,text\nCustomer,I need help\nAgent,Sure"\n'
    conversations = list(transcripts.conversations_from_csv(io.StringIO(rows), "calls.csv"))
    assert len(conversations) == 1 and conversations[0]["turns"][0] == {"speaker": "Customer", "text": "I need help"}
    assert "+1555" not in json.dumps(conversations[0]["turns"])


def test_truncated_scan_drops_the_partial_last_conversation():
    rows = "conversation_id,speaker,text\n" + "".join(f"{i},Customer,hello number {i}\n{i},Agent,hi {i}\n" for i in range(50))
    complete = transcripts.sample_from_objects([("c.csv", lambda: io.BytesIO(rows.encode()), len(rows))], sample=100, seed=1, scan_bytes=10 ** 9)
    assert complete["sampling"]["candidatesSeen"] == 50
    cut = transcripts.sample_from_objects([("c.csv", lambda: io.BytesIO(rows.encode()), len(rows))], sample=100, seed=1, scan_bytes=400)
    assert cut["sampling"]["scanTruncated"] and 0 < cut["sampling"]["candidatesSeen"] < 50
    assert all(len(c["turns"]) == 2 for c in cut["conversations"]), "no partial conversation admitted"


def test_malformed_json_transcript_is_a_readable_error():
    with pytest.raises(BuildError, match="neither JSON nor JSON Lines"):
        transcripts.conversations_from_json(b'{"a": 1,}\n{"b": 2', "bad.json")


def test_fetch_all_continues_past_a_failing_source(tmp_path):
    from vapi_build.workspace import Workspace

    workspace = Workspace.create(tmp_path / "w", "Partial")
    good = tmp_path / "kb"
    good.mkdir()
    (good / "a.md").write_text("# A\n\nText.\n")
    sources.add_source(workspace, "knowledge", str(good))
    sources.add_source(workspace, "website", "https://down.example/")

    def fetch(url):
        raise BuildError("boom")

    results = sources.fetch_all(workspace, fetch=fetch)
    by_id = {r["source"]: r for r in results}
    assert by_id["source:knowledge"]["itemCount"] == 1 and "boom" in by_id["source:website"]["error"]
    with pytest.raises(BuildError, match="No source matches"):
        sources.fetch_all(workspace, fetch=fetch, only="source:typo")


def test_raw_transcripts_are_never_written_to_disk(tmp_path):
    from vapi_build.workspace import Workspace

    workspace = Workspace.create(tmp_path / "w", "Raw")
    calls = tmp_path / "calls"
    calls.mkdir()
    (calls / "c.csv").write_bytes(nested_csv())
    sources.add_source(workspace, "transcripts", str(calls), privacy="raw", sample=5)
    inventory = sources.fetch_all(workspace)[0]
    raw_dir = sources.raw_dir(workspace, workspace.sources()[0])
    assert inventory["privacy"] == "raw" and "conversations" not in inventory and inventory["piiScan"]["conversationsScanned"] == 3
    assert not (raw_dir / "conversations.json").exists()
    assert "money back" not in "".join(p.read_text() for p in raw_dir.glob("*.json"))


def test_speech_ivr_logs_group_by_call_and_keep_prompt_and_no_match():
    rows = ("call_id,timestamp,prompt_name,asr_text,recognition_result,confidence\n"
            "c1,2025-01-03T10:00:00,MainMenu,I want to cancel my crossing,MATCH,0.91\n"
            "c1,2025-01-03T10:00:09,RefundReason,the weather looks awful tomorrow,NOMATCH,0.22\n"
            "c1,2025-01-03T10:00:20,RefundReason,,NOINPUT,\n"
            "c2,2025-01-04T08:12:00,MainMenu,when is the last boat back,MATCH,0.88\n")
    conversations = list(transcripts.conversations_from_csv(io.StringIO(rows), "ivr.csv"))
    assert [c["id"] for c in conversations] == ["c1", "c2"]
    first = conversations[0]["turns"]
    assert first[0] == {"speaker": "caller", "text": "[MainMenu] I want to cancel my crossing"}
    assert first[1] == {"speaker": "caller", "text": "[RefundReason] the weather looks awful tomorrow (IVR result: NOMATCH)"}
    assert first[2] == {"speaker": "caller", "text": "[RefundReason] (no speech) (IVR result: NOINPUT)"}
    assert conversations[0]["fields"]["timestamp"].startswith("2025-01-03") and "asr_text" not in conversations[0]["fields"]
    text = transcripts.conversation_text(conversations[0])
    assert "NOMATCH" in text and "0.91" not in text, "confidence stays in fields; the model sees what callers said and what the IVR missed"
    # a plain one-row-per-conversation CSV with an id and a text column still yields one conversation per row with its fields
    plain = "id,reason,transcript\n1,Refund,Customer said hi\n2,Schedule,Customer asked times\n"
    plain_conversations = list(transcripts.conversations_from_csv(io.StringIO(plain), "plain.csv"))
    assert [c["fields"]["reason"] for c in plain_conversations] == ["Refund", "Schedule"]


def test_skill_packaging_for_codex_and_upstream():
    """What VapiAI/skills' Codex packager and Codex itself need from the skill folder."""
    import re

    root = Path(__file__).resolve().parents[1]
    text = (root / "SKILL.md").read_text()
    head, frontmatter, _ = text.split("---\n", 2)
    assert head == ""
    top_keys = re.findall(r"^([a-z-]+):", frontmatter, flags=re.M)
    assert top_keys.count("compatibility") == 1 and top_keys.count("metadata") == 1
    assert len(text.splitlines()) <= 500
    yaml_text = (root / "agents" / "openai.yaml").read_text()
    for key in ("display_name", "short_description", "default_prompt"):
        assert f"  {key}: " in yaml_text
    assert "$vapi-build" in yaml_text
