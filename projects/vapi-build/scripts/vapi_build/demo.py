"""Sample datasets the skill can build from when the user has no material of their own.

A demo workspace registers every demo source itself and refuses anything else, and an ordinary
workspace refuses the demo sources, so the two never mix. Everything in a demo is synthetic: the
bank, its customers, their credentials, the transcripts, and the API. The credentials below are
published on purpose so the front door (ANI lookup, then PIN) can be exercised end to end.
"""
from __future__ import annotations

from typing import Any

from .workspace import BuildError, Workspace

STANDARD_CHARTER = {
    "id": "standard-charter",
    "name": "Standard Charter Bank",
    "summary": "A fictional US retail bank: checking, savings, cards, loans. Callers ask about balances, transactions, transfers, products, and policies. "
               "The API identifies callers by phone (ANI) and verifies a four-digit PIN; account operations need the resulting session token.",
    "audience": "customers",
    "callersByPhone": True,
    "sources": [
        {"role": "website", "location": "https://bank.standardcharter.co", "options": {"maxPages": 40}},
        {"role": "openapi", "location": "https://bank.standardcharter.co/openapi.json", "options": {"serverUrl": "https://bank.standardcharter.co"}},
        {"role": "knowledge", "location": "s3://standardcharter-vapi-build/knowledge", "options": {}},
        {"role": "transcripts", "location": "s3://standardcharter-vapi-build/transcripts", "options": {"privacy": "synthetic"}},
        {"role": "transcripts", "location": "s3://standardcharter-vapi-build/ivr", "options": {"privacy": "synthetic"}},
    ],
    # Hosts and buckets that belong to the demo; an ordinary workspace may not register them.
    "hosts": ("bank.standardcharter.co", "standardcharter.co", "standardcharter-vapi-build"),
    "s3Anonymous": True,
    # Variable name a plan uses for the MCP bearer; apply fills it from the published token unless the user saved their own.
    "secretsEnv": {"STANDARD_CHARTER_MCP_TOKEN": "scb_-bF5BCKF5oWPJV0jPjrfMJsdolY5Vzsh"},
    "auth": {
        "how": "Two ways to reach the bank; ask the user which they want (REST endpoints, the MCP server, or both). REST: call verifyCallerPin with the caller's phone and PIN; its response carries a `token`. Give that tool extract {\"sessionToken\": \"{{token}}\"} and put "
               "headers {\"Authorization\": \"Bearer {{sessionToken}}\"} on listAccounts, getAccount, listTransactions, and createTransfer. lookupCallerByPhone takes "
               "the caller's number ({{customer.number}}) as a staticParameter so the model never fills it; when the number is unknown, the agent asks for it. "
               "MCP: declare the server under mcpServers with auth {\"mode\": \"HEADER_ENV\", \"env\": \"STANDARD_CHARTER_MCP_TOKEN\"} and list it under the assistant's `mcp`; "
               "apply fills the bearer from the demo automatically, and the server's own tools (lookup by phone, verify PIN, accounts, transactions, transfers, help) verify the caller and remember the session for the call.",
        "customers": [
            {"customer_id": 1000000000, "name": "Ada Lovelace", "phone": "+19990000000", "pin": "4380", "email": "ada.lovelace.1000000000@scbank.example", "password": "VhLbMzpGDLzw",
             "accounts": "checking, savings, credit card"},
            {"customer_id": 1000000001, "name": "Grace Hopper", "phone": "+19990000001", "pin": "8053", "email": "grace.hopper.1000000001@scbank.example", "password": "LZzmZGAGj8DC",
             "accounts": "checking"},
            {"customer_id": 1000000002, "name": "Alan Turing", "phone": "+19990000002", "pin": "7091", "email": "alan.turing.1000000002@scbank.example", "password": "Qzs4ZPk2iiLP",
             "accounts": "see listAccounts"},
            {"customer_id": 1000000003, "name": "Katherine Johnson", "phone": "+19990000003", "pin": "6434", "email": "katherine.johnson.1000000003@scbank.example", "password": "82ciMPWx4eVe",
             "accounts": "see listAccounts"},
        ],
        "mcp": {"url": "https://bank.standardcharter.co/mcp", "bearer": "scb_-bF5BCKF5oWPJV0jPjrfMJsdolY5Vzsh",
                "note": "The same bank as an MCP server (lookup by phone, verify PIN, accounts, transactions, transfers, help search). Attach it to an assistant as a Vapi MCP tool "
                        "with this bearer in the Authorization header when a plan prefers MCP over API Request tools; the vapi-build plan itself uses the OpenAPI operations."},
        "web": "https://bank.standardcharter.co (sign in with a customer's email and password to see the same accounts the agent reads)",
    },
}

DEMOS: dict[str, dict[str, Any]] = {STANDARD_CHARTER["id"]: STANDARD_CHARTER}


def get(demo_id: str) -> dict[str, Any]:
    demo = DEMOS.get(demo_id)
    if demo is None:
        raise BuildError(f"Unknown demo {demo_id!r}; available: {', '.join(DEMOS)}.")
    return demo


def owning_demo(location: str) -> dict[str, Any] | None:
    """The demo a source location belongs to, by host or bucket, or None."""
    lowered = location.casefold()
    for demo in DEMOS.values():
        if any(host in lowered for host in demo["hosts"]):
            return demo
    return None


def is_demo_source(demo: dict[str, Any], role: str, location: str) -> bool:
    return any(s["role"] == role and s["location"].rstrip("/") == location.rstrip("/") for s in demo["sources"])


def register(workspace: Workspace, demo_id: str) -> list[dict[str, Any]]:
    """Mark the workspace as this demo's and register every demo source. Fails on a workspace that already has sources."""
    from . import sources  # local import: sources imports this module for the mixing guard

    demo = get(demo_id)
    if workspace.sources():
        raise BuildError("This workspace already has sources; a demo needs a fresh workspace so demo data never mixes with anything else.")
    workspace.project["demo"] = demo_id
    workspace.project["s3Anonymous"] = bool(demo.get("s3Anonymous"))
    workspace.project["audience"] = demo["audience"]
    workspace.save()
    return [sources.add_source(workspace, s["role"], s["location"], **s["options"]) for s in demo["sources"]]


def card(demo: dict[str, Any]) -> str:
    """What the agent tells the user about a demo: sources, how auth works, and the published synthetic credentials."""
    lines = [f"# Demo: {demo['name']} ({demo['id']})", "", demo["summary"], "", "Everything here is synthetic and published on purpose; nothing is a real person, account, or secret.", "",
             "## Sources registered"]
    for s in demo["sources"]:
        extra = ", ".join(f"{k}={v}" for k, v in s["options"].items())
        lines.append(f"- {s['role']}: {s['location']}" + (f" ({extra})" if extra else ""))
    auth = demo["auth"]
    lines += ["", "## Caller authentication", auth["how"], "", "## Demo customers (phone and PIN for the voice front door; email and password for the web site)"]
    for c in auth["customers"]:
        lines.append(f"- {c['name']} (id {c['customer_id']}): phone {c['phone']}, PIN {c['pin']}; web {c['email']} / {c['password']}; {c['accounts']}")
    lines += ["", "## MCP server (alternative to the REST tools)", f"- URL: {auth['mcp']['url']}", f"- Authorization: Bearer {auth['mcp']['bearer']}", f"- {auth['mcp']['note']}",
              "", "## Web site", f"- {auth['web']}"]
    return "\n".join(lines) + "\n"
