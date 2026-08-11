import { lstat, mkdir, readdir } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { assistantAuthStatusSchema, type AssistantAuthStatus } from "../../shared/contracts";
import { PackagedCodexAuthRunner, sanitizedCodexEnvironment, type AuthRunner } from "./auth-runner";
import {
  AIProviderError,
  PROVIDER_TEXT_LIMIT,
  type AIProvider,
  type AIProviderEventHandler,
  type AIProviderOutputSchema,
  type AIProviderResult,
  type AIProviderStructuredResult,
  type AIProviderTask,
} from "./provider";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_STREAM_EVENTS = 1_000;
const MAX_AGENT_MESSAGES = 16;
const CORRECTIVE_PROMPT = [
  "Your previous response was invalid.",
  "Return only one complete JSON value matching the provided schema and using only identifiers from the supplied context.",
  "Do not add commentary or call tools.",
].join(" ");

export interface CodexSdkThreadOptionsLike {
  sandboxMode: "read-only";
  workingDirectory: string;
  skipGitRepoCheck: true;
  networkAccessEnabled: false;
  webSearchMode: "disabled";
  approvalPolicy: "never";
  additionalDirectories: string[];
}

export interface CodexSdkTurnOptionsLike {
  outputSchema?: unknown;
  signal: AbortSignal;
}

export interface CodexSdkThreadLike {
  runStreamed(
    input: string,
    options: CodexSdkTurnOptionsLike,
  ): Promise<{ events: AsyncIterable<unknown> }>;
}

export interface CodexSdkClientLike {
  startThread(options: CodexSdkThreadOptionsLike): CodexSdkThreadLike;
  resumeThread(threadId: string, options: CodexSdkThreadOptionsLike): CodexSdkThreadLike;
}

export interface CodexSdkModuleLike {
  Codex: new (options: { env: Record<string, string> }) => CodexSdkClientLike;
}

export interface CodexProviderOptions {
  workingDirectory: string;
  timeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
  sdkPackageDirectory?: string;
  authRunner?: AuthRunner;
  loadSdk?: () => Promise<CodexSdkModuleLike>;
}

interface Deadline {
  signal: AbortSignal;
  timedOut(): boolean;
  abort(reason?: unknown): void;
  cleanup(): void;
}

interface ConsumedTurn {
  text: string;
  threadId: string;
}

class RunAbortedError extends Error {}

function unavailableStatus(): AssistantAuthStatus {
  return {
    state: "unavailable",
    auth: "unknown",
    message: "Codex authentication status is unavailable.",
    sdkVersion: null,
  };
}

function createDeadline(external: AbortSignal, timeoutMs: number): Deadline {
  const controller = new AbortController();
  let timeoutReached = false;
  const onExternalAbort = () => controller.abort(external.reason);
  if (external.aborted) controller.abort(external.reason);
  else external.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(() => {
    timeoutReached = true;
    controller.abort(new RunAbortedError("deadline"));
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    abort: (reason) => controller.abort(reason),
    cleanup() {
      clearTimeout(timer);
      external.removeEventListener("abort", onExternalAbort);
    },
  };
}

async function waitForAbortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  onAbort?: () => void,
): Promise<T> {
  if (signal.aborted) {
    onAbort?.();
    throw new RunAbortedError("aborted");
  }
  return new Promise<T>((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => finish(() => {
      onAbort?.();
      rejectPromise(new RunAbortedError("aborted"));
    });
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => finish(() => resolvePromise(value)),
      (error: unknown) => finish(() => rejectPromise(error)),
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOpaqueThreadId(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 128
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function providerError(error: unknown, externalSignal: AbortSignal, deadline: Deadline): AIProviderError {
  if (externalSignal.aborted) return new AIProviderError("cancelled", "The Codex request was cancelled.");
  if (deadline.timedOut()) return new AIProviderError("timeout", "The Codex request timed out.");
  if (error instanceof AIProviderError) return error;
  return new AIProviderError("unknown", "Codex could not complete the request.");
}

function parseStructured<Output>(text: string, output: AIProviderOutputSchema<Output>): Output | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = output.zodSchema.safeParse(raw);
  if (!parsed.success) return null;
  if (output.validateKnownIds !== undefined) {
    try {
      if (!output.validateKnownIds(parsed.data)) return null;
    } catch {
      return null;
    }
  }
  return parsed.data;
}

export class CodexProvider implements AIProvider {
  private readonly workingDirectory: string;
  private readonly timeoutMs: number;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly authRunner: AuthRunner;
  private readonly loadSdk: () => Promise<CodexSdkModuleLike>;
  private loadedSdk: Promise<CodexSdkModuleLike> | undefined;

  constructor(options: CodexProviderOptions) {
    this.workingDirectory = options.workingDirectory;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError("Codex provider timeout must be a positive integer");
    }
    this.environment = options.environment ?? process.env;
    this.authRunner = options.authRunner ?? new PackagedCodexAuthRunner({
      environment: this.environment,
      ...(options.sdkPackageDirectory === undefined ? {} : { sdkPackageDirectory: options.sdkPackageDirectory }),
    });
    this.loadSdk = options.loadSdk ?? (async () => import("@openai/codex-sdk") as unknown as Promise<CodexSdkModuleLike>);
  }

  async getStatus(): Promise<AssistantAuthStatus> {
    try {
      return this.validStatus(await this.authRunner.getStatus());
    } catch {
      return unavailableStatus();
    }
  }

  async beginLogin(signal: AbortSignal): Promise<AssistantAuthStatus> {
    try {
      return this.validStatus(await this.authRunner.beginLogin(signal));
    } catch (error) {
      if (signal.aborted || (error instanceof AIProviderError && error.code === "cancelled")) {
        throw new AIProviderError("cancelled", "The Codex login was cancelled.");
      }
      return unavailableStatus();
    }
  }

  async runText(
    task: AIProviderTask,
    signal: AbortSignal,
    onEvent: AIProviderEventHandler,
  ): Promise<AIProviderResult> {
    return this.runWithDeadline(signal, async (codex, deadline) => this.consumeTurn(
      codex,
      task,
      deadline.signal,
      onEvent,
      true,
    ));
  }

  async runStructured<Output>(
    task: AIProviderTask,
    outputSchema: AIProviderOutputSchema<Output>,
    signal: AbortSignal,
    onEvent: AIProviderEventHandler,
  ): Promise<AIProviderStructuredResult<Output>> {
    if (!isRecord(outputSchema.jsonSchema)) {
      throw new AIProviderError("invalid_response", "Codex returned an invalid response.");
    }
    return this.runWithDeadline(signal, async (codex, deadline) => {
      const first = await this.consumeTurn(codex, task, deadline.signal, onEvent, false, outputSchema.jsonSchema);
      const firstValue = parseStructured(first.text, outputSchema);
      if (firstValue !== null) return { ...first, value: firstValue };

      const corrected = await this.consumeTurn(
        codex,
        { kind: task.kind, prompt: CORRECTIVE_PROMPT, threadId: first.threadId },
        deadline.signal,
        onEvent,
        false,
        outputSchema.jsonSchema,
      );
      const correctedValue = parseStructured(corrected.text, outputSchema);
      if (correctedValue === null) {
        throw new AIProviderError("invalid_response", "Codex returned an invalid response.");
      }
      return { ...corrected, value: correctedValue };
    });
  }

  private validStatus(value: AssistantAuthStatus): AssistantAuthStatus {
    const parsed = assistantAuthStatusSchema.safeParse(value);
    return parsed.success ? parsed.data : unavailableStatus();
  }

  private async runWithDeadline<Result>(
    externalSignal: AbortSignal,
    operation: (codex: CodexSdkClientLike, deadline: Deadline) => Promise<Result>,
  ): Promise<Result> {
    const deadline = createDeadline(externalSignal, this.timeoutMs);
    try {
      await this.requireReady(deadline.signal);
      await this.requireEmptyWorkingDirectory(deadline.signal);
      const sdk = await waitForAbortable(this.sdk(), deadline.signal);
      const codex = new sdk.Codex({ env: sanitizedCodexEnvironment(this.environment) });
      return await operation(codex, deadline);
    } catch (error) {
      if (!deadline.signal.aborted) deadline.abort(error);
      throw providerError(error, externalSignal, deadline);
    } finally {
      deadline.cleanup();
    }
  }

  private async requireReady(signal: AbortSignal): Promise<void> {
    const status = this.validStatus(await waitForAbortable(this.authRunner.getStatus(signal), signal));
    switch (status.state) {
      case "ready":
        return;
      case "signed_out":
        throw new AIProviderError("signed_out", "Sign in with ChatGPT to use Copilot.");
      case "unsupported_auth":
        throw new AIProviderError("unsupported_auth", "Copilot requires Sign in with ChatGPT.");
      case "checking":
      case "unavailable":
        throw new AIProviderError("unavailable", "Codex is unavailable.");
    }
  }

  private async requireEmptyWorkingDirectory(signal: AbortSignal): Promise<void> {
    if (!isAbsolute(this.workingDirectory) || resolve(this.workingDirectory) !== this.workingDirectory) {
      throw new AIProviderError("unavailable", "Codex is unavailable.");
    }
    try {
      await waitForAbortable(mkdir(this.workingDirectory, { recursive: true, mode: 0o700 }), signal);
      const info = await waitForAbortable(lstat(this.workingDirectory), signal);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("invalid directory");
      const entries = await waitForAbortable(readdir(this.workingDirectory), signal);
      if (entries.length !== 0) throw new Error("working directory is not empty");
    } catch (error) {
      if (signal.aborted) throw error;
      throw new AIProviderError("unavailable", "Codex is unavailable.");
    }
  }

  private sdk(): Promise<CodexSdkModuleLike> {
    this.loadedSdk ??= this.loadSdk().catch((error: unknown) => {
      this.loadedSdk = undefined;
      throw new AIProviderError("unavailable", "Codex is unavailable.", { cause: error });
    });
    return this.loadedSdk;
  }

  private threadOptions(): CodexSdkThreadOptionsLike {
    return {
      sandboxMode: "read-only",
      workingDirectory: this.workingDirectory,
      skipGitRepoCheck: true,
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      approvalPolicy: "never",
      additionalDirectories: [],
    };
  }

  private async consumeTurn(
    codex: CodexSdkClientLike,
    task: AIProviderTask,
    signal: AbortSignal,
    onEvent: AIProviderEventHandler,
    emitSnapshots: boolean,
    outputSchema?: Readonly<Record<string, unknown>>,
  ): Promise<ConsumedTurn> {
    if (task.prompt.trim().length === 0) {
      throw new AIProviderError("invalid_response", "Codex returned an invalid response.");
    }
    if (task.threadId !== undefined && !isOpaqueThreadId(task.threadId)) {
      throw new AIProviderError("invalid_response", "Codex returned an invalid response.");
    }
    const options = this.threadOptions();
    const thread = task.threadId === undefined
      ? codex.startThread(options)
      : codex.resumeThread(task.threadId, options);
    const turnOptions: CodexSdkTurnOptionsLike = {
      signal,
      ...(outputSchema === undefined ? {} : { outputSchema }),
    };
    const streamed = await waitForAbortable(thread.runStreamed(task.prompt, turnOptions), signal);
    if (!isRecord(streamed)) {
      throw new AIProviderError("invalid_response", "Codex returned an invalid response.");
    }
    const events = streamed.events;
    if (events === null || (typeof events !== "object" && typeof events !== "function")) {
      throw new AIProviderError("invalid_response", "Codex returned an invalid response.");
    }
    const iteratorFactory = (events as AsyncIterable<unknown>)[Symbol.asyncIterator];
    if (typeof iteratorFactory !== "function") {
      throw new AIProviderError("invalid_response", "Codex returned an invalid response.");
    }
    const iterator = iteratorFactory.call(events) as AsyncIterator<unknown>;
    let eventCount = 0;
    let threadId: string | undefined;
    let turnCompleted = false;
    const messages: string[] = [];

    while (true) {
      const next = await waitForAbortable(
        Promise.resolve(iterator.next()),
        signal,
        () => { void Promise.resolve(iterator.return?.()).catch(() => {}); },
      );
      if (next.done) break;
      eventCount += 1;
      if (eventCount > MAX_STREAM_EVENTS || !isRecord(next.value)) {
        throw new AIProviderError("invalid_response", "Codex returned an invalid response.");
      }
      const event = next.value;
      if (threadId === undefined && event.type !== "thread.started") {
        throw new AIProviderError("invalid_response", "Codex returned an invalid response.");
      }
      if (turnCompleted) {
        throw new AIProviderError("invalid_response", "Codex returned an invalid response.");
      }
      if (event.type === "thread.started") {
        if (threadId !== undefined || !isOpaqueThreadId(event.thread_id)) {
          throw new AIProviderError("invalid_response", "Codex returned an invalid response.");
        }
        if (task.threadId !== undefined && event.thread_id !== task.threadId) {
          throw new AIProviderError("invalid_response", "Codex returned an invalid response.");
        }
        threadId = event.thread_id;
        continue;
      }
      if (event.type === "error" || event.type === "turn.failed") {
        throw new AIProviderError("invalid_response", "Codex returned an invalid response.");
      }
      if (event.type === "turn.completed") {
        turnCompleted = true;
        continue;
      }
      if (event.type === "turn.started") continue;
      if (event.type !== "item.started" && event.type !== "item.updated" && event.type !== "item.completed") {
        throw new AIProviderError("invalid_response", "Codex returned an invalid response.");
      }
      if (!isRecord(event.item) || typeof event.item.type !== "string") {
        throw new AIProviderError("invalid_response", "Codex returned an invalid response.");
      }
      const itemType = event.item.type;
      if (
        itemType === "command_execution"
        || itemType === "file_change"
        || itemType === "mcp_tool_call"
        || itemType === "web_search"
        || itemType === "error"
      ) {
        throw new AIProviderError("invalid_response", "Codex returned an invalid response.");
      }
      if (itemType !== "agent_message" && itemType !== "reasoning" && itemType !== "todo_list") {
        throw new AIProviderError("invalid_response", "Codex returned an invalid response.");
      }
      if (event.type !== "item.completed" || itemType !== "agent_message") continue;
      if (
        typeof event.item.text !== "string"
        || event.item.text.trim().length === 0
        || event.item.text.length > PROVIDER_TEXT_LIMIT
        || messages.length >= MAX_AGENT_MESSAGES
      ) {
        throw new AIProviderError("invalid_response", "Codex returned an invalid response.");
      }
      messages.push(event.item.text);
      if (emitSnapshots && !signal.aborted) onEvent({ type: "text_snapshot", text: event.item.text });
    }

    if (threadId === undefined || !turnCompleted || messages.length === 0) {
      throw new AIProviderError("invalid_response", "Codex returned an invalid response.");
    }
    return { text: messages[messages.length - 1]!, threadId };
  }
}
