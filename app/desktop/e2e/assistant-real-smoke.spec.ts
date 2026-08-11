import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { CodexProvider } from "../src/main/assistant/codex-provider";
import { AIProviderError } from "../src/main/assistant/provider";
import { assistantPlanOutputSchema, assistantSearchOutputSchema } from "../src/main/assistant/schemas";

const desktopDirectory = process.cwd();
const repositoryRoot = resolve(desktopDirectory, "../..");
const mainEntry = join(desktopDirectory, "dist/main/main.cjs");
const execFileAsync = promisify(execFile);

test.skip(process.env.DJ_COPILOT_REAL_SMOKE !== "1", "Explicit existing-auth smoke only");

async function compatiblePython(): Promise<string> {
  const candidates = [
    join(repositoryRoot, ".venv/bin/python"),
    ...[...new Set((process.env.PATH ?? "").split(delimiter).filter(Boolean))]
      .map((directory) => join(directory, "python3")),
  ];
  for (const candidate of [...new Set(candidates)]) {
    try {
      await access(candidate);
      const { stdout } = await execFileAsync(candidate, [
        "-c",
        "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')",
      ]);
      const [major, minor] = stdout.trim().split(".").map(Number);
      if ((major ?? 0) > 3 || (major === 3 && (minor ?? 0) >= 12)) return candidate;
    } catch {
      // Try the next supported Python executable.
    }
  }
  throw new Error("A CPython 3.12+ executable is required for the real M6 smoke");
}

function electronEnvironment(pythonExecutable: string): Record<string, string> {
  const values = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const {
    VITE_DEV_SERVER_URL: _ignoredRenderer,
    DJ_COPILOT_ASSISTANT_PROVIDER: _ignoredProvider,
    ...remaining
  } = values;
  return { ...remaining, DJ_COPILOT_TEST_MODE: "1", DJ_COPILOT_PYTHON: pythonExecutable };
}

test.beforeAll(async () => {
  if (process.env.DJ_COPILOT_REAL_SMOKE === "1") {
    await execFileAsync("pnpm", ["build"], { cwd: desktopDirectory });
  }
});

test("uses exact existing ChatGPT auth for real structured, resumed, cancelled, and Electron-main turns", async () => {
  test.setTimeout(300_000);
  const root = await mkdtemp(join(tmpdir(), "dj-copilot-m6-real-"));
  const providerDirectory = join(root, "provider-workspace");
  const userDataPath = join(root, "user-data");
  const pythonExecutable = await compatiblePython();
  const provider = new CodexProvider({ workingDirectory: providerDirectory, timeoutMs: 90_000 });
  let application: ElectronApplication | undefined;
  try {
    await expect(provider.getStatus()).resolves.toMatchObject({ state: "ready", auth: "chatgpt", sdkVersion: "0.147.0" });

    const search = await provider.runStructured(
      {
        kind: "search",
        prompt: [
          "Return only a JSON value matching the supplied schema.",
          "Interpret the DJ request as a local genre filter.",
          "Use type filters, summary House filter, and filters genre House. Do not call tools.",
        ].join(" "),
      },
      assistantSearchOutputSchema,
      new AbortController().signal,
      () => {},
    );
    expect(search.value).toMatchObject({ type: "filters", filters: { genre: "House" } });
    if (search.threadId === undefined) throw new Error("The real Codex turn did not publish a thread ID");
    expect(search.threadId.length).toBeGreaterThan(0);

    const plan = await provider.runStructured(
      {
        kind: "plan",
        threadId: search.threadId,
        prompt: [
          "Return only a JSON value matching the new supplied schema.",
          "Create a three-track smooth DJ draft titled Real Smoke Set.",
          "Use null target duration, null artist repeat limit, empty candidate filters, maxTracks 3, and no selected seed. Do not call tools.",
        ].join(" "),
      },
      assistantPlanOutputSchema,
      new AbortController().signal,
      () => {},
    );
    expect(plan.value).toMatchObject({ type: "create_draft", maxTracks: 3 });
    expect(plan.threadId).toBe(search.threadId);

    const cancellation = new AbortController();
    const cancelledTurn = provider.runText(
      {
        kind: "explain",
        prompt: "Prepare a detailed DJ explanation, checking every point carefully before answering.",
      },
      cancellation.signal,
      () => {},
    );
    setTimeout(() => cancellation.abort(), 250);
    let cancellationCode: string | null = null;
    try {
      await cancelledTurn;
    } catch (error) {
      cancellationCode = error instanceof AIProviderError ? error.code : null;
    }
    expect(cancellationCode).toBe("cancelled");

    application = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataPath}`],
      env: electronEnvironment(pythonExecutable),
    });
    const page = await application.firstWindow();
    await expect.poll(() => application!.evaluate(() => (
      Reflect.get(globalThis, "__DJ_COPILOT_TEST_HOOK__") as { getStatus(): { state: string } }
    ).getStatus().state), { timeout: 10_000 }).toBe("ready");
    const panel = page.getByRole("region", { name: "Copilot" });
    await expect(panel.getByText("Copilot status not checked")).toBeVisible();
    await panel.getByRole("button", { name: "Refresh Copilot status" }).click();
    await expect(panel.getByText("ChatGPT ready")).toBeVisible({ timeout: 15_000 });

    await panel.getByRole("textbox", { name: "Ask Copilot" }).fill("Search my local library for House tracks using a genre filter.");
    await panel.getByRole("button", { name: "Run Copilot" }).click();
    await expect(panel.getByRole("region", { name: "Copilot result" })).toContainText("No local tracks matched", { timeout: 90_000 });

    await panel.getByRole("tab", { name: "Plan set" }).click();
    await panel.getByRole("textbox", { name: "Ask Copilot" }).fill("Propose a smooth three-track set plan from my local library.");
    await panel.getByRole("button", { name: "Run Copilot" }).click();
    const proposal = panel.getByRole("region", { name: "Copilot proposal" });
    await expect(proposal).toContainText("Proposal — not applied", { timeout: 90_000 });
    await proposal.getByRole("button", { name: "Discard proposal" }).click();

    const runtimeDirectory = await application.evaluate(() => (
      Reflect.get(globalThis, "__DJ_COPILOT_TEST_HOOK__") as { getRuntimeDirectory(): string }
    ).getRuntimeDirectory());
    await application.close();
    application = undefined;
    await expect(access(runtimeDirectory)).rejects.toThrow();
    console.log(`M6_REAL_SMOKE ${JSON.stringify({
      exactSdk: true,
      existingChatGptAuth: true,
      structuredSearch: true,
      structuredPlan: true,
      exactThreadResume: true,
      abortSignalCancellation: true,
      statusCheckExplicit: true,
      electronMainSearchAndPlan: true,
      responseTextRecorded: false,
    })}`);
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
