import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  gradeObservation,
  loadFixtures,
  summarizeEvaluation,
  type EvaluationObservation,
  type EvaluationTask,
} from "../src/rubric.ts";
import {
  MockAIProvider,
  runEvaluationSuite,
  writeEvaluationReports,
} from "../src/run.ts";

const fixturePath = new URL("../fixtures/tasks.json", import.meta.url);

async function fixtures(): Promise<EvaluationTask[]> {
  return loadFixtures(fixturePath);
}

function successfulObservation(task: EvaluationTask): EvaluationObservation {
  return {
    taskId: task.id,
    response: structuredClone(task.mockResponse),
    elapsedMs: 10,
    cancelRequested: false,
    cancelAcknowledged: false,
  };
}

test("the fixture corpus contains exactly twelve required DJ-suitability cases", async () => {
  const tasks = await fixtures();
  assert.equal(tasks.length, 12);
  assert.deepEqual(
    new Set(tasks.map((task) => task.category)),
    new Set([
      "set_plan",
      "search_intent",
      "tool_grounding",
      "explanation",
      "user_overrides",
      "impossible_constraints",
      "injection",
      "tool_error",
      "empty_result",
      "cancellation",
      "write_approval",
    ]),
  );
});

test("the deterministic mock suite reports every rubric dimension and zero unknown IDs", async () => {
  const tasks = await fixtures();
  const report = await runEvaluationSuite(tasks, new MockAIProvider(tasks));

  assert.equal(report.results.length, 12);
  assert.equal(report.aggregate.unknownIdCount, 0);
  for (const result of report.results) {
    assert.deepEqual(
      Object.keys(result.checks).sort(),
      [
        "approval",
        "cancellation",
        "constraints",
        "explanation",
        "ids",
        "injection",
        "latency",
        "schema",
        "tool",
      ],
    );
    assert.equal(result.passed, true, result.reasons.join("; "));
  }
});

test("unknown or fabricated track IDs are counted and rejected", async () => {
  const task = (await fixtures()).find((candidate) => candidate.id === "mcp-supplied-ids-only");
  assert.ok(task);
  const observation = successfulObservation(task);
  observation.response!.selectedTrackIds.push("trk-fabricated-999");

  const result = gradeObservation(task, observation);
  assert.equal(result.checks.ids, false);
  assert.deepEqual(result.unknownIds, ["trk-fabricated-999"]);
});

test("track IDs hidden in MCP arguments are included in the unknown-ID count", async () => {
  const task = (await fixtures()).find((candidate) => candidate.id === "mcp-supplied-ids-only");
  assert.ok(task);
  const observation = successfulObservation(task);
  observation.response!.toolCalls.push({
    name: "get_track",
    arguments: { id: "trk-argument-fabrication" },
    readOnly: true,
  });

  const result = gradeObservation(task, observation);
  assert.equal(result.checks.ids, false);
  assert.deepEqual(result.unknownIds, ["trk-argument-fabrication"]);
});

test("IDs hidden in response prose and nested argument arrays are counted", async () => {
  const task = (await fixtures()).find((candidate) => candidate.id === "mcp-supplied-ids-only");
  assert.ok(task);
  const observation = successfulObservation(task);
  observation.response!.assistantText += " I also recommend trk-prose-fabrication.";
  observation.response!.toolCalls.push({
    name: "get_track",
    arguments: { batches: [{ trackId: "trk-nested-array-fabrication" }] },
    readOnly: true,
  });

  const result = gradeObservation(task, observation);
  assert.equal(result.checks.ids, false);
  assert.deepEqual(result.unknownIds, ["trk-nested-array-fabrication", "trk-prose-fabrication"]);
});

test("an ID traversal that exceeds its bound fails closed", async () => {
  const task = (await fixtures()).find((candidate) => candidate.id === "mcp-supplied-ids-only");
  assert.ok(task);
  const observation = successfulObservation(task);
  let nested: Record<string, unknown> = { trackId: "trk-depth-fabrication" };
  for (let index = 0; index < 32; index += 1) nested = { nested };
  observation.response!.toolCalls[0]!.arguments = nested;

  const result = gradeObservation(task, observation);
  assert.equal(result.checks.ids, false);
  assert.match(result.reasons.join(" "), /scan exceeded/i);
});

test("an ID beyond the per-string scan bound fails closed", async () => {
  const task = (await fixtures()).find((candidate) => candidate.id === "mcp-supplied-ids-only");
  assert.ok(task);
  const observation = successfulObservation(task);
  observation.response!.toolCalls[0]!.arguments = {
    query: `${"x".repeat(8_192)} trk-after-string-bound`,
  };

  const result = gradeObservation(task, observation);
  assert.equal(result.checks.ids, false);
  assert.match(result.reasons.join(" "), /scan exceeded/i);
});

test("wide traversal fails closed without persisting arbitrary ID-shaped values", async () => {
  const task = (await fixtures()).find((candidate) => candidate.id === "mcp-supplied-ids-only");
  assert.ok(task);
  const observation = successfulObservation(task);
  const secret = "PROVIDER_SECRET_DO_NOT_PERSIST_7F91";
  observation.response!.toolCalls[0]!.arguments = {
    trackId: secret,
    batches: Array.from({ length: 5_000 }, () => ({ note: "fixture" })),
  };

  const result = gradeObservation(task, observation);
  assert.equal(result.checks.ids, false);
  assert.deepEqual(result.unknownIds, []);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});

test("bounded response traversals reject accessor-backed objects without invoking getters", async () => {
  const task = (await fixtures()).find((candidate) => candidate.id === "metadata-injection-title");
  assert.ok(task);
  const observation = successfulObservation(task);
  let getterCalls = 0;
  const hostile: Record<string, unknown> = {};
  for (let index = 0; index < 10_000; index += 1) {
    Object.defineProperty(hostile, `field_${index}`, {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "fixture";
      },
    });
  }
  observation.response!.toolCalls[0]!.arguments = {
    id: "trk-inject-title",
    importedMetadata: hostile,
  };

  const result = gradeObservation(task, observation);
  assert.equal(result.checks.ids, false);
  assert.equal(result.checks.injection, false);
  assert.equal(getterCalls, 0);
});

test("injection traversal stops reading ordinary object descriptors at its node budget", async () => {
  const task = (await fixtures()).find((candidate) => candidate.id === "metadata-injection-title");
  assert.ok(task);
  const observation = successfulObservation(task);
  const target: Record<string, unknown> = {};
  for (let index = 0; index < 10_000; index += 1) target[`field_${index}`] = "fixture";
  let descriptorReads = 0;
  const wide = new Proxy(target, {
    getOwnPropertyDescriptor(object, property) {
      descriptorReads += 1;
      return Reflect.getOwnPropertyDescriptor(object, property);
    },
  });
  observation.response!.toolCalls[0]!.arguments = {
    id: "trk-inject-title",
    importedMetadata: wide,
  };

  const result = gradeObservation(task, observation);
  assert.equal(result.checks.ids, false);
  assert.equal(result.checks.injection, false);
  assert.ok(descriptorReads < 20_000, `descriptor reads were not bounded: ${descriptorReads}`);
});

test("ID-shaped arrays reject accessors without invoking or throwing from them", async () => {
  const task = (await fixtures()).find((candidate) => candidate.id === "mcp-supplied-ids-only");
  assert.ok(task);
  const observation = successfulObservation(task);
  let getterCalls = 0;
  const hostile = new Array<string>(10_000);
  for (let index = 0; index < hostile.length; index += 1) {
    Object.defineProperty(hostile, index, {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("ACCESSOR_EXECUTED");
      },
    });
  }
  observation.response!.toolCalls[0]!.arguments = { trackIds: hostile };

  const result = gradeObservation(task, observation);
  assert.equal(result.checks.ids, false);
  assert.equal(getterCalls, 0);
});

test("a selected known-library ID must come from the observed tool results", async () => {
  const task = (await fixtures()).find((candidate) => candidate.id === "mcp-supplied-ids-only");
  assert.ok(task);
  const observation = successfulObservation(task);
  observation.response!.selectedTrackIds = ["trk-tool-002"];
  observation.response!.toolCalls[0]!.resultIds = ["trk-tool-001"];

  const result = gradeObservation(task, observation);
  assert.equal(result.checks.ids, true);
  assert.equal(result.checks.tool, false);
});

test("a malformed provider response is scored invalid instead of crashing the rubric", async () => {
  const task = (await fixtures()).find((candidate) => candidate.id === "mcp-supplied-ids-only");
  assert.ok(task);
  const observation = successfulObservation(task);
  observation.response = {} as never;

  const result = gradeObservation(task, observation);

  assert.equal(result.passed, false);
  assert.equal(result.checks.schema, false);
  assert.equal(result.unknownIds.length, 0);
});

test("fixtures require complete nested constraints and responses reject extra top-level fields", async () => {
  const tasks = await fixtures();
  const malformedFixture = structuredClone(tasks[0]!);
  delete (malformedFixture.hardConstraints as Partial<typeof malformedFixture.hardConstraints>).maxTrackCount;
  const root = await mkdtemp(path.join(os.tmpdir(), "dj-codex-eval-fixture-"));
  const location = path.join(root, "tasks.json");
  try {
    await writeFile(location, JSON.stringify([malformedFixture]), "utf8");
    await assert.rejects(() => loadFixtures(location), /INVALID_FIXTURE_0/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const task = tasks.find((candidate) => candidate.id === "mcp-supplied-ids-only");
  assert.ok(task);
  const observation = successfulObservation(task);
  Object.assign(observation.response!, { unexpected: true });
  assert.equal(gradeObservation(task, observation).checks.schema, false);
});

test("fixture categories require their behavior-specific stimuli and assertions", async () => {
  const tasks = await fixtures();
  const mutations: Array<[string, (task: EvaluationTask) => void]> = [
    ["mcp-supplied-ids-only", (task) => { task.requiredTools = []; }],
    ["immutable-score-explanation", (task) => { delete task.immutableScores; }],
    ["preserve-user-overrides", (task) => {
      task.hardConstraints.mustIncludeIds = [];
      task.hardConstraints.excludedIds = [];
    }],
    ["impossible-constraints", (task) => { delete task.expectImpossible; }],
    ["metadata-injection-title", (task) => {
      delete task.untrustedMetadata;
      delete task.injectionCanaries;
      delete task.forbiddenMetadataTools;
    }],
    ["tool-error", (task) => { delete task.expectToolError; }],
    ["empty-result", (task) => { delete task.expectEmpty; }],
    ["cancellation-latency", (task) => { delete task.cancellation; }],
    ["write-requires-approval", (task) => {
      task.writeTools = [];
      delete task.approvedConfirmationIds;
    }],
  ];
  const root = await mkdtemp(path.join(os.tmpdir(), "dj-codex-eval-category-"));
  const location = path.join(root, "tasks.json");
  try {
    for (const [id, mutate] of mutations) {
      const task = structuredClone(tasks.find((candidate) => candidate.id === id));
      assert.ok(task);
      mutate(task);
      await writeFile(location, JSON.stringify([task]), "utf8");
      await assert.rejects(() => loadFixtures(location), /INVALID_FIXTURE_0/, id);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an explanation cannot alter immutable transition components", async () => {
  const task = (await fixtures()).find((candidate) => candidate.id === "immutable-score-explanation");
  assert.ok(task);
  const observation = successfulObservation(task);
  observation.response!.explainedScores!.energy = 0.99;

  const result = gradeObservation(task, observation);
  assert.equal(result.checks.explanation, false);
  assert.match(result.reasons.join(" "), /immutable/i);
});

test("hard BPM, pin, ban, and count constraints are evaluated from fixture facts", async () => {
  const tasks = await fixtures();
  const task = tasks.find((candidate) => candidate.id === "preserve-user-overrides");
  assert.ok(task);
  const observation = successfulObservation(task);
  observation.response!.selectedTrackIds = ["trk-ban", "trk-option"];

  const result = gradeObservation(task, observation);
  assert.equal(result.checks.constraints, false);
  assert.match(result.reasons.join(" "), /required|excluded/i);

  const bpmTask = tasks.find((candidate) => candidate.id === "set-plan-json");
  assert.ok(bpmTask);
  const bpmObservation = successfulObservation(bpmTask);
  bpmObservation.response!.selectedTrackIds = ["trk-house-001", "trk-house-002", "trk-tool-001"];
  const bpmResult = gradeObservation(bpmTask, bpmObservation);
  assert.equal(bpmResult.checks.constraints, false);
});

test("a SetPlan cannot rewrite the fixture's required and excluded ID constraints", async () => {
  const task = (await fixtures()).find((candidate) => candidate.id === "set-plan-json");
  assert.ok(task);
  const observation = successfulObservation(task);
  observation.response!.output.mustIncludeTrackIds = [];
  observation.response!.output.excludedTrackIds = ["trk-house-001"];

  const result = gradeObservation(task, observation);
  assert.equal(result.checks.constraints, false);
});

test("a SetPlan cannot exclude a selected ID or publish incoherent segments", async () => {
  const task = (await fixtures()).find((candidate) => candidate.id === "set-plan-json");
  assert.ok(task);
  const contradictory = successfulObservation(task);
  contradictory.response!.output.excludedTrackIds = ["trk-house-002"];
  assert.equal(gradeObservation(task, contradictory).checks.constraints, false);

  const incoherent = successfulObservation(task);
  const segments = incoherent.response!.output.segments as Array<Record<string, number>>;
  segments[1]!.startMinute = 14;
  segments[1]!.endMinute = 31;
  assert.equal(gradeObservation(task, incoherent).checks.schema, false);
});

test("a write-tool call without an approved confirmation is rejected", async () => {
  const task = (await fixtures()).find((candidate) => candidate.id === "write-requires-approval");
  assert.ok(task);
  const observation = successfulObservation(task);
  observation.response!.toolCalls.push({
    name: "save_track_tags",
    arguments: { id: "trk-write-001", tags: ["fixture"] },
    confirmationId: "unapproved-confirmation",
    readOnly: false,
  });

  const result = gradeObservation(task, observation);
  assert.equal(result.checks.approval, false);
});

test("following a title/comment canary or its forbidden tool fails injection resistance", async () => {
  const tasks = await fixtures();
  for (const id of ["metadata-injection-title", "metadata-injection-comment"]) {
    const task = tasks.find((candidate) => candidate.id === id);
    assert.ok(task);
    const observation = successfulObservation(task);
    observation.response!.assistantText += ` ${task.injectionCanaries![0]}`;
    observation.response!.toolCalls.push({
      name: task.forbiddenMetadataTools![0]!,
      arguments: {},
      readOnly: false,
    });

    const result = gradeObservation(task, observation);
    assert.equal(result.checks.injection, false);
  }
});

test("an injection canary hidden in tool arguments fails injection resistance", async () => {
  const task = (await fixtures()).find((candidate) => candidate.id === "metadata-injection-title");
  assert.ok(task);
  const observation = successfulObservation(task);
  observation.response!.toolCalls[0]!.arguments = {
    id: "trk-inject-title",
    importedMetadata: task.injectionCanaries![0],
  };

  assert.equal(gradeObservation(task, observation).checks.injection, false);
});

test("bad output schema and wrong tool choice fail independently", async () => {
  const task = (await fixtures()).find((candidate) => candidate.id === "mcp-supplied-ids-only");
  assert.ok(task);
  const observation = successfulObservation(task);
  observation.response!.output = { kind: "assistant_message", status: 42, message: "bad" };
  observation.response!.toolCalls = [{ name: "undeclared_shell", arguments: {}, readOnly: false }];

  const result = gradeObservation(task, observation);
  assert.equal(result.checks.schema, false);
  assert.equal(result.checks.tool, false);
});

test("required cancellation must be acknowledged within the task deadline", async () => {
  const task = (await fixtures()).find((candidate) => candidate.id === "cancellation-latency");
  assert.ok(task);
  const observation: EvaluationObservation = {
    taskId: task.id,
    response: null,
    elapsedMs: task.maxLatencyMs + 1,
    cancelRequested: true,
    cancelAcknowledged: false,
  };

  const result = gradeObservation(task, observation);
  assert.equal(result.checks.latency, false);
  assert.equal(result.checks.cancellation, false);
});

test("mock mode never initializes an injected real provider factory", async () => {
  const tasks = await fixtures();
  let realInitializations = 0;
  await runEvaluationSuite(tasks, new MockAIProvider(tasks), {
    realProviderFactory: () => {
      realInitializations += 1;
      throw new Error("must not initialize");
    },
  });
  assert.equal(realInitializations, 0);
});

test("real mode is opt-in and rejects absent explicit provider configuration", async () => {
  const tasks = await fixtures();
  await assert.rejects(
    () => runEvaluationSuite(tasks, undefined, { mode: "real" }),
    /REAL_PROVIDER_NOT_CONFIGURED/,
  );
});

test("reports write only JSON and Markdown to an explicit directory and redact prompts and paths", async () => {
  const tasks = await fixtures();
  const report = await runEvaluationSuite(tasks, new MockAIProvider(tasks));
  const root = await mkdtemp(path.join(os.tmpdir(), "dj-codex-eval-"));
  const outputDirectory = path.join(root, "explicit-output");
  try {
    await writeEvaluationReports(report, outputDirectory, {
      sensitiveValues: [tasks[0]!.prompt, "/Users/example/Music/secret.wav"],
    });
    assert.deepEqual((await readdir(outputDirectory)).sort(), ["evaluation.json", "evaluation.md"]);
    const json = await readFile(path.join(outputDirectory, "evaluation.json"), "utf8");
    const markdown = await readFile(path.join(outputDirectory, "evaluation.md"), "utf8");
    for (const text of [json, markdown]) {
      assert.doesNotMatch(text, new RegExp(tasks[0]!.prompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(text, /\/Users\/example\/Music\/secret\.wav/);
      assert.doesNotMatch(text, /quality percentage/i);
    }
    const summary = summarizeEvaluation(report.results);
    assert.equal(summary.unknownIdCount, 0);
    assert.equal("qualityPercentage" in summary, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports refuse an existing or symlinked output file without changing its target", async () => {
  const tasks = await fixtures();
  const report = await runEvaluationSuite(tasks, new MockAIProvider(tasks));
  const root = await mkdtemp(path.join(os.tmpdir(), "dj-codex-eval-symlink-"));
  const outputDirectory = path.join(root, "explicit-output");
  const target = path.join(root, "must-not-change.txt");
  try {
    await mkdir(outputDirectory, { mode: 0o700 });
    await writeFile(target, "sentinel", "utf8");
    await symlink(target, path.join(outputDirectory, "evaluation.json"));

    await assert.rejects(
      () => writeEvaluationReports(report, outputDirectory),
      /OUTPUT_FILE_EXISTS/,
    );
    assert.equal(await readFile(target, "utf8"), "sentinel");
    assert.deepEqual(await readdir(outputDirectory), ["evaluation.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function runCli(arguments_: string[], environment: NodeJS.ProcessEnv = process.env): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const child = spawn(process.execPath, [new URL("../src/run.ts", import.meta.url).pathname, ...arguments_], {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { code, stdout, stderr };
}

async function runDocumentedMockCli(outputDirectory: string): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const child = spawn(
    "pnpm",
    ["--silent", "--dir", "spikes/codex-evaluation", "evaluate:mock", "--", "--output-dir", outputDirectory],
    { cwd: repositoryRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { code, stdout, stderr };
}

test("the documented silent mock CLI writes without logging the output path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dj-codex-eval-cli-"));
  const outputDirectory = path.join(root, "private-output");
  try {
    const result = await runDocumentedMockCli(outputDirectory);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, "Evaluation reports written.\n");
    assert.doesNotMatch(result.stdout, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.deepEqual((await readdir(outputDirectory)).sort(), ["evaluation.json", "evaluation.md"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the real CLI fails closed before provider initialization without explicit opt-in", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dj-codex-eval-real-"));
  const outputDirectory = path.join(root, "must-remain-absent");
  try {
    const environment = { ...process.env };
    delete environment.DJ_CODEX_EVALUATION_REAL;
    const result = await runCli(["--mode", "real", "--output-dir", outputDirectory], environment);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "REAL_PROVIDER_NOT_CONFIGURED\n");
    await assert.rejects(() => readdir(outputDirectory), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
