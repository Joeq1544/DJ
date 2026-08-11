import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

const desktopDirectory = process.cwd();
const repositoryRoot = resolve(desktopDirectory, "../..");
const mainEntry = join(desktopDirectory, "dist/main/main.cjs");
const execFileAsync = promisify(execFile);

const fixtureTracks = [
  { externalId: "m5-alpha", title: "Alpha Seed", artist: "Artist A" },
  { externalId: "m5-bravo", title: "Bravo Baseline", artist: "Artist B" },
  { externalId: "m5-charlie", title: "Charlie Current", artist: "Artist C" },
  { externalId: "m5-delta", title: "Delta Current", artist: "Artist D" },
  { externalId: "m5-echo", title: "Echo Current", artist: "Artist E" },
  { externalId: "m5-foxtrot", title: "Foxtrot Current", artist: "Artist F" },
  { externalId: "m5-zeta", title: "Zeta Favorite", artist: "Artist Z" },
] as const;

interface PublicTrack {
  id: string;
  title: string | null;
  userMetadata: { rating: number | null; tags: string[]; note: string | null };
}

interface PublicProfile {
  revision: string;
  status: "baseline" | "learning" | "active";
  effectiveEvidenceCount: number;
  eventCounts: Record<string, number>;
  trackAffinities: unknown[];
  genreAffinities: unknown[];
}

interface PublicComparison {
  profile: PublicProfile;
  baseline: { items: Array<{ track: { id: string }; scorePpm: number }> };
  personalized: { items: Array<{ track: { id: string }; scorePpm: number }> };
  rankChanges: Array<{ trackId: string; delta: number }>;
}

interface PersonalApi {
  library: {
    listTracks(query?: Record<string, unknown>): Promise<{ items: PublicTrack[] }>;
    getTrackMetadata(trackId: string): Promise<{ trackId: string; rating: number | null; tags: string[]; note: string | null }>;
    listSavedFilters(): Promise<{ items: Array<{ id: string; name: string; filters: Record<string, unknown> }> }>;
  };
  preferences: {
    getProfile(): Promise<PublicProfile>;
    compareRecommendations(request: Record<string, unknown>): Promise<PublicComparison>;
  };
  sets: { list(): Promise<{ items: unknown[] }> };
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
  throw new Error("A CPython 3.12+ executable is required for the M5 Electron flow");
}

function environment(pythonExecutable: string): Record<string, string> {
  const values = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const { VITE_DEV_SERVER_URL: _ignored, ...remaining } = values;
  return { ...remaining, DJ_COPILOT_TEST_MODE: "1", DJ_COPILOT_PYTHON: pythonExecutable };
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function makeFixture(root: string): Promise<{
  xmlPath: string;
  hashes: Record<string, string>;
}> {
  const mediaPaths: string[] = [];
  for (const track of fixtureTracks) {
    const mediaPath = join(root, `${track.externalId}.wav`);
    await writeFile(mediaPath, `Generated M5 marker ${track.externalId}\n`, "utf8");
    mediaPaths.push(mediaPath);
  }
  const xmlPath = join(root, "m5-source.xml");
  await writeFile(xmlPath, `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="7.0.0"/>
  <COLLECTION Entries="${fixtureTracks.length}">
${fixtureTracks.map((track, index) => `    <TRACK TrackID="${xmlEscape(track.externalId)}" Name="${xmlEscape(track.title)}" Artist="${xmlEscape(track.artist)}" Genre="House" AverageBpm="124" Tonality="8A" TotalTime="${180 + index}" Location="${xmlEscape(pathToFileURL(mediaPaths[index]!).href)}"/>`).join("\n")}
  </COLLECTION>
  <PLAYLISTS><NODE Type="0" Name="ROOT" Count="1"><NODE Type="1" Name="M5 Personalization" Entries="${fixtureTracks.length}">${fixtureTracks.map((track) => `<TRACK KeyType="TrackID" Key="${xmlEscape(track.externalId)}"/>`).join("")}</NODE></NODE></PLAYLISTS>
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

async function stubSaveDialog(application: ElectronApplication, selectedPath: string | null): Promise<void> {
  await application.evaluate(({ dialog }, path: string | null) => {
    const nativeDialog = dialog as unknown as { showSaveDialog: unknown };
    nativeDialog.showSaveDialog = async () => path === null
      ? ({ canceled: true, filePath: undefined })
      : ({ canceled: false, filePath: path });
  }, selectedPath);
}

async function allTracks(page: Page): Promise<PublicTrack[]> {
  return page.evaluate(async () => {
    const api = Reflect.get(globalThis, "djCopilot") as PersonalApi;
    return (await api.library.listTracks({ limit: 200 })).items;
  });
}

async function metadataForTitle(page: Page, title: string) {
  const tracks = await allTracks(page);
  const item = tracks.find((track) => track.title === title);
  if (!item) throw new Error(`Missing generated track ${title}`);
  return page.evaluate(async (trackId) => {
    const api = Reflect.get(globalThis, "djCopilot") as PersonalApi;
    return api.library.getTrackMetadata(trackId);
  }, item.id);
}

async function importFixture(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Import Rekordbox XML" }).click();
  await expect(page.getByText(`${fixtureTracks.length} tracks imported and 2 playlists.`)).toBeVisible();
}

test.beforeAll(async () => {
  await execFileAsync("pnpm", ["build"], { cwd: desktopDirectory });
});

test("persists, applies, exports, and exactly resets personal preferences through the production desktop boundary", async () => {
  test.setTimeout(150_000);
  const root = await mkdtemp(join(tmpdir(), "dj-copilot-m5-e2e-"));
  const userDataPath = join(root, "user-data");
  const exportPath = join(root, "preferences.json");
  const pythonExecutable = await compatiblePython();
  const fixture = await makeFixture(root);
  let application: ElectronApplication | undefined;
  try {
    application = await launch(pythonExecutable, userDataPath);
    await stubOpenDialog(application, fixture.xmlPath);
    await stubSaveDialog(application, null);
    let page = await application.firstWindow();
    await importFixture(page);

    await page.getByRole("button", { name: "Edit details for Zeta Favorite" }).click();
    const details = page.getByRole("region", { name: "Personal details for Zeta Favorite" });
    await details.getByRole("combobox", { name: "Rating" }).selectOption("5");
    await details.getByRole("textbox", { name: "Tags" }).fill("Warm, Favorite, warm");
    await details.getByRole("textbox", { name: "Notes" }).fill("Opening option from generated evidence");
    await details.getByRole("button", { name: "Save personal details" }).click();
    await expect(details.getByText("Personal details saved.")).toBeVisible();
    await details.getByRole("button", { name: "Like Zeta Favorite", exact: true }).click();
    await expect(details.getByText("Like recorded.")).toBeVisible();
    await details.getByRole("button", { name: "Close personal details" }).click();

    await importFixture(page);
    await expect.poll(() => metadataForTitle(page, "Zeta Favorite")).toMatchObject({
      rating: 5,
      tags: ["Warm", "Favorite"],
      note: "Opening option from generated evidence",
    });

    const filters = page.getByRole("region", { name: "Library filters" });
    await filters.getByRole("searchbox", { name: "Search library" }).fill("generated evidence");
    await filters.getByRole("combobox", { name: "Minimum rating" }).selectOption("5");
    await filters.getByRole("textbox", { name: "Exact tag" }).fill("Warm");
    await filters.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByRole("button", { name: "Edit details for Zeta Favorite" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Edit details for /u })).toHaveCount(1);

    const savedFilters = page.getByRole("region", { name: "Saved filters" });
    await savedFilters.getByRole("textbox", { name: "Filter name" }).fill("Delete after proof");
    await savedFilters.getByRole("button", { name: "Save current filter" }).click();
    await expect(savedFilters.getByText("Saved Delete after proof.")).toBeVisible();
    await savedFilters.getByRole("button", { name: "Delete Delete after proof" }).click();
    await expect(savedFilters.getByText("Deleted Delete after proof.")).toBeVisible();

    await filters.getByRole("searchbox", { name: "Search library" }).fill("");
    await filters.getByRole("combobox", { name: "Minimum rating" }).selectOption("");
    await filters.getByRole("textbox", { name: "Exact tag" }).fill("Warm");
    await filters.getByRole("button", { name: "Apply filters" }).click();
    await savedFilters.getByRole("textbox", { name: "Filter name" }).fill("Keep warm tag");
    await savedFilters.getByRole("button", { name: "Save current filter" }).click();
    await expect(savedFilters.getByText("Saved Keep warm tag.")).toBeVisible();
    await filters.getByRole("button", { name: "Clear filters" }).click();
    await savedFilters.getByRole("button", { name: "Load Keep warm tag" }).click();
    await expect(savedFilters.getByText("Loaded Keep warm tag.")).toBeVisible();
    await expect(filters.getByRole("textbox", { name: "Exact tag" })).toHaveValue("Warm");
    await filters.getByRole("button", { name: "Clear filters" }).click();

    await page.getByRole("treeitem", { name: /M5 Personalization/u }).click();
    await page.getByRole("button", { name: "Create from playlist" }).click();
    const draftTracks = page.getByRole("list", { name: "Draft tracks" });
    await expect(draftTracks.getByRole("listitem")).toHaveCount(fixtureTracks.length);
    await draftTracks.getByRole("button", { name: "Move Bravo Baseline up" }).click();
    await expect(page.locator(".set-workspace > p[aria-live='polite']").first()).toContainText("Draft updated:");

    await page.getByRole("treeitem", { name: /All Tracks/u }).click();
    await page.getByRole("button", { name: "Explore Alpha Seed" }).click();
    await page.getByRole("tab", { name: "Next" }).click();
    const candidates = page.getByRole("list", { name: "Next-track candidates" });
    const candidateHeadings = candidates.getByRole("heading", { level: 3 });
    await expect(candidateHeadings).toHaveCount(fixtureTracks.length - 1);
    const baselineTitles = await candidateHeadings.allTextContents();
    expect(baselineTitles.at(-1)).toBe("Zeta Favorite");
    await candidates.getByRole("button", { name: "Accept Zeta Favorite" }).click();
    await expect(page.getByText(/Learning from 4 of 5 signals/u)).toBeVisible();
    await candidates.getByRole("button", { name: `Reject ${baselineTitles[0]}` }).click();
    await expect(page.getByText(/Personalization active/u)).toBeVisible();
    await candidates.getByRole("button", { name: /Skip (Charlie|Delta|Echo|Foxtrot) Current/u }).first().click();
    await expect(page.getByText(/Personalization active · 6 signals/u)).toBeVisible();
    await expect(candidates.getByText(/Baseline #\d+ · (up|down) [1-9]/u).first()).toBeVisible();

    const activeComparison = await page.evaluate(async () => {
      const api = Reflect.get(globalThis, "djCopilot") as PersonalApi;
      const tracks = await api.library.listTracks({ limit: 200 });
      const seed = tracks.items.find((track) => track.title === "Alpha Seed");
      if (!seed) throw new Error("Missing Alpha Seed");
      return api.preferences.compareRecommendations({ seedTrackId: seed.id, intent: "smooth", limit: 20 });
    });
    expect(activeComparison.profile.status).toBe("active");
    expect(activeComparison.rankChanges.some((change) => change.delta !== 0)).toBe(true);
    expect(activeComparison.profile.eventCounts.manualReorder).toBe(1);
    expect(activeComparison.profile.eventCounts.liked).toBe(1);
    expect(activeComparison.profile.eventCounts.accepted).toBe(1);
    expect(activeComparison.profile.eventCounts.rejected).toBe(1);
    expect(activeComparison.profile.eventCounts.skipped).toBe(1);
    expect(activeComparison.profile.trackAffinities.length).toBeLessThanOrEqual(50);
    expect(activeComparison.profile.genreAffinities.length).toBeLessThanOrEqual(50);
    const currentIds = new Set((await allTracks(page)).map((track) => track.id));
    for (const item of [...activeComparison.baseline.items, ...activeComparison.personalized.items]) {
      expect(currentIds.has(item.track.id)).toBe(true);
    }

    await page.getByRole("button", { name: "Prepare preference export" }).click();
    await expect(page.getByText("Preference export cancelled. No file was written.")).toBeVisible();
    await stubSaveDialog(application, exportPath);
    await page.getByRole("button", { name: "Prepare preference export" }).click();
    await expect(page.getByText("preferences.json will be created.")).toBeVisible();
    await page.getByRole("button", { name: "Confirm preference export" }).click();
    await expect(page.getByText("Preference export created a new JSON file.")).toBeVisible();
    const firstExport = JSON.parse(await readFile(exportPath, "utf8")) as Record<string, unknown>;
    expect(firstExport.format).toBe("dj-copilot-preferences-v1");
    expect((await stat(exportPath)).mode & 0o777).toBe(0o600);
    const serializedExport = JSON.stringify(firstExport);
    for (const forbidden of [root, fixture.xmlPath, "Opening option", "Warm", "Zeta Favorite", "Artist Z"]) {
      expect(serializedExport).not.toContain(forbidden);
    }
    await page.getByRole("button", { name: "Prepare preference export" }).click();
    await expect(page.getByText("preferences.json already exists and will be replaced.")).toBeVisible();
    await page.getByRole("button", { name: "Confirm preference export" }).click();
    await expect(page.getByText("Preference export replaced the selected JSON file.")).toBeVisible();
    expect(JSON.parse(await readFile(exportPath, "utf8"))).toEqual(firstExport);

    await page.getByRole("button", { name: "Reset preferences" }).click();
    await expect(page.getByText(/This clears ratings and learned feedback/u)).toBeVisible();
    await page.getByRole("button", { name: "Confirm preference reset" }).click();
    await expect(page.getByText(/Reset 5 feedback events and 1 rating/u)).toBeVisible();
    const resetState = await page.evaluate(async () => {
      const api = Reflect.get(globalThis, "djCopilot") as PersonalApi;
      const tracks = await api.library.listTracks({ limit: 200 });
      const seed = tracks.items.find((track) => track.title === "Alpha Seed");
      const favorite = tracks.items.find((track) => track.title === "Zeta Favorite");
      if (!seed || !favorite) throw new Error("Missing generated tracks after reset");
      return {
        profile: await api.preferences.getProfile(),
        comparison: await api.preferences.compareRecommendations({ seedTrackId: seed.id, intent: "smooth", limit: 20 }),
        metadata: await api.library.getTrackMetadata(favorite.id),
        saved: await api.library.listSavedFilters(),
        sets: await api.sets.list(),
        libraryCount: tracks.items.length,
      };
    });
    expect(resetState.profile.status).toBe("baseline");
    expect(resetState.profile.effectiveEvidenceCount).toBe(0);
    expect(resetState.metadata).toMatchObject({ rating: null, tags: ["Warm", "Favorite"], note: "Opening option from generated evidence" });
    expect(resetState.saved.items.map((item) => item.name)).toEqual(["Keep warm tag"]);
    expect(resetState.sets.items).toHaveLength(1);
    expect(resetState.libraryCount).toBe(fixtureTracks.length);
    expect(resetState.comparison.personalized.items).toEqual(resetState.comparison.baseline.items);
    expect(resetState.comparison.rankChanges.every((change) => change.delta === 0)).toBe(true);

    await application.close();
    application = undefined;
    application = await launch(pythonExecutable, userDataPath);
    page = await application.firstWindow();
    const restarted = await page.evaluate(async () => {
      const api = Reflect.get(globalThis, "djCopilot") as PersonalApi;
      return {
        profile: await api.preferences.getProfile(),
        tracks: await api.library.listTracks({ limit: 200 }),
        saved: await api.library.listSavedFilters(),
        sets: await api.sets.list(),
      };
    });
    const restartedFavorite = restarted.tracks.items.find((track) => track.title === "Zeta Favorite");
    expect(restarted.profile.status).toBe("baseline");
    expect(restartedFavorite?.userMetadata).toEqual({ rating: null, tags: ["Warm", "Favorite"], note: "Opening option from generated evidence" });
    expect(restarted.saved.items.map((item) => item.name)).toEqual(["Keep warm tag"]);
    expect(restarted.sets.items).toHaveLength(1);

    const afterHashes = Object.fromEntries(await Promise.all(Object.keys(fixture.hashes).map(async (path) => [
      path,
      createHash("sha256").update(await readFile(path)).digest("hex"),
    ])));
    expect(afterHashes).toEqual(fixture.hashes);
    const temporaryPrefix = `.${basename(exportPath)}.`;
    expect((await readdir(root)).filter((name) => name.startsWith(temporaryPrefix) && name.endsWith(".tmp"))).toEqual([]);
    const runtimeDirectory = await application.evaluate(() => (
      Reflect.get(globalThis, "__DJ_COPILOT_TEST_HOOK__") as { getRuntimeDirectory(): string }
    ).getRuntimeDirectory());
    await application.close();
    application = undefined;
    await expect(access(runtimeDirectory)).rejects.toThrow();
    console.log(`M5_E2E_EVIDENCE ${JSON.stringify({
      metadataRetainedAfterReimport: true,
      composedFilters: true,
      savedFilterLifecycle: true,
      automaticSetFeedback: true,
      activeRankChange: true,
      pathFreeAtomicExport: true,
      exactReset: true,
      restartPreservation: true,
      sourceHashesPreserved: true,
      runtimeDirectoryCleaned: true,
    })}`);
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
