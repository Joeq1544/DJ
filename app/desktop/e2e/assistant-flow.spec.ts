import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { buildDesktop } from "./build-desktop";

const desktopDirectory = process.cwd();
const repositoryRoot = resolve(desktopDirectory, "../..");
const mainEntry = join(desktopDirectory, "dist/main/main.cjs");
const execFileAsync = promisify(execFile);

const tracks = [
  { externalId: "m6-alpha", title: "Alpha Seed", artist: "Artist A", bpm: 120, key: "8A" },
  { externalId: "m6-bravo", title: "Bravo Warm", artist: "Artist B", bpm: 122, key: "8B" },
  { externalId: "m6-charlie", title: "Charlie Lift", artist: "Artist C", bpm: 124, key: "9A" },
  { externalId: "m6-delta", title: "Delta Peak", artist: "Artist D", bpm: 126, key: "9B" },
  { externalId: "m6-echo", title: "Echo Reset", artist: "Artist E", bpm: 128, key: "10A" },
  { externalId: "m6-foxtrot", title: "Foxtrot Closer", artist: "Artist F", bpm: 130, key: "10B" },
] as const;

interface AssistantE2eApi {
  library: { listTracks(query?: Record<string, unknown>): Promise<{ items: Array<{ id: string; title: string | null }> }> };
  sets: { list(): Promise<{ items: Array<{ draftId: string; title: string; currentRevision: number }> }> };
}

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
  throw new Error("A CPython 3.12+ executable is required for the M6 Electron flow");
}

function environment(pythonExecutable: string): Record<string, string> {
  const values = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const { VITE_DEV_SERVER_URL: _ignored, ...remaining } = values;
  return {
    ...remaining,
    DJ_COPILOT_TEST_MODE: "1",
    DJ_COPILOT_PYTHON: pythonExecutable,
    DJ_COPILOT_ASSISTANT_PROVIDER: "mock",
  };
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function makeFixture(root: string): Promise<{ xmlPath: string; hashes: Record<string, string> }> {
  const mediaPaths: string[] = [];
  for (const track of tracks) {
    const mediaPath = join(root, `${track.externalId}.wav`);
    await writeFile(mediaPath, `Generated M6 marker ${track.externalId}\n`, "utf8");
    mediaPaths.push(mediaPath);
  }
  const xmlPath = join(root, "m6-source.xml");
  await writeFile(xmlPath, `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="7.0.0"/>
  <COLLECTION Entries="${tracks.length}">
${tracks.map((track, index) => `    <TRACK TrackID="${track.externalId}" Name="${xmlEscape(track.title)}" Artist="${xmlEscape(track.artist)}" Genre="House" AverageBpm="${track.bpm}" Tonality="${track.key}" TotalTime="${180 + index}" Location="${xmlEscape(pathToFileURL(mediaPaths[index]!).href)}"/>`).join("\n")}
  </COLLECTION>
  <PLAYLISTS><NODE Type="0" Name="ROOT" Count="1"><NODE Type="1" Name="M6 Copilot" Entries="${tracks.length}">${tracks.map((track) => `<TRACK KeyType="TrackID" Key="${track.externalId}"/>`).join("")}</NODE></NODE></PLAYLISTS>
</DJ_PLAYLISTS>
`, "utf8");
  const paths = [xmlPath, ...mediaPaths];
  return {
    xmlPath,
    hashes: Object.fromEntries(await Promise.all(paths.map(async (path) => [
      path,
      createHash("sha256").update(await readFile(path)).digest("hex"),
    ]))),
  };
}

async function launch(pythonExecutable: string, userDataPath: string): Promise<ElectronApplication> {
  const application = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataPath}`],
    env: environment(pythonExecutable),
  });
  await application.firstWindow();
  await expect.poll(() => application.evaluate(() => (
    Reflect.get(globalThis, "__DJ_COPILOT_TEST_HOOK__") as { getStatus(): { state: string } }
  ).getStatus().state), { timeout: 10_000 }).toBe("ready");
  return application;
}

async function stubOpenDialog(application: ElectronApplication, selectedPath: string): Promise<void> {
  await application.evaluate(({ dialog }, path: string) => {
    const nativeDialog = dialog as unknown as { showOpenDialog: unknown };
    nativeDialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, selectedPath);
}

async function setCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const api = Reflect.get(globalThis, "djCopilot") as AssistantE2eApi;
    return (await api.sets.list()).items.length;
  });
}

async function runCopilot(page: Page, prompt: string): Promise<void> {
  const panel = page.getByRole("region", { name: "Copilot" });
  await panel.getByRole("textbox", { name: "Ask Copilot" }).fill(prompt);
  await panel.getByRole("button", { name: "Run Copilot" }).click();
}

test.beforeAll(async () => {
  await buildDesktop(desktopDirectory);
});

test("runs all M6 Copilot workflows through built Electron while preserving local state and sources", async () => {
  test.setTimeout(150_000);
  const root = await mkdtemp(join(tmpdir(), "dj-copilot-m6-e2e-"));
  const userDataPath = join(root, "user-data");
  const pythonExecutable = await compatiblePython();
  const fixture = await makeFixture(root);
  let application: ElectronApplication | undefined;
  try {
    application = await launch(pythonExecutable, userDataPath);
    await stubOpenDialog(application, fixture.xmlPath);
    let page = await application.firstWindow();
    await page.getByRole("button", { name: "Import Rekordbox XML" }).click();
    await expect(page.getByText(`${tracks.length} tracks imported and 2 playlists.`)).toBeVisible();
    await page.getByRole("button", { name: "Explore Alpha Seed" }).click();

    const panel = page.getByRole("region", { name: "Copilot" });
    await expect(panel.getByText("Copilot status not checked")).toBeVisible();
    await panel.getByRole("button", { name: "Refresh Copilot status" }).click();
    await expect(panel.getByText("ChatGPT ready")).toBeVisible();

    await runCopilot(page, "Find warm house tracks");
    let result = await panel.getByRole("region", { name: "Copilot result" });
    await expect(result.getByRole("list", { name: "Local tracks" })).toContainText("Alpha Seed");

    await runCopilot(page, "Find tracks similar to this");
    await expect(result).toContainText("Tracks similar to the selected track");

    await runCopilot(page, "What should I play next to build energy?");
    await expect(result).toContainText("Build energy");
    await expect(result).toContainText("ppm score");

    await panel.getByRole("tab", { name: "Plan set" }).click();
    await runCopilot(page, "Plan a smooth five-track set");
    const planProposal = await panel.getByRole("region", { name: "Copilot proposal" });
    await expect(planProposal).toContainText("Proposal — not applied");
    await expect.poll(() => setCount(page)).toBe(0);
    await planProposal.getByRole("button", { name: "Confirm proposal" }).click();
    await expect(page.getByRole("list", { name: "Draft tracks" })).toBeVisible();
    await expect.poll(() => setCount(page)).toBe(1);

    await panel.getByRole("tab", { name: "Revise draft" }).click();
    await runCopilot(page, "Rename this set to Sunset Session");
    const revisionProposal = await panel.getByRole("region", { name: "Copilot proposal" });
    await expect(revisionProposal).toContainText("Sunset Session");
    const setTitle = page.locator(".set-workspace").getByLabel("Set title");
    await expect(setTitle).not.toHaveValue("Sunset Session");
    await revisionProposal.getByRole("button", { name: "Confirm proposal" }).click();
    await expect(setTitle).toHaveValue("Sunset Session");

    await panel.getByRole("tab", { name: "Explain" }).click();
    await panel.getByRole("combobox", { name: "Explanation context" }).selectOption("draft");
    await runCopilot(page, "Explain this draft");
    result = panel.getByRole("region", { name: "Copilot result" });
    await expect(result.getByLabel(/Track citation:/u).first()).toBeVisible();

    await panel.getByRole("tab", { name: "Search" }).click();
    await runCopilot(page, "wait for cancellation");
    await panel.getByRole("button", { name: "Cancel Copilot" }).click();
    await expect(panel.getByText("Copilot request cancelled. Nothing was changed.")).toBeVisible();
    await expect.poll(() => setCount(page)).toBe(1);
    await expect.poll(() => page.evaluate(async () => {
      const api = Reflect.get(globalThis, "djCopilot") as AssistantE2eApi;
      return (await api.library.listTracks({ limit: 200 })).items.length;
    })).toBe(tracks.length);

    const runtimeDirectory = await application.evaluate(() => (
      Reflect.get(globalThis, "__DJ_COPILOT_TEST_HOOK__") as { getRuntimeDirectory(): string }
    ).getRuntimeDirectory());
    await application.close();
    application = undefined;

    application = await launch(pythonExecutable, userDataPath);
    page = await application.firstWindow();
    await expect(page.getByLabel("Saved sets")).toContainText("Sunset Session");
    await page.getByLabel("Saved sets").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Open saved set" }).click();
    await expect(page.locator(".set-workspace").getByLabel("Set title")).toHaveValue("Sunset Session");

    const after = Object.fromEntries(await Promise.all(Object.keys(fixture.hashes).map(async (path) => [
      path,
      createHash("sha256").update(await readFile(path)).digest("hex"),
    ]))) as Record<string, string>;
    expect(after).toEqual(fixture.hashes);
    await application.close();
    application = undefined;
    await expect(access(runtimeDirectory)).rejects.toThrow();
    console.log(`M6_E2E_EVIDENCE ${JSON.stringify({
      filtersSimilarNext: true,
      statusCheckExplicit: true,
      planConfirmedOnlyAfterPreview: true,
      revisionConfirmedOnlyAfterPreview: true,
      groundedExplanation: true,
      cancellation: true,
      persistedAfterReload: true,
      sourceHashesPreserved: true,
      runtimeDirectoryCleaned: true,
    })}`);
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
