"""Register raw material and fetch it into the workspace.

A source is anything the user points at: an HTTPS website, an OpenAPI document (URL or
file), a local file or directory, or an S3 prefix. Each source has a role that decides how
it is read and how much authority it carries. Fetching stores exact bytes plus an inventory
with digests so every later stage can be replayed offline.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import mimetypes
import re
import shutil
import socket
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from . import transcripts
from .workspace import USER_AGENT, BuildError, Workspace, read_json, slug, utc_now, write_json

ROLES = ("website", "knowledge", "transcripts", "openapi")
AUTHORITY = {"website": "SUPPORTING", "knowledge": "AUTHORITATIVE", "transcripts": "OBSERVATIONAL", "openapi": "INTERFACE"}
PRIVACY = ("synthetic", "redacted", "raw")
MAX_HTTP_BYTES = 10 * 1024 * 1024
MAX_OBJECT_BYTES = 25 * 1024 * 1024
MAX_OBJECTS = 500
TEXT_KINDS = {"html", "markdown", "yaml", "json", "text", "csv"}
Fetch = Callable[[str], tuple[bytes, str, str]]


def kind_of(name: str, content_type: str = "") -> str:
    suffix = PurePosixPath(name.split("?")[0]).suffix.casefold()
    by_suffix = {
        ".html": "html", ".htm": "html", ".md": "markdown", ".markdown": "markdown", ".yaml": "yaml", ".yml": "yaml",
        ".json": "json", ".jsonl": "jsonl", ".txt": "text", ".csv": "csv", ".pdf": "pdf", ".docx": "docx",
    }
    if suffix in by_suffix:
        return by_suffix[suffix]
    base = content_type.split(";")[0].strip().casefold()
    by_type = {"text/html": "html", "text/markdown": "markdown", "application/json": "json", "text/plain": "text",
               "application/yaml": "yaml", "text/yaml": "yaml", "application/pdf": "pdf", "text/csv": "csv"}
    return by_type.get(base, "other")


# --------------------------------------------------------------------------- locations

def location_kind(location: str) -> str:
    if location.startswith("s3://"):
        return "s3"
    if re.match(r"^https?://", location):
        return "https"
    return "local"


def split_s3_uri(uri: str) -> tuple[str, str]:
    parsed = urlsplit(uri)
    if parsed.scheme != "s3" or not parsed.netloc:
        raise BuildError("Expected an s3://bucket/prefix location.")
    if parsed.query or parsed.fragment or ".." in PurePosixPath(parsed.path).parts:
        raise BuildError("The S3 location is not a safe prefix.")
    return parsed.netloc, parsed.path.lstrip("/")


def normalize_https(url: str) -> tuple[str, str]:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise BuildError(f"Only credential-free HTTPS URLs are supported: {url}")
    normalized = urlunsplit(("https", parsed.netloc.casefold(), parsed.path or "/", parsed.query, ""))
    return normalized, parsed.hostname.casefold()


def _assert_public(url: str) -> str:
    normalized, host = normalize_https(url)
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
    except socket.gaierror as error:
        raise BuildError(f"The hostname did not resolve: {host}") from error
    for value in addresses:
        if not ipaddress.ip_address(value).is_global:
            raise BuildError(f"{host} resolves to a private or special-use address; refusing to fetch.")
    return normalized


class _SafeRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401 - urllib hook
        return super().redirect_request(req, fp, code, msg, headers, _assert_public(newurl))


def default_fetch(url: str) -> tuple[bytes, str, str]:
    """Fetch one public HTTPS URL with byte and time bounds. Returns (bytes, content type, final url)."""
    request = Request(_assert_public(url), method="GET", headers={
        "Accept": "text/html,application/json,application/yaml,text/yaml,text/markdown,text/plain;q=0.9,*/*;q=0.5",
        "User-Agent": USER_AGENT,
    })
    try:
        with build_opener(_SafeRedirects()).open(request, timeout=20) as response:  # noqa: S310 - public HTTPS only
            body = response.read(MAX_HTTP_BYTES + 1)
            if len(body) > MAX_HTTP_BYTES:
                raise BuildError(f"{url} exceeds the {MAX_HTTP_BYTES // (1024 * 1024)} MB fetch limit.")
            return body, response.headers.get_content_type(), response.geturl()
    except HTTPError as error:
        raise BuildError(f"{url} returned HTTP {error.code}.") from error
    except URLError as error:
        raise BuildError(f"{url} could not be fetched: {error.reason}") from error
    except (TimeoutError, socket.timeout) as error:
        raise BuildError(f"{url} timed out.") from error


# --------------------------------------------------------------------------- registration

def add_source(workspace: Workspace, role: str, location: str, **options: Any) -> dict[str, Any]:
    from . import demo as demos  # local import: demo registers through this function

    if role not in ROLES:
        raise BuildError(f"Role must be one of {', '.join(ROLES)}.")
    # Demo data and a user's own material never share a workspace, in either direction.
    active = workspace.project.get("demo")
    owner = demos.owning_demo(location)
    if active and not demos.is_demo_source(demos.get(active), role, location):
        raise BuildError(f"This is a {demos.get(active)['name']} demo workspace; it holds only the demo sources. Start a new workspace (`init`) for your own material.")
    if not active and owner is not None:
        raise BuildError(f"{location} is part of the {owner['name']} sample dataset. To build from it, start a fresh workspace with `init --demo {owner['id']}`; "
                         "demo data is never mixed into a workspace with your own material.")
    kind = location_kind(location)
    if kind == "local":
        path = Path(location).expanduser()
        if not path.exists():
            raise BuildError(f"Local path does not exist: {location}")
        location = str(path.resolve())
    elif kind == "https":
        normalize_https(location)
    else:
        split_s3_uri(location)
    privacy = options.pop("privacy", None)
    if role == "transcripts":
        if privacy not in PRIVACY:
            raise BuildError("Transcripts need a privacy attestation: --privacy synthetic, redacted, or raw. "
                             "Raw transcripts are inventoried but never shown to the model.")
    existing = [item for item in workspace.sources() if item["location"] == location and item["role"] == role]
    if existing:
        raise BuildError(f"{location} is already registered as {role}.")
    count = len(workspace.sources(role))
    source_id = f"source:{role}" if count == 0 else f"source:{role}-{count + 1}"
    record = {
        "id": source_id,
        "role": role,
        "location": location,
        "locationKind": kind,
        "authority": options.pop("authority", None) or AUTHORITY[role],
        "privacy": privacy if role == "transcripts" else None,
        "options": {key: value for key, value in options.items() if value is not None},
        "addedAt": utc_now(),
        "fetched": None,
    }
    workspace.project["sources"].append(record)
    workspace.save()
    return record


def raw_dir(workspace: Workspace, source: dict[str, Any]) -> Path:
    return workspace.path("raw", source["id"].replace(":", "-"))


# --------------------------------------------------------------------------- fetching

class _Links(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)


def crawl_site(start_url: str, fetch: Fetch, *, max_pages: int = 40, allowed_hosts: Iterable[str] | None = None) -> tuple[list[dict[str, Any]], bool]:
    """Breadth-first crawl of same-host pages. Page bytes are kept exactly as fetched.
    Returns (pages, truncated); failed fetches are recorded but do not count toward the page budget."""
    start, host = normalize_https(start_url)
    allowed = {h.casefold() for h in (allowed_hosts or [])} | {host}
    queue, seen, pages = [start], set(), []
    fetched = 0
    while queue and fetched < max_pages:
        url = queue.pop(0)
        key = url.split("#")[0]
        if key in seen:
            continue
        seen.add(key)
        try:
            body, content_type, final_url = fetch(url)
        except BuildError as error:
            pages.append({"locator": url, "error": str(error)})
            continue
        except Exception as error:  # noqa: BLE001 - one page failing must not lose the crawl
            pages.append({"locator": url, "error": f"{type(error).__name__}: {error}"[:300]})
            continue
        final_url, final_host = normalize_https(final_url)
        if final_host not in allowed:
            continue
        pages.append({"locator": final_url, "bytes": body, "contentType": content_type})
        fetched += 1
        if kind_of(final_url, content_type) != "html":
            continue
        parser = _Links()
        parser.feed(body.decode("utf-8", errors="replace"))
        for href in parser.links:
            candidate = urljoin(final_url, href)
            parsed = urlsplit(candidate)
            if parsed.scheme != "https" or not parsed.hostname or parsed.hostname.casefold() not in allowed:
                continue
            if PurePosixPath(parsed.path).suffix.casefold() in {".png", ".jpg", ".jpeg", ".gif", ".svg", ".css", ".js", ".ico", ".woff", ".woff2", ".mp4", ".zip"}:
                continue
            clean = urlunsplit(("https", parsed.netloc.casefold(), parsed.path or "/", parsed.query, ""))
            if clean not in seen and clean not in queue:
                queue.append(clean)
    return pages, bool(queue)


def parse_openapi(data: bytes, *, document_url: str | None = None, server_url: str | None = None) -> dict[str, Any]:
    text = data.decode("utf-8-sig")
    try:
        document = json.loads(text)
    except json.JSONDecodeError:
        import yaml

        try:
            document = yaml.safe_load(text)
        except yaml.YAMLError as error:
            raise BuildError("The OpenAPI document is neither JSON nor YAML.") from error
    if not isinstance(document, dict) or not re.fullmatch(r"3\.[01]\.\d+", str(document.get("openapi", ""))) or not isinstance(document.get("paths"), dict):
        raise BuildError("The interface source is not an OpenAPI 3.0 or 3.1 document with a paths object.")

    def walk(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key == "$ref" and isinstance(child, str):
                    yield child
                else:
                    yield from walk(child)
        elif isinstance(value, list):
            for child in value:
                yield from walk(child)

    for reference in set(walk(document)):
        if not reference.startswith("#/"):
            raise BuildError(f"OpenAPI reference is not local to the document: {reference}")
        current: Any = document
        for token in reference[2:].split("/"):
            token = token.replace("~1", "/").replace("~0", "~")
            if isinstance(current, dict) and token in current:
                current = current[token]
            elif isinstance(current, list) and token.isdigit() and int(token) < len(current):
                current = current[int(token)]
            else:
                raise BuildError(f"OpenAPI reference does not resolve: {reference}")
    servers = []
    for item in document.get("servers") or []:
        if not isinstance(item, dict) or not item.get("url"):
            continue
        url = str(item["url"])
        for name, variable in (item.get("variables") or {}).items():
            if isinstance(variable, dict) and variable.get("default") is not None:
                url = url.replace("{" + str(name) + "}", str(variable["default"]))
        servers.append(url)
    resolved_server = server_url
    if not resolved_server and servers and "{" not in str(servers[0]):
        first = str(servers[0])
        if re.match(r"^https?://", first):
            resolved_server = first
        elif document_url:
            origin = urlsplit(document_url)
            resolved_server = urlunsplit((origin.scheme, origin.netloc, first if first.startswith("/") else "/" + first, "", "")).rstrip("/") or origin.scheme + "://" + origin.netloc
    if not resolved_server and document_url:
        origin = urlsplit(document_url)
        resolved_server = f"{origin.scheme}://{origin.netloc}"
    return {"document": document, "serverUrl": (resolved_server or "").rstrip("/") or None, "declaredServers": servers}


def _iter_local_files(root: Path, limit: int) -> list[Path]:
    if root.is_file():
        return [root]
    files = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink() or not path.is_file() or any(part.startswith(".") for part in path.relative_to(root).parts):
            continue
        files.append(path)
        if len(files) >= limit:
            break
    return files


def _s3_client(workspace: Workspace, factory: Callable[[], Any] | None):
    if factory is not None:
        return factory()
    import boto3  # imported lazily so offline use never needs it

    profile = workspace.project.get("awsProfile")
    session = boto3.Session(profile_name=profile) if profile else boto3.Session()
    if workspace.project.get("s3Anonymous") or (not profile and session.get_credentials() is None):
        # Public buckets (the sample datasets) need no credentials; unsigned requests also keep a demo
        # from ever using whatever AWS identity happens to be on the machine.
        from botocore import UNSIGNED
        from botocore.config import Config

        # Static placeholder credentials keep botocore away from the machine's provider chain; UNSIGNED means they are never sent.
        anonymous = boto3.Session(aws_access_key_id="anonymous", aws_secret_access_key="anonymous", region_name=session.region_name or "us-east-1")
        return anonymous.client("s3", config=Config(signature_version=UNSIGNED))
    return session.client("s3")


def _list_s3(client: Any, bucket: str, prefix: str, limit: int) -> list[dict[str, Any]]:
    items = []
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        for item in page.get("Contents", []):
            if item["Key"].endswith("/"):
                continue
            items.append({"key": item["Key"], "bytes": int(item["Size"])})
            if len(items) >= limit:
                return items
    return items


def _store(raw: Path, index: int, locator: str, data: bytes, content_type: str = "") -> dict[str, Any]:
    kind = kind_of(locator, content_type)
    original = PurePosixPath(urlsplit(locator).path or locator)
    suffix = ".html" if kind == "html" else original.suffix.casefold()
    stem = original.name[: -len(original.suffix)] if original.suffix else original.name
    path = raw / f"{index:04d}-{slug(stem or 'item', 50)}{suffix}"
    path.write_bytes(data)
    return {"id": f"item-{index:04d}", "locator": locator, "file": path.name, "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data), "contentType": content_type or mimetypes.guess_type(locator)[0] or "", "kind": kind}


def fetch_source(workspace: Workspace, source: dict[str, Any], *, fetch: Fetch = default_fetch, s3_factory: Callable[[], Any] | None = None) -> dict[str, Any]:
    final = raw_dir(workspace, source)
    raw = final.with_name(final.name + ".fetching")
    if raw.exists():
        shutil.rmtree(raw)
    raw.mkdir(parents=True)
    try:
        inventory = _fetch_into(workspace, source, raw, fetch, s3_factory)
    except BaseException:
        shutil.rmtree(raw, ignore_errors=True)
        raise
    if final.exists():
        shutil.rmtree(final)
    raw.rename(final)
    source["fetched"] = {"at": inventory["fetchedAt"], "itemCount": inventory["itemCount"], "byteCount": inventory["byteCount"], "notes": inventory["notes"]}
    workspace.save()
    return inventory


def _fetch_into(workspace: Workspace, source: dict[str, Any], raw: Path, fetch: Fetch, s3_factory: Callable[[], Any] | None) -> dict[str, Any]:
    role, kind, location, options = source["role"], source["locationKind"], source["location"], source.get("options", {})
    items: list[dict[str, Any]] = []
    notes: list[str] = []
    extra: dict[str, Any] = {}

    if role == "website":
        if kind != "https":
            raise BuildError("A website source must be an HTTPS URL.")
        pages, truncated = crawl_site(location, fetch, max_pages=int(options.get("maxPages", 40)), allowed_hosts=options.get("allowedHosts"))
        for page in pages:
            if "error" in page:
                notes.append(f"{page['locator']}: {page['error']}")
                continue
            items.append(_store(raw, len(items) + 1, page["locator"], page["bytes"], page["contentType"]))
        if truncated:
            notes.append(f"Crawl stopped at the page limit ({len(items)} pages); raise --max-pages to include more.")
        if not items:
            raise BuildError(f"No page of {location} could be fetched: {notes[0] if notes else 'nothing was returned'}")
    elif role == "openapi":
        if kind == "https":
            data, content_type, final_url = fetch(location)
        elif kind == "local":
            data, content_type, final_url = Path(location).read_bytes(), "", None
        else:
            raise BuildError("Read the OpenAPI document from a URL or a local file, not an S3 prefix.")
        parsed = parse_openapi(data, document_url=final_url, server_url=options.get("serverUrl"))
        item = _store(raw, 1, final_url or location, data, content_type)
        item["kind"] = "openapi"
        items.append(item)
        write_json(raw / "openapi.json", parsed["document"])
        extra = {"serverUrl": parsed["serverUrl"], "declaredServers": parsed["declaredServers"], "document": "openapi.json"}
        if not parsed["serverUrl"]:
            notes.append("No absolute server URL could be derived; set one with --server-url before compiling tools.")
    elif role == "knowledge":
        if kind == "https":
            data, content_type, final_url = fetch(location)
            items.append(_store(raw, 1, final_url, data, content_type))
        elif kind == "local":
            files = _iter_local_files(Path(location), MAX_OBJECTS)
            if not files:
                raise BuildError(f"No files found under {location}.")
            for index, path in enumerate(files, start=1):
                if path.stat().st_size > MAX_OBJECT_BYTES:
                    notes.append(f"{path}: skipped, larger than {MAX_OBJECT_BYTES // (1024 * 1024)} MB.")
                    continue
                items.append(_store(raw, index, str(path), path.read_bytes()))
        else:
            client = _s3_client(workspace, s3_factory)
            bucket, prefix = split_s3_uri(location)
            listed = _list_s3(client, bucket, prefix, MAX_OBJECTS)
            if not listed:
                raise BuildError(f"No objects under {location}.")
            for index, entry in enumerate(listed, start=1):
                if entry["bytes"] > MAX_OBJECT_BYTES:
                    notes.append(f"s3://{bucket}/{entry['key']}: skipped, larger than {MAX_OBJECT_BYTES // (1024 * 1024)} MB.")
                    continue
                response = client.get_object(Bucket=bucket, Key=entry["key"])
                items.append(_store(raw, index, f"s3://{bucket}/{entry['key']}", response["Body"].read(), response.get("ContentType", "")))
    else:  # transcripts
        sample = int(options.get("sample", 40))
        seed = int(options.get("seed", 1))
        scan_bytes = int(options.get("scanMb", 64)) * 1024 * 1024
        if kind == "https":
            data, content_type, final_url = fetch(location)
            result = transcripts.sample_from_objects([(final_url, lambda d=data: d, len(data))], sample=sample, seed=seed, scan_bytes=scan_bytes)
        elif kind == "local":
            files = _iter_local_files(Path(location), MAX_OBJECTS)
            if not files:
                raise BuildError(f"No files found under {location}.")
            objects = [(str(path), (lambda p=path: p.open("rb")), path.stat().st_size) for path in files]
            result = transcripts.sample_from_objects(objects, sample=sample, seed=seed, scan_bytes=scan_bytes)
        else:
            client = _s3_client(workspace, s3_factory)
            bucket, prefix = split_s3_uri(location)
            listed = _list_s3(client, bucket, prefix, MAX_OBJECTS)
            if not listed:
                raise BuildError(f"No objects under {location}.")
            objects = [(f"s3://{bucket}/{e['key']}", (lambda key=e["key"]: client.get_object(Bucket=bucket, Key=key)["Body"]), e["bytes"]) for e in listed]
            result = transcripts.sample_from_objects(objects, sample=sample, seed=seed, scan_bytes=scan_bytes)
        scan = transcripts.scan_conversations(result["conversations"])
        extra = {"sampling": result["sampling"], "privacy": source["privacy"], "piiScan": scan}
        if source["privacy"] == "raw":
            notes.append("Attested raw: conversation text was scanned in memory and discarded; only counts and digests are kept.")
        else:
            write_json(raw / "conversations.json", result["conversations"])
            extra["conversations"] = "conversations.json"
        notes.extend(result["notes"])
        items = [{"id": f"conv-{i:04d}", "locator": c["locator"], "kind": "conversation", "bytes": len(transcripts.conversation_text(c)),
                  "sha256": hashlib.sha256(transcripts.conversation_text(c).encode("utf-8")).hexdigest()} for i, c in enumerate(result["conversations"], start=1)]

    inventory = {"source": source["id"], "role": role, "location": location, "fetchedAt": utc_now(), "itemCount": len(items),
                 "byteCount": sum(int(item.get("bytes", 0)) for item in items), "items": items, "notes": notes, **extra}
    write_json(raw / "inventory.json", inventory)
    return inventory


def fetch_all(workspace: Workspace, *, fetch: Fetch = default_fetch, s3_factory: Callable[[], Any] | None = None, only: str | None = None) -> list[dict[str, Any]]:
    """Fetch every registered source. One failing source is reported, not fatal; all failing is."""
    registered = workspace.sources()
    if not registered:
        raise BuildError("No sources registered. Add at least one with `add`.")
    sources = [s for s in registered if only is None or s["id"] == only or s["role"] == only]
    if not sources:
        raise BuildError(f"No source matches --only {only}; registered: {', '.join(s['id'] for s in registered)}")
    results = []
    for source in sources:
        try:
            results.append(fetch_source(workspace, source, fetch=fetch, s3_factory=s3_factory))
        except BuildError as error:
            results.append({"source": source["id"], "role": source["role"], "location": source["location"], "error": str(error), "itemCount": 0, "byteCount": 0, "notes": []})
    if all("error" in result for result in results):
        raise BuildError("Every source failed to fetch: " + "; ".join(f"{r['source']}: {r['error']}" for r in results))
    return results


def load_inventory(workspace: Workspace, source: dict[str, Any]) -> dict[str, Any]:
    path = raw_dir(workspace, source) / "inventory.json"
    if not path.exists():
        raise BuildError(f"{source['id']} has not been fetched yet. Run `fetch` first.")
    return read_json(path)
