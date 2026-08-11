import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AssistantAuthStatus } from "../src/shared/contracts";
import type { AuthRunner } from "../src/main/assistant/auth-runner";
import {
  CodexProvider,
  type CodexSdkModuleLike,
  type CodexSdkThreadOptionsLike,
  type CodexSdkTurnOptionsLike,
} from "../src/main/assistant/codex-provider";

const READY: AssistantAuthStatus = {
  state: "ready",
  auth: "chatgpt",
  message: "Codex is ready.",
  sdkVersion: "0.147.0",
};

const usage = {
  input_tokens: 1,
  cached_input_tokens: 0,
  cache_write_input_tokens: 0,
  output_tokens: 1,
  reasoning_output_tokens: 0,
};

const asyncEvents = (...values: unknown[]): AsyncIterable<unknown> => ({
  async *[Symbol.asyncIterator]() {
    for (const value of values) yield value;
  },
});

const completedTurn = (threadId: string, text: string): AsyncIterable<unknown> => asyncEvents(
  { type: "thread.started", thread_id: threadId },
  { type: "item.completed", item: { id: "message-1", type: "agent_message", text } },
  { type: "turn.completed", usage },
);

interface SdkCapture {
  codexOptions: unknown[];
  starts: CodexSdkThreadOptionsLike[];
  resumes: Array<{ threadId: string; options: CodexSdkThreadOptionsLike }>;
  runs: Array<{ input: string; options: CodexSdkTurnOptionsLike }>;
}

function fakeSdk(sources: AsyncIterable<unknown>[]): { module: CodexSdkModuleLike; capture: SdkCapture } {
  const capture: SdkCapture = { codexOptions: [], starts: [], resumes: [], runs: [] };
  const nextThread = () => {
    const source = sources.shift();
    if (source === undefined) throw new Error("No fake SDK turn remains");
    return {
      async runStreamed(input: string, options: CodexSdkTurnOptionsLike) {
        capture.runs.push({ input, options });
        return { events: source };
      },
    };
  };
  class FakeCodex {
    constructor(options: unknown) {
      capture.codexOptions.push(options);
    }

    startThread(options: CodexSdkThreadOptionsLike) {
      capture.starts.push(options);
      return nextThread();
    }

    resumeThread(threadId: string, options: CodexSdkThreadOptionsLike) {
      capture.resumes.push({ threadId, options });
      return nextThread();
    }
  }
  return { module: { Codex: FakeCodex }, capture };
}

function authRunner(status: AssistantAuthStatus = READY): AuthRunner {
  return {
    async getStatus() { return status; },
    async beginLogin() { return READY; },
  };
}

describe("CodexProvider", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  async function workspace(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "dj-assistant-provider-"));
    directories.push(directory);
    return directory;
  }

  it("lazy-loads 0.147.0 only for a run and uses the exact bounded SDK configuration", async () => {
    const directory = await workspace();
    const sdk = fakeSdk([asyncEvents(
      { type: "thread.started", thread_id: "thread-new" },
      { type: "item.updated", item: { id: "message-1", type: "agent_message", text: "partial" } },
      { type: "item.completed", item: { id: "message-1", type: "agent_message", text: "Complete snapshot one." } },
      { type: "item.completed", item: { id: "reason-1", type: "reasoning", text: "private" } },
      { type: "item.completed", item: { id: "message-2", type: "agent_message", text: "Complete snapshot two." } },
      { type: "turn.completed", usage },
    )]);
    let loadCalls = 0;
    const provider = new CodexProvider({
      workingDirectory: directory,
      authRunner: authRunner(),
      environment: {
        PATH: "/safe/bin",
        SAFE_VALUE: "preserved",
        OPENAI_API_KEY: "not-read-or-forwarded",
        CODEX_ACCESS_TOKEN: "not-read-or-forwarded",
        OPENAI_BASE_URL: "not-read-or-forwarded",
      },
      loadSdk: async () => {
        loadCalls += 1;
        return sdk.module;
      },
    });
    const snapshots: string[] = [];

    await expect(provider.getStatus()).resolves.toEqual(READY);
    expect(loadCalls).toBe(0);
    await expect(provider.runText(
      { kind: "explain", prompt: "Explain the supplied local evidence." },
      new AbortController().signal,
      (event) => snapshots.push(event.text),
    )).resolves.toEqual({ text: "Complete snapshot two.", threadId: "thread-new" });

    expect(loadCalls).toBe(1);
    expect(snapshots).toEqual(["Complete snapshot one.", "Complete snapshot two."]);
    expect(sdk.capture.codexOptions).toEqual([{ env: { PATH: "/safe/bin", SAFE_VALUE: "preserved" } }]);
    expect(sdk.capture.starts).toEqual([{
      sandboxMode: "read-only",
      workingDirectory: directory,
      skipGitRepoCheck: true,
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      approvalPolicy: "never",
      additionalDirectories: [],
    }]);
    expect(sdk.capture.resumes).toEqual([]);
    expect(sdk.capture.runs[0]!.input).toBe("Explain the supplied local evidence.");
    expect(sdk.capture.runs[0]!.options.outputSchema).toBeUndefined();
    expect(sdk.capture.runs[0]!.options.signal).toBeInstanceOf(AbortSignal);
  });

  it("resumes only the requested opaque thread and requires the matching thread.started event", async () => {
    const directory = await workspace();
    const sdk = fakeSdk([completedTurn("thread-existing", "Grounded explanation.")]);
    const provider = new CodexProvider({
      workingDirectory: directory,
      authRunner: authRunner(),
      loadSdk: async () => sdk.module,
    });

    await expect(provider.runText(
      { kind: "explain", prompt: "Continue.", threadId: "thread-existing" },
      new AbortController().signal,
      () => {},
    )).resolves.toEqual({ text: "Grounded explanation.", threadId: "thread-existing" });
    expect(sdk.capture.starts).toEqual([]);
    expect(sdk.capture.resumes.map(({ threadId }) => threadId)).toEqual(["thread-existing"]);
  });

  it("parses strict JSON with Zod and a known-ID validator before returning a structured value", async () => {
    const directory = await workspace();
    const text = JSON.stringify({ action: "select", trackId: "track-1" });
    const sdk = fakeSdk([completedTurn("thread-structured", text)]);
    const provider = new CodexProvider({
      workingDirectory: directory,
      authRunner: authRunner(),
      loadSdk: async () => sdk.module,
    });
    const jsonSchema = {
      type: "object",
      properties: { action: { const: "select" }, trackId: { type: "string" } },
      required: ["action", "trackId"],
      additionalProperties: false,
    } as const;

    await expect(provider.runStructured(
      { kind: "search", prompt: "Select from supplied IDs." },
      {
        jsonSchema,
        zodSchema: z.strictObject({ action: z.literal("select"), trackId: z.string() }),
        validateKnownIds: (value) => value.trackId === "track-1",
      },
      new AbortController().signal,
      () => {},
    )).resolves.toEqual({
      text,
      value: { action: "select", trackId: "track-1" },
      threadId: "thread-structured",
    });
    expect(sdk.capture.runs[0]!.options.outputSchema).toBe(jsonSchema);
  });

  it("makes at most one corrective turn on the same thread after invalid JSON or IDs", async () => {
    const directory = await workspace();
    const invalid = JSON.stringify({ action: "select", trackId: "unknown-track" });
    const valid = JSON.stringify({ action: "select", trackId: "track-1" });
    const sdk = fakeSdk([
      completedTurn("thread-correct", invalid),
      completedTurn("thread-correct", valid),
    ]);
    const provider = new CodexProvider({
      workingDirectory: directory,
      authRunner: authRunner(),
      loadSdk: async () => sdk.module,
    });
    const jsonSchema = { type: "object", additionalProperties: false } as const;

    await expect(provider.runStructured(
      { kind: "revise", prompt: "Choose one known entry." },
      {
        jsonSchema,
        zodSchema: z.strictObject({ action: z.literal("select"), trackId: z.string() }),
        validateKnownIds: (value) => value.trackId === "track-1",
      },
      new AbortController().signal,
      () => {},
    )).resolves.toMatchObject({ value: { trackId: "track-1" }, threadId: "thread-correct" });

    expect(sdk.capture.starts).toHaveLength(1);
    expect(sdk.capture.resumes.map(({ threadId }) => threadId)).toEqual(["thread-correct"]);
    expect(sdk.capture.runs).toHaveLength(2);
    expect(sdk.capture.runs[1]!.input).toContain("previous response was invalid");
    expect(sdk.capture.runs[1]!.input).not.toContain("unknown-track");
    expect(sdk.capture.runs.map(({ options }) => options.outputSchema)).toEqual([jsonSchema, jsonSchema]);
  });

  it("fails with one sanitized invalid_response after the corrective turn is still invalid", async () => {
    const directory = await workspace();
    const sdk = fakeSdk([
      completedTurn("thread-invalid", "not-json-private-detail"),
      completedTurn("thread-invalid", JSON.stringify({ unknown: true })),
    ]);
    const provider = new CodexProvider({
      workingDirectory: directory,
      authRunner: authRunner(),
      loadSdk: async () => sdk.module,
    });

    const operation = provider.runStructured(
      { kind: "plan", prompt: "Plan." },
      {
        jsonSchema: { type: "object", additionalProperties: false },
        zodSchema: z.strictObject({ title: z.string() }),
      },
      new AbortController().signal,
      () => {},
    );

    await expect(operation).rejects.toMatchObject({
      name: "AIProviderError",
      code: "invalid_response",
      message: "Codex returned an invalid response.",
    });
    await expect(operation).rejects.not.toThrow(/private-detail|unknown/u);
    expect(sdk.capture.runs).toHaveLength(2);
  });

  it.each([
    { name: "top-level error", event: { type: "error", message: "private provider detail" } },
    { name: "turn failure", event: { type: "turn.failed", error: { message: "private provider detail" } } },
    {
      name: "tool use",
      event: {
        type: "item.started",
        item: { id: "command-1", type: "command_execution", command: "forbidden-command", aggregated_output: "", status: "in_progress" },
      },
    },
  ])("rejects $name without surfacing raw event metadata", async ({ event }) => {
    const directory = await workspace();
    const sdk = fakeSdk([asyncEvents(
      { type: "thread.started", thread_id: "thread-failure" },
      event,
    )]);
    const provider = new CodexProvider({
      workingDirectory: directory,
      authRunner: authRunner(),
      loadSdk: async () => sdk.module,
    });

    const operation = provider.runText(
      { kind: "explain", prompt: "Explain." },
      new AbortController().signal,
      () => {},
    );

    await expect(operation).rejects.toMatchObject({ name: "AIProviderError", code: "invalid_response" });
    await expect(operation).rejects.not.toThrow(/private provider detail|forbidden-command/u);
  });

  it("classifies a malformed SDK event stream as an invalid response", async () => {
    const directory = await workspace();
    const sdk = fakeSdk([null as unknown as AsyncIterable<unknown>]);
    const provider = new CodexProvider({
      workingDirectory: directory,
      authRunner: authRunner(),
      loadSdk: async () => sdk.module,
    });

    await expect(provider.runText(
      { kind: "explain", prompt: "Explain." },
      new AbortController().signal,
      () => {},
    )).rejects.toMatchObject({ code: "invalid_response" });
  });

  it.each([
    { name: "cancellation", timeoutMs: 1_000, cancel: true, code: "cancelled" },
    { name: "timeout", timeoutMs: 10, cancel: false, code: "timeout" },
  ])("settles promptly on $name and ignores late stream events", async ({ timeoutMs, cancel, code }) => {
    const directory = await workspace();
    let releaseWaiting!: () => void;
    const waiting = new Promise<void>((resolve) => { releaseWaiting = resolve; });
    let step = 0;
    const lateSource: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            step += 1;
            if (step === 1) return Promise.resolve({ value: { type: "thread.started", thread_id: "thread-late" }, done: false });
            if (step === 2) {
              releaseWaiting();
              return new Promise((resolve) => setTimeout(() => resolve({
                value: { type: "item.completed", item: { id: "late", type: "agent_message", text: "late snapshot" } },
                done: false,
              }), 40));
            }
            return Promise.resolve({ value: undefined, done: true });
          },
          return() { return Promise.resolve({ value: undefined, done: true }); },
        };
      },
    };
    const sdk = fakeSdk([lateSource]);
    const provider = new CodexProvider({
      workingDirectory: directory,
      authRunner: authRunner(),
      timeoutMs,
      loadSdk: async () => sdk.module,
    });
    const controller = new AbortController();
    const snapshots: string[] = [];
    const operation = provider.runText(
      { kind: "explain", prompt: "Explain slowly." },
      controller.signal,
      (event) => snapshots.push(event.text),
    );
    await waiting;
    if (cancel) controller.abort();

    await expect(operation).rejects.toMatchObject({ name: "AIProviderError", code });
    await new Promise((resolve) => setTimeout(resolve, 55));
    expect(snapshots).toEqual([]);
  });

  it("clears the internal deadline after a completed turn", async () => {
    vi.useFakeTimers();
    try {
      const directory = await workspace();
      const sdk = fakeSdk([completedTurn("thread-fast", "Finished.")]);
      const provider = new CodexProvider({
        workingDirectory: directory,
        authRunner: authRunner(),
        timeoutMs: 10,
        loadSdk: async () => sdk.module,
      });

      await provider.runText(
        { kind: "explain", prompt: "Finish." },
        new AbortController().signal,
        () => {},
      );
      const runSignal = sdk.capture.runs[0]!.options.signal!;
      await vi.advanceTimersByTimeAsync(25);
      expect(runSignal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails before SDK import when ChatGPT auth is unavailable or the working directory is not empty", async () => {
    const directory = await workspace();
    let loadCalls = 0;
    const signedOutProvider = new CodexProvider({
      workingDirectory: directory,
      authRunner: authRunner({
        state: "signed_out",
        auth: "none",
        message: "Sign in with ChatGPT to use Copilot.",
        sdkVersion: "0.147.0",
      }),
      loadSdk: async () => {
        loadCalls += 1;
        return fakeSdk([]).module;
      },
    });
    await expect(signedOutProvider.runText(
      { kind: "search", prompt: "Search." },
      new AbortController().signal,
      () => {},
    )).rejects.toMatchObject({ code: "signed_out" });

    await writeFile(join(directory, "unexpected.txt"), "not empty");
    const nonemptyProvider = new CodexProvider({
      workingDirectory: directory,
      authRunner: authRunner(),
      loadSdk: async () => {
        loadCalls += 1;
        return fakeSdk([]).module;
      },
    });
    await expect(nonemptyProvider.runText(
      { kind: "search", prompt: "Search." },
      new AbortController().signal,
      () => {},
    )).rejects.toMatchObject({ code: "unavailable" });
    expect(loadCalls).toBe(0);
  });
});
