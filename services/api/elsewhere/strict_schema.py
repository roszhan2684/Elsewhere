"""Turn a Pydantic model into a schema that passes Meta's strict structured-output rules.

Strict mode (docs/meta-api-notes.md):
  - root is a plain object
  - every object: additionalProperties false, and every property listed in `required`
  - no oneOf / allOf (anyOf is fine below the root)
  - depth <= 10, no recursion
Optional fields stay optional by being nullable (`anyOf: [X, null]`), never by omission.
"""

from __future__ import annotations

import copy
from typing import Any

from pydantic import BaseModel

_DROP = {"default", "title", "examples"}
MAX_DEPTH = 10


class SchemaError(ValueError):
    pass


def strict_schema(model: type[BaseModel]) -> dict[str, Any]:
    raw = model.model_json_schema(mode="validation")
    defs = raw.pop("$defs", {})
    out = _walk(raw, defs, depth=0, seen=())
    if out.get("type") != "object":
        raise SchemaError("root must be an object")
    return out


def _walk(node: Any, defs: dict, depth: int, seen: tuple[str, ...]) -> Any:
    if depth > MAX_DEPTH:
        raise SchemaError(f"schema deeper than {MAX_DEPTH}")
    if isinstance(node, list):
        return [_walk(n, defs, depth, seen) for n in node]
    if not isinstance(node, dict):
        return node

    if "$ref" in node:
        name = node["$ref"].split("/")[-1]
        if name in seen:
            raise SchemaError(f"recursive schema at {name}")
        return _walk(copy.deepcopy(defs[name]), defs, depth, seen + (name,))

    node = {k: v for k, v in node.items() if k not in _DROP}
    for bad in ("oneOf", "allOf"):
        if bad in node:
            if bad == "allOf" and len(node[bad]) == 1:
                merged = {**node, **node.pop(bad)[0]}
                return _walk(merged, defs, depth, seen)
            node["anyOf"] = node.pop(bad)

    if node.get("type") == "object" or "properties" in node:
        props = node.get("properties", {})
        node["type"] = "object"
        node["properties"] = {k: _walk(v, defs, depth + 1, seen) for k, v in props.items()}
        node["required"] = list(props.keys())
        node["additionalProperties"] = False
        return node

    return {k: _walk(v, defs, depth + 1 if k in ("items", "anyOf") else depth, seen) for k, v in node.items()}


def text_format(model: type[BaseModel], name: str | None = None) -> dict[str, Any]:
    """The `text=` argument for the Responses API."""
    return {
        "format": {
            "type": "json_schema",
            "name": name or model.__name__,
            "schema": strict_schema(model),
            "strict": True,
        }
    }
