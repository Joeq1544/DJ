import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

const desktopDirectory = process.cwd();
const repositoryRoot = resolve(desktopDirectory, "../..");
const mainEntry = join(desktopDirectory, "dist/main/main.cjs");
const execFileAsync = promisify(execFile);

const tracks = [
  { id: "1", title: "Alpha", artist: "Artist One", bpm: 120, key: "8A", seconds: 180 },
  { id: "2", title: "Beta", artist: "Artist Two", bpm: 122, key: "8B", seconds: 181 },
  { id: "3", title: "Gamma", artist: "Artist Three", bpm: 124, key: "9A", seconds: 182 },
  { id: "4", title: "Delta", artist: "Artist Four", bpm: 126, key: "9B", seconds: 183 },
  { id: "5", title: "Epsilon", artist: "Artist Five", bpm: 128, key: "10A", seconds: 184 },
] as const;

async function compatiblePython(): Promise<string> {
  const candidates = [join(repositoryRoot, ".venv/bin/python"), ...[...new Set((process.env.PATH ?? "").split(delimiter).filter(Boolean))].map((directory) => join(directory, "python3"))];
  for (const candidate of [...new Set(candidates)]) {
    try {
      await access(candidate);
      const { stdout } = await execFileAsync(candidate, ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"]);
      const [major, minor] = stdout.trim().split(".").map(Number);
      if ((major ?? 0) > 3 || (major === 3 && (minor ?? 0) >= 12)) return candidate;
    } catch { /* try the next candidate */ }
  }
  throw new Error("A CPython 3.12+ executable is required for the M4 Electron flow");
}

function environment(pythonExecutable: string): Record<string, string> {
  const values = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const { VITE_DEV_SERVER_URL: _ignored, ...remaining } = values;
  return { ...remaining, DJ_COPILOT_TEST_MODE: "1", DJ_COPILOT_PYTHON: pythonExecutable };
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function makeFixture(root: string): Promise<{ xmlPath: string; mediaPaths: string[]; hashes: Record<string, string> }> {
  const mediaPaths: string[] = [];
  for (const track of tracks) {
    const path = join(root, `${track.id}.wav`);
    await writeFile(path, `M4 generated media sentinel ${track.id}\n`, "utf8");
    mediaPaths.push(path);
  }
  const xmlPath = join(root, "m4-source.xml");
  await writeFile(xmlPath, `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="7.0.0"/>
  <COLLECTION Entries="${tracks.length}">
${tracks.map((track) => `    <TRACK TrackID="${track.id}" Name="${track.title}" Artist="${track.artist}" Genre="House" AverageBpm="${track.bpm}" Tonality="${track.key}" TotalTime="${track.seconds}" Location="${xmlEscape(pathToFileURL(join(root, `${track.id}.wav`)).href)}"/>`).join("\n")}
  </COLLECTION>
  <PLAYLISTS><NODE Type="0" Name="ROOT" Count="1"><NODE Type="1" Name="Repeated source" KeyType="0" Entries="5"><TRACK Key="1"/><TRACK Key="2"/><TRACK Key="1"/><TRACK Key="3"/><TRACK Key="4"/></NODE></NODE></PLAYLISTS>
</DJ_PLAYLISTS>
`, "utf8");
  const paths = [xmlPath, ...mediaPaths];
  return { xmlPath, mediaPaths, hashes: Object.fromEntries(await Promise.all(paths.map(async (path) => [path, createHash("sha256").update(await readFile(path)).digest("hex")])) ) };
}

async function launch(pythonExecutable: string, userDataPath: string): Promise<ElectronApplication> {
  const application = await electron.launch({ args: [mainEntry, `--user-data-dir=${userDataPath}`], env: environment(pythonExecutable) });
  await application.firstWindow();
  await expect.poll(() => application.evaluate(() => (Reflect.get(globalThis, "__DJ_COPILOT_TEST_HOOK__") as { getStatus(): { state: string } }).getStatus().state), { timeout: 10_000 }).toBe("ready");
  return application;
}

async function stubDialogs(application: ElectronApplication, openPath: string, savePath: string | undefined): Promise<void> {
  await application.evaluate(({ dialog }, path: string) => {
    const nativeDialog = dialog as unknown as { showOpenDialog: unknown; showSaveDialog: unknown };
    nativeDialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, openPath);
  await application.evaluate(({ dialog }, path: string) => {
    const nativeDialog = dialog as unknown as { showSaveDialog: unknown };
    nativeDialog.showSaveDialog = async () => path === ""
      ? ({ canceled: true, filePath: undefined })
      : ({ canceled: false, filePath: path });
  }, savePath ?? "");
}

async function updated(page: Page): Promise<void> {
  await expect(page.getByText("Draft updated.")).toBeVisible();
}

test.beforeAll(async () => { await execFileAsync("pnpm", ["build"], { cwd: desktopDirectory }); });

test("runs the M4 set workflow through UI, preload, IPC, and core without changing the source library", async () => {
  test.setTimeout(120_000);
  const root = await mkdtemp(join(tmpdir(), "dj-copilot-m4-e2e-"));
  const userDataPath = join(root, "user-data");
  const exportPath = join(root, "exported-set.xml");
  const pythonExecutable = await compatiblePython();
  const fixture = await makeFixture(root);
  let application: ElectronApplication | undefined;
  try {
    application = await launch(pythonExecutable, userDataPath);
    await stubDialogs(application, fixture.xmlPath, undefined);
    let page = await application.firstWindow();
    await page.getByRole("button", { name: "Import Rekordbox XML" }).click();
    await expect(page.getByText("5 tracks imported and 2 playlists.")).toBeVisible();
    await page.getByRole("treeitem", { name: /Repeated source/u }).click();
    await page.getByRole("button", { name: "Inspect selected playlist" }).click();
    await expect(page.getByText("Suggestions only—nothing has changed in Rekordbox.")).toBeVisible();
    await page.getByRole("button", { name: "Create from playlist" }).click();
    const draftTracks = page.getByRole("list", { name: "Draft tracks" });
    await expect(draftTracks).toHaveCount(1);
    await expect(draftTracks.getByRole("listitem")).toHaveCount(5);
    await expect(draftTracks.getByRole("heading", { name: "Alpha" })).toHaveCount(2);

    await draftTracks.getByRole("button", { name: "Move Beta up" }).click(); await updated(page);
    await draftTracks.getByRole("button", { name: "Pin track Alpha" }).first().click(); await updated(page);
    await draftTracks.getByRole("button", { name: "Pin position Gamma" }).click(); await updated(page);
    await page.getByRole("button", { name: "Ban Delta" }).click(); await updated(page);
    await draftTracks.getByRole("button", { name: "Find replacements for Beta" }).click();
    await expect(draftTracks.getByRole("button", { name: /Replace Beta with/u })).toHaveCount(1);
    await draftTracks.getByRole("button", { name: /Replace Beta with/u }).click(); await updated(page);
    await draftTracks.getByLabel("Role for Gamma").selectOption("closer"); await updated(page);
    await draftTracks.getByLabel("Target energy for Gamma (%)").fill("70");
    await draftTracks.getByLabel("Target energy for Gamma (%)").blur(); await updated(page);
    await page.getByRole("button", { name: "Optimize order" }).click(); await updated(page);
    await page.getByRole("button", { name: "Undo" }).click(); await updated(page);
    await page.getByRole("button", { name: "Redo" }).click(); await updated(page);
    await page.getByRole("button", { name: "Save version" }).click(); await updated(page);
    await page.getByLabel("Saved versions").selectOption({ index: 1 });
    await page.getByRole("button", { name: "View selected version" }).click();
    await expect(page.getByText("Viewing a saved version. Restore it to edit the current draft.")).toBeVisible();
    await page.getByRole("button", { name: "View current draft" }).click();
    await expect(page.getByText("Viewing current draft.")).toBeVisible();
    await page.getByRole("button", { name: "Restore version" }).click(); await updated(page);
    await page.getByRole("button", { name: "Inspect set" }).click();
    await expect(page.getByText("Suggestions only—nothing has changed in Rekordbox.")).toBeVisible();

    await page.getByRole("button", { name: "Prepare Rekordbox XML export" }).click();
    await expect(page.getByText("Export cancelled.")).toBeVisible();
    await stubDialogs(application, fixture.xmlPath, exportPath);
    await page.getByRole("button", { name: "Prepare Rekordbox XML export" }).click();
    await expect(page.getByRole("button", { name: "Confirm export" })).toBeVisible();
    await expect(page.getByText("This creates a new file.")).toBeVisible();
    const finalTitles = await draftTracks.getByRole("heading", { level: 3 }).allTextContents();
    expect(finalTitles.filter((title) => title === "Alpha")).toHaveLength(2);
    await page.getByRole("button", { name: "Confirm export" }).click();
    await expect(page.getByText(/^Exported /u)).toBeVisible();
    await expect(access(exportPath)).resolves.toBeUndefined();

    const expectedKeys = finalTitles.map((title) => tracks.find((track) => track.title === title)?.id ?? "");
    const reparsed = await execFileAsync(pythonExecutable, ["-c", "import sys; from pathlib import Path; from core.dj_copilot.rekordbox_xml import parse_rekordbox_xml; parsed=parse_rekordbox_xml(Path(sys.argv[1])); leaf=next(item for item in parsed.playlists if item.kind == 'playlist'); print(','.join(leaf.track_external_ids))", exportPath], { cwd: repositoryRoot });
    expect(reparsed.stdout.trim().split(",")).toEqual(expectedKeys);

    await page.getByRole("button", { name: "Prepare Rekordbox XML export" }).click();
    await expect(page.getByText("This will replace the existing file.")).toBeVisible();
    await page.getByRole("button", { name: "Confirm export" }).click();
    await expect(page.getByText(/^Exported /u)).toBeVisible();
    const overwritten = await execFileAsync(pythonExecutable, ["-c", "import sys; from pathlib import Path; from core.dj_copilot.rekordbox_xml import parse_rekordbox_xml; parsed=parse_rekordbox_xml(Path(sys.argv[1])); leaf=next(item for item in parsed.playlists if item.kind == 'playlist'); print(','.join(leaf.track_external_ids))", exportPath], { cwd: repositoryRoot });
    expect(overwritten.stdout.trim().split(",")).toEqual(expectedKeys);

    await application.close(); application = undefined;
    application = await launch(pythonExecutable, userDataPath);
    page = await application.firstWindow();
    await expect(page.getByLabel("Saved sets")).toContainText("New set");
    await page.getByLabel("Saved sets").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Open saved set" }).click();
    await expect(page.getByRole("list", { name: "Draft tracks" }).getByRole("heading", { name: "Alpha" })).toHaveCount(2);

    const after = Object.fromEntries(await Promise.all(Object.keys(fixture.hashes).map(async (path) => [path, createHash("sha256").update(await readFile(path)).digest("hex")]))) as Record<string, string>;
    expect(after).toEqual(fixture.hashes);
    const temporaryPrefix = `.${basename(exportPath)}.`;
    expect((await (await import("node:fs/promises")).readdir(root)).filter((name) => name.startsWith(temporaryPrefix) && name.endsWith(".tmp"))).toEqual([]);
    const runtimeDirectory = await application.evaluate(() => (Reflect.get(globalThis, "__DJ_COPILOT_TEST_HOOK__") as { getRuntimeDirectory(): string }).getRuntimeDirectory());
    await application.close(); application = undefined;
    await expect(access(runtimeDirectory)).rejects.toThrow();
    console.log(`M4_E2E_EVIDENCE ${JSON.stringify({ repeatedEntries: 2, persistedAfterReload: true, exportReparsed: true, sourceHashesPreserved: true, runtimeDirectoryCleaned: true })}`);
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
