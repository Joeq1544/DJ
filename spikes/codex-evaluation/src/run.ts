import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  gradeObservation,
  loadFixtures,
  summarizeEvaluation,
  type EvaluationObservation,
  type EvaluationResponse,
  type EvaluationSummary,
  type EvaluationTask,
  type TaskEvaluationResult,
} from "./rubric.ts";

export interface EvaluationProvider {
  run(task: EvaluationTask, signal: AbortSignal): Promise<EvaluationResponse>;
}

export interface EvaluationReport {
  mode: "mock" | "real";
  results: TaskEvaluationResult[];
  aggregate: EvaluationSummary;
}

export interface RunOptions {
  mode?: "mock" | "real";
  realProviderFactory?: () => EvaluationProvider | Promise<EvaluationProvider>;
}

export class MockAIProvider implements EvaluationProvider {
  readonly #tasks: ReadonlyMap<string, EvaluationTask>;

  constructor(tasks: readonly EvaluationTask[]) {
    this.#tasks = new Map(tasks.map((task) => [task.id, task]));
  }

  async run(task: EvaluationTask, signal: AbortSignal): Promise<EvaluationResponse> {
    const fixture = this.#tasks.get(task.id);
    if (fixture === undefined) throw new Error("UNKNOWN_MOCK_TASK");
    const delayMs = fixture.cancellation?.providerDelayMs ?? 0;
    if (delayMs > 0) await abortableDelay(delayMs, signal);
    if (signal.aborted) throw abortError();
    return structuredClone(fixture.mockResponse);
  }
}

function abortError(): Error {
  const error = new Error("operation aborted");
  error.name = "AbortError";
  return error;
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function observeTask(task: EvaluationTask, provider: EvaluationProvider): Promise<EvaluationObservation> {
  const controller = new AbortController();
  const startedAt = performance.now();
  let cancelRequested = false;
  let cancelAcknowledged = false;
  let deadlineReached = false;
  let cancellationTimer: NodeJS.Timeout | undefined;
  let deadlineTimer: NodeJS.Timeout | undefined;

  if (task.cancellation?.required) {
    cancellationTimer = setTimeout(() => {
      cancelRequested = true;
      controller.abort();
    }, task.cancellation.cancelAfterMs);
  }

  const deadline = new Promise<never>((_resolve, reject) => {
    deadlineTimer = setTimeout(() => {
      deadlineReached = true;
      controller.abort();
      reject(new Error("EVALUATION_DEADLINE_EXCEEDED"));
    }, task.maxLatencyMs);
  });

  try {
    const response = await Promise.race([provider.run(task, controller.signal), deadline]);
    return {
      taskId: task.id,
      response,
      elapsedMs: performance.now() - startedAt,
      cancelRequested,
      cancelAcknowledged,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError" && cancelRequested && !deadlineReached) {
      cancelAcknowledged = true;
      return {
        taskId: task.id,
        response: null,
        elapsedMs: performance.now() - startedAt,
        cancelRequested,
        cancelAcknowledged,
        errorCode: "CANCELLED",
      };
    }
    return {
      taskId: task.id,
      response: null,
      elapsedMs: performance.now() - startedAt,
      cancelRequested,
      cancelAcknowledged,
      errorCode: deadlineReached ? "DEADLINE_EXCEEDED" : "PROVIDER_ERROR",
    };
  } finally {
    if (cancellationTimer !== undefined) clearTimeout(cancellationTimer);
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
  }
}

export async function runEvaluationSuite(
  tasks: readonly EvaluationTask[],
  provider?: EvaluationProvider,
  options: RunOptions = {},
): Promise<EvaluationReport> {
  const mode = options.mode ?? "mock";
  let selectedProvider = provider;
  if (mode === "real" && selectedProvider === undefined) {
    if (options.realProviderFactory === undefined) throw new Error("REAL_PROVIDER_NOT_CONFIGURED");
    selectedProvider = await options.realProviderFactory();
  }
  if (selectedProvider === undefined) selectedProvider = new MockAIProvider(tasks);

  const results: TaskEvaluationResult[] = [];
  for (const task of tasks) {
    results.push(gradeObservation(task, await observeTask(task, selectedProvider)));
  }
  return { mode, results, aggregate: summarizeEvaluation(results) };
}

function redactText(value: string, sensitiveValues: readonly string[]): string {
  let redacted = value;
  for (const sensitive of sensitiveValues) {
    if (sensitive.length > 0) redacted = redacted.split(sensitive).join("[REDACTED]");
  }
  redacted = redacted.replace(/file:\/\/\/[^\s"']+/giu, "file:///[REDACTED]");
  redacted = redacted.replace(/\/(?:Users|home)\/[^\s"']+/gu, "/[REDACTED]");
  redacted = redacted.replace(/[A-Z]:\\[^\r\n"']+/gu, "[REDACTED_PATH]");
  return redacted;
}

function renderMarkdown(report: EvaluationReport): string {
  const lines = [
    "# Codex DJ Suitability Evaluation",
    "",
    `Mode: ${report.mode}`,
    `Tasks: ${report.aggregate.totalTasks}`,
    `Passed: ${report.aggregate.passedTasks}`,
    `Failed: ${report.aggregate.failedTasks}`,
    `Unknown ID count: ${report.aggregate.unknownIdCount}`,
    "",
    "| Task | Category | Schema | Tool | IDs | Constraints | Injection | Explanation | Latency | Cancellation | Approval | Outcome |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const result of report.results) {
    const check = (key: keyof typeof result.checks): string => (result.checks[key] ? "pass" : "fail");
    lines.push(
      `| ${result.taskId} | ${result.category} | ${check("schema")} | ${check("tool")} | ${check("ids")} | ${check("constraints")} | ${check("injection")} | ${check("explanation")} | ${check("latency")} | ${check("cancellation")} | ${check("approval")} | ${result.passed ? "pass" : "fail"} |`,
    );
  }
  lines.push("", "This report is a contract/evaluation result, not a subjective DJ-quality score.", "");
  return lines.join("\n");
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function requireAbsentOutput(filePath: string): Promise<void> {
  try {
    await lstat(filePath);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return;
    throw error;
  }
  throw new Error("OUTPUT_FILE_EXISTS");
}

async function writeExclusiveReport(filePath: string, content: string): Promise<void> {
  try {
    await writeFile(filePath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if (isErrno(error, "EEXIST")) throw new Error("OUTPUT_FILE_EXISTS");
    throw error;
  }
}

export async function writeEvaluationReports(
  report: EvaluationReport,
  explicitOutputDirectory: string,
  options: { sensitiveValues?: readonly string[] } = {},
): Promise<{ jsonPath: string; markdownPath: string }> {
  if (explicitOutputDirectory.trim().length === 0) throw new Error("OUTPUT_DIRECTORY_REQUIRED");
  const resolved = path.resolve(explicitOutputDirectory);
  await mkdir(resolved, { recursive: true, mode: 0o700 });
  const info = await lstat(resolved);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("OUTPUT_DIRECTORY_INVALID");
  const outputDirectory = await realpath(resolved);
  const sensitiveValues = options.sensitiveValues ?? [];
  const jsonPath = path.join(outputDirectory, "evaluation.json");
  const markdownPath = path.join(outputDirectory, "evaluation.md");
  await requireAbsentOutput(jsonPath);
  await requireAbsentOutput(markdownPath);
  const json = redactText(`${JSON.stringify(report, null, 2)}\n`, sensitiveValues);
  const markdown = redactText(renderMarkdown(report), sensitiveValues);
  await writeExclusiveReport(jsonPath, json);
  await writeExclusiveReport(markdownPath, markdown);
  return { jsonPath, markdownPath };
}

interface CliOptions {
  mode: "mock" | "real";
  outputDirectory: string;
  providerModule?: string;
}

function parseCli(argv: readonly string[]): CliOptions {
  let mode: "mock" | "real" = "mock";
  let outputDirectory: string | undefined;
  let providerModule: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--mode" && (value === "mock" || value === "real")) {
      mode = value;
      index += 1;
    } else if (argument === "--output-dir" && value !== undefined) {
      outputDirectory = value;
      index += 1;
    } else if (argument === "--provider-module" && value !== undefined) {
      providerModule = value;
      index += 1;
    } else if (argument === "--") {
      continue;
    } else {
      throw new Error("INVALID_CLI_ARGUMENT");
    }
  }
  if (outputDirectory === undefined) throw new Error("OUTPUT_DIRECTORY_REQUIRED");
  return { mode, outputDirectory, providerModule };
}

async function loadExplicitRealProvider(modulePath: string | undefined): Promise<EvaluationProvider> {
  if (process.env.DJ_CODEX_EVALUATION_REAL !== "1" || modulePath === undefined || !path.isAbsolute(modulePath)) {
    throw new Error("REAL_PROVIDER_NOT_CONFIGURED");
  }
  const loaded: unknown = await import(pathToFileURL(modulePath).href);
  if (
    typeof loaded !== "object" ||
    loaded === null ||
    !("createEvaluationProvider" in loaded) ||
    typeof loaded.createEvaluationProvider !== "function"
  ) {
    throw new Error("REAL_PROVIDER_INVALID");
  }
  const provider: unknown = await loaded.createEvaluationProvider();
  if (typeof provider !== "object" || provider === null || !("run" in provider) || typeof provider.run !== "function") {
    throw new Error("REAL_PROVIDER_INVALID");
  }
  return provider as EvaluationProvider;
}

async function main(argv: readonly string[]): Promise<void> {
  const cli = parseCli(argv);
  const tasks = await loadFixtures(new URL("../fixtures/tasks.json", import.meta.url));
  const provider = cli.mode === "mock" ? new MockAIProvider(tasks) : await loadExplicitRealProvider(cli.providerModule);
  const report = await runEvaluationSuite(tasks, provider, { mode: cli.mode });
  const paths = await writeEvaluationReports(report, cli.outputDirectory, {
    sensitiveValues: tasks.map((task) => task.prompt),
  });
  void paths;
  process.stdout.write("Evaluation reports written.\n");
  if (report.aggregate.failedTasks > 0) process.exitCode = 1;
}

const invokedPath = process.argv[1] === undefined ? undefined : pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : "EVALUATION_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
