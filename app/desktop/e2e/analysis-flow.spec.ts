import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";

const desktopDirectory = process.cwd();
const repositoryRoot = resolve(desktopDirectory, "../..");
const fixtureGenerator = join(repositoryRoot, "scripts/generate-audio-fixtures.py");
const mainEntry = join(desktopDirectory, "dist/main/main.cjs");
const execFileAsync = promisify(execFile);

const fixtureNames = ["clicks.wav", "harmonic.wav", "silence.wav", "corrupt.wav"] as const;

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
        "import numpy, sys; print(f'{sys.version_info.major}.{sys.version_info.minor}'); print(numpy.__version__)",
      ]);
      const [pythonVersion, numpyVersion] = stdout.trim().split(/\r?\n/u);
      const [major, minor] = (pythonVersion ?? "").split(".").map(Number);
      if (((major ?? 0) > 3 || (major === 3 && (minor ?? 0) >= 12)) && numpyVersion === "2.4.4") {
        return candidate;
      }
    } catch {
      // Continue until the exact local provider prerequisites are available.
    }
  }
  throw new Error("A CPython 3.12+ executable with NumPy 2.4.4 is required for the M2 Electron flow");
}

async function executablePath(command: "ffmpeg" | "ffprobe"): Promise<string> {
  const { stdout } = await execFileAsync("which", [command]);
  const executable = stdout.trim().split(/\r?\n/u)[0];
  if (!executable) throw new Error(`${command} is required for the M2 Electron flow`);
  await access(executable);
  return executable;
}

function electronTestEnvironment(options: {
  pythonExecutable: string;
  ffmpegPath: string;
  ffprobePath: string;
}): Record<string, string> {
  const definedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const { VITE_DEV_SERVER_URL: _ignoredDevRendererUrl, ...environment } = definedEnvironment;
  return {
    ...environment,
    DJ_COPILOT_TEST_MODE: "1",
    DJ_COPILOT_ANALYSIS_TEST_DELAY_MS: "75",
    DJ_COPILOT_PYTHON: options.pythonExecutable,
    DJ_COPILOT_FFMPEG: options.ffmpegPath,
    DJ_COPILOT_FFPROBE: options.ffprobePath,
  };
}

function xmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function writeFixtureXml(xmlPath: string, audioDirectory: string): Promise<void> {
  const tracks = ([
    ["clicks", "Clicks", "clicks.wav"],
    ["harmonic", "Harmonic", "harmonic.wav"],
    ["silence", "Silence", "silence.wav"],
    ["corrupt", "Corrupt", "corrupt.wav"],
  ] as const).map(([id, title, filename]) => {
    const location = pathToFileURL(join(audioDirectory, filename)).href;
    return `    <TRACK TrackID="${id}" Name="${title}" Artist="Generated fixture" Location="${xmlAttribute(location)}"/>`;
  }).join("\n");
  await writeFile(
    xmlPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="7.0.0"/>
  <COLLECTION Entries="4">
${tracks}
  </COLLECTION>
  <PLAYLISTS/>
</DJ_PLAYLISTS>
`,
    "utf8",
  );
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function fixtureHashes(audioDirectory: string): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(
    fixtureNames.map(async (filename) => [filename, await sha256(join(audioDirectory, filename))]),
  ));
}

async function waitForCore(application: ElectronApplication, expectedState: string): Promise<void> {
  await expect.poll(() => application.evaluate(() => {
    const hook = Reflect.get(globalThis, "__DJ_COPILOT_TEST_HOOK__") as { getStatus(): { state: string } };
    return hook.getStatus().state;
  }), { timeout: 10_000 }).toBe(expectedState);
}

async function forceCoreExit(application: ElectronApplication): Promise<"retrying"> {
  return application.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "__DJ_COPILOT_TEST_HOOK__");
    if (!descriptor || descriptor.enumerable || typeof descriptor.value?.forceCoreExit !== "function") {
      throw new Error("Test-only core recovery hook is unavailable");
    }
    return descriptor.value.forceCoreExit() as Promise<"retrying">;
  });
}

function trackRow(page: Page, title: string): Locator {
  const checkbox = page.getByRole("checkbox", { name: `Select ${title} for analysis` });
  return page.locator("tbody tr").filter({ has: checkbox });
}

function ledgerValue(evidence: Locator, label: string): Locator {
  return evidence.locator(".feature-ledger > div").filter({ hasText: label }).locator("dd");
}

test.beforeAll(async () => {
  await execFileAsync("pnpm", ["build"], { cwd: desktopDirectory });
});

test("pauses generated local analysis across a forced core restart and persists measured results", async () => {
  test.setTimeout(120_000);
  const pythonExecutable = await compatiblePython();
  const ffmpegPath = await executablePath("ffmpeg");
  const ffprobePath = await executablePath("ffprobe");
  const temporaryRoot = await mkdtemp(join(tmpdir(), "dj-copilot-analysis-e2e-"));
  const audioDirectory = join(temporaryRoot, "audio");
  const xmlPath = join(temporaryRoot, "library.xml");
  const userDataPath = join(temporaryRoot, "user-data");
  let application: ElectronApplication | undefined;

  try {
    await execFileAsync(pythonExecutable, [fixtureGenerator, "--output", audioDirectory], {
      cwd: repositoryRoot,
    });
    await writeFixtureXml(xmlPath, audioDirectory);
    const hashesBefore = await fixtureHashes(audioDirectory);

    application = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataPath}`],
      env: electronTestEnvironment({ pythonExecutable, ffmpegPath, ffprobePath }),
    });
    const page = await application.firstWindow();
    expect(new URL(page.url()).protocol).toBe("file:");
    await waitForCore(application, "ready");

    await application.evaluate(({ dialog }, selectedPath: string) => {
      const dialogStub = dialog as unknown as {
        showOpenDialog: (window: unknown, options: unknown) => Promise<unknown>;
      };
      dialogStub.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
    }, xmlPath);
    await page.getByRole("button", { name: "Import Rekordbox XML" }).click();
    await expect(page.getByText("4 tracks imported and 0 playlists.")).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(4);
    await page.getByRole("checkbox", { name: "Select all analyzable tracks" }).check();
    await expect(page.getByRole("button", { name: "Analyze 4 selected" })).toBeEnabled();

    const analysisStartedAt = Date.now();
    await page.getByRole("button", { name: "Analyze 4 selected" }).click();
    const progress = page.getByRole("progressbar", { name: "Analysis progress" });
    await expect(progress).toBeVisible();
    await expect.poll(async () => Number(await progress.getAttribute("aria-valuenow")), {
      message: "generated analysis should expose nonzero progress before it can be paused",
      timeout: 20_000,
    }).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Pause analysis" }).click();
    await expect(page.getByRole("button", { name: "Resume analysis" })).toBeVisible();
    const queueCounts = page.locator(".analysis-transport__counts");
    await expect.poll(async () => /[1-4] paused/u.test((await queueCounts.textContent()) ?? ""), {
      message: "the in-flight job should settle into a durable paused state",
      timeout: 10_000,
    }).toBe(true);

    expect(await forceCoreExit(application)).toBe("retrying");
    await waitForCore(application, "ready");
    await expect(page.getByRole("button", { name: "Resume analysis" })).toBeVisible();
    const pausedProgress = await progress.getAttribute("aria-valuenow");
    await page.waitForTimeout(1_250);
    await expect(page.getByRole("button", { name: "Resume analysis" })).toBeVisible();
    await expect(progress).toHaveAttribute("aria-valuenow", pausedProgress ?? "0");
    await expect.poll(async () => /[1-4] paused/u.test((await queueCounts.textContent()) ?? "")).toBe(true);

    await page.getByRole("button", { name: "Resume analysis" }).click();
    await expect(queueCounts).toHaveText(
      "0 queued · 0 running · 0 paused · 3 complete · 1 failed",
      { timeout: 90_000 },
    );
    const analysisElapsedMs = Date.now() - analysisStartedAt;

    for (const title of ["Clicks", "Harmonic", "Silence"]) {
      await expect(trackRow(page, title).locator(".analysis-state")).toHaveText("Analyzed");
    }
    await expect(trackRow(page, "Corrupt").locator(".analysis-state")).toHaveText("Failed");
    await expect(page.getByText("The source audio format is unsupported.")).toBeVisible();

    const clicksEvidence = page.getByRole("region", { name: "Local analysis for Clicks" });
    const harmonicEvidence = page.getByRole("region", { name: "Local analysis for Harmonic" });
    const silenceEvidence = page.getByRole("region", { name: "Local analysis for Silence" });
    await expect(ledgerValue(clicksEvidence, "Local tempo")).toHaveText("120 BPM");
    await expect(ledgerValue(harmonicEvidence, "Local key")).toHaveText("C major");
    await expect(ledgerValue(silenceEvidence, "Local tempo")).toHaveText("Not enough evidence");
    await expect(ledgerValue(silenceEvidence, "Local key")).toHaveText("Not enough evidence");
    await expect(harmonicEvidence.getByText(/^Tempo confidence \d+%$/u)).toBeVisible();
    await expect(harmonicEvidence.getByText(/^Key confidence \d+%$/u)).toBeVisible();
    await expect(harmonicEvidence.getByText("ffmpeg-numpy-basic", { exact: true })).toBeVisible();
    await expect(harmonicEvidence.getByText("baseline-v1", { exact: true })).toBeVisible();
    await expect(harmonicEvidence.getByText("ffmpeg 8.1.2; ffprobe 8.1.2; numpy 2.4.4", { exact: true })).toBeVisible();

    await page.reload();
    await expect(queueCounts).toHaveText("0 queued · 0 running · 0 paused · 3 complete · 1 failed");
    await expect(page.getByRole("region", { name: "Local analysis for Clicks" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Local analysis for Harmonic" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Local analysis for Silence" })).toBeVisible();
    await expect(page.getByText("The source audio format is unsupported.")).toBeVisible();

    const hashesAfter = await fixtureHashes(audioDirectory);
    expect(hashesAfter).toEqual(hashesBefore);
    const runtimeDirectory = await application.evaluate(() => {
      const hook = Reflect.get(globalThis, "__DJ_COPILOT_TEST_HOOK__") as { getRuntimeDirectory(): string };
      return hook.getRuntimeDirectory();
    });
    expect(runtimeDirectory).toBeTruthy();

    await application.close();
    application = undefined;
    await expect(access(runtimeDirectory)).rejects.toThrow();
    console.log(`M2_E2E_EVIDENCE ${JSON.stringify({
      analysisElapsedMs,
      hashes: hashesAfter,
      outcomes: { succeeded: 3, failed: 1, pausedAcrossRestart: true, persistedAfterReload: true },
      runtimeDirectoryCleaned: true,
    })}`);
  } finally {
    await application?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
