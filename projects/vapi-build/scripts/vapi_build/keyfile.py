"""Manage ~/.config/vapi-build/env, the only place the CLI reads API keys and tool tokens from.

Values are copied from an environment variable or another file by the CLI itself, so a secret never
has to pass through the conversation. Nothing here ever prints a value; only names and lengths.
"""
from __future__ import annotations

import getpass
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from . import vapi as _vapi
from .vapi import KEY_VARIABLES, load_env_file  # noqa: E402
from .workspace import BuildError

NAME = re.compile(r"^[A-Z][A-Z0-9_]{2,63}$")
PROFILE_FILE = Path("~/.config/agent-strategist/vapi-profiles.yaml")
PROFILE_SECRETS = Path("~/.config/agent-strategist/secrets.env")


def _validate_name(name: str) -> str:
    if not NAME.match(name):
        raise BuildError(f"{name!r} is not a valid variable name (uppercase letters, digits, underscores).")
    return name


def _validate_value(value: str, name: str) -> str:
    value = value.strip()
    if not value:
        raise BuildError(f"The value for {name} is empty.")
    if any(ch.isspace() for ch in value) or "\n" in value:
        raise BuildError(f"The value for {name} contains whitespace; keys and tokens never do.")
    return value


def write_entries(updates: dict[str, str], key_file: Path | None = None) -> Path:
    """Merge updates into the key file, creating it with owner-only permissions. Existing lines survive."""
    path = (key_file or _vapi.KEY_FILE).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    existing = load_env_file(path)
    merged = {**existing, **updates}
    body = "# Written by vapi-build. One NAME=value per line; the skill reads names, never prints values.\n"
    body += "".join(f"{name}={value}\n" for name, value in merged.items())
    path.touch(mode=0o600, exist_ok=True)
    path.chmod(0o600)
    path.write_text(body, encoding="utf-8")
    return path


def read_from_login_shell(variable: str, shell: str | None = None) -> str:
    """Evaluate the user's own login shell so exports in ~/.zshrc or ~/.bash_profile resolve exactly as they do for them."""
    shell = shell or os.environ.get("SHELL") or "/bin/zsh"
    try:
        completed = subprocess.run([shell, "-ilc", f'printf %s "${{{variable}}}"'], capture_output=True, text=True, timeout=20, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return completed.stdout.strip() if completed.returncode == 0 else ""


def set_from_env(name: str, source: str, env: dict[str, str] | None = None, key_file: Path | None = None, shell_reader=read_from_login_shell) -> dict[str, Any]:
    _validate_name(name)
    _validate_name(source)
    env = os.environ if env is None else env
    value = env.get(source)
    origin = f"environment variable {source}"
    if not value:
        value = shell_reader(source)
        origin = f"{source} exported in the login shell profile"
    if not value:
        raise BuildError(f"{source} is not set in this shell or in the login shell profile. Use --from-file PATH --var NAME if it lives in a file.")
    write_entries({name: _validate_value(value, name)}, key_file)
    return {"name": name, "source": origin, "length": len(value.strip())}


def set_from_file(name: str, path: str, variable: str | None = None, key_file: Path | None = None) -> dict[str, Any]:
    _validate_name(name)
    source = Path(path).expanduser()
    if not source.is_file():
        raise BuildError(f"{source} is not a file.")
    text = source.read_text(encoding="utf-8", errors="replace")
    entries = load_env_file(source)
    variable = variable or name
    if entries:
        value = entries.get(variable) or (next(iter(entries.values())) if len(entries) == 1 and variable == name else None)
        if not value:
            raise BuildError(f"{source} has no line for {variable}; variables present: {', '.join(sorted(entries)) or 'none'}.")
    else:
        # A file holding just the bare secret.
        lines = [line.strip() for line in text.splitlines() if line.strip() and not line.strip().startswith("#")]
        if len(lines) != 1:
            raise BuildError(f"{source} is neither a NAME=value file nor a single-line secret.")
        value = lines[0]
    write_entries({name: _validate_value(value, name)}, key_file)
    return {"name": name, "source": str(source), "length": len(value.strip())}


def set_from_profile(name: str, alias: str, key_file: Path | None = None, profiles: Path = PROFILE_FILE, secrets: Path = PROFILE_SECRETS) -> dict[str, Any]:
    """Reuse the Vapi GTM skill pack's profile convention: an alias naming the variable that holds the private key."""
    _validate_name(name)
    profiles_path = profiles.expanduser()
    if not profiles_path.is_file():
        raise BuildError(f"No profile file at {profiles_path}.")
    import yaml

    loaded = yaml.safe_load(profiles_path.read_text(encoding="utf-8")) or {}
    candidates = loaded.get("profiles", loaded) if isinstance(loaded, dict) else {}
    profile = candidates.get(alias) if isinstance(candidates, dict) else None
    if not isinstance(profile, dict):
        raise BuildError(f"Profile {alias!r} not found; available: {', '.join(sorted(candidates)) if isinstance(candidates, dict) else 'none'}.")
    variable = profile.get("privateKeyEnv") or profile.get("tokenEnv")
    if not variable:
        raise BuildError(f"Profile {alias!r} has no privateKeyEnv.")
    value = os.environ.get(variable) or load_env_file(secrets).get(variable)
    if not value:
        raise BuildError(f"{variable} (from profile {alias!r}) is set neither in the environment nor in {secrets.expanduser()}.")
    write_entries({name: _validate_value(value, name)}, key_file)
    return {"name": name, "source": f"profile {alias} ({variable})", "length": len(value.strip())}


def init_placeholders(names: list[str], key_file: Path | None = None) -> dict[str, Any]:
    """Create the file with empty lines for names not yet present, so the user can fill it in an editor."""
    key_file = key_file or _vapi.KEY_FILE
    existing = load_env_file(key_file)
    missing = [_validate_name(n) for n in names if not existing.get(n)]
    path = key_file.expanduser()
    if not path.exists() or missing:
        current = path.read_text(encoding="utf-8") if path.exists() else "# Written by vapi-build. One NAME=value per line; the skill reads names, never prints values.\n"
        for name in missing:
            if not re.search(rf"^{re.escape(name)}=", current, re.M):
                current += f"{name}=\n"
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        path.touch(mode=0o600, exist_ok=True)
        path.chmod(0o600)
        path.write_text(current, encoding="utf-8")
    return {"path": str(path), "present": sorted(n for n in names if existing.get(n)), "placeholders": missing}


def status(names: list[str] | None = None, key_file: Path | None = None) -> dict[str, Any]:
    key_file = key_file or _vapi.KEY_FILE
    entries = load_env_file(key_file)
    wanted = names or sorted(set(entries) | set(KEY_VARIABLES[:1]))
    return {"path": str(key_file.expanduser()), "exists": key_file.expanduser().exists(),
            "present": sorted(n for n in wanted if entries.get(n)), "missing": sorted(n for n in wanted if not entries.get(n))}


def verify_key(client: Any) -> dict[str, Any]:
    """One read-only call proves the key works and shows which organization it belongs to."""
    assistants = client.request("GET", "/assistant?limit=1") or []
    org = assistants[0].get("orgId") if isinstance(assistants, list) and assistants and isinstance(assistants[0], dict) else None
    return {"ok": True, "assistantsVisible": len(assistants) if isinstance(assistants, list) else 0, "orgId": org}


SECRET_LINE = re.compile(r"^\s*(?:export\s+)?(VAPI_[A-Z0-9_]*(?:KEY|TOKEN|SECRET)[A-Z0-9_]*)\s*=", re.M)
SKIP_DIRS = {"node_modules", ".git", ".venv", "venv", "__pycache__", "Library", ".Trash", ".cache", "dist", "build", ".next", "target"}
PROFILE_FILES = ("~/.zshrc", "~/.zprofile", "~/.zshenv", "~/.bashrc", "~/.bash_profile", "~/.profile")


def find_candidates(roots: list[Path] | None = None, *, profiles: tuple[str, ...] = PROFILE_FILES, max_depth: int = 4, max_files: int = 4000) -> list[dict[str, Any]]:
    """Where on this machine might a Vapi key already live? Reports paths and variable names only."""
    roots = roots or [Path("~/.config").expanduser(), Path("~/Developer").expanduser(), Path.cwd()]
    found: list[dict[str, Any]] = []
    seen_paths: set[Path] = set()

    def inspect(path: Path, kind: str) -> None:
        try:
            if path in seen_paths or not path.is_file() or path.stat().st_size > 256 * 1024:
                return
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return
        seen_paths.add(path)
        names = sorted(set(SECRET_LINE.findall(text)))
        if names:
            found.append({"path": str(path), "variables": names, "kind": kind})

    for profile in profiles:
        inspect(Path(profile).expanduser(), "shell profile")
    budget = max_files
    for root in roots:
        root = root.expanduser()
        if not root.is_dir():
            continue
        base_depth = len(root.parts)
        for current, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not (d.startswith(".") and d not in {".config"})]
            if len(Path(current).parts) - base_depth >= max_depth:
                dirs[:] = []
            for name in files:
                budget -= 1
                if budget <= 0:
                    return found
                lowered = name.casefold()
                if lowered.startswith(".env") or lowered.endswith(".env") or lowered in {"secrets.env", "vapi.env", "credentials"}:
                    inspect(Path(current) / name, "file")
    return found


def prompt_and_save(name: str, key_file: Path | None = None) -> dict[str, Any]:
    """Interactive fallback for a terminal: hidden input, written straight to the key file."""
    _validate_name(name)
    if not sys.stdin.isatty():
        raise BuildError("This needs an interactive terminal: run the same command in the Terminal tab of the Claude app, where the input stays hidden and never enters the chat.")
    value = getpass.getpass(f"Paste the value for {name} (input is hidden): ")
    write_entries({name: _validate_value(value, name)}, key_file)
    return {"name": name, "source": "hidden terminal prompt", "length": len(value.strip())}
