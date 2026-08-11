from __future__ import annotations

import json
import sys
from importlib.metadata import version
from pathlib import Path
from typing import Any

import anyio
from mcp import ClientSession, StdioServerParameters, stdio_client, types

from contract import validate_echo_library_ids_result


EXPECTED_MCP_VERSION = "2.0.0"
ROOT = Path(__file__).resolve().parent
SERVER = ROOT / "server.py"
EXPECTED_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "ids": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
            "maxItems": 5,
        }
    },
    "required": ["ids"],
    "additionalProperties": False,
}
EXPECTED_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "ids": {
            "type": "array",
            "items": {
                "type": "string",
                "enum": [
                    "fixture-1",
                    "fixture-2",
                    "fixture-3",
                    "fixture-4",
                    "fixture-5",
                    "fixture-1234567890",
                ],
            },
            "minItems": 1,
            "maxItems": 5,
        }
    },
    "required": ["ids"],
    "additionalProperties": False,
}
EXPECTED_ANNOTATIONS = {
    "readOnlyHint": True,
    "destructiveHint": False,
    "idempotentHint": True,
    "openWorldHint": False,
}
EXPECTED_TOOL = {
    "name": "echo_library_ids",
    "description": "Echo fixture library IDs after strict local validation.",
    "inputSchema": EXPECTED_INPUT_SCHEMA,
    "outputSchema": EXPECTED_OUTPUT_SCHEMA,
    "annotations": EXPECTED_ANNOTATIONS,
}


def require_exact_mcp_distribution() -> str:
    installed = version("mcp")
    if installed != EXPECTED_MCP_VERSION:
        raise RuntimeError("required mcp distribution unavailable")
    return installed


def validate_listed_tools(tools: list[types.Tool]) -> dict[str, object]:
    try:
        if len(tools) != 1:
            raise ValueError
        serialized = tools[0].model_dump(by_alias=True, exclude_none=True)
        if serialized != EXPECTED_TOOL:
            raise ValueError
        return {
            "name": serialized["name"],
            "description": serialized["description"],
            "inputSchema": serialized["inputSchema"],
            "outputSchema": serialized["outputSchema"],
            "annotations": serialized["annotations"],
        }
    except (KeyError, TypeError, ValueError):
        raise ValueError("invalid echo_library_ids listing") from None


async def run_probe() -> dict[str, object]:
    installed = require_exact_mcp_distribution()
    parameters = StdioServerParameters(
        command=sys.executable,
        args=["-W", "error", str(SERVER)],
        cwd=ROOT,
        env={"PYTHONWARNINGS": "error"},
    )
    async with stdio_client(parameters) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            initialized = await session.initialize()
            listed = await session.list_tools()
            tool = validate_listed_tools(listed.tools)
            result = await session.call_tool(
                "echo_library_ids",
                {"ids": ["fixture-2", "fixture-1"]},
            )
            validated = validate_echo_library_ids_result(result)
    return {
        "mode": "stdio",
        "mcpDistributionVersion": installed,
        "server": {
            "name": initialized.server_info.name,
            "version": initialized.server_info.version,
        },
        "tool": tool,
        "validated": validated,
    }


def run_local_only() -> dict[str, str]:
    return {"mode": "local_only"}


def main() -> int:
    if sys.argv[1:] == ["--local-only"]:
        sys.stdout.write('{"mode":"local_only"}\n')
        return 0
    if len(sys.argv) != 1:
        sys.stderr.write("python mcp probe rejected arguments\n")
        return 64
    try:
        evidence = anyio.run(run_probe)
        serialized = json.dumps(evidence, separators=(",", ":"), ensure_ascii=False)
        if len(serialized.encode("utf-8")) > 2_047:
            raise ValueError
        sys.stdout.write(f"{serialized}\n")
        return 0
    except BaseException:
        sys.stderr.write("python mcp stdio probe failed\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
