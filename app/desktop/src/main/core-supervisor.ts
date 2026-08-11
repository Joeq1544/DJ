import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { chmod, mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppStatus, CoreRequest } from "../shared/contracts";
import { CoreClient } from "./core-client";

const SAFE_FAILURE_MESSAGE = "Core service stopped unexpectedly";
const STDERR_LIMIT = 8_192;

interface CoreRequester {
  request(command: CoreRequest["command"], payload: unknown): Promise<unknown>;
  close(): void;
}

export interface CoreSupervisorOptions {
  userDataPath: string;
  repositoryRoot: string;
  pythonExecutable?: string;
  now?: () => number;
  spawn?: (command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => ChildProcess;
  createClient?: (socketPath: string) => CoreRequester;
}

export class CoreSupervisor {
  private readonly spawnProcess: NonNullable<CoreSupervisorOptions["spawn"]>;
  private readonly createClient: NonNullable<CoreSupervisorOptions["createClient"]>;
  private readonly pythonExecutable: string;
  private readonly now: () => number;
  private state: AppStatus = { state: "starting", message: null };
  private child: ChildProcess | undefined;
  private client: CoreRequester | undefined;
  private runtimePath: string | undefined;
  private stopping = false;
  private restartCount = 0;
  private firstUnexpectedExitAt: number | undefined;
  private stderr = "";

  constructor(private readonly options: CoreSupervisorOptions) {
    this.spawnProcess = options.spawn ?? ((command, args, spawnOptions) =>
      nodeSpawn(command, args, { env: spawnOptions.env, stdio: ["ignore", "ignore", "pipe"] }));
    this.createClient = options.createClient ?? ((socketPath) => new CoreClient(socketPath));
    this.pythonExecutable = options.pythonExecutable ?? process.env.DJ_COPILOT_PYTHON ?? "python3";
    this.now = options.now ?? Date.now;
  }

  async start(): Promise<void> {
    if (!this.runtimePath) {
      this.runtimePath = await mkdtemp(join(tmpdir(), "dj-copilot-runtime-"));
      await chmod(this.runtimePath, 0o700);
    }
    this.stopping = false;
    await this.launch(false);
  }

  status(): AppStatus {
    return this.state;
  }

  runtimeDirectory(): string {
    if (!this.runtimePath) throw new Error("Core runtime has not started");
    return this.runtimePath;
  }

  getClient(): CoreRequester {
    if (!this.client) throw new Error("Core service is unavailable");
    return this.client;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.client?.close();
    const child = this.child;
    this.child = undefined;
    if (child && child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 2_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill("SIGTERM");
      });
    }
    await this.removeRuntimeDirectory();
  }

  async forceCoreExitForTest(): Promise<"retrying"> {
    if (process.env.DJ_COPILOT_TEST_MODE !== "1") throw new Error("Test core control is disabled");
    const child = this.child;
    if (!child || child.exitCode !== null) throw new Error("Core service is unavailable");
    child.kill("SIGKILL");
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (this.state.state === "retrying") return "retrying";
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Core service did not begin retrying");
  }

  private async launch(isRetry: boolean): Promise<void> {
    const socketPath = join(this.runtimeDirectory(), "core.sock");
    if (isRetry) {
      try {
        await unlink(socketPath);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
    this.state = isRetry
      ? { state: "retrying", message: "Restarting core service" }
      : { state: "starting", message: null };
    const child = this.spawnProcess(
      this.pythonExecutable,
      ["-B", "-m", "dj_copilot.service", "--socket", socketPath, "--database", join(this.options.userDataPath, "dj-copilot.sqlite3")],
      { env: { ...process.env, PYTHONPATH: join(this.options.repositoryRoot, "core") } },
    );
    this.child = child;
    child.stderr?.on("data", (chunk: Buffer | string) => {
      this.stderr = (this.stderr + String(chunk)).slice(-STDERR_LIMIT);
    });
    child.once("exit", () => this.handleExit(child));
    this.client = this.createClient(socketPath);
    try {
      await this.waitForHealth(this.client);
      if (this.child === child && !this.stopping) this.state = { state: "ready", message: null };
    } catch {
      if (this.child === child && !this.stopping) {
        child.kill("SIGTERM");
        this.state = { state: "degraded", message: SAFE_FAILURE_MESSAGE };
      }
    }
  }

  private async removeRuntimeDirectory(): Promise<void> {
    const runtimePath = this.runtimePath;
    this.runtimePath = undefined;
    if (!runtimePath) return;
    await rm(runtimePath, { recursive: true, force: true });
  }

  private async waitForHealth(client: CoreRequester): Promise<void> {
    const deadline = Date.now() + 5_000;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        await client.request("health", {});
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Core health check timed out");
  }

  private handleExit(child: ChildProcess): void {
    if (this.child !== child) return;
    this.client?.close();
    if (this.stopping) return;
    const exitedAt = this.now();
    if (this.firstUnexpectedExitAt === undefined || exitedAt - this.firstUnexpectedExitAt > 30_000) {
      this.firstUnexpectedExitAt = exitedAt;
      this.restartCount = 0;
    }
    if (this.restartCount >= 1) {
      this.state = { state: "degraded", message: SAFE_FAILURE_MESSAGE };
      return;
    }
    this.restartCount += 1;
    void this.launch(true);
  }
}
