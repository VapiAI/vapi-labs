"""OpenAPI operation inventory, risk classification, and schema conversion for Vapi tools."""
from __future__ import annotations

import copy
import re
from typing import Any

import yaml

from .workspace import BuildError, slug

HTTP_METHODS = ("get", "put", "post", "delete", "patch")
VAPI_FORMATS = {"date-time", "time", "date", "duration", "email", "hostname", "ipv4", "ipv6", "uuid"}
WORD = re.compile(r"[a-z0-9]+")
ADMIN_WORDS = {"admin", "demoadmin", "reset", "restore", "internal", "debug", "maintenance"}
DESTRUCTIVE_WORDS = {"delete", "remove", "reset", "close", "cancel", "terminate", "purge", "revoke"}
FINANCIAL_WORDS = {"transfer", "transfers", "payment", "payments", "pay", "deposit", "deposits", "withdraw", "withdrawal", "withdrawals",
                   "refund", "refunds", "charge", "charges", "billing", "purchase", "purchases", "order", "orders", "invoice", "invoices"}
IDENTITY_WORDS = {"auth", "login", "logout", "token", "tokens", "password", "otp", "verify", "verification", "identity", "me", "session", "ticket"}


def resolve(document: dict[str, Any], node: Any, _path: tuple[str, ...] = ()) -> Any:
    """Inline local $ref pointers. A reference already on the expansion path is replaced by a placeholder
    instead of recursing forever; scalars and plain objects are never altered."""
    if isinstance(node, dict):
        if isinstance(node.get("$ref"), str):
            target = node["$ref"]
            if target in _path or len(_path) > 32:
                return {"type": "object", "description": f"recursive reference to {target.rsplit('/', 1)[-1]}"}
            current: Any = document
            for token in target[2:].split("/"):
                token = token.replace("~1", "/").replace("~0", "~")
                current = current[token] if isinstance(current, dict) else current[int(token)]
            merged = copy.deepcopy(current) if isinstance(current, dict) else {"value": current}
            for key, value in node.items():
                if key != "$ref":
                    merged[key] = value
            return resolve(document, merged, _path + (target,))
        return {key: resolve(document, value, _path) for key, value in node.items()}
    if isinstance(node, list):
        return [resolve(document, item, _path) for item in node]
    return node


def _words(path: str, operation_id: str, operation: dict[str, Any]) -> set[str]:
    text = " ".join([
        re.sub(r"[{}]", " ", path),
        re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", operation_id),
        str(operation.get("summary") or ""),
        " ".join(str(tag) for tag in (operation.get("tags") or [])),
    ]).casefold()
    return set(WORD.findall(text))


def classify(method: str, path: str, operation_id: str, operation: dict[str, Any], document: dict[str, Any]) -> dict[str, Any]:
    words = _words(path, operation_id, operation)
    segments = {segment.casefold() for segment in path.split("/") if segment}
    admin = bool(words & ADMIN_WORDS) or any(segment.startswith("admin") for segment in segments)
    destructive = method == "DELETE" or bool(words & DESTRUCTIVE_WORDS)
    financial = bool(words & FINANCIAL_WORDS)
    identity = bool(words & IDENTITY_WORDS)
    security = operation.get("security", document.get("security", []))
    public = not security or "public" in segments or path in {"/health", "/status"}
    read = method in {"GET", "HEAD"}
    risk = "PRIVILEGED" if admin else "HIGH" if (destructive or financial) else "MEDIUM" if not read else "LOW"
    return {
        "read": read,
        "write": not read,
        "public": public,
        "requiresAuth": not public,
        "adminOrInternal": admin,
        "destructive": destructive,
        "financial": financial,
        "identitySensitive": identity,
        "risk": risk,
        # Every non-read operation confirms before the call. A plan may opt one out with a stated reason.
        "confirmBeforeCall": not read,
    }


def _params(path_item: dict[str, Any], operation: dict[str, Any], document: dict[str, Any]) -> list[dict[str, Any]]:
    merged: dict[tuple[str, str], dict[str, Any]] = {}
    for scope in (path_item.get("parameters") or [], operation.get("parameters") or []):
        for parameter in scope:
            parameter = resolve(document, parameter)
            if isinstance(parameter, dict) and parameter.get("name") and parameter.get("in"):
                merged[(parameter["in"], parameter["name"])] = parameter
    return list(merged.values())


def _body_schema(operation: dict[str, Any], document: dict[str, Any]) -> dict[str, Any] | None:
    body = resolve(document, operation.get("requestBody"))
    if not isinstance(body, dict):
        return None
    content = body.get("content") or {}
    for media in ("application/json", "application/x-www-form-urlencoded", "*/*"):
        if media in content and isinstance(content[media], dict) and isinstance(content[media].get("schema"), dict):
            return content[media]["schema"]
    for value in content.values():
        if isinstance(value, dict) and isinstance(value.get("schema"), dict):
            return value["schema"]
    return None


def _response_schema(operation: dict[str, Any], document: dict[str, Any]) -> dict[str, Any] | None:
    responses = resolve(document, operation.get("responses") or {})
    if not isinstance(responses, dict):
        return None
    for code in sorted(responses, key=str):
        if str(code).startswith("2") and isinstance(responses[code], dict):
            content = responses[code].get("content") or {}
            for value in content.values():
                if isinstance(value, dict) and isinstance(value.get("schema"), dict):
                    return value["schema"]
    return None


def to_vapi_schema(schema: Any, depth: int = 0) -> dict[str, Any]:
    """Project an arbitrary JSON Schema onto the subset Vapi's JsonSchema accepts. Never raises."""
    if not isinstance(schema, dict) or depth > 12:
        return {"type": "string"}
    if isinstance(schema.get("allOf"), list) and schema["allOf"]:
        merged: dict[str, Any] = {"type": "object", "properties": {}, "required": []}
        for part in schema["allOf"]:
            projected = to_vapi_schema(part, depth + 1)
            merged["properties"].update(projected.get("properties", {}))
            merged["required"] += [name for name in projected.get("required", []) if name not in merged["required"]]
        if not merged["required"]:
            merged.pop("required")
        if schema.get("description"):
            merged["description"] = schema["description"]
        return merged
    for key in ("oneOf", "anyOf"):
        if isinstance(schema.get(key), list) and schema[key]:
            first = to_vapi_schema(schema[key][0], depth + 1)
            if schema.get("description") and "description" not in first:
                first["description"] = schema["description"]
            return first
    kind = schema.get("type")
    if isinstance(kind, list):
        kind = next((k for k in kind if isinstance(k, str) and k != "null"), "string")
    if not isinstance(kind, str) or kind not in {"string", "number", "integer", "boolean", "array", "object"}:
        kind = "object" if isinstance(schema.get("properties"), dict) else "array" if "items" in schema else "string"
    out: dict[str, Any] = {"type": kind}
    for key in ("description", "title", "pattern"):
        if isinstance(schema.get(key), str) and schema[key]:
            out[key] = schema[key]
    if isinstance(schema.get("enum"), list) and schema["enum"] and all(isinstance(v, (str, int, float, bool)) for v in schema["enum"]):
        out["enum"] = [str(v) for v in schema["enum"]]
        out["type"] = "string"
    if schema.get("format") in VAPI_FORMATS and out["type"] == "string":
        out["format"] = schema["format"]
    if kind == "object":
        properties = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
        out["properties"] = {str(name): to_vapi_schema(value, depth + 1) for name, value in properties.items()}
        required = [name for name in (schema.get("required") or []) if isinstance(name, str) and name in out["properties"]]
        if required:
            out["required"] = required
    if kind == "array":
        out["items"] = to_vapi_schema(schema.get("items") if isinstance(schema.get("items"), dict) else {"type": "string"}, depth + 1)
    return out


def inventory(document: dict[str, Any], *, server_url: str | None) -> dict[str, Any]:
    operations = []
    seen_ids: set[str] = set()
    for path, path_item in sorted((document.get("paths") or {}).items()):
        if not isinstance(path_item, dict):
            continue
        for method in HTTP_METHODS:
            operation = path_item.get(method)
            if not isinstance(operation, dict):
                continue
            operation_id = str(operation.get("operationId") or "").strip()
            if not operation_id:
                operation_id = f"{method}_{slug(path, 80)}"
                counter = 2
                while operation_id in seen_ids:
                    operation_id = f"{method}_{slug(path, 76)}_{counter}"
                    counter += 1
            if operation_id in seen_ids:
                raise BuildError(f"Duplicate operationId in the OpenAPI document: {operation_id}")
            seen_ids.add(operation_id)
            try:
                parameters = _params(path_item, operation, document)
                body = _body_schema(operation, document)
                response = _response_schema(operation, document)
            except (KeyError, ValueError, IndexError, TypeError) as error:
                raise BuildError(f"OpenAPI operation {operation_id} has an unresolvable reference: {error}") from error
            classification = classify(method.upper(), path, operation_id, operation, document)
            tool_properties: dict[str, Any] = {}
            required: list[str] = []
            for parameter in parameters:
                if parameter["in"] not in {"path", "query"}:
                    continue
                projected = to_vapi_schema(parameter.get("schema") or {"type": "string"})
                if parameter.get("description") and "description" not in projected:
                    projected["description"] = parameter["description"]
                tool_properties[parameter["name"]] = projected
                if parameter["in"] == "path" or parameter.get("required"):
                    required.append(parameter["name"])
            if body is not None:
                projected = to_vapi_schema(body)
                if projected.get("type") == "object":
                    tool_properties.update(projected.get("properties", {}))
                    required += [name for name in projected.get("required", []) if name not in required]
                else:
                    tool_properties["body"] = projected
                    required.append("body")
            tool_schema: dict[str, Any] = {"type": "object", "properties": tool_properties}
            if required:
                tool_schema["required"] = required
            query_names = [p["name"] for p in parameters if p["in"] == "query"]
            path_names = [p["name"] for p in parameters if p["in"] == "path"]
            body_names = [name for name in tool_properties if name not in query_names and name not in path_names]
            capability_id = f"capability:{slug(operation_id, 60)}"
            text = yaml.safe_dump({
                "capability": capability_id,
                "operationId": operation_id, "method": method.upper(), "path": path,
                "summary": operation.get("summary"), "description": operation.get("description"), "tags": operation.get("tags"),
                "security": operation.get("security", document.get("security")),
                "parameters": [{k: v for k, v in resolve(document, p).items() if k in {"name", "in", "required", "description", "schema"}} for p in parameters],
                "requestBody": body, "response": response,
            }, sort_keys=False, allow_unicode=True, width=100).strip()
            operations.append({
                "id": capability_id,
                "operationId": operation_id, "method": method.upper(), "path": path,
                "summary": operation.get("summary") or "", "description": operation.get("description") or "",
                "tags": operation.get("tags") or [],
                "classification": classification,
                "toolSchema": tool_schema,
                "pathParams": path_names, "queryParams": query_names, "bodyParams": body_names,
                "responseSchema": to_vapi_schema(response) if response else None,
                "text": text,
            })
    if not operations:
        raise BuildError("The OpenAPI document declares no operations.")
    if len({op["id"] for op in operations}) != len(operations):
        raise BuildError("Two operationIds collapse to the same capability ID after normalization; rename one in the spec.")
    return {"openapiVersion": str(document.get("openapi")), "title": (document.get("info") or {}).get("title", ""), "serverUrl": server_url,
            "operationCount": len(operations), "operations": operations}


def tool_name(operation_id: str, taken: set[str]) -> str:
    base = re.sub(r"[^a-zA-Z0-9_-]", "_", operation_id)[:40] or "tool"
    name, counter = base, 2
    while name in taken:
        suffix = f"_{counter}"
        name = base[: 40 - len(suffix)] + suffix
        counter += 1
    taken.add(name)
    return name
