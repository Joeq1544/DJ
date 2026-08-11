import assert from "node:assert/strict";
import test from "node:test";

import {
  MCP_SERVER_NAME,
  MCP_TOOL_NAME,
  buildCodexOptions,
  buildExpectedSdkArgv,
  buildMcpShimEnvironment,
  runRequiredMcpEcho,
  transformShimArgv,
  validateCodexMcpEchoEvent,
  type McpRegistrationPaths,
} from "../src/provider-spike.js";

const MCP_PATHS: McpRegistrationPaths = {
  pythonExecutable: "/app/codex-mcp/python_mcp/.venv/bin/python",
  serverScript: "/app/codex-mcp/python_mcp/server.py",
  workingDirectory: "/app/codex-mcp/python_mcp",
};

const EXPECTED_IDS = ["fixture-2", "fixture-1"];

test("Codex options register only the exact required local Python MCP tool", () => {
  const options = buildCodexOptions("/app/codex-isolation-shim", MCP_PATHS);
  assert.deepEqual(options.config, {
    default_permissions: "dj_read",
    'permissions.dj_read.filesystem.\":workspace_roots\".\".\"': "read",
    "permissions.dj_read.network.enabled": false,
    "features.shell_tool": false,
    "features.apps": false,
    "features.connectors": false,
    "features.enable_mcp_apps": false,
    "features.plugins": false,
    "features.tool_suggest": false,
    "apps._default.enabled": false,
    "features.standalone_web_search": false,
    "features.in_app_browser": false,
    "features.browser_use": false,
    "features.browser_use_full_cdp_access": false,
    "features.browser_use_external": false,
    "features.computer_use": false,
    [`mcp_servers.${MCP_SERVER_NAME}.enabled`]: true,
    [`mcp_servers.${MCP_SERVER_NAME}.required`]: true,
    [`mcp_servers.${MCP_SERVER_NAME}.command`]: MCP_PATHS.pythonExecutable,
    [`mcp_servers.${MCP_SERVER_NAME}.args`]: ["-B", "-W", "error", MCP_PATHS.serverScript],
    [`mcp_servers.${MCP_SERVER_NAME}.cwd`]: MCP_PATHS.workingDirectory,
    [`mcp_servers.${MCP_SERVER_NAME}.env`]: {},
    [`mcp_servers.${MCP_SERVER_NAME}.startup_timeout_sec`]: 5,
    [`mcp_servers.${MCP_SERVER_NAME}.tool_timeout_sec`]: 3,
    [`mcp_servers.${MCP_SERVER_NAME}.enabled_tools`]: [MCP_TOOL_NAME],
    [`mcp_servers.${MCP_SERVER_NAME}.default_tools_approval_mode`]: "approve",
  });
  const serialized = JSON.stringify(options);
  for (const forbidden of ["OPENAI_API_KEY", "apiKey", "url", "bearer", "http_headers"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.deepEqual(buildMcpShimEnvironment(MCP_PATHS), {
    DJ_CODEX_EXPECTED_MCP_PYTHON: MCP_PATHS.pythonExecutable,
    DJ_CODEX_EXPECTED_MCP_SERVER: MCP_PATHS.serverScript,
    DJ_CODEX_EXPECTED_MCP_CWD: MCP_PATHS.workingDirectory,
  });
});

test("shim accepts the exact ordered MCP registration and rejects ambient fallback or mutations", () => {
  const argv = buildExpectedSdkArgv("/app/ai-workspace", "/tmp/schema.json", MCP_PATHS);
  const transformed = transformShimArgv(argv, undefined, MCP_PATHS) as string[];
  const expectedMcpConfig = [
    `mcp_servers.${MCP_SERVER_NAME}.enabled=true`,
    `mcp_servers.${MCP_SERVER_NAME}.required=true`,
    `mcp_servers.${MCP_SERVER_NAME}.command=${JSON.stringify(MCP_PATHS.pythonExecutable)}`,
    `mcp_servers.${MCP_SERVER_NAME}.args=["-B", "-W", "error", ${JSON.stringify(MCP_PATHS.serverScript)}]`,
    `mcp_servers.${MCP_SERVER_NAME}.cwd=${JSON.stringify(MCP_PATHS.workingDirectory)}`,
    `mcp_servers.${MCP_SERVER_NAME}.env={}`,
    `mcp_servers.${MCP_SERVER_NAME}.startup_timeout_sec=5`,
    `mcp_servers.${MCP_SERVER_NAME}.tool_timeout_sec=3`,
    `mcp_servers.${MCP_SERVER_NAME}.enabled_tools=["${MCP_TOOL_NAME}"]`,
    `mcp_servers.${MCP_SERVER_NAME}.default_tools_approval_mode="approve"`,
  ];
  for (const value of expectedMcpConfig) {
    const index = transformed.indexOf(value);
    assert.notEqual(index, -1);
    assert.equal(transformed[index - 1], "-c");
  }
  assert.throws(() => transformShimArgv(argv, undefined, undefined), /unexpected Codex SDK argv/);

  const mutationValues = [
    `mcp_servers.${MCP_SERVER_NAME}.command="/tmp/other-python"`,
    `mcp_servers.${MCP_SERVER_NAME}.args=["-B", "-W", "error", "/tmp/other.py"]`,
    `mcp_servers.${MCP_SERVER_NAME}.cwd="/tmp"`,
    `mcp_servers.${MCP_SERVER_NAME}.env={OPENAI_API_KEY="secret"}`,
    `mcp_servers.${MCP_SERVER_NAME}.env_vars=["OPENAI_API_KEY"]`,
    `mcp_servers.${MCP_SERVER_NAME}.enabled_tools=["${MCP_TOOL_NAME}", "read_file"]`,
    `mcp_servers.${MCP_SERVER_NAME}.url="https://example.invalid/mcp"`,
    "mcp_servers.ambient.enabled=true",
  ];
  for (const replacement of mutationValues) {
    const mutated = [...argv];
    const index = mutated.indexOf(expectedMcpConfig[2]!);
    mutated[index] = replacement;
    assert.throws(() => transformShimArgv(mutated, undefined, MCP_PATHS), /unexpected Codex SDK argv/);
  }

  const first = argv.indexOf(expectedMcpConfig[0]!);
  const second = argv.indexOf(expectedMcpConfig[1]!);
  const reordered = [...argv];
  [reordered[first - 1], reordered[first], reordered[second - 1], reordered[second]] =
    [argv[second - 1]!, argv[second]!, argv[first - 1]!, argv[first]!];
  assert.throws(() => transformShimArgv(reordered, undefined, MCP_PATHS), /unexpected Codex SDK argv/);
  assert.throws(
    () => transformShimArgv([...argv.slice(0, first - 1), "--config", expectedMcpConfig[0]!, ...argv.slice(first - 1)], undefined, MCP_PATHS),
    /unexpected Codex SDK argv/,
  );
  assert.throws(
    () => transformShimArgv(argv, undefined, { ...MCP_PATHS, pythonExecutable: "/tmp/changed-owner-expectation" }),
    /unexpected Codex SDK argv/,
  );

  const withoutMcp = argv.filter((value, index) => {
    if (!value.startsWith(`mcp_servers.${MCP_SERVER_NAME}.`)) return true;
    return false;
  });
  assert.throws(() => transformShimArgv(withoutMcp, undefined, MCP_PATHS), /unexpected Codex SDK argv/);
});

test("completed Codex MCP echo event requires exact server, tool, arguments, result, and known IDs", () => {
  const event = completedEchoEvent(EXPECTED_IDS);
  assert.deepEqual(validateCodexMcpEchoEvent(event, EXPECTED_IDS), {
    server: MCP_SERVER_NAME,
    tool: MCP_TOOL_NAME,
    ids: EXPECTED_IDS,
    unknownIdCount: 0,
  });

  const mutations: unknown[] = [
    { ...event, type: "item.started" },
    { ...event, extra: true },
    { ...event, item: { ...event.item, server: "ambient" } },
    { ...event, item: { ...event.item, tool: "read_file" } },
    { ...event, item: { ...event.item, status: "failed", error: { message: "private" }, result: undefined } },
    { ...event, item: { ...event.item, arguments: { ids: ["unknown"] } } },
    { ...event, item: { ...event.item, arguments: { ids: EXPECTED_IDS, extra: true } } },
    { ...event, item: { ...event.item, result: { ...event.item.result, structured_content: { ids: ["unknown"] } } } },
    { ...event, item: { ...event.item, result: { ...event.item.result, structured_content: { ids: ["fixture-1", "fixture-2"] } } } },
    { ...event, item: { ...event.item, result: { ...event.item.result, _meta: {} } } },
    { ...event, item: { ...event.item, extra: true } },
  ];
  for (const mutation of mutations) {
    assert.throws(() => validateCodexMcpEchoEvent(mutation, EXPECTED_IDS), /invalid Codex MCP echo event/);
  }
});

test("required MCP echo credits one actual validated tool event and exact structured assistant result", async () => {
  const events = [
    { type: "thread.started", thread_id: "mcp-thread" },
    inProgressEchoEvent("item.started", EXPECTED_IDS),
    inProgressEchoEvent("item.updated", EXPECTED_IDS),
    completedEchoEvent(EXPECTED_IDS),
    { type: "item.completed", item: { id: "agent-1", type: "agent_message", text: JSON.stringify({ ids: EXPECTED_IDS }) } },
    { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } },
  ];
  let cleaned = 0;
  let prompt = "";
  let options: { outputSchema?: unknown; signal?: AbortSignal } | undefined;
  const result = await runRequiredMcpEcho({
    startThread(threadOptions) {
      assert.equal(threadOptions.workingDirectory, "/app/ai-workspace");
      return {
        id: "mcp-thread",
        async runStreamed(input, turnOptions) {
          prompt = input;
          options = turnOptions;
          async function* stream() { for (const event of events) yield event; }
          return { events: stream() };
        },
      };
    },
  }, "/app/ai-workspace", EXPECTED_IDS, 1_000, async () => { cleaned += 1; });
  assert.deepEqual(result, { server: MCP_SERVER_NAME, tool: MCP_TOOL_NAME, ids: EXPECTED_IDS, unknownIdCount: 0 });
  assert.equal(prompt.includes(MCP_SERVER_NAME), true);
  assert.equal(prompt.includes(MCP_TOOL_NAME), true);
  assert.equal(options?.signal instanceof AbortSignal, true);
  assert.deepEqual(options?.outputSchema, {
    type: "object",
    properties: { ids: { type: "array", items: { type: "string", enum: EXPECTED_IDS }, minItems: 2, maxItems: 2 } },
    required: ["ids"],
    additionalProperties: false,
  });
  assert.equal(cleaned, 1);
});

test("required MCP echo rejects failed or duplicate calls and always cleans up", async () => {
  const failed: { type: string; item: Record<string, unknown> } = completedEchoEvent(EXPECTED_IDS);
  failed.item = { ...failed.item, status: "failed", result: undefined, error: { message: "sensitive service detail" } };
  for (const events of [
    [failed],
    [completedEchoEvent(EXPECTED_IDS), completedEchoEvent(EXPECTED_IDS), agentEvent(EXPECTED_IDS)],
    [completedEchoEvent(EXPECTED_IDS), agentEvent(["fixture-1", "fixture-2"])],
    [completedEchoEvent(EXPECTED_IDS), agentEvent(EXPECTED_IDS)],
    [{ type: "error", message: "sensitive stream detail" }],
    [
      {
        type: "item.started",
        item: {
          id: "mcp-duplicate-inflight",
          type: "mcp_tool_call",
          server: MCP_SERVER_NAME,
          tool: MCP_TOOL_NAME,
          arguments: { ids: ["not-in-library"] },
          status: "in_progress",
        },
      },
      completedEchoEvent(EXPECTED_IDS),
      agentEvent(EXPECTED_IDS),
      completedTurnEvent(),
    ],
    [
      inProgressEchoEvent("item.started", EXPECTED_IDS, "mcp-duplicate-inflight"),
      completedEchoEvent(EXPECTED_IDS),
      agentEvent(EXPECTED_IDS),
      completedTurnEvent(),
    ],
    [
      { type: "item.started", item: { id: "ambient-1", type: "mcp_tool_call", server: "ambient", tool: "read_file", arguments: {}, status: "in_progress" } },
      completedEchoEvent(EXPECTED_IDS),
      agentEvent(EXPECTED_IDS),
      completedTurnEvent(),
    ],
  ]) {
    let cleaned = 0;
    await assert.rejects(
      runRequiredMcpEcho(fakeMcpClient(events), "/app/ai-workspace", EXPECTED_IDS, 1_000, async () => { cleaned += 1; }),
      /required Codex MCP echo failed/,
    );
    assert.equal(cleaned, 1);
  }
});

test("required MCP echo reports only stable stage-local failure reasons", async () => {
  await assert.rejects(
    runRequiredMcpEcho(fakeMcpClient([]), "/app/ai-workspace", EXPECTED_IDS, 1_000, async () => {}),
    /required Codex MCP echo failed \(tool_not_observed\)$/,
  );
  await assert.rejects(
    runRequiredMcpEcho(fakeMcpClient([{ type: "error", message: "sensitive stream detail" }]), "/app/ai-workspace", EXPECTED_IDS, 1_000, async () => {}),
    /required Codex MCP echo failed \(stream_failed\)$/,
  );
  await assert.rejects(
    runRequiredMcpEcho({
      startThread() {
        return {
          id: null,
          async runStreamed() { throw new Error("sensitive SDK detail"); },
        };
      },
    }, "/app/ai-workspace", EXPECTED_IDS, 1_000, async () => {}),
    /required Codex MCP echo failed \(sdk_stream_error\)$/,
  );
  await assert.rejects(
    runRequiredMcpEcho({
      startThread() {
        return {
          id: null,
          async runStreamed() { return Promise.reject(); },
        };
      },
    }, "/app/ai-workspace", EXPECTED_IDS, 1_000, async () => {}),
    /required Codex MCP echo failed \(sdk_stream_error\)$/,
  );
});

test("required MCP echo preserves cleanup failure after success, stage failure, and timeout", async () => {
  const rejectingCleanup = async () => { throw new Error("sensitive cleanup detail"); };
  await assert.rejects(
    runRequiredMcpEcho(fakeMcpClient([
      completedEchoEvent(EXPECTED_IDS),
      agentEvent(EXPECTED_IDS),
      completedTurnEvent(),
    ]), "/app/ai-workspace", EXPECTED_IDS, 1_000, rejectingCleanup),
    /total-timeout cleanup failed \(after_success\)$/,
  );
  await assert.rejects(
    runRequiredMcpEcho(fakeMcpClient([]), "/app/ai-workspace", EXPECTED_IDS, 1_000, rejectingCleanup),
    /total-timeout cleanup failed \(after_error\)$/,
  );
  const timeoutClient = {
    startThread() {
      return {
        id: null,
        async runStreamed(_input: string, options?: { signal?: AbortSignal }) {
          async function* stream() {
            await new Promise<void>((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true }));
          }
          return { events: stream() };
        },
      };
    },
  };
  await assert.rejects(
    runRequiredMcpEcho(timeoutClient, "/app/ai-workspace", EXPECTED_IDS, 10, rejectingCleanup),
    /total-timeout cleanup failed \(after_timeout\)$/,
  );
});

test("required MCP echo timeout aborts its SDK stream and runs cleanup", async () => {
  let aborted = false;
  let cleaned = false;
  const client = {
    startThread() {
      return {
        id: null,
        async runStreamed(_input: string, options?: { signal?: AbortSignal }) {
          async function* stream() {
            await new Promise<void>((_resolve, reject) => options?.signal?.addEventListener("abort", () => {
              aborted = true;
              reject(options.signal?.reason);
            }, { once: true }));
          }
          return { events: stream() };
        },
      };
    },
  };
  await assert.rejects(
    runRequiredMcpEcho(client, "/app/ai-workspace", EXPECTED_IDS, 10, async () => { cleaned = true; }),
    /total timeout/,
  );
  assert.equal(aborted, true);
  assert.equal(cleaned, true);
});

function completedEchoEvent(ids: string[]) {
  return {
    type: "item.completed",
    item: {
      id: "mcp-call-1",
      type: "mcp_tool_call",
      server: MCP_SERVER_NAME,
      tool: MCP_TOOL_NAME,
      arguments: { ids: [...ids] },
      result: {
        content: [{ type: "text", text: JSON.stringify({ ids }) }],
        structured_content: { ids: [...ids] },
      },
      status: "completed",
    },
  };
}

function inProgressEchoEvent(type: "item.started" | "item.updated", ids: string[], id = "mcp-call-1") {
  return {
    type,
    item: {
      id,
      type: "mcp_tool_call",
      server: MCP_SERVER_NAME,
      tool: MCP_TOOL_NAME,
      arguments: { ids: [...ids] },
      status: "in_progress",
    },
  };
}

function agentEvent(ids: string[]) {
  return { type: "item.completed", item: { id: "agent-1", type: "agent_message", text: JSON.stringify({ ids }) } };
}

function completedTurnEvent() {
  return { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } };
}

function fakeMcpClient(events: unknown[]) {
  return {
    startThread() {
      return {
        id: "mcp-thread",
        async runStreamed() {
          async function* stream() { for (const event of events) yield event; }
          return { events: stream() };
        },
      };
    },
  };
}
