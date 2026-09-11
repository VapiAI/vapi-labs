"""Serve the review page on localhost so the tab the user already has open refreshes itself.

`render` rewrites `<workspace>/review.html`; the page polls `/version` every two seconds and reloads
when the digest changes. `open` starts this server if needed and launches the browser only when no
tab has polled recently, so a re-render never opens a second copy of the same page. The server binds
to 127.0.0.1 only, serves nothing but the one page, and exits after twelve idle hours.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.error import URLError
from urllib.request import urlopen

from . import __version__
from .workspace import BuildError, Workspace, read_json, utc_now, write_json

PAGE = "review.html"
STATE = "preview.json"
LOG = "preview.log"
VIEWER_WINDOW_SECONDS = 6.0
IDLE_EXIT_SECONDS = 12 * 3600
START_TIMEOUT_SECONDS = 8.0


DIGEST_ATTRIBUTE = re.compile(rb'data-digest="([^"]+)"')


def page_digest(root: Path) -> str | None:
    """The digest the page embeds in data-digest, which is what the page compares against; the file hash is the fallback."""
    path = root / PAGE
    if not path.exists():
        return None
    data = path.read_bytes()
    match = DIGEST_ATTRIBUTE.search(data)
    return match.group(1).decode("ascii", errors="replace") if match else "sha256:" + hashlib.sha256(data).hexdigest()


class _Handler(BaseHTTPRequestHandler):
    server: "PreviewServer"

    def _json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - http.server API
        path = self.path.split("?", 1)[0]
        if path in {"/", "/index.html", f"/{PAGE}"}:
            page = self.server.root / PAGE
            if not page.exists():
                self._json({"error": "review.html has not been rendered yet"}, 404)
                return
            body = page.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/version":
            self.server.last_poll = time.time()
            self._json({"digest": page_digest(self.server.root)})
        elif path == "/status":
            self._json(self.server.status())
        else:
            self._json({"error": "not found"}, 404)

    def log_message(self, *_: Any) -> None:  # quiet
        return


class PreviewServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, root: Path, port: int = 0) -> None:
        super().__init__(("127.0.0.1", port), _Handler)
        self.root = root
        self.last_poll = 0.0
        self.started = time.time()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}/"

    def status(self) -> dict[str, Any]:
        now = time.time()
        return {"workspace": str(self.root), "url": self.url, "port": self.server_address[1], "pid": os.getpid(), "version": __version__, "digest": page_digest(self.root),
                "lastPollSecondsAgo": None if not self.last_poll else round(now - self.last_poll, 1),
                "viewerOpen": bool(self.last_poll) and now - self.last_poll < VIEWER_WINDOW_SECONDS}


def serve_forever(root: Path, port: int = 0) -> None:
    """Foreground server process. `ensure_server` spawns this detached."""
    server = PreviewServer(root, port)
    state_path = root / STATE
    write_json(state_path, {"pid": os.getpid(), "port": server.server_address[1], "url": server.url, "startedAt": utc_now()})

    def watchdog() -> None:
        while True:
            time.sleep(30)
            idle = time.time() - max(server.last_poll, server.started)
            replaced = not state_path.exists() or read_json(state_path).get("pid") != os.getpid()
            if idle > IDLE_EXIT_SECONDS or replaced:
                server.shutdown()
                return

    threading.Thread(target=watchdog, daemon=True).start()
    try:
        server.serve_forever(poll_interval=1.0)
    finally:
        server.server_close()
        if state_path.exists() and read_json(state_path).get("pid") == os.getpid():
            state_path.unlink()


def status(workspace: Workspace, *, timeout: float = 1.0) -> dict[str, Any] | None:
    """The live server's status for this workspace, or None (and a cleaned-up state file) when none answers."""
    state_path = workspace.path(STATE)
    if not state_path.exists():
        return None
    state = read_json(state_path)
    try:
        with urlopen(f"{state['url']}status", timeout=timeout) as response:  # noqa: S310 - loopback only
            live = json.loads(response.read().decode("utf-8"))
    except (URLError, OSError, ValueError, KeyError):
        state_path.unlink(missing_ok=True)
        return None
    if Path(live.get("workspace", "")) != workspace.root:
        state_path.unlink(missing_ok=True)
        return None
    return live


def ensure_server(workspace: Workspace) -> dict[str, Any]:
    live = status(workspace)
    if live and live.get("version") == __version__:
        return live
    if live:
        stop(workspace)  # a server left over from an older install; replace it so it serves with current code
        time.sleep(0.3)
    log = workspace.path(LOG).open("ab")
    package_root = str(Path(__file__).resolve().parents[1])
    env = {**os.environ, "PYTHONPATH": package_root + (os.pathsep + os.environ["PYTHONPATH"] if os.environ.get("PYTHONPATH") else "")}
    subprocess.Popen([sys.executable, "-m", "vapi_build", "preview", "serve", str(workspace.root)], stdout=log, stderr=log, stdin=subprocess.DEVNULL,  # noqa: S603
                     start_new_session=True, env=env, close_fds=True)
    deadline = time.time() + START_TIMEOUT_SECONDS
    while time.time() < deadline:
        time.sleep(0.2)
        live = status(workspace, timeout=0.5)
        if live:
            return live
    raise BuildError(f"The preview server did not start; see {workspace.path(LOG)}.")


def open_review(workspace: Workspace, *, launch: Callable[[str], bool] = lambda url: webbrowser.open(url, new=2),
                ensure: Callable[[Workspace], dict[str, Any]] = ensure_server) -> dict[str, Any]:
    """Open the review page once. A tab that is already polling refreshes itself, so nothing is launched twice."""
    if not workspace.path(PAGE).exists():
        raise BuildError("Nothing to open: run `render` first.")
    live = ensure(workspace)
    if live.get("viewerOpen"):
        return {"action": "refreshed", **live}
    launched = launch(live["url"])
    return {"action": "opened" if launched else "manual", **live}


def stop(workspace: Workspace) -> bool:
    state_path = workspace.path(STATE)
    if not state_path.exists():
        return False
    pid = read_json(state_path).get("pid")
    state_path.unlink(missing_ok=True)
    try:
        if pid:
            os.kill(int(pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError, ValueError):
        return False
    return True
