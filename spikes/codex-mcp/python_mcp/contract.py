from __future__ import annotations

import json
from typing import Any

from mcp import types


MAX_IDS = 5
OUTPUT_CAP_BYTES = 512
KNOWN_ID_VALUES = (
    "fixture-1",
    "fixture-2",
    "fixture-3",
    "fixture-4",
    "fixture-5",
    "fixture-1234567890",
)
KNOWN_IDS = frozenset(KNOWN_ID_VALUES)
SAFE_ERROR_TEXT = "invalid echo_library_ids input"

INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "ids": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
            "maxItems": MAX_IDS,
        }
    },
    "required": ["ids"],
    "additionalProperties": False,
}

OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "ids": {
            "type": "array",
            "items": {"type": "string", "enum": list(KNOWN_ID_VALUES)},
            "minItems": 1,
            "maxItems": MAX_IDS,
        }
    },
    "required": ["ids"],
    "additionalProperties": False,
}


def tool_definition() -> types.Tool:
    return types.Tool(
        name="echo_library_ids",
        description="Echo fixture library IDs after strict local validation.",
        input_schema=INPUT_SCHEMA,
        output_schema=OUTPUT_SCHEMA,
        annotations=types.ToolAnnotations(
            read_only_hint=True,
            destructive_hint=False,
            idempotent_hint=True,
            open_world_hint=False,
        ),
    )


def call_echo_library_ids(arguments: object) -> types.CallToolResult:
    validated = _validate_ids_object(arguments)
    if validated is None:
        return _safe_error()
    compact = json.dumps(validated, separators=(",", ":"), ensure_ascii=False)
    result = types.CallToolResult(
        content=[types.TextContent(text=compact)],
        structured_content=validated,
        is_error=False,
    )
    if len(result.model_dump_json(by_alias=True).encode("utf-8")) > OUTPUT_CAP_BYTES:
        return _safe_error()
    validate_echo_library_ids_result(result)
    return result


def validate_echo_library_ids_result(result: object) -> dict[str, list[str]]:
    try:
        if not isinstance(result, types.CallToolResult) or result.is_error:
            raise ValueError
        if len(result.content) != 1 or not isinstance(result.content[0], types.TextContent):
            raise ValueError
        if len(result.content[0].text.encode("utf-8")) > OUTPUT_CAP_BYTES:
            raise ValueError
        structured = _require_ids_object(result.structured_content)
        text = _require_ids_object(json.loads(result.content[0].text))
        if _compact_json(text) != _compact_json(structured):
            raise ValueError
        if len(result.model_dump_json(by_alias=True).encode("utf-8")) > OUTPUT_CAP_BYTES:
            raise ValueError
        return structured
    except (TypeError, ValueError, json.JSONDecodeError):
        raise ValueError("invalid echo_library_ids result") from None


def _safe_error() -> types.CallToolResult:
    return types.CallToolResult(
        content=[types.TextContent(text=SAFE_ERROR_TEXT)],
        is_error=True,
    )


def _validate_ids_object(value: object) -> dict[str, list[str]] | None:
    try:
        return _require_ids_object(value)
    except (TypeError, ValueError):
        return None


def _require_ids_object(value: object) -> dict[str, list[str]]:
    if not isinstance(value, dict) or set(value) != {"ids"}:
        raise ValueError
    ids = value["ids"]
    if not isinstance(ids, list) or not 1 <= len(ids) <= MAX_IDS:
        raise ValueError
    if not all(isinstance(item, str) and item in KNOWN_IDS for item in ids):
        raise ValueError
    return {"ids": list(ids)}


def _compact_json(value: object) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)
