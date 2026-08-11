import { spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import type { AssistantAuthStatus } from "../../shared/contracts";
import { AIProviderError, CODEX_SDK_VERSION } from "./provider";

const DEFAULT_STATUS_TIMEOUT_MS = 5_000;
const DEFAULT_LOGIN_TIMEOUT_MS = 300_000;
const MAX_COMMAND_OUTPUT_BYTES = 8_192;
const PATH_WARNING_PREFIX = "WARNING: proceeding, even though we could not create PATH aliases:";

export interface AuthCommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface AuthCommandInvocation {
  executable: string;
  args: readonly string[];
  environment: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  timeoutMs: number;
}

export type AuthCommandRunner = (invocation: AuthCommandInvocation) => Promise<AuthCommandResult>;

export interface AuthRunner {
  getStatus(signal?: AbortSignal): Promise<AssistantAuthStatus>;
  beginLogin(signal: AbortSignal): Promise<AssistantAuthStatus>;
}

export interface PackagedCodexAuthRunnerOptions {
  sdkPackageDirectory?: string;
  environment?: NodeJS.ProcessEnv;
  commandRunner?: AuthCommandRunner;
  statusTimeoutMs?: number;
  loginTimeoutMs?: number;
}

const readyStatus = (): AssistantAuthStatus => ({
  state: "ready",
  auth: "chatgpt",
  message: "Codex is ready.",
  sdkVersion: CODEX_SDK_VERSION,
});

const signedOutStatus = (): AssistantAuthStatus => ({
  state: "signed_out",
  auth: "none",
  message: "Sign in with ChatGPT to use Copilot.",
  sdkVersion: CODEX_SDK_VERSION,
});

const unsupportedAuthStatus = (): AssistantAuthStatus => ({
  state: "unsupported_auth",
  auth: "other",
  message: "Copilot requires Sign in with ChatGPT.",
  sdkVersion: CODEX_SDK_VERSION,
});

const unavailableStatus = (): AssistantAuthStatus => ({
  state: "unavailable",
  auth: "unknown",
  message: "Codex authentication status is unavailable.",
  sdkVersion: null,
});

function isEnvironmentOverride(key: string): boolean {
  const normalized = key.toUpperCase();
  const mayOverrideCodex = normalized.includes("OPENAI") || normalized.startsWith("CODEX_");
  return mayOverrideCodex && (
    normalized.endsWith("API_KEY")
    || normalized.endsWith("ACCESS_TOKEN")
    || normalized.endsWith("API_TOKEN")
    || normalized.endsWith("BASE_URL")
    || normalized.endsWith("API_BASE")
    || normalized.endsWith("ENDPOINT")
  );
}

export function sanitizedCodexEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of Object.keys(source)) {
    if (isEnvironmentOverride(key)) continue;
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function sanitizedLines(output: string): string[] | null {
  const lines = output.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const warnings = lines.filter((line) => line.startsWith(PATH_WARNING_PREFIX));
  if (warnings.length > 1 || warnings.some((warning) => {
    const detail = warning.slice(PATH_WARNING_PREFIX.length).trim();
    return detail.length === 0
      || detail.length > 200
      || /sk-[A-Za-z0-9_-]{4,}|api[ _-]?key|access[ _-]?token|bearer/iu.test(detail);
  })) return null;
  const statusLines = lines.filter((line) => !line.startsWith(PATH_WARNING_PREFIX));
  return statusLines;
}

function classifyStatus(result: AuthCommandResult): AssistantAuthStatus {
  if (result.signal !== null || result.stdout.trim() !== "") return unavailableStatus();
  const lines = sanitizedLines(result.stderr);
  if (lines === null || lines.length !== 1) return unavailableStatus();
  const [status] = lines;
  if (result.code === 0 && status === "Logged in using ChatGPT") return readyStatus();
  if (result.code === 1 && status === "Not logged in") return signedOutStatus();
  if (result.code === 0 && status !== undefined && (
    /^Logged in using an API key(?:\s+-\s+.+)?$/u.test(status)
    || /^Logged in using (?:an access token|a personal access token|Amazon Bedrock API key)$/u.test(status)
  )) {
    return unsupportedAuthStatus();
  }
  return unavailableStatus();
}

function exactVersion(result: AuthCommandResult): boolean {
  if (result.code !== 0 || result.signal !== null) return false;
  const stderrLines = sanitizedLines(result.stderr);
  return stderrLines !== null
    && stderrLines.length === 0
    && result.stdout.trim() === `codex-cli ${CODEX_SDK_VERSION}`;
}

interface PackageMetadata {
  name?: unknown;
  version?: unknown;
  bin?: { codex?: unknown };
}

async function readMetadata(path: string): Promise<PackageMetadata> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid package metadata");
  return value as PackageMetadata;
}

async function resolveMatchingHelper(sdkPackageDirectory: string): Promise<string> {
  if (resolve(sdkPackageDirectory) !== sdkPackageDirectory) throw new Error("SDK package path must be absolute");
  const sdkRoot = await realpath(sdkPackageDirectory);
  const sdkMetadata = await readMetadata(join(sdkRoot, "package.json"));
  if (sdkMetadata.name !== "@openai/codex-sdk" || sdkMetadata.version !== CODEX_SDK_VERSION) {
    throw new Error("matching Codex SDK unavailable");
  }
  const helperRoot = await realpath(join(dirname(sdkRoot), "codex"));
  const helperMetadata = await readMetadata(join(helperRoot, "package.json"));
  if (
    helperMetadata.name !== "@openai/codex"
    || helperMetadata.version !== CODEX_SDK_VERSION
    || helperMetadata.bin?.codex !== "bin/codex.js"
  ) {
    throw new Error("matching Codex helper unavailable");
  }
  return realpath(join(helperRoot, "bin", "codex.js"));
}

export async function findPackagedCodexSdkDirectory(searchRoots?: readonly string[]): Promise<string> {
  const resourcePath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const starts = searchRoots ?? [process.cwd(), ...(resourcePath === undefined ? [] : [resourcePath])];
  const candidates = new Set<string>();
  for (const start of starts) {
    const root = parse(start).root;
    for (let current = resolve(start); ; current = dirname(current)) {
      candidates.add(join(current, "node_modules", "@openai", "codex-sdk"));
      candidates.add(join(current, "app", "node_modules", "@openai", "codex-sdk"));
      candidates.add(join(current, "app", "desktop", "node_modules", "@openai", "codex-sdk"));
      if (current === root) break;
    }
  }
  for (const candidate of candidates) {
    try {
      const metadata = await readMetadata(join(candidate, "package.json"));
      if (metadata.name === "@openai/codex-sdk" && metadata.version === CODEX_SDK_VERSION) return candidate;
    } catch {
      // Search only exact package locations and fail closed if none match.
    }
  }
  throw new Error("packaged Codex SDK unavailable");
}

const defaultCommandRunner: AuthCommandRunner = async (invocation) => new Promise<AuthCommandResult>((resolveResult, reject) => {
  if (invocation.signal?.aborted === true) {
    reject(new AIProviderError("cancelled", "The Codex login was cancelled."));
    return;
  }
  const environment = { ...invocation.environment };
  if (process.versions.electron !== undefined) environment.ELECTRON_RUN_AS_NODE = "1";
  const child = spawn(process.execPath, [invocation.executable, ...invocation.args], {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let outputBytes = 0;
  let settled = false;

  const finish = (result?: AuthCommandResult, error?: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    invocation.signal?.removeEventListener("abort", onAbort);
    child.removeAllListeners();
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
    if (error !== undefined) reject(error);
    else resolveResult(result ?? { code: null, signal: null, stdout: "", stderr: "" });
  };
  const stopForInvalidOutput = () => {
    try { child.kill("SIGTERM"); } catch { /* already exited */ }
    finish({ code: null, signal: "SIGTERM", stdout: "", stderr: "" });
  };
  const collect = (target: Buffer[]) => (chunk: Buffer) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
      stopForInvalidOutput();
      return;
    }
    target.push(chunk);
  };
  const onAbort = () => {
    try { child.kill("SIGTERM"); } catch { /* already exited */ }
    finish(undefined, new AIProviderError("cancelled", "The Codex login was cancelled."));
  };
  child.stdout?.on("data", collect(stdout));
  child.stderr?.on("data", collect(stderr));
  child.once("error", () => finish());
  child.once("close", (code, signal) => finish({
    code,
    signal,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  }));
  invocation.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(stopForInvalidOutput, invocation.timeoutMs);
});

export class PackagedCodexAuthRunner implements AuthRunner {
  private readonly sdkPackageDirectory: string | undefined;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly commandRunner: AuthCommandRunner;
  private readonly statusTimeoutMs: number;
  private readonly loginTimeoutMs: number;

  constructor(options: PackagedCodexAuthRunnerOptions = {}) {
    this.sdkPackageDirectory = options.sdkPackageDirectory;
    this.environment = options.environment ?? process.env;
    this.commandRunner = options.commandRunner ?? defaultCommandRunner;
    this.statusTimeoutMs = options.statusTimeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS;
    this.loginTimeoutMs = options.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
  }

  async getStatus(signal?: AbortSignal): Promise<AssistantAuthStatus> {
    try {
      const helper = await this.resolveHelper();
      const environment = sanitizedCodexEnvironment(this.environment);
      const version = await this.commandRunner({
        executable: helper,
        args: ["--version"],
        environment,
        ...(signal === undefined ? {} : { signal }),
        timeoutMs: this.statusTimeoutMs,
      });
      if (!exactVersion(version)) return unavailableStatus();
      const status = await this.commandRunner({
        executable: helper,
        args: ["login", "status"],
        environment,
        ...(signal === undefined ? {} : { signal }),
        timeoutMs: this.statusTimeoutMs,
      });
      return classifyStatus(status);
    } catch (error) {
      if (error instanceof AIProviderError && error.code === "cancelled") throw error;
      return unavailableStatus();
    }
  }

  async beginLogin(signal: AbortSignal): Promise<AssistantAuthStatus> {
    if (signal.aborted) throw new AIProviderError("cancelled", "The Codex login was cancelled.");
    try {
      const helper = await this.resolveHelper();
      const environment = sanitizedCodexEnvironment(this.environment);
      const version = await this.commandRunner({
        executable: helper,
        args: ["--version"],
        environment,
        signal,
        timeoutMs: this.statusTimeoutMs,
      });
      if (!exactVersion(version)) return unavailableStatus();
      const login = await this.commandRunner({
        executable: helper,
        args: ["login"],
        environment,
        signal,
        timeoutMs: this.loginTimeoutMs,
      });
      if (login.code !== 0 || login.signal !== null) return unavailableStatus();
      return this.getStatus(signal);
    } catch (error) {
      if (error instanceof AIProviderError && error.code === "cancelled") throw error;
      return unavailableStatus();
    }
  }

  private async resolveHelper(): Promise<string> {
    return resolveMatchingHelper(this.sdkPackageDirectory ?? await findPackagedCodexSdkDirectory());
  }
}
