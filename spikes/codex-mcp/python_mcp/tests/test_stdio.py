from __future__ import annotations

import importlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

import anyio
from mcp import ClientSession, MCPError, StdioServerParameters, stdio_client, types


ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "server.py"
CLIENT = ROOT / "client.py"
SLOW_SERVER = ROOT / "tests" / "slow_server_fixture.py"
PYTHON = ROOT / ".venv" / "bin" / "python"
sys.path.insert(0, str(ROOT))


EXPECTED_INPUT_SCHEMA = {
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
EXPECTED_OUTPUT_SCHEMA = {
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


class StdioTests(unittest.TestCase):
    def client_module(self):
        try:
            return importlib.import_module("client")
        except ModuleNotFoundError:
            self.fail("client module is unavailable")

    def test_client_probe_uses_real_stdio_and_returns_bounded_validated_evidence(self) -> None:
        completed = subprocess.run(
            [str(PYTHON), "-W", "error", str(CLIENT)],
            cwd=ROOT,
            env={**os.environ, "PYTHONWARNINGS": "error"},
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stderr, "")
        self.assertEqual(len(completed.stdout.encode("utf-8")) <= 2_048, True)
        self.assertTrue(completed.stdout.endswith("\n"))
        self.assertEqual(completed.stdout.count("\n"), 1)
        evidence = json.loads(completed.stdout)
        self.assertEqual(
            evidence,
            {
                "mode": "stdio",
                "mcpDistributionVersion": "2.0.0",
                "server": {"name": "dj-copilot-python-mcp-spike", "version": "0.0.0"},
                "tool": {
                    "name": "echo_library_ids",
                    "description": "Echo fixture library IDs after strict local validation.",
                    "inputSchema": EXPECTED_INPUT_SCHEMA,
                    "outputSchema": EXPECTED_OUTPUT_SCHEMA,
                    "annotations": EXPECTED_ANNOTATIONS,
                },
                "validated": {"ids": ["fixture-2", "fixture-1"]},
            },
        )

    def test_client_rejects_changed_or_additional_listed_tools_before_call(self) -> None:
        client = self.client_module()
        valid = types.Tool(
            name="echo_library_ids",
            description="Echo fixture library IDs after strict local validation.",
            input_schema=EXPECTED_INPUT_SCHEMA,
            output_schema=EXPECTED_OUTPUT_SCHEMA,
            annotations=types.ToolAnnotations(
                read_only_hint=True,
                destructive_hint=False,
                idempotent_hint=True,
                open_world_hint=False,
            ),
        )
        changed = valid.model_copy(update={"output_schema": {**EXPECTED_OUTPUT_SCHEMA, "additionalProperties": True}})
        open_world = valid.model_copy(
            update={"annotations": valid.annotations.model_copy(update={"open_world_hint": True})}
        )

        self.assertEqual(
            client.validate_listed_tools([valid]),
            {
                "name": "echo_library_ids",
                "description": "Echo fixture library IDs after strict local validation.",
                "inputSchema": EXPECTED_INPUT_SCHEMA,
                "outputSchema": EXPECTED_OUTPUT_SCHEMA,
                "annotations": EXPECTED_ANNOTATIONS,
            },
        )
        for tools in ([changed], [open_world], [valid, valid], []):
            with self.subTest(tools=tools):
                with self.assertRaisesRegex(ValueError, "invalid echo_library_ids listing"):
                    client.validate_listed_tools(tools)

    def test_invalid_inputs_cross_real_stdio_and_return_only_stable_sanitized_errors(self) -> None:
        async def exercise() -> list[types.CallToolResult]:
            parameters = StdioServerParameters(
                command=str(PYTHON),
                args=["-W", "error", str(SERVER)],
                cwd=ROOT,
                env={"PYTHONWARNINGS": "error"},
            )
            with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as errlog:
                async with stdio_client(parameters, errlog=errlog) as (read_stream, write_stream):
                    async with ClientSession(read_stream, write_stream) as session:
                        await session.initialize()
                        await session.list_tools()
                        results = []
                        for name, arguments in (
                            ("echo_library_ids", {"ids": ["unknown"]}),
                            ("echo_library_ids", {"ids": ["fixture-1"], "command": "read /private/secret"}),
                            ("echo_library_ids", {"ids": []}),
                            ("echo_library_ids", {"ids": ["fixture-1"] * 6}),
                            ("not_echo_library_ids", {"ids": ["fixture-1"]}),
                        ):
                            results.append(await session.call_tool(name, arguments))
                errlog.seek(0)
                self.assertEqual(errlog.read(), "")
            return results

        try:
            results = anyio.run(exercise)
        except BaseException as error:
            self.fail(f"real stdio exchange unavailable: {type(error).__name__}")

        self.assertEqual(len(results), 5)
        for result in results:
            self.assertTrue(result.is_error)
            self.assertIsNone(result.structured_content)
            self.assertEqual(len(result.content), 1)
            self.assertEqual(result.content[0].text, "invalid echo_library_ids input")
            self.assertNotIn("secret", result.model_dump_json(by_alias=True))

    def test_local_only_returns_before_server_path_or_transport_is_used(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            isolated_client = Path(directory) / "client.py"
            shutil.copy2(CLIENT, isolated_client)
            completed = subprocess.run(
                [str(PYTHON), "-W", "error", str(isolated_client), "--local-only"],
                cwd=directory,
                env={**os.environ, "PYTHONPATH": str(ROOT), "PYTHONWARNINGS": "error"},
                text=True,
                capture_output=True,
                timeout=5,
                check=False,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(completed.stderr, "")
            self.assertEqual(completed.stdout, '{"mode":"local_only"}\n')
            self.assertEqual(sorted(path.name for path in Path(directory).iterdir()), ["client.py"])

    def test_timed_out_stdio_call_reaps_the_exact_spawned_server_pid(self) -> None:
        async def exercise(pid_file: Path) -> int:
            parameters = StdioServerParameters(
                command=str(PYTHON),
                args=["-W", "error", str(SLOW_SERVER), str(pid_file)],
                cwd=ROOT,
                env={"PYTHONWARNINGS": "error"},
            )
            with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as errlog:
                async with stdio_client(parameters, errlog=errlog) as (read_stream, write_stream):
                    async with ClientSession(read_stream, write_stream) as session:
                        await session.initialize()
                        await session.list_tools()
                        pid = await wait_for_pid_file(pid_file)
                        with self.assertRaises(MCPError):
                            await session.call_tool(
                                "echo_library_ids",
                                {"ids": ["fixture-1"]},
                                read_timeout_seconds=0.05,
                            )
                errlog.seek(0)
                self.assertEqual(errlog.read(), "")
            return pid

        with tempfile.TemporaryDirectory() as directory:
            pid_file = Path(directory) / "server.pid"
            try:
                pid = anyio.run(exercise, pid_file)
            except BaseException as error:
                self.fail(f"timeout fixture unavailable: {type(error).__name__}")
            wait_for_pid_esrch(pid, timeout_seconds=3)

async def wait_for_pid_file(path: Path) -> int:
    with anyio.fail_after(2):
        while True:
            try:
                return int(path.read_text(encoding="utf-8"))
            except (FileNotFoundError, ValueError):
                await anyio.sleep(0.01)


def wait_for_pid_esrch(pid: int, timeout_seconds: float) -> None:
    deadline = time.monotonic() + timeout_seconds
    while True:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return
        if time.monotonic() >= deadline:
            raise AssertionError(f"exact server PID {pid} remained alive")
        time.sleep(0.01)


if __name__ == "__main__":
    unittest.main()
