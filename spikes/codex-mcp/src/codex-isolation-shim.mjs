#!/usr/bin/env node
import { spawn } from "node:child_process";
import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, statSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedTerminateProcessGroupImpl } from "./process-group-control.mjs";

const EXPECTED_VERSION = "0.146.0";
const MCP_SERVER_NAME = "dj_copilot_fixture";
const MCP_TOOL_NAME = "echo_library_ids";
const BASE_CONFIG = [
  'default_permissions="dj_read"',
  'permissions.dj_read.filesystem.\":workspace_roots\".\".\"="read"',
  "permissions.dj_read.network.enabled=false",
  "features.shell_tool=false",
  "features.apps=false",
  "features.connectors=false",
  "features.enable_mcp_apps=false",
  "features.plugins=false",
  "features.tool_suggest=false",
  "apps._default.enabled=false",
  "features.standalone_web_search=false",
  "features.in_app_browser=false",
  "features.browser_use=false",
  "features.browser_use_full_cdp_access=false",
  "features.browser_use_external=false",
  "features.computer_use=false",
];

export function transformShimArgv(argv, expectedResumeId, expectedMcpRegistration) {
  const mcp = validateMcpRegistrationShape(expectedMcpRegistration);
  const exactConfig = [
    ...BASE_CONFIG,
    `mcp_servers.${MCP_SERVER_NAME}.enabled=true`,
    `mcp_servers.${MCP_SERVER_NAME}.required=true`,
    `mcp_servers.${MCP_SERVER_NAME}.command=${JSON.stringify(mcp.pythonExecutable)}`,
    `mcp_servers.${MCP_SERVER_NAME}.args=["-B", "-W", "error", ${JSON.stringify(mcp.serverScript)}]`,
    `mcp_servers.${MCP_SERVER_NAME}.cwd=${JSON.stringify(mcp.workingDirectory)}`,
    `mcp_servers.${MCP_SERVER_NAME}.env={}`,
    `mcp_servers.${MCP_SERVER_NAME}.startup_timeout_sec=5`,
    `mcp_servers.${MCP_SERVER_NAME}.tool_timeout_sec=3`,
    `mcp_servers.${MCP_SERVER_NAME}.enabled_tools=["${MCP_TOOL_NAME}"]`,
    `mcp_servers.${MCP_SERVER_NAME}.default_tools_approval_mode="approve"`,
  ];
  let index = 0;
  expectValue(argv, index++, "exec");
  expectValue(argv, index++, "--experimental-json");
  const output = ["exec", "--ignore-user-config", "--ignore-rules", "--experimental-json", "--strict-config"];
  for (const value of exactConfig) {
    expectValue(argv, index++, "--config");
    expectValue(argv, index++, value);
    output.push("-c", runtimeConfigOverride(value));
  }

  expectValue(argv, index++, "--cd");
  const workingDirectory = argv[index++];
  if (!validAbsolutePath(workingDirectory)) fail();
  output.push("--cd", workingDirectory);

  expectValue(argv, index++, "--skip-git-repo-check");
  output.push("--skip-git-repo-check");

  expectValue(argv, index++, "--output-schema");
  const schemaPath = argv[index++];
  if (!validAbsolutePath(schemaPath)) fail();
  output.push("--output-schema", schemaPath);

  for (const value of ['web_search="disabled"', 'approval_policy="never"']) {
    expectValue(argv, index++, "--config");
    expectValue(argv, index++, value);
    output.push("-c", value);
  }

  if (index < argv.length) {
    expectValue(argv, index++, "resume");
    const resumeId = argv[index++];
    if (typeof resumeId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(resumeId) || resumeId !== expectedResumeId) fail();
    output.push("resume", resumeId);
  }
  if (index !== argv.length) fail();
  return output;
}

function runtimeConfigOverride(value) {
  if (value === 'permissions.dj_read.filesystem.\":workspace_roots\".\".\"="read"') {
    return 'permissions.dj_read.filesystem={":workspace_roots"={"."="read"}}';
  }
  return value;
}

function validateMcpRegistrationShape(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail();
  if (Object.keys(value).sort().join(",") !== "pythonExecutable,serverScript,workingDirectory") fail();
  const paths = [value.pythonExecutable, value.serverScript, value.workingDirectory];
  if (paths.some((path) => !validAbsolutePath(path) || resolve(path) !== path)) fail();
  if (value.serverScript !== join(value.workingDirectory, "server.py")) fail();
  if (value.pythonExecutable !== join(value.workingDirectory, ".venv", "bin", "python")) fail();
  return value;
}

function validAbsolutePath(value) {
  return typeof value === "string" && isAbsolute(value) && !/[\u0000-\u001f\u007f]/.test(value);
}

function expectValue(argv, index, expected) {
  if (argv[index] !== expected) fail();
}

function fail() {
  throw new Error("unexpected Codex SDK argv");
}

export function resolveMatchingWrapper() {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve("@openai/codex/package.json");
  const metadata = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (metadata.version !== EXPECTED_VERSION || metadata.bin?.codex !== "bin/codex.js") {
    throw new Error("matching packaged Codex runtime unavailable");
  }
  return join(dirname(packageJsonPath), metadata.bin.codex);
}

async function main() {
  let transformed;
  try {
    const expectedMcpRegistration = expectedMcpRegistrationFromEnvironment();
    transformed = transformShimArgv(process.argv.slice(2), process.env.DJ_CODEX_EXPECTED_RESUME_ID, expectedMcpRegistration);
  } catch {
    process.stderr.write("codex isolation shim rejected argv\n");
    process.exitCode = 64;
    return;
  }
  const wrapper = resolveMatchingWrapper();
  const child = spawn(process.execPath, [wrapper, ...transformed], {
    stdio: "inherit",
    env: process.env,
    detached: process.platform !== "win32",
  });
  if (!positivePid(child.pid)) {
    try { child.kill("SIGKILL"); } catch {}
    process.stderr.write("codex isolation shim failed closed\n");
    process.exitCode = 70;
    return;
  }
  const invocationId = `inv-${randomUUID()}`;
  let startedRecord;
  try {
    startedRecord = appendStartedControlRecord(process.argv.slice(2), child.pid, invocationId);
  } catch {
    try { signalChildGroup(child, "SIGKILL"); } catch {}
    process.stderr.write("codex isolation shim failed closed\n");
    process.exitCode = 70;
    return;
  }
  const signalGroup = (signal) => {
    signalChildGroup(child, signal);
  };
  let cancelResolve;
  const cancelled = new Promise((resolveCancel) => { cancelResolve = resolveCancel; });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => cancelResolve(signal));
  }
  const exited = new Promise((resolveExit) => {
    child.once("error", () => resolveExit({ code: 70, signal: null }));
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  const first = await Promise.race([
    exited.then((result) => ({ kind: "exit", result })),
    cancelled.then((signal) => ({ kind: "cancel", signal })),
  ]);
  const cleanup = await boundedTerminateProcessGroupImpl({
    signalGroup,
    waitForExit: () => exited,
    isGroupAlive: () => isChildGroupAlive(child),
    graceMs: 100,
    postKillMs: 150,
  });
  if (!cleanup.verified) {
    process.stderr.write("codex isolation shim cleanup incomplete\n");
    process.exitCode = 70;
    return;
  }
  try {
    appendCompletedControlRecord(process.argv.slice(2), startedRecord, first.kind === "cancel" ? "cancelled" : "natural");
  } catch {
    process.stderr.write("codex isolation shim failed closed\n");
    process.exitCode = 70;
    return;
  }
  if (first.kind === "cancel") {
    process.exitCode = 130;
    return;
  }
  if (first.result.signal) process.exitCode = 128;
  else process.exitCode = first.result.code ?? 1;
}

function expectedMcpRegistrationFromEnvironment() {
  const value = validateMcpRegistrationShape({
    pythonExecutable: process.env.DJ_CODEX_EXPECTED_MCP_PYTHON,
    serverScript: process.env.DJ_CODEX_EXPECTED_MCP_SERVER,
    workingDirectory: process.env.DJ_CODEX_EXPECTED_MCP_CWD,
  });
  const cwdLstat = lstatSync(value.workingDirectory);
  const serverLstat = lstatSync(value.serverScript);
  const pythonLstat = lstatSync(value.pythonExecutable);
  const cwdReal = realpathSync(value.workingDirectory);
  const serverReal = realpathSync(value.serverScript);
  const pythonStat = statSync(value.pythonExecutable);
  if (!cwdLstat.isDirectory() || cwdLstat.isSymbolicLink() || cwdReal !== value.workingDirectory) fail();
  if (!serverLstat.isFile() || serverLstat.isSymbolicLink() || dirname(serverReal) !== cwdReal) fail();
  if ((!pythonLstat.isFile() && !pythonLstat.isSymbolicLink()) || !pythonStat.isFile() || (pythonStat.mode & 0o111) === 0) fail();
  return value;
}

function appendStartedControlRecord(argv, childPid, invocationId) {
  if (!validInvocationId(invocationId) || !positivePid(childPid)) fail();
  const identity = validateControlBoundary(argv);
  const record = {
    version: 1,
    event: "started",
    runId: identity.runId,
    parentPid: identity.parentPid,
    invocationId,
    shimPid: process.pid,
    childPid,
    startedAtMs: Date.now(),
  };
  appendExactControlRecord(identity.file, record);
  return record;
}

function appendCompletedControlRecord(argv, started, outcome) {
  if (outcome !== "natural" && outcome !== "cancelled") fail();
  const identity = validateControlBoundary(argv);
  if (identity.runId !== started.runId || identity.parentPid !== started.parentPid) fail();
  appendExactControlRecord(identity.file, { ...started, event: "completed", completedAtMs: Date.now(), outcome });
}

function validateControlBoundary(argv) {
  const file = process.env.DJ_CODEX_SHIM_CONTROL_FILE;
  const runId = process.env.DJ_CODEX_SHIM_RUN_ID;
  const parentPid = Number(process.env.DJ_CODEX_SHIM_PARENT_PID);
  if (typeof file !== "string" || !isAbsolute(file) || !validRunId(runId) || !positivePid(parentPid) || process.ppid !== parentPid) fail();
  const cdIndex = argv.indexOf("--cd");
  const workspace = argv[cdIndex + 1];
  if (cdIndex < 0 || typeof workspace !== "string") fail();
  const directory = dirname(file);
  const directoryReal = realpathSync(directory);
  const workspaceReal = realpathSync(workspace);
  const fromWorkspace = relative(workspaceReal, directoryReal);
  if (fromWorkspace === "" || (!fromWorkspace.startsWith("..") && !isAbsolute(fromWorkspace))) fail();
  const directoryStat = statSync(directoryReal);
  const directoryLstat = lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryLstat.isSymbolicLink() || (directoryStat.mode & 0o077) !== 0) fail();
  if (typeof process.getuid === "function" && directoryStat.uid !== process.getuid()) fail();
  return { file, runId, parentPid };
}

function appendExactControlRecord(file, record) {
  const descriptor = openSync(file, fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_NOFOLLOW);
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0 || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) fail();
    writeSync(descriptor, `${JSON.stringify(record)}\n`, null, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

function validRunId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$/.test(value);
}

function validInvocationId(value) {
  return typeof value === "string" && /^inv-[A-Za-z0-9][A-Za-z0-9_-]{11,59}$/.test(value);
}

function positivePid(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function signalChildGroup(child, signal) {
  if (process.platform === "win32") child.kill(signal);
  else if (positivePid(child.pid)) process.kill(-child.pid, signal);
  else throw new Error("child process group unavailable");
}

function isChildGroupAlive(child) {
  if (!positivePid(child.pid)) throw new Error("child process group unavailable");
  try {
    process.kill(process.platform === "win32" ? child.pid : -child.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

if (process.argv[1] !== undefined && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  await main();
}
