import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { ECHO_LIBRARY_IDS_DEFINITION } from "../src/mcp-spike.js";


const executeFile = promisify(execFile);
const pythonRoot = fileURLToPath(new URL("../python_mcp/", import.meta.url));
const pythonExecutable = fileURLToPath(new URL("../python_mcp/.venv/bin/python", import.meta.url));
const pythonClient = fileURLToPath(new URL("../python_mcp/client.py", import.meta.url));

test("the published Python MCP tool listing matches the TypeScript definition", async () => {
  const { stdout, stderr } = await executeFile(
    pythonExecutable,
    ["-B", "-W", "error", pythonClient],
    {
      cwd: pythonRoot,
      env: { PYTHONWARNINGS: "error" },
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 4_096,
    },
  );

  assert.equal(stderr, "");
  assert.ok(Buffer.byteLength(stdout, "utf8") <= 2_048);
  assert.ok(stdout.endsWith("\n"));
  assert.equal(stdout.split("\n").length, 2);
  const evidence = JSON.parse(stdout) as Record<string, unknown>;
  assert.deepEqual(Object.keys(evidence).sort(), [
    "mcpDistributionVersion",
    "mode",
    "server",
    "tool",
    "validated",
  ]);
  assert.deepEqual(
    {
      mode: evidence.mode,
      mcpDistributionVersion: evidence.mcpDistributionVersion,
      server: evidence.server,
    },
    {
      mode: "stdio",
      mcpDistributionVersion: "2.0.0",
      server: { name: "dj-copilot-python-mcp-spike", version: "0.0.0" },
    },
  );
  assert.deepEqual(evidence.tool, {
    name: ECHO_LIBRARY_IDS_DEFINITION.name,
    description: ECHO_LIBRARY_IDS_DEFINITION.description,
    inputSchema: ECHO_LIBRARY_IDS_DEFINITION.inputSchema,
    outputSchema: ECHO_LIBRARY_IDS_DEFINITION.outputSchema,
    annotations: ECHO_LIBRARY_IDS_DEFINITION.annotations,
  });
  assert.deepEqual(evidence.validated, { ids: ["fixture-2", "fixture-1"] });
});
