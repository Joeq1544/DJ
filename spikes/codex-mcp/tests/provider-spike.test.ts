import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, copyFile, lstat, mkdtemp, mkdir, readFile, realpath, rename, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Codex } from "@openai/codex-sdk";

import {
  EXPECTED_CODEX_VERSION,
  auditAndTerminateControl,
  boundedTerminateProcessGroup,
  buildExpectedSdkArgv,
  buildCodexOptions,
  buildMcpShimEnvironment,
  buildThreadOptions,
  classifyLoginStatus,
  classifyNegativeCapabilityEvidence,
  classifySanitizedFailure,
  createSupervisorControl,
  createControlCompletedRecord,
  createControlStartedRecord,
  createSyntheticSentinels,
  inspectExistingAuth,
  resolvePackagedHelper,
  runLifecycle,
  runLocalOnly,
  transformShimArgv,
  readControlRecords,
  validateAppWorkspace,
  validateStructuredResult,
  verifyPackagedHelperVersion,
  verifyPackagedHelperConfig,
  verifyPackagedHelperSandboxProfile,
  withTotalTimeout,
  type McpRegistrationPaths,
} from "../src/provider-spike.js";

const RUN_ID = "run-1234567890abcdef";
const INVOCATION_ID = "inv-1234567890abcdef";
const STATIC_MCP_PATHS: McpRegistrationPaths = {
  pythonExecutable: "/app/codex-mcp/python_mcp/.venv/bin/python",
  serverScript: "/app/codex-mcp/python_mcp/server.py",
  workingDirectory: "/app/codex-mcp/python_mcp",
};

test("Codex options use the exact permission profile and no API-key or legacy path", () => {
  const options = buildCodexOptions("/app/codex-isolation-shim", STATIC_MCP_PATHS);
  assert.equal(options.codexPathOverride, "/app/codex-isolation-shim");
  assert.equal(options.config?.default_permissions, "dj_read");
  assert.equal(options.config?.['permissions.dj_read.filesystem.\":workspace_roots\".\".\"'], "read");
  assert.equal(options.config?.["permissions.dj_read.network.enabled"], false);
  for (const disabled of [
    "features.shell_tool", "features.apps", "features.connectors", "features.enable_mcp_apps",
    "features.plugins", "features.tool_suggest", "apps._default.enabled",
    "features.standalone_web_search", "features.in_app_browser", "features.browser_use",
    "features.browser_use_full_cdp_access", "features.browser_use_external", "features.computer_use",
  ]) assert.equal(options.config?.[disabled], false);
  assert.equal(JSON.stringify(options).includes("API_KEY"), false);
  for (const forbidden of [
    "sandboxMode",
    "networkAccessEnabled",
    "webSearchEnabled",
    "additionalDirectories",
  ]) {
    assert.equal(forbidden in options, false);
  }
});

test("thread options are app-workspace-only and contain no legacy expansion", () => {
  assert.deepEqual(buildThreadOptions("/app/ai-workspace"), {
    workingDirectory: "/app/ai-workspace",
    skipGitRepoCheck: true,
    approvalPolicy: "never",
    webSearchMode: "disabled",
  });
});

test("shim accepts only SDK exec argv and injects isolation plus strict-config flags exactly once", () => {
  const sdkArgv = buildExpectedSdkArgv("/app/ai-workspace", "/tmp/schema.json", STATIC_MCP_PATHS);
  assert.deepEqual(
    transformShimArgv(sdkArgv, undefined, STATIC_MCP_PATHS),
    [
      "exec",
      "--ignore-user-config",
      "--ignore-rules",
      "--experimental-json",
      "--strict-config",
      "-c", 'default_permissions="dj_read"',
      "-c", 'permissions.dj_read.filesystem={":workspace_roots"={"."="read"}}',
      "-c", "permissions.dj_read.network.enabled=false",
      "-c", "features.shell_tool=false",
      "-c", "features.apps=false",
      "-c", "features.connectors=false",
      "-c", "features.enable_mcp_apps=false",
      "-c", "features.plugins=false",
      "-c", "features.tool_suggest=false",
      "-c", "apps._default.enabled=false",
      "-c", "features.standalone_web_search=false",
      "-c", "features.in_app_browser=false",
      "-c", "features.browser_use=false",
      "-c", "features.browser_use_full_cdp_access=false",
      "-c", "features.browser_use_external=false",
      "-c", "features.computer_use=false",
      "-c", "mcp_servers.dj_copilot_fixture.enabled=true",
      "-c", "mcp_servers.dj_copilot_fixture.required=true",
      "-c", 'mcp_servers.dj_copilot_fixture.command="/app/codex-mcp/python_mcp/.venv/bin/python"',
      "-c", 'mcp_servers.dj_copilot_fixture.args=["-B", "-W", "error", "/app/codex-mcp/python_mcp/server.py"]',
      "-c", 'mcp_servers.dj_copilot_fixture.cwd="/app/codex-mcp/python_mcp"',
      "-c", "mcp_servers.dj_copilot_fixture.env={}",
      "-c", "mcp_servers.dj_copilot_fixture.startup_timeout_sec=5",
      "-c", "mcp_servers.dj_copilot_fixture.tool_timeout_sec=3",
      "-c", 'mcp_servers.dj_copilot_fixture.enabled_tools=["echo_library_ids"]',
      "-c", 'mcp_servers.dj_copilot_fixture.default_tools_approval_mode="approve"',
      "--cd", "/app/ai-workspace",
      "--skip-git-repo-check",
      "--output-schema", "/tmp/schema.json",
      "-c", 'web_search="disabled"',
      "-c", 'approval_policy="never"',
    ],
  );
  for (const argv of [
    ["login", "status"],
    ["exec", "--json"],
    ["exec", "--experimental-json", "--ignore-rules"],
    [...sdkArgv, "--sandbox", "read-only"],
  ]) {
    assert.throws(() => transformShimArgv(argv, undefined, STATIC_MCP_PATHS), /unexpected Codex SDK argv/);
  }
  const resumed = [...sdkArgv, "resume", "original-thread-id"];
  assert.equal((transformShimArgv(resumed, "original-thread-id", STATIC_MCP_PATHS) as string[]).filter((item) => item === "resume").length, 1);
  assert.throws(() => transformShimArgv(resumed, "changed-thread-id", STATIC_MCP_PATHS), /unexpected Codex SDK argv/);
  assert.throws(() => transformShimArgv([...sdkArgv, "resume", "bad/id"], "bad/id", STATIC_MCP_PATHS), /unexpected Codex SDK argv/);
});

test("supervisor telemetry is outside the workspace, private, regular, and exact-schema validated", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-control-"));
  const workspace = join(root, "workspace");
  const supervisor = join(root, "supervisor");
  await mkdir(workspace);
  const control = await createSupervisorControl(supervisor, workspace, RUN_ID, process.pid);
  assert.equal((await stat(control.directory)).mode & 0o777, 0o700);
  assert.equal((await lstat(control.file)).isFile(), true);
  assert.equal((await stat(control.file)).mode & 0o777, 0o600);
  assert.equal(control.file.startsWith(workspace), false);
  const started = createControlStartedRecord(control.identity, INVOCATION_ID, process.pid, process.pid, Date.now());
  const completed = createControlCompletedRecord(started, Date.now(), "natural");
  await writeFile(control.file, `${JSON.stringify(started)}\n${JSON.stringify(completed)}\n`, { mode: 0o600 });
  assert.deepEqual(await readControlRecords(control.file, control.identity), [started, completed]);
  await assert.rejects(createSupervisorControl(workspace, workspace, RUN_ID, process.pid), /invalid supervisor control boundary/);
});

test("supervisor control creation never follows or mutates pre-existing and symlink paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-control-exclusive-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace, { mode: 0o700 });

  const existing = join(root, "existing-control");
  await mkdir(existing, { mode: 0o755 });
  await chmod(existing, 0o755);
  const existingSentinel = join(existing, "sentinel.txt");
  await writeFile(existingSentinel, "unchanged");
  const existingMode = (await stat(existing)).mode & 0o777;
  await assert.rejects(createSupervisorControl(existing, workspace, RUN_ID, process.pid), /invalid supervisor control boundary/);
  assert.equal((await stat(existing)).mode & 0o777, existingMode);
  assert.equal(await readFile(existingSentinel, "utf8"), "unchanged");

  const symlinkTarget = join(root, "symlink-target");
  await mkdir(symlinkTarget, { mode: 0o755 });
  await chmod(symlinkTarget, 0o755);
  const symlinkTargetMode = (await stat(symlinkTarget)).mode & 0o777;
  const targetSentinel = join(symlinkTarget, "sentinel.txt");
  await writeFile(targetSentinel, "target-unchanged");
  const controlLink = join(root, "control-link");
  await symlink(symlinkTarget, controlLink);
  await assert.rejects(createSupervisorControl(controlLink, workspace, RUN_ID, process.pid), /invalid supervisor control boundary/);
  assert.equal((await stat(symlinkTarget)).mode & 0o777, symlinkTargetMode);
  assert.equal(await readFile(targetSentinel, "utf8"), "target-unchanged");

  const workspaceParent = join(workspace, "linked-parent");
  await mkdir(workspaceParent, { mode: 0o700 });
  const workspaceParentMode = (await stat(workspaceParent)).mode & 0o777;
  const parentSentinel = join(workspaceParent, "sentinel.txt");
  await writeFile(parentSentinel, "workspace-unchanged");
  const parentLink = join(root, "parent-link");
  await symlink(workspaceParent, parentLink);
  await assert.rejects(createSupervisorControl(join(parentLink, "control"), workspace, RUN_ID, process.pid), /invalid supervisor control boundary/);
  assert.equal((await stat(workspaceParent)).mode & 0o777, workspaceParentMode);
  assert.equal(await readFile(parentSentinel, "utf8"), "workspace-unchanged");
  await assert.rejects(lstat(join(workspaceParent, "control")));
});

test("control telemetry fails closed for missing, malformed, partial, invalid, unrelated, stale, and symlink records", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-control-invalid-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const cases: unknown[] = [
    "{",
    { version: 1, runId: RUN_ID, parentPid: process.pid, shimPid: 0, childPid: 1, startedAtMs: Date.now() },
    { version: 1, runId: RUN_ID, parentPid: process.pid, shimPid: -1, childPid: 1, startedAtMs: Date.now() },
    { version: 1, runId: RUN_ID, parentPid: process.pid, shimPid: null, childPid: 1, startedAtMs: Date.now() },
    { version: 1, runId: "unrelated-run-1234", parentPid: process.pid, shimPid: 1, childPid: 1, startedAtMs: Date.now() },
    { version: 1, runId: RUN_ID, parentPid: process.pid + 1, shimPid: 1, childPid: 1, startedAtMs: Date.now() },
    { version: 1, runId: RUN_ID, parentPid: process.pid, shimPid: 1, childPid: 1, startedAtMs: Date.now() - 600_000 },
    { version: 1, runId: RUN_ID, parentPid: process.pid, shimPid: 1, childPid: 1, startedAtMs: Date.now(), extra: true },
  ];
  for (const [index, value] of cases.entries()) {
    const control = await createSupervisorControl(join(root, `supervisor-${index}`), workspace, RUN_ID, process.pid);
    await writeFile(control.file, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
    await assert.rejects(readControlRecords(control.file, control.identity), /invalid control telemetry/);
    const audit = await auditAndTerminateControl(control.file, control.identity);
    assert.deepEqual(audit, { status: "blocked", reason: "invalid_control_telemetry" });
  }
  const missing = join(root, "missing-control.jsonl");
  await assert.rejects(readControlRecords(missing, { runId: RUN_ID, parentPid: process.pid }), /invalid control telemetry/);

  const control = await createSupervisorControl(join(root, "supervisor-symlink"), workspace, RUN_ID, process.pid);
  const target = join(workspace, "model-replacement.jsonl");
  await writeFile(target, "{}\n");
  await rename(control.file, `${control.file}.old`);
  await symlink(target, control.file);
  await assert.rejects(readControlRecords(control.file, control.identity), /invalid control telemetry/);
  assert.throws(() => createControlStartedRecord({ runId: RUN_ID, parentPid: process.pid }, INVOCATION_ID, process.pid, undefined, Date.now()), /invalid control telemetry/);
});

test("control invocation state rejects duplicate, out-of-order, and conflicting transitions", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-control-state-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const started = createControlStartedRecord({ runId: RUN_ID, parentPid: process.pid }, INVOCATION_ID, process.pid, process.pid, Date.now());
  const completed = createControlCompletedRecord(started, Date.now(), "natural");
  const conflicting = { ...completed, childPid: process.pid + 1 };
  const sequences = [
    [completed],
    [started, started],
    [started, completed, completed],
    [started, conflicting],
    [completed, started],
  ];
  for (const [index, sequence] of sequences.entries()) {
    const control = await createSupervisorControl(join(root, `state-${index}`), workspace, RUN_ID, process.pid);
    await writeFile(control.file, `${sequence.map((event) => JSON.stringify(event)).join("\n")}\n`);
    assert.deepEqual(await auditAndTerminateControl(control.file, control.identity), { status: "blocked", reason: "invalid_control_telemetry" });
  }
});

test("invalid or workspace-mutated telemetry never signals an unrelated process", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-control-unrelated-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const sentinel = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    const control = await createSupervisorControl(join(root, "supervisor"), workspace, RUN_ID, process.pid);
    const unrelated = createControlStartedRecord({ runId: "unrelated-run-1234", parentPid: process.pid }, INVOCATION_ID, sentinel.pid, sentinel.pid, Date.now());
    await writeFile(control.file, `${JSON.stringify(unrelated)}\n`);
    const workspaceDecoy = join(workspace, "control.jsonl");
    await writeFile(workspaceDecoy, `${JSON.stringify({ childPid: sentinel.pid })}\n`);
    assert.deepEqual(await auditAndTerminateControl(control.file, control.identity), { status: "blocked", reason: "invalid_control_telemetry" });
    assert.equal(isAlive(sentinel.pid!), true);
    const stale = createControlStartedRecord(control.identity, INVOCATION_ID, sentinel.pid, sentinel.pid, Date.now() - 600_000);
    await writeFile(control.file, `${JSON.stringify(stale)}\n`);
    assert.deepEqual(await auditAndTerminateControl(control.file, control.identity), { status: "blocked", reason: "invalid_control_telemetry" });
    assert.equal(isAlive(sentinel.pid!), true);
  } finally {
    sentinel.kill("SIGKILL");
    await once(sentinel, "exit");
  }
});

test("fresh completed telemetry never signals a live unrelated PID reused from a prior invocation", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-control-completed-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const sentinel = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    const control = await createSupervisorControl(join(root, "supervisor"), workspace, RUN_ID, process.pid);
    const started = createControlStartedRecord(control.identity, INVOCATION_ID, sentinel.pid, sentinel.pid, Date.now());
    const completed = createControlCompletedRecord(started, Date.now(), "natural");
    await writeFile(control.file, `${JSON.stringify(started)}\n${JSON.stringify(completed)}\n`);
    assert.deepEqual(await auditAndTerminateControl(control.file, control.identity), {
      status: "ok",
      invocations: 1,
      active: 0,
      observedShimAndGroupSurvivors: 0,
      escapedDescendantCleanup: "proof_unavailable",
      blocker: true,
    });
    assert.equal(isAlive(sentinel.pid!), true);
  } finally {
    sentinel.kill("SIGKILL");
    await once(sentinel, "exit");
  }
});

test("active audit kills distinct shim and helper group but blocks escaped-descendant cleanup proof", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-control-active-escaped-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const shim = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  const escapedPidFile = join(root, "escaped.json");
  const helper = spawn(process.execPath, ["-e", [
    "const {spawn}=require('node:child_process');",
    "const {writeFileSync}=require('node:fs');",
    "process.on('SIGTERM',()=>{});",
    "const escaped=spawn(process.execPath,['-e','process.on(\\'SIGTERM\\',()=>{});setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});",
    `writeFileSync(${JSON.stringify(escapedPidFile)},JSON.stringify({escaped:escaped.pid}));`,
    "setInterval(()=>{},1000);",
  ].join("")], { detached: true, stdio: "ignore" });
  const shimExit = once(shim, "exit");
  const helperExit = once(helper, "exit");
  const escaped = await waitForJson(escapedPidFile) as { escaped: number };
  try {
    const control = await createSupervisorControl(join(root, "supervisor"), workspace, RUN_ID, process.pid);
    const started = createControlStartedRecord(control.identity, INVOCATION_ID, shim.pid, helper.pid, Date.now());
    await writeFile(control.file, `${JSON.stringify(started)}\n`);
    const auditStartedAt = Date.now();
    const audit = await auditAndTerminateControl(control.file, control.identity);
    assert.deepEqual(audit, {
      status: "ok",
      invocations: 1,
      active: 0,
      observedShimAndGroupSurvivors: 0,
      escapedDescendantCleanup: "proof_unavailable",
      blocker: true,
    });
    assert.ok(Date.now() - auditStartedAt < 2_000, "active audit must remain bounded while allowing child reaping");
    await Promise.race([
      Promise.all([shimExit, helperExit]),
      new Promise((_, reject) => setTimeout(() => reject(new Error("scoped cleanup timed out")), 1_000)),
    ]);
    assert.equal(isAlive(shim.pid!), false);
    assert.equal(isProcessGroupAlive(helper.pid!), false);
    assert.equal(isAlive(escaped.escaped), true);
    const events = await readControlRecords(control.file, control.identity);
    assert.equal(events[1]!.event === "completed" && events[1]!.outcome, "supervisor");
  } finally {
    try { process.kill(shim.pid!, "SIGKILL"); } catch {}
    try { process.kill(-helper.pid!, "SIGKILL"); } catch {}
    try { process.kill(escaped.escaped, "SIGKILL"); } catch {}
    await Promise.all([waitForDead(shim.pid!), waitForDead(helper.pid!), waitForDead(escaped.escaped)]);
  }
});

test("login status only accepts exact ChatGPT success and never returns raw output", () => {
  assert.deepEqual(
    classifyLoginStatus({ code: 0, signal: null, stdout: "", stderr: "Logged in using ChatGPT\n" }),
    { kind: "chatgpt" },
  );
  for (const stderr of [
    "Logged in using an API key - sk-partial",
    "Logged in using an API key - ***",
    "Logged in using an access token",
    "Logged in using a personal access token",
    "Logged in using Amazon Bedrock API key",
  ]) {
    assert.deepEqual(classifyLoginStatus({ code: 0, signal: null, stdout: "", stderr }), { kind: "other_auth" });
  }
  assert.deepEqual(
    classifyLoginStatus({ code: 1, signal: null, stdout: "", stderr: "Not logged in" }),
    { kind: "signed_out" },
  );
  assert.deepEqual(
    classifyLoginStatus({ code: 2, signal: null, stdout: "", stderr: "sk-partial" }),
    { kind: "status_error" },
  );
  assert.deepEqual(
    classifyLoginStatus({ code: 0, signal: "SIGTERM", stdout: "", stderr: "Logged in using ChatGPT" }),
    { kind: "status_error" },
  );
});

test("official SDK plus executable shim captures exact start and one original-id resume argv", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-shim-integration-"));
  const shimDir = join(root, "src");
  const helperDir = join(root, "node_modules", "@openai", "codex");
  const capturePath = join(root, "argv.jsonl");
  await mkdir(shimDir, { recursive: true });
  await mkdir(join(helperDir, "bin"), { recursive: true });
  const shimPath = join(shimDir, "codex-isolation-shim.mjs");
  await copyFile(new URL("../src/codex-isolation-shim.mjs", import.meta.url), shimPath);
  await copyFile(new URL("../src/process-group-control.mjs", import.meta.url), join(shimDir, "process-group-control.mjs"));
  await chmod(shimPath, 0o755);
  await writeFile(join(helperDir, "package.json"), JSON.stringify({ name: "@openai/codex", version: EXPECTED_CODEX_VERSION, bin: { codex: "bin/codex.js" } }));
  await writeFile(join(helperDir, "bin", "codex.js"), [
    "#!/usr/bin/env node",
    "import { appendFileSync } from 'node:fs';",
    "appendFileSync(process.env.CODEX_SHIM_CAPTURE, JSON.stringify(process.argv.slice(2)) + '\\n');",
    "process.stdin.resume();",
    "process.stdin.on('end', () => {",
    "  console.log(JSON.stringify({type:'thread.started',thread_id:'shim-thread'}));",
    "  console.log(JSON.stringify({type:'item.completed',item:{id:'a',type:'agent_message',text:'{\\\"ids\\\":[\\\"fixture-1\\\"]}'} }));",
    "  console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:1,reasoning_output_tokens:0}}));",
    "});",
  ].join("\n"));
  await chmod(join(helperDir, "bin", "codex.js"), 0o755);
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const mcpPaths = await createExecutableMcpFixture(root);
  const control = await createSupervisorControl(join(root, "supervisor"), workspace, RUN_ID, process.pid);
  const options = buildCodexOptions(shimPath, mcpPaths);
  const codex = new Codex({ ...options, env: {
    PATH: process.env.PATH ?? "",
    CODEX_SHIM_CAPTURE: capturePath,
    DJ_CODEX_SHIM_CONTROL_FILE: control.file,
    DJ_CODEX_SHIM_RUN_ID: RUN_ID,
    DJ_CODEX_SHIM_PARENT_PID: String(process.pid),
    DJ_CODEX_EXPECTED_RESUME_ID: "shim-thread",
    ...buildMcpShimEnvironment(mcpPaths),
  } });
  const started = codex.startThread(buildThreadOptions(workspace));
  await started.run("probe", { outputSchema: { type: "object" } });
  assert.equal(started.id, "shim-thread");
  await codex.resumeThread(started.id, buildThreadOptions(workspace)).run("resume probe", { outputSchema: { type: "object" } });
  const captured = (await readFile(capturePath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
  assert.equal(captured.length, 2);
  assert.equal(captured[0]!.includes("resume"), false);
  assert.equal(captured[1]!.filter((item) => item === "resume").length, 1);
  assert.deepEqual(captured[1]!.slice(captured[1]!.indexOf("resume")), ["resume", "shim-thread"]);
  const startSchema = captured[0]![captured[0]!.indexOf("--output-schema") + 1]!;
  const resumeSchema = captured[1]![captured[1]!.indexOf("--output-schema") + 1]!;
  assert.deepEqual(captured[0], transformShimArgv(buildExpectedSdkArgv(workspace, startSchema, mcpPaths), undefined, mcpPaths));
  assert.deepEqual(captured[1], transformShimArgv([...buildExpectedSdkArgv(workspace, resumeSchema, mcpPaths), "resume", "shim-thread"], "shim-thread", mcpPaths));
  const controlEvents = await readControlRecords(control.file, control.identity);
  assert.equal(controlEvents.filter((event) => event.event === "started").length, 2);
  assert.equal(controlEvents.filter((event) => event.event === "completed").length, 2);
});

test("official SDK AbortSignal cancellation reaps shim wrapper and grandchild", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-sdk-abort-"));
  const shimDir = join(root, "src");
  const helperDir = join(root, "node_modules", "@openai", "codex");
  const workspace = join(root, "workspace");
  const pidPath = join(root, "children.json");
  await mkdir(shimDir, { recursive: true });
  await mkdir(join(helperDir, "bin"), { recursive: true });
  await mkdir(workspace);
  const shimPath = join(shimDir, "codex-isolation-shim.mjs");
  await copyFile(new URL("../src/codex-isolation-shim.mjs", import.meta.url), shimPath);
  await copyFile(new URL("../src/process-group-control.mjs", import.meta.url), join(shimDir, "process-group-control.mjs"));
  await chmod(shimPath, 0o755);
  await writeFile(join(helperDir, "package.json"), JSON.stringify({ name: "@openai/codex", version: EXPECTED_CODEX_VERSION, bin: { codex: "bin/codex.js" } }));
  await writeFile(join(helperDir, "bin", "codex.js"), [
    "#!/usr/bin/env node",
    "import { spawn } from 'node:child_process';",
    "import { writeFileSync } from 'node:fs';",
    "const grandchild = spawn(process.execPath, ['-e', `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)`], {stdio:'ignore'});",
    "writeFileSync(process.env.CODEX_CHILD_PID_FILE, JSON.stringify({wrapper:process.pid,grandchild:grandchild.pid}));",
    "process.on('SIGTERM', () => process.exit(0));",
    "process.stdin.resume();",
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  await chmod(join(helperDir, "bin", "codex.js"), 0o755);
  const mcpPaths = await createExecutableMcpFixture(root);
  const control = await createSupervisorControl(join(root, "supervisor"), workspace, RUN_ID, process.pid);
  const codex = new Codex({ ...buildCodexOptions(shimPath, mcpPaths), env: {
    PATH: process.env.PATH ?? "",
    CODEX_CHILD_PID_FILE: pidPath,
    DJ_CODEX_SHIM_CONTROL_FILE: control.file,
    DJ_CODEX_SHIM_RUN_ID: RUN_ID,
    DJ_CODEX_SHIM_PARENT_PID: String(process.pid),
    ...buildMcpShimEnvironment(mcpPaths),
  } });
  const controller = new AbortController();
  const consuming = (async () => {
    const streamed = await codex.startThread(buildThreadOptions(workspace)).runStreamed("probe", { outputSchema: { type: "object" }, signal: controller.signal });
    for await (const _event of streamed.events) { /* consume until cancellation */ }
  })();
  const pids = await waitForJson(pidPath) as { wrapper: number; grandchild: number };
  controller.abort(new Error("test cancellation"));
  await assert.rejects(consuming);
  await waitForDead(pids.wrapper);
  await waitForDead(pids.grandchild);
  assert.equal(isAlive(pids.wrapper), false);
  assert.equal(isAlive(pids.grandchild), false);
  assert.equal(isProcessGroupAlive(pids.wrapper), false);
  const controlEvents = await readControlRecords(control.file, control.identity);
  assert.equal(controlEvents.length, 2);
  assert.equal(controlEvents[0]!.event, "started");
  assert.equal(controlEvents[1]!.event, "completed");
  assert.equal(controlEvents[1]!.event === "completed" && controlEvents[1]!.outcome, "cancelled");
});

test("synthetic negative sentinels are generated outside the app workspace and unsafe overlap is rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-sentinels-"));
  const sentinels = await createSyntheticSentinels(root);
  assert.equal((await readFile(sentinels.outsideText, "utf8")).includes("OUTSIDE_WORKSPACE_SENTINEL"), true);
  assert.equal((await readFile(sentinels.audioShaped)).subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(sentinels.symlinkAlias.startsWith(sentinels.appWorkspace), true);
  assert.equal(sentinels.outsideText.startsWith(sentinels.appWorkspace), false);
  assert.equal(sentinels.ambientMarker, join(sentinels.appWorkspace, "AGENTS.md"));
  assert.equal((await readFile(sentinels.ambientMarker, "utf8")).includes("AMBIENT_RULES_MARKER"), true);
  await assert.rejects(createSyntheticSentinels(root, root), /sentinel root must not be the app workspace/);
});

test("app workspace validation rejects music roots, outside paths, and symlink aliases before SDK use", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workspace-policy-"));
  const appRoot = join(root, "app-owned");
  const musicRoot = join(root, "music-root");
  const alias = join(root, "app-alias");
  await mkdir(appRoot);
  await mkdir(musicRoot);
  await (await import("node:fs/promises")).symlink(musicRoot, alias);
  assert.equal(await validateAppWorkspace(appRoot, appRoot, [musicRoot]), appRoot);
  await assert.rejects(validateAppWorkspace(musicRoot, appRoot, [musicRoot]), /working directory is not the app-owned workspace/);
  await assert.rejects(validateAppWorkspace(alias, appRoot, [musicRoot]), /working directory is not the app-owned workspace/);
  await assert.rejects(validateAppWorkspace(join(root, "outside"), appRoot, [musicRoot]), /working directory is not the app-owned workspace/);
});

test("matching packaged helper resolution rejects a mismatched runtime version", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-helper-fixture-"));
  const sdkPackage = join(root, "node_modules", "@openai", "codex-sdk", "package.json");
  const helperDir = join(root, "node_modules", "@openai", "codex");
  await mkdir(join(root, "node_modules", "@openai", "codex-sdk"), { recursive: true });
  await mkdir(helperDir, { recursive: true });
  await writeFile(sdkPackage, JSON.stringify({ name: "@openai/codex-sdk", version: EXPECTED_CODEX_VERSION }));
  await writeFile(join(helperDir, "package.json"), JSON.stringify({ name: "@openai/codex", version: "0.145.0", bin: { codex: "bin/codex.js" } }));
  await mkdir(join(helperDir, "bin"));
  await writeFile(join(helperDir, "bin", "codex.js"), "#!/usr/bin/env node\n");
  await assert.rejects(resolvePackagedHelper(sdkPackage), /matching @openai\/codex@0\.146\.0/);
});

test("installed SDK resolves its matching packaged helper, never ambient PATH", async () => {
  const sdkPackage = new URL("../node_modules/@openai/codex-sdk/package.json", import.meta.url).pathname;
  const helper = await resolvePackagedHelper(sdkPackage);
  assert.equal(helper.version, EXPECTED_CODEX_VERSION);
  assert.match(helper.executable, /node_modules\/@openai\/codex/);
  assert.equal(await verifyPackagedHelperVersion(helper.executable, 2_000), EXPECTED_CODEX_VERSION);
});

test("matching packaged helper accepts the exact isolated Codex configuration", async () => {
  const sdkPackage = new URL("../node_modules/@openai/codex-sdk/package.json", import.meta.url).pathname;
  const helper = await resolvePackagedHelper(sdkPackage);
  assert.equal(
    await verifyPackagedHelperConfig(helper.executable, STATIC_MCP_PATHS, 2_000),
    EXPECTED_CODEX_VERSION,
  );
});

test("matching packaged helper fails sandboxed child execution closed without the broad minimal profile", async () => {
  const sdkPackage = new URL("../node_modules/@openai/codex-sdk/package.json", import.meta.url).pathname;
  const helper = await resolvePackagedHelper(sdkPackage);
  await verifyPackagedHelperSandboxProfile(helper.executable, STATIC_MCP_PATHS, 2_000);
});

test("auth inspection invokes only matching helper version/login status and returns no raw partial key", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-auth-fixture-"));
  const helper = join(root, "codex-fixture.mjs");
  const capture = join(root, "calls.jsonl");
  await writeFile(helper, [
    "#!/usr/bin/env node",
    "import { appendFileSync } from 'node:fs';",
    `appendFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
    "if (process.argv[2] === '--version') console.log('codex-cli 0.146.0');",
    "else if (process.argv[2] === 'login' && process.argv[3] === 'status') console.error('Logged in using an API key - sk-partial-secret');",
    "else process.exitCode = 64;",
  ].join("\n"));
  await chmod(helper, 0o755);
  const status = await inspectExistingAuth(helper, 2_000);
  assert.deepEqual(status, { kind: "other_auth" });
  assert.equal(JSON.stringify(status).includes("partial"), false);
  assert.deepEqual((await readFile(capture, "utf8")).trim().split("\n").map((line) => JSON.parse(line)), [["--version"], ["login", "status"]]);
});

test("bounded helper preflight kills and reaps an ignoring helper process group", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-preflight-cleanup-"));
  const helper = join(root, "codex-hanging-fixture.mjs");
  const pidPath = join(root, "pids.json");
  await writeFile(helper, [
    "#!/usr/bin/env node",
    "import { spawn } from 'node:child_process';",
    "import { writeFileSync } from 'node:fs';",
    "process.on('SIGTERM', () => {});",
    "const grandchild = spawn(process.execPath, ['-e', `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)`], {stdio:'ignore'});",
    `writeFileSync(${JSON.stringify(pidPath)}, JSON.stringify({helper:process.pid,grandchild:grandchild.pid}));`,
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  await chmod(helper, 0o755);
  await assert.rejects(verifyPackagedHelperVersion(helper, 2_000), /matching packaged helper version/);
  const pids = await waitForJson(pidPath) as { helper: number; grandchild: number };
  await waitForDead(pids.helper);
  await waitForDead(pids.grandchild);
  assert.equal(isAlive(pids.helper), false);
  assert.equal(isAlive(pids.grandchild), false);
});

test("helper cleanup kills a TERM-ignoring grandchild after cooperative parent exit", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-preflight-orphan-"));
  const helper = join(root, "codex-cooperative-fixture.mjs");
  const pidPath = join(root, "pids.json");
  await writeFile(helper, [
    "#!/usr/bin/env node",
    "import { spawn } from 'node:child_process';",
    "import { writeFileSync } from 'node:fs';",
    "const grandchild = spawn(process.execPath, ['-e', `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)`], {stdio:'ignore'});",
    `writeFileSync(${JSON.stringify(pidPath)}, JSON.stringify({helper:process.pid,grandchild:grandchild.pid}));`,
    "process.on('SIGTERM', () => process.exit(0));",
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  await chmod(helper, 0o755);
  await assert.rejects(verifyPackagedHelperVersion(helper, 1_000), /matching packaged helper version/);
  const pids = await waitForJson(pidPath) as { helper: number; grandchild: number };
  await waitForDead(pids.helper);
  await waitForDead(pids.grandchild);
  assert.equal(isAlive(pids.grandchild), false);
});

test("bounded process-group termination has an absolute post-KILL deadline without exit", async () => {
  const signals: string[] = [];
  const started = Date.now();
  const result = await boundedTerminateProcessGroup({
    signalGroup: (signal) => { signals.push(signal); },
    waitForExit: async () => new Promise<never>(() => {}),
    isGroupAlive: () => true,
    graceMs: 10,
    postKillMs: 15,
  });
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.deepEqual(result, { directChildSettled: false, helperGroupExtinct: false, verified: false, verificationFailed: false });
  assert.equal(Date.now() - started < 150, true);
});

test("direct wrapper exit cannot verify cleanup when group signals are no-op or fail", async () => {
  const noOpSignals: NodeJS.Signals[] = [];
  const noOp = await boundedTerminateProcessGroup({
    signalGroup: (signal) => { noOpSignals.push(signal); },
    waitForExit: async () => {},
    isGroupAlive: () => true,
    graceMs: 5,
    postKillMs: 10,
  });
  assert.deepEqual(noOpSignals, ["SIGTERM", "SIGKILL"]);
  assert.deepEqual(noOp, { directChildSettled: true, helperGroupExtinct: false, verified: false, verificationFailed: false });
  assert.equal("survivors" in noOp, false);

  const denied = Object.assign(new Error("denied"), { code: "EPERM" });
  const failedSignals: NodeJS.Signals[] = [];
  const failed = await boundedTerminateProcessGroup({
    signalGroup: (signal) => { failedSignals.push(signal); throw denied; },
    waitForExit: async () => {},
    isGroupAlive: () => { throw denied; },
    graceMs: 5,
    postKillMs: 10,
  });
  assert.deepEqual(failedSignals, ["SIGTERM", "SIGKILL"]);
  assert.deepEqual(failed, { directChildSettled: true, helperGroupExtinct: false, verified: false, verificationFailed: true });
});

test("executable shim terminates its matching wrapper and grandchild on cancellation", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-shim-cleanup-"));
  const shimDir = join(root, "src");
  const helperDir = join(root, "node_modules", "@openai", "codex");
  const workspace = join(root, "workspace");
  const pidPath = join(root, "children.json");
  await mkdir(shimDir, { recursive: true });
  await mkdir(join(helperDir, "bin"), { recursive: true });
  await mkdir(workspace);
  const shimPath = join(shimDir, "codex-isolation-shim.mjs");
  await copyFile(new URL("../src/codex-isolation-shim.mjs", import.meta.url), shimPath);
  await copyFile(new URL("../src/process-group-control.mjs", import.meta.url), join(shimDir, "process-group-control.mjs"));
  await chmod(shimPath, 0o755);
  await writeFile(join(helperDir, "package.json"), JSON.stringify({ name: "@openai/codex", version: EXPECTED_CODEX_VERSION, bin: { codex: "bin/codex.js" } }));
  await writeFile(join(helperDir, "bin", "codex.js"), [
    "#!/usr/bin/env node",
    "import { spawn } from 'node:child_process';",
    "import { writeFileSync } from 'node:fs';",
    "process.on('SIGTERM', () => process.exit(0));",
    "const grandchild = spawn(process.execPath, ['-e', `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)`], {stdio:'ignore'});",
    "writeFileSync(process.env.CODEX_CHILD_PID_FILE, JSON.stringify({wrapper:process.pid,grandchild:grandchild.pid}));",
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  await chmod(join(helperDir, "bin", "codex.js"), 0o755);
  const mcpPaths = await createExecutableMcpFixture(root);
  const control = await createSupervisorControl(join(root, "supervisor"), workspace, RUN_ID, process.pid);
  const child = spawn(shimPath, buildExpectedSdkArgv(workspace, join(root, "schema.json"), mcpPaths), {
    env: {
      PATH: process.env.PATH ?? "",
      CODEX_CHILD_PID_FILE: pidPath,
      DJ_CODEX_SHIM_CONTROL_FILE: control.file,
      DJ_CODEX_SHIM_RUN_ID: RUN_ID,
      DJ_CODEX_SHIM_PARENT_PID: String(process.pid),
      ...buildMcpShimEnvironment(mcpPaths),
    },
    stdio: "ignore",
  });
  const pids = await waitForJson(pidPath) as { wrapper: number; grandchild: number };
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((_, reject) => setTimeout(() => reject(new Error("shim did not escalate cancellation")), 1_000)),
  ]);
  await waitForDead(pids.wrapper);
  await waitForDead(pids.grandchild);
  assert.equal(isAlive(pids.wrapper), false);
  assert.equal(isAlive(pids.grandchild), false);
  assert.equal(isProcessGroupAlive(pids.wrapper), false);
  const shimEvents = await readControlRecords(control.file, control.identity);
  assert.equal(shimEvents.length, 2);
  assert.equal(shimEvents[0]!.childPid, pids.wrapper);
  assert.equal(shimEvents[1]!.event, "completed");
});

test("new and resumed lifecycle streams events and returns validated structured JSON", async () => {
  const calls: string[] = [];
  let streamRuns = 0;
  const turnOptions: Array<{ outputSchema?: unknown; signal?: AbortSignal }> = [];
  const events = [{ type: "thread.started", thread_id: "thread-1" }, { type: "item.completed", item: { type: "agent_message", text: '{"ids":["fixture-1"]}' } }];
  const thread = {
    id: "thread-1",
    async runStreamed(_prompt: string, options?: { outputSchema?: unknown; signal?: AbortSignal }): Promise<{ events: AsyncIterable<unknown> }> {
      streamRuns += 1;
      turnOptions.push(options ?? {});
      async function* stream() { for (const event of events) yield event; }
      return { events: stream() };
    },
  };
  const client = {
    startThread() { calls.push("start"); return thread; },
    resumeThread(id: string) { calls.push(`resume:${id}`); return thread; },
  };
  const schema = { type: "object" };
  const stages: string[] = [];
  const result = await runLifecycle(client, "/app/ai-workspace", schema, ["fixture-1"], 5_000, (stage) => stages.push(stage));
  assert.deepEqual(calls, ["start", "resume:thread-1"]);
  assert.equal(streamRuns, 2);
  assert.equal(turnOptions.every((options) => options.outputSchema === schema && options.signal instanceof AbortSignal), true);
  assert.deepEqual(result.value, { ids: ["fixture-1"] });
  assert.deepEqual(result.events, events);
  assert.deepEqual(result.resumedEvents, events);
  assert.deepEqual(stages, ["lifecycle_start", "lifecycle_resume"]);
});

test("lifecycle requires the exact expected IDs from both new and resumed streams", async () => {
  function clientFor(firstIds: string[], resumedIds: string[]) {
    const thread = (ids: string[]) => ({
      id: "thread-1",
      async runStreamed(): Promise<{ events: AsyncIterable<unknown> }> {
        async function* stream() {
          yield { type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ ids }) } };
        }
        return { events: stream() };
      },
    });
    return {
      startThread() { return thread(firstIds); },
      resumeThread() { return thread(resumedIds); },
    };
  }
  const schema = { type: "object" };
  await assert.rejects(
    runLifecycle(clientFor(["fixture-2"], ["fixture-1"]), "/app/ai-workspace", schema, ["fixture-1"], 5_000),
    /invalid lifecycle structured result/,
  );
  await assert.rejects(
    runLifecycle(clientFor(["fixture-1"], ["fixture-2"]), "/app/ai-workspace", schema, ["fixture-1"], 5_000),
    /invalid lifecycle structured result/,
  );
});

test("negative-capability classification never treats model booleans as denial proof", () => {
  const allFalse = JSON.stringify({
    outside_text_read: false,
    symlink_read: false,
    audio_bytes_read: false,
    shell_marker_created: false,
    patch_marker_created: false,
    music_root_cwd_entered: false,
    network_used: false,
    undeclared_tool_used: false,
  });
  assert.deepEqual(classifyNegativeCapabilityEvidence({ modelOutput: allFalse, observedSuccesses: ["outside_text_read"], observedDenied: [] }), {
    counterevidence: ["outside_text_read"],
    proofUnavailable: ["symlink_read", "audio_bytes_read", "shell_marker_created", "patch_marker_created", "music_root_cwd_entered", "network_used", "undeclared_tool_used"],
    blocker: true,
  });
  const unavailable = classifyNegativeCapabilityEvidence({ modelOutput: allFalse, observedSuccesses: [], observedDenied: ["shell_marker_created"] });
  assert.equal(unavailable.counterevidence.length, 0);
  assert.equal(unavailable.proofUnavailable.includes("outside_text_read"), true);
  assert.equal(unavailable.proofUnavailable.includes("audio_bytes_read"), true);
  assert.equal(unavailable.blocker, true);
});

test("sanitized failure taxonomy distinguishes fixed categories without returning raw text", () => {
  const cases: Array<[Error, { category: string; reason?: string }]> = [
    [new Error("total timeout"), { category: "timeout" }],
    [new Error("codex isolation shim rejected argv secret-path"), { category: "shim" }],
    [new Error("invalid configuration secret-value"), { category: "config" }],
    [new Error("Failed to parse item: private response"), { category: "protocol" }],
    [new Error("network connection refused token"), { category: "network" }],
    [new Error("upstream service unavailable account"), { category: "service" }],
    [new Error("required Codex MCP echo failed"), { category: "unknown" }],
    [new Error("required Codex MCP echo failed (tool_not_observed)"), { category: "mcp", reason: "tool_not_observed" }],
    [new Error("total-timeout cleanup failed (after_timeout)"), { category: "cleanup", reason: "after_timeout" }],
  ];
  for (const [error, expected] of cases) {
    const classified = classifySanitizedFailure(error);
    assert.deepEqual(classified, expected);
    assert.equal(JSON.stringify(classified).includes("secret"), false);
    assert.equal(JSON.stringify(classified).includes("private"), false);
    assert.equal(JSON.stringify(classified).includes("token"), false);
    assert.equal(JSON.stringify(classified).includes("account"), false);
  }
});

test("structured output rejects malformed, extra, unknown, and oversized IDs", () => {
  assert.deepEqual(validateStructuredResult('{"ids":["fixture-1"]}'), { ids: ["fixture-1"] });
  for (const value of [
    "not-json",
    '{"ids":[]}',
    '{"ids":["fixture-1"],"extra":true}',
    '{"ids":["unknown"]}',
    '{"ids":["fixture-1","fixture-2","fixture-3","fixture-4","fixture-5","fixture-6"]}',
    `{"ids":["${"x".repeat(10_000)}"]}`,
  ]) {
    assert.throws(() => validateStructuredResult(value), /invalid structured result/);
  }
});

test("total timeout aborts the operation and always invokes descendant cleanup", async () => {
  let aborted = false;
  let cleaned = false;
  await assert.rejects(
    withTotalTimeout(
      async (signal) => new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); }, { once: true })),
      10,
      async () => { cleaned = true; },
    ),
    /total timeout/,
  );
  assert.equal(aborted, true);
  assert.equal(cleaned, true);
});

test("total timeout wins even when the operation ignores AbortSignal", async () => {
  let cleaned = false;
  const started = Date.now();
  await assert.rejects(
    withTotalTimeout(
      async () => new Promise<never>(() => {}),
      15,
      async () => { cleaned = true; },
    ),
    /total timeout/,
  );
  assert.equal(Date.now() - started < 250, true);
  assert.equal(cleaned, true);
});

test("total timeout runs cleanup when operation throws synchronously", async () => {
  let cleaned = false;
  await assert.rejects(
    withTotalTimeout(
      (() => { throw new Error("sync failure"); }) as unknown as (signal: AbortSignal) => Promise<never>,
      100,
      async () => { cleaned = true; },
    ),
    /sync failure/,
  );
  assert.equal(cleaned, true);
});

test("successful total-timeout operation does not abort its completed SDK signal", async () => {
  let observedSignal: AbortSignal | undefined;
  let cleaned = false;
  const result = await withTotalTimeout(
    async (signal) => {
      observedSignal = signal;
      return "complete";
    },
    100,
    async () => { cleaned = true; },
  );
  assert.equal(result, "complete");
  assert.equal(observedSignal?.aborted, false);
  assert.equal(cleaned, true);
});

test("rejected total-timeout operation does not abort its settled SDK signal", async () => {
  let observedSignal: AbortSignal | undefined;
  let cleaned = false;
  await assert.rejects(
    withTotalTimeout(
      async (signal) => {
        observedSignal = signal;
        throw new Error("operation rejection");
      },
      100,
      async () => { cleaned = true; },
    ),
    /operation rejection/,
  );
  assert.equal(observedSignal?.aborted, false);
  assert.equal(cleaned, true);
});

test("cleanup rejection preserves whether success, operation error, or timeout came first", async () => {
  const rejectingCleanup = async () => { throw new Error("sensitive cleanup detail"); };
  await assert.rejects(
    withTotalTimeout(async () => "complete", 100, rejectingCleanup),
    /total-timeout cleanup failed \(after_success\)$/,
  );
  await assert.rejects(
    withTotalTimeout(async () => { throw new Error("sensitive operation detail"); }, 100, rejectingCleanup),
    /total-timeout cleanup failed \(after_error\)$/,
  );
  await assert.rejects(
    withTotalTimeout(async () => new Promise<never>(() => {}), 10, rejectingCleanup),
    /total-timeout cleanup failed \(after_timeout\)$/,
  );
});

test("undefined rejection remains a failure with successful or rejected cleanup", async () => {
  let cleaned = false;
  await assert.rejects(withTotalTimeout(
    async () => Promise.reject(),
    100,
    async () => { cleaned = true; },
  ));
  assert.equal(cleaned, true);
  await assert.rejects(
    withTotalTimeout(
      async () => Promise.reject(),
      100,
      async () => { throw new Error("sensitive cleanup detail"); },
    ),
    /total-timeout cleanup failed \(after_error\)$/,
  );
});

test("local-only mode initializes neither SDK, MCP, nor network", async () => {
  const result = await runLocalOnly({
    sdk: () => { throw new Error("SDK initialized"); },
    mcp: () => { throw new Error("MCP initialized"); },
    network: () => { throw new Error("network initialized"); },
  });
  assert.deepEqual(result, { mode: "local_only" });
});

async function createExecutableMcpFixture(root: string): Promise<McpRegistrationPaths> {
  const requestedWorkingDirectory = join(root, "python_mcp");
  await mkdir(join(requestedWorkingDirectory, ".venv", "bin"), { recursive: true });
  const workingDirectory = await realpath(requestedWorkingDirectory);
  const pythonExecutable = join(workingDirectory, ".venv", "bin", "python");
  const serverScript = join(workingDirectory, "server.py");
  await writeFile(pythonExecutable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await chmod(pythonExecutable, 0o755);
  await writeFile(serverScript, "# local MCP fixture\n");
  return { pythonExecutable, serverScript, workingDirectory };
}

async function waitForJson(path: string): Promise<unknown> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { return JSON.parse(await readFile(path, "utf8")); } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
  throw new Error("timed out waiting for child pid fixture");
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function isProcessGroupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function waitForDead(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!isAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for process cleanup");
}
