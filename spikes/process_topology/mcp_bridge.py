"""Stateless MCP stdio-to-core stand-in.

Stdio is newline-delimited JSON for the stand-in only. Length-prefixed core
frames exist exclusively on the private Unix socket. This module intentionally
has no database import, path argument, or persistence.
"""

from __future__ import annotations

import argparse
import math
import socket
import sys
import time
from pathlib import Path
from typing import Any, BinaryIO, TextIO

from .protocol import MAX_PAYLOAD, FrameDecoder, ProtocolError, canonical_json, decode_payload, encode_frame


class MCPBridge:
    def __init__(
        self, socket_path: str | Path, session_id: str, capability: str, *, timeout_seconds: float,
    ) -> None:
        if (
            not isinstance(timeout_seconds, (int, float))
            or isinstance(timeout_seconds, bool)
            or not math.isfinite(timeout_seconds)
            or timeout_seconds <= 0
            or timeout_seconds > 30
        ):
            raise ValueError("timeout_seconds must be finite, greater than 0, and at most 30")
        self.socket_path = Path(socket_path)
        self.session_id = session_id
        self._timeout_seconds = float(timeout_seconds)
        deadline = time.monotonic() + self._timeout_seconds
        self._socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            self._set_deadline_timeout(deadline)
            self._socket.connect(str(self.socket_path))
            self._remaining(deadline)
            self._decoder = FrameDecoder()
            self._pending: list[dict[str, Any]] = []
            self._set_deadline_timeout(deadline)
            self._socket.sendall(encode_frame({
                "type": "handshake", "version": 1,
                "role": "mcp-bridge", "session_id": session_id,
                "capability": capability,
            }))
            self._remaining(deadline)
            reply = self._receive(deadline)
            if reply.get("type") != "handshake-accepted":
                raise RuntimeError(f"core rejected MCP bridge handshake: {reply.get('error', {})}")
        except BaseException:
            self.close()
            raise

    @staticmethod
    def _remaining(deadline: float) -> float:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("MCP bridge operation exceeded its absolute deadline")
        return remaining

    def _set_deadline_timeout(self, deadline: float) -> None:
        self._socket.settimeout(self._remaining(deadline))

    def _receive(self, deadline: float) -> dict[str, Any]:
        self._remaining(deadline)
        if self._pending:
            return self._pending.pop(0)
        while True:
            self._set_deadline_timeout(deadline)
            chunk = self._socket.recv(65_540)
            self._remaining(deadline)
            if not chunk:
                raise EOFError("core closed the private socket")
            decoded = self._decoder.feed(chunk)
            if decoded:
                self._pending.extend(decoded[1:])
                return decoded[0]

    def handle_stdio_message(self, message: dict[str, Any]) -> dict[str, Any]:
        request_id = message.get("id")
        operation = message.get("operation")
        payload = message.get("payload")
        if not isinstance(request_id, str) or not isinstance(operation, str) or not isinstance(payload, dict):
            return {
                "id": request_id,
                "status": "failed",
                "error": {"code": "invalid_stdio_request", "message": "id, operation, and object payload are required"},
            }
        core_message = {"type": "request", "id": request_id, "operation": operation, "payload": payload}
        if "idempotency_key" in message:
            core_message["idempotency_key"] = message["idempotency_key"]
        deadline = time.monotonic() + self._timeout_seconds
        try:
            self._set_deadline_timeout(deadline)
            self._socket.sendall(encode_frame(core_message))
            self._remaining(deadline)
            while True:
                reply = self._receive(deadline)
                if reply.get("request_id") != request_id or reply.get("type") != "terminal":
                    # MCP stand-in intentionally does not expose core progress frames.
                    continue
                output = {"id": request_id, "status": reply["status"]}
                if "result" in reply:
                    output["result"] = reply["result"]
                if "error" in reply:
                    output["error"] = reply["error"]
                return output
        except BaseException:
            # A timed-out or otherwise failed framed exchange cannot be safely resumed.
            self.close()
            raise

    def close(self) -> None:
        try:
            self._socket.close()
        except OSError:
            pass


def run_stdio(
    socket_path: str | Path, session_id: str, capability: str, stdin: BinaryIO, stdout: TextIO,
    *, timeout_seconds: float,
) -> int:
    bridge = MCPBridge(socket_path, session_id, capability, timeout_seconds=timeout_seconds)
    try:
        while True:
            line = stdin.readline(MAX_PAYLOAD + 2)
            if not line:
                break
            has_newline = line.endswith(b"\n")
            content = line[:-1] if has_newline else line
            if content.endswith(b"\r"):
                content = content[:-1]
            if len(content) > MAX_PAYLOAD or (not has_newline and len(line) > MAX_PAYLOAD):
                while not has_newline:
                    remainder = stdin.readline(MAX_PAYLOAD + 2)
                    if not remainder:
                        break
                    has_newline = remainder.endswith(b"\n")
                response = {
                    "id": None,
                    "status": "failed",
                    "error": {"code": "stdio_line_too_large", "message": "stdio JSON line exceeds 65536 bytes"},
                }
                stdout.write(canonical_json(response).decode("utf-8") + "\n")
                stdout.flush()
                continue
            try:
                message = decode_payload(content)
                response = bridge.handle_stdio_message(message)
            except ProtocolError as exc:
                response = {
                    "id": None,
                    "status": "failed",
                    "error": exc.as_dict(),
                }
            stdout.write(canonical_json(response).decode("utf-8") + "\n")
            stdout.flush()
    finally:
        bridge.close()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 0 MCP bridge stand-in")
    parser.add_argument("socket_path")
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--capability-file", required=True)
    parser.add_argument("--timeout-seconds", required=True, type=float)
    args = parser.parse_args()
    capability_path = Path(args.capability_file)
    if capability_path.stat().st_mode & 0o077:
        raise SystemExit("capability file must not be accessible by group/other")
    capability = capability_path.read_text(encoding="utf-8").strip()
    return run_stdio(
        args.socket_path, args.session_id, capability, sys.stdin.buffer, sys.stdout,
        timeout_seconds=args.timeout_seconds,
    )


if __name__ == "__main__":
    raise SystemExit(main())
