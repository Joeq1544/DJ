"""Test-only JSON-lines oracle for the existing Python protocol contract."""

from __future__ import annotations

import base64
import json
import sys
from typing import Any

from spikes.process_topology import protocol


def _decode_raw(command: dict[str, Any]) -> dict[str, Any]:
    return protocol.decode_payload(command["raw"].encode("utf-8"))


def _answer(command: dict[str, Any]) -> dict[str, Any]:
    action = command.get("action")
    if action == "canonical":
        value = _decode_raw(command)
        encoded = protocol.canonical_json(value)
        return {
            "ok": True,
            "canonical_base64": base64.b64encode(encoded).decode("ascii"),
            "hash": protocol.canonical_hash(value),
        }
    if action == "encode_frame":
        encoded = protocol.encode_frame(_decode_raw(command))
        return {"ok": True, "frame_base64": base64.b64encode(encoded).decode("ascii")}
    if action == "decode_payload":
        value = protocol.decode_payload(base64.b64decode(command["payload_base64"], validate=True))
        encoded = protocol.canonical_json(value)
        return {"ok": True, "canonical_base64": base64.b64encode(encoded).decode("ascii")}
    if action == "decode_chunks":
        decoder = protocol.FrameDecoder()
        frames: list[dict[str, Any]] = []
        for chunk in command["chunks_base64"]:
            frames.extend(decoder.feed(base64.b64decode(chunk, validate=True)))
        if command.get("finish", True):
            decoder.finish()
        return {
            "ok": True,
            "frames_base64": [
                base64.b64encode(protocol.canonical_json(frame)).decode("ascii") for frame in frames
            ],
        }
    if action in {"validate_handshake", "validate_request"}:
        value = _decode_raw(command)
        validator = (
            protocol.validate_handshake if action == "validate_handshake" else protocol.validate_request
        )
        validator(value)
        return {
            "ok": True,
            "canonical_base64": base64.b64encode(protocol.canonical_json(value)).decode("ascii"),
        }
    raise ValueError("unknown oracle action")


def main() -> int:
    for line in sys.stdin:
        try:
            command = json.loads(line)
            result = _answer(command)
        except protocol.ProtocolError as exc:
            result = {"ok": False, "error": exc.code}
            if command.get("include_message"):
                result["message"] = exc.message
        except ValueError as exc:
            result = {"ok": False, "error": "value_error", "detail": str(exc)}
        print(json.dumps(result, separators=(",", ":")), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
