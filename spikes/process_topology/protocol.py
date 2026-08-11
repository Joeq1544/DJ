"""Bounded core RPC framing and validation for the Phase 0 topology spike."""

from __future__ import annotations

import json
import math
import struct
from collections import deque
from hashlib import sha256
from typing import Any


MAX_PAYLOAD = 65_536
MAX_JSON_DEPTH = 32
MAX_JSON_NODES = 4_096
MIN_JSON_INTEGER = -(1 << 63)
MAX_JSON_INTEGER = (1 << 63) - 1
CAPABILITY_MIN_BYTES = 32
CAPABILITY_MAX_BYTES = 128
CAPABILITY_ALPHABET = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
TERMINAL_STATUSES = frozenset({"succeeded", "failed", "cancelled", "outcome-unknown"})


class ProtocolError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def as_dict(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}


def canonical_json(value: Any) -> bytes:
    try:
        _validate_json_value(value)
    except ProtocolError as exc:
        raise ValueError(f"canonical JSON rejected value: {exc.message}") from exc
    try:
        encoded = json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise ValueError("canonical JSON requires JSON values and finite numbers") from exc
    return encoded.encode("utf-8")


def canonical_hash(value: Any) -> str:
    return sha256(canonical_json(value)).hexdigest()


def encode_frame(value: dict[str, Any]) -> bytes:
    if not isinstance(value, dict):
        raise ProtocolError("invalid_top_level", "frame payload must be a JSON object")
    payload = canonical_json(value)
    if not payload:
        raise ProtocolError("frame_empty", "frame payload cannot be empty")
    if len(payload) > MAX_PAYLOAD:
        raise ProtocolError("frame_too_large", "frame payload exceeds 65536 bytes")
    return struct.pack(">I", len(payload)) + payload


def _duplicate_rejector(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ProtocolError("duplicate_key", f"duplicate JSON object key: {key}")
        result[key] = value
    return result


def _reject_constant(value: str) -> Any:
    raise ProtocolError("invalid_json_constant", f"invalid JSON constant: {value}")


def _reject_float(raw: str) -> Any:
    if not math.isfinite(float(raw)):
        raise ProtocolError("invalid_json_constant", "JSON numbers must be finite")
    raise ProtocolError(
        "float_contract_unsupported",
        "JSON transport uses an integer-only numeric contract",
    )


def _parse_json_int(raw: str) -> int:
    negative = raw.startswith("-")
    digits = raw[1:] if negative else raw
    limit = "9223372036854775808" if negative else "9223372036854775807"
    if len(digits) > len(limit) or (len(digits) == len(limit) and digits > limit):
        raise ProtocolError("integer_out_of_range", "JSON integer exceeds signed 64-bit range")
    return int(raw)


def _validate_json_value(value: Any, depth: int = 0, counter: list[int] | None = None) -> None:
    if counter is None:
        counter = [0]
    counter[0] += 1
    if counter[0] > MAX_JSON_NODES:
        raise ProtocolError("json_too_many_nodes", "JSON value exceeds the node bound")
    if depth > MAX_JSON_DEPTH:
        raise ProtocolError("json_too_deep", "JSON value exceeds the nesting bound")
    if isinstance(value, str):
        try:
            value.encode("utf-8", "strict")
        except UnicodeEncodeError as exc:
            raise ProtocolError("invalid_unicode", "JSON string contains an unpaired surrogate") from exc
    elif isinstance(value, bool) or value is None:
        return
    elif isinstance(value, int):
        if value < MIN_JSON_INTEGER or value > MAX_JSON_INTEGER:
            raise ProtocolError("integer_out_of_range", "JSON integer exceeds signed 64-bit range")
    elif isinstance(value, float):
        if not math.isfinite(value):
            raise ProtocolError("invalid_json_constant", "JSON numbers must be finite")
        raise ProtocolError(
            "float_contract_unsupported",
            "JSON transport uses an integer-only numeric contract",
        )
    elif isinstance(value, list):
        for child in value:
            _validate_json_value(child, depth + 1, counter)
    elif isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str):
                raise ProtocolError("invalid_object_key", "JSON object keys must be strings")
            _validate_json_value(key, depth + 1, counter)
            _validate_json_value(child, depth + 1, counter)
    else:
        raise ProtocolError("invalid_json_type", "value is not representable as JSON")


def decode_payload(payload: bytes) -> dict[str, Any]:
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ProtocolError("invalid_utf8", "frame payload is not valid UTF-8") from exc
    try:
        value = json.loads(
            text,
            object_pairs_hook=_duplicate_rejector,
            parse_constant=_reject_constant,
            parse_int=_parse_json_int,
            parse_float=_reject_float,
        )
    except ProtocolError:
        raise
    except (RecursionError, MemoryError, OverflowError) as exc:
        raise ProtocolError("json_resource_limit", "JSON parser resource limit exceeded") from exc
    except json.JSONDecodeError as exc:
        raise ProtocolError("invalid_json", "frame payload is not valid JSON") from exc
    if not isinstance(value, dict):
        raise ProtocolError("invalid_top_level", "frame payload must be a JSON object")
    _validate_json_value(value)
    return value


class FrameDecoder:
    """Streaming decoder that rejects an invalid length after only four bytes."""

    def __init__(self) -> None:
        self._buffer = bytearray()
        self._expected: int | None = None

    def feed(self, data: bytes) -> list[dict[str, Any]]:
        self._buffer.extend(data)
        output: list[dict[str, Any]] = []
        while True:
            if self._expected is None:
                if len(self._buffer) < 4:
                    break
                self._expected = struct.unpack(">I", self._buffer[:4])[0]
                del self._buffer[:4]
                if self._expected == 0:
                    raise ProtocolError("frame_empty", "zero-length frames are forbidden")
                if self._expected > MAX_PAYLOAD:
                    raise ProtocolError("frame_too_large", "frame payload exceeds 65536 bytes")
            if len(self._buffer) < self._expected:
                break
            payload = bytes(self._buffer[: self._expected])
            del self._buffer[: self._expected]
            self._expected = None
            output.append(decode_payload(payload))
        return output

    def finish(self) -> None:
        if self._buffer or self._expected is not None:
            raise ProtocolError("incomplete_frame", "stream ended with a trailing incomplete frame")


def _bounded_string(value: Any, code: str, label: str, maximum: int = 128) -> str:
    if not isinstance(value, str) or not value or len(value.encode("utf-8")) > maximum:
        raise ProtocolError(code, f"{label} must be a non-empty bounded string")
    return value


def validate_capability_token(value: Any) -> str:
    if (
        not isinstance(value, str)
        or not (CAPABILITY_MIN_BYTES <= len(value) <= CAPABILITY_MAX_BYTES)
        or any(character not in CAPABILITY_ALPHABET for character in value)
    ):
        raise ProtocolError(
            "invalid_handshake_capability",
            "capability must be a bounded ASCII URL-safe token",
        )
    return value


def validate_handshake(value: dict[str, Any]) -> dict[str, Any]:
    if value.get("type") != "handshake":
        raise ProtocolError("handshake_required", "first client message must be a handshake")
    if type(value.get("version")) is not int or value.get("version") != 1:
        raise ProtocolError("version_mismatch", "protocol version 1 is required")
    if value.get("role") not in {"trusted-main", "mcp-bridge"}:
        raise ProtocolError("invalid_role", "role must be trusted-main or mcp-bridge")
    _bounded_string(value.get("session_id"), "invalid_session_id", "session_id")
    validate_capability_token(value.get("capability"))
    if set(value) != {"type", "version", "role", "session_id", "capability"}:
        raise ProtocolError("invalid_handshake_schema", "handshake has unknown or missing fields")
    return value


def validate_request(value: dict[str, Any]) -> dict[str, Any]:
    if value.get("type") != "request":
        raise ProtocolError("invalid_request", "message must be a request")
    _bounded_string(value.get("id"), "invalid_request_id", "request id")
    _bounded_string(value.get("operation"), "invalid_operation", "operation")
    if not isinstance(value.get("payload"), dict):
        raise ProtocolError("invalid_request_payload", "request payload must be an object")
    allowed = {"type", "id", "operation", "payload", "idempotency_key"}
    if not set(value).issubset(allowed):
        raise ProtocolError("invalid_request_schema", "request has unknown fields")
    if "idempotency_key" in value:
        _bounded_string(value["idempotency_key"], "invalid_idempotency_key", "idempotency key")
    return value


class CrashLoopPolicy:
    """Small supervisor policy: bounded attempts in a moving window."""

    def __init__(self, max_restarts: int, window_seconds: float, base_delay: float) -> None:
        if max_restarts < 1 or window_seconds <= 0 or base_delay <= 0:
            raise ValueError("crash loop bounds must be positive")
        self.max_restarts = max_restarts
        self.window_seconds = window_seconds
        self.base_delay = base_delay
        self._crashes: deque[float] = deque()

    def record_crash(self, now: float) -> float | None:
        while self._crashes and now - self._crashes[0] >= self.window_seconds:
            self._crashes.popleft()
        if len(self._crashes) >= self.max_restarts:
            return None
        self._crashes.append(now)
        return self.base_delay * (2 ** (len(self._crashes) - 1))
