import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

const desktopDirectory = process.cwd();
const repositoryRoot = resolve(desktopDirectory, "../..");
const discoveryFixture = join(repositoryRoot, "fixtures/discovery/m3-library.json");
const fixtureSeeder = join(repositoryRoot, "scripts/seed-m3-fixture.py");
const mainEntry = join(desktopDirectory, "dist/main/main.cjs");
const execFileAsync = promisify(execFile);

interface FixtureTrack {
  external_id: string;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  bpm_milli: number | null;
  musical_key: string | null;
  duration_ms: number | null;
  availability: "available" | "missing";
  playlist_ids: string[];
}

interface DiscoveryFixture {
  playlists: { main: string; alternate: string };
  tracks: FixtureTrack[];
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
      // Continue until a supported Python runtime is found.
    }
  }
  throw new Error("A CPython 3.12+ executable is required for the M3 Electron flow");
}

function electronTestEnvironment(pythonExecutable: string): Record<string, string> {
  const definedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const { VITE_DEV_SERVER_URL: _ignoredDevRendererUrl, ...environment } = definedEnvironment;
  return {
    ...environment,
    DJ_COPILOT_TEST_MODE: "1",
    DJ_COPILOT_PYTHON: pythonExecutable,
  };
}

function xmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function optionalAttribute(name: string, value: string | number | null): string {
  return value === null ? "" : ` ${name}="${xmlAttribute(String(value))}"`;
}

async function prepareFixture(root: string): Promise<{
  document: DiscoveryFixture;
  xmlPath: string;
  hashedPaths: string[];
}> {
  const document = JSON.parse(await readFile(discoveryFixture, "utf8")) as DiscoveryFixture;
  const mediaDirectory = join(root, "media");
  const xmlPath = join(root, "m3-library.xml");
  await mkdir(mediaDirectory, { recursive: true });
  const trackXml: string[] = [];
  const hashedPaths = [discoveryFixture];
  for (const track of document.tracks) {
    const mediaPath = join(mediaDirectory, `${track.external_id}.wav`);
    if (track.availability === "available") {
      await writeFile(mediaPath, `Generated M3 marker ${track.external_id}\n`, "utf8");
      hashedPaths.push(mediaPath);
    }
    trackXml.push(
      `    <TRACK TrackID="${xmlAttribute(track.external_id)}" Name="${xmlAttribute(track.title)}"`
      + optionalAttribute("Artist", track.artist)
      + optionalAttribute("Album", track.album)
      + optionalAttribute("Genre", track.genre)
      + optionalAttribute("AverageBpm", track.bpm_milli === null ? null : track.bpm_milli / 1_000)
      + optionalAttribute("Tonality", track.musical_key)
      + optionalAttribute("TotalTime", track.duration_ms === null ? null : Math.round(track.duration_ms / 1_000))
      + ` Location="${xmlAttribute(pathToFileURL(mediaPath).href)}"/>`,
    );
  }
  const playlist = (name: string, fixtureId: string) => {
    const ids = document.tracks
      .filter((track) => track.playlist_ids.includes(fixtureId))
      .map((track) => `<TRACK KeyType="TrackID" Key="${xmlAttribute(track.external_id)}"/>`)
      .join("");
    return `    <NODE Type="1" Name="${name}" Entries="${document.tracks.filter((track) => track.playlist_ids.includes(fixtureId)).length}">${ids}</NODE>`;
  };
  await writeFile(
    xmlPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="7.0.0"/>
  <COLLECTION Entries="${document.tracks.length}">
${trackXml.join("\n")}
  </COLLECTION>
  <PLAYLISTS>
${playlist("M3 Main", document.playlists.main)}
${playlist("M3 Alternate", document.playlists.alternate)}
  </PLAYLISTS>
</DJ_PLAYLISTS>
`,
    "utf8",
  );
  hashedPaths.push(xmlPath);
  return { document, xmlPath, hashedPaths };
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function hashes(paths: string[]): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await sha256(path)])));
}

async function waitForCore(application: ElectronApplication): Promise<void> {
  await expect.poll(() => application.evaluate(() => {
    const hook = Reflect.get(globalThis, "__DJ_COPILOT_TEST_HOOK__") as { getStatus(): { state: string } };
    return hook.getStatus().state;
  }), { timeout: 10_000 }).toBe("ready");
}

async function launch(pythonExecutable: string, userDataPath: string): Promise<ElectronApplication> {
  const application = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataPath}`],
    env: electronTestEnvironment(pythonExecutable),
  });
  await application.firstWindow();
  await waitForCore(application);
  return application;
}

async function applySignalFilters(page: Page): Promise<void> {
  const filters = page.getByRole("region", { name: "Library filters" });
  await filters.getByRole("searchbox", { name: "Search library" }).fill("signal");
  await filters.getByRole("spinbutton", { name: "Minimum BPM" }).fill("115");
  await filters.getByRole("spinbutton", { name: "Maximum BPM" }).fill("135");
  await filters.getByRole("button", { name: "Apply filters" }).click();
  const explore = page.getByRole("button", { name: /^Explore /u });
  await expect(explore).toHaveCount(2);
  await expect(explore.nth(0)).toHaveAccessibleName("Explore Ascent Signal");
  await expect(explore.nth(1)).toHaveAccessibleName("Explore Descent Signal");
}

test.beforeAll(async () => {
  await execFileAsync("pnpm", ["build"], { cwd: desktopDirectory });
});

test("searches, explores, and ranks the generated M3 library through the production desktop boundary", async () => {
  test.setTimeout(90_000);
  const pythonExecutable = await compatiblePython();
  const temporaryRoot = await mkdtemp(join(tmpdir(), "dj-copilot-discovery-e2e-"));
  const userDataPath = join(temporaryRoot, "user-data");
  const { document, xmlPath, hashedPaths } = await prepareFixture(temporaryRoot);
  const hashesBefore = await hashes(hashedPaths);
  let application: ElectronApplication | undefined;
  try {
    application = await launch(pythonExecutable, userDataPath);
    let page = await application.firstWindow();
    await application.evaluate(({ dialog }, selectedPath: string) => {
      const dialogStub = dialog as unknown as {
        showOpenDialog: (window: unknown, options: unknown) => Promise<unknown>;
      };
      dialogStub.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
    }, xmlPath);
    await page.getByRole("button", { name: "Import Rekordbox XML" }).click();
    await expect(page.getByText(`${document.tracks.length} tracks imported and 2 playlists.`)).toBeVisible();
    await application.close();
    application = undefined;

    const { stdout } = await execFileAsync(
      pythonExecutable,
      [fixtureSeeder, "--database", join(userDataPath, "dj-copilot.sqlite3"), "--fixture", discoveryFixture],
      { cwd: repositoryRoot },
    );
    expect(stdout.trim()).toBe("Seeded M3 discovery fixture: 5 analyzed, 1 failed.");

    application = await launch(pythonExecutable, userDataPath);
    page = await application.firstWindow();
    await expect(page.getByRole("region", { name: "Library filters" })).toBeVisible();
    await page.getByRole("treeitem", { name: /M3 Main/u }).click();
    await applySignalFilters(page);

    await page.getByRole("region", { name: "Library filters" })
      .getByRole("button", { name: "Clear filters" }).click();
    await page.getByRole("treeitem", { name: /All Tracks/u }).click();
    await page.getByRole("button", { name: "Explore Neon Harbor" }).click();
    const similar = await page.getByRole("list", { name: "Similar candidates" });
    await expect(similar.getByRole("heading", { level: 3 }).first()).toHaveText("Double Echo");
    await expect(page.getByRole("heading", { name: "Explore Neon Harbor" })).toBeVisible();

    await page.getByRole("tab", { name: "Next" }).click();
    await page.getByRole("combobox", { name: "Transition intent" }).selectOption("genre_shift");
    const next = page.getByRole("list", { name: "Next-track candidates" });
    await expect(next.getByRole("heading", { level: 3 }).first()).toHaveText("Élan Bridge");
    for (const summary of await next.locator("details > summary").all()) await summary.click();
    await expect(next.getByText("Bonus").first()).toBeVisible();
    await expect(next.getByText("Penalty").first()).toBeVisible();
    await expect(next.getByText("Missing evidence").first()).toBeVisible();

    await page.reload();
    await page.getByRole("treeitem", { name: /M3 Main/u }).click();
    await applySignalFilters(page);

    const hashesAfter = await hashes(hashedPaths);
    expect(hashesAfter).toEqual(hashesBefore);
    const runtimeDirectory = await application.evaluate(() => {
      const hook = Reflect.get(globalThis, "__DJ_COPILOT_TEST_HOOK__") as { getRuntimeDirectory(): string };
      return hook.getRuntimeDirectory();
    });
    await application.close();
    application = undefined;
    await expect(access(runtimeDirectory)).rejects.toThrow();
    console.log(`M3_E2E_EVIDENCE ${JSON.stringify({
      importedTracks: document.tracks.length,
      searchedPlaylist: "M3 Main",
      similarTop: "Double Echo",
      genreShiftTop: "Élan Bridge",
      explanations: ["bonus", "penalty", "missing"],
      persistedAfterReload: true,
      hashes: hashesAfter,
      runtimeDirectoryCleaned: true,
    })}`);
  } finally {
    await application?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
