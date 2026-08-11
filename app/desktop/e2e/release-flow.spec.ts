import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import type {
  AnalysisQueueStatus,
  AssistantEvent,
  DesktopApi,
  DiagnosticsSnapshot,
  SetDraftSnapshot,
  TrackListItem,
} from "../src/shared/contracts";

const desktopDirectory = process.cwd();
const repositoryRoot = resolve(desktopDirectory, "../..");
const packagedApplication = join(
  repositoryRoot,
  "out",
  "DJ Copilot-darwin-arm64",
  "DJ Copilot.app",
);
const packagedExecutable = join(
  packagedApplication,
  "Contents",
  "MacOS",
  "DJ Copilot",
);

const fixtureTracks = [
  { externalId: "7101", title: "M7 Clicks", artist: "Generated Fixture", fileName: "clicks.wav", bpm: 120, key: "8A" },
  { externalId: "7102", title: "M7 Harmonic", artist: "Generated Fixture", fileName: "harmonic.wav", bpm: 122, key: "8B" },
  { externalId: "7103", title: "M7 Silence", artist: "Generated Fixture", fileName: "silence.wav", bpm: 124, key: "9A" },
  { externalId: "7104", title: "M7 Corrupt", artist: "Generated Fixture", fileName: "corrupt.wav", bpm: 126, key: "9B" },
] as const;

interface GeneratedFixture {
  xmlPath: string;
  sourcePaths: string[];
  hashes: Record<string, string>;
}

declare global {
  interface Window {
    djCopilot: DesktopApi;
  }
}

async function packagedApplicationExists(): Promise<boolean> {
  try {
    await access(packagedApplication);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function packagedEnvironment(): Record<string, string> {
  const source = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const {
    VITE_DEV_SERVER_URL: _devRenderer,
    DJ_COPILOT_PYTHON: _python,
    DJ_COPILOT_FFMPEG: _ffmpeg,
    DJ_COPILOT_FFPROBE: _ffprobe,
    DJ_COPILOT_TEST_XML: _testXml,
    DJ_COPILOT_ASSISTANT_PROVIDER: _assistantProvider,
    PYTHONPATH: _pythonPath,
    NODE_PATH: _nodePath,
    ELECTRON_RUN_AS_NODE: _electronRunAsNode,
    ...environment
  } = source;
  return {
    ...environment,
    PATH: "/usr/bin:/bin",
    DJ_COPILOT_TEST_MODE: "1",
    DJ_COPILOT_ASSISTANT_PROVIDER: "mock",
  };
}

function pcmWave(samples: Int16Array, sampleRate = 48_000): Buffer {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36 + samples.length * 2, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index += 1) {
    bytes.writeInt16LE(samples[index]!, 44 + index * 2);
  }
  return bytes;
}

function clickSignal(): Int16Array {
  const sampleRate = 48_000;
  const samples = new Int16Array(sampleRate * 16);
  const firstClick = Math.round(sampleRate * 0.25);
  const interval = Math.round(sampleRate * 0.5);
  const duration = Math.round(sampleRate * 0.01);
  for (let click = 0; click < 32; click += 1) {
    const start = firstClick + click * interval;
    const amplitude = click < 16 ? 8_192 : 16_384;
    samples.fill(amplitude, start, Math.min(start + duration, samples.length));
  }
  return samples;
}

function harmonicSignal(): Int16Array {
  const sampleRate = 48_000;
  const samples = new Int16Array(sampleRate * 16);
  const frequencies = [261.625565, 293.664768, 329.627557, 349.228231, 391.995436, 440, 493.883301];
  const amplitudes = [0.09, 0.04, 0.07, 0.05, 0.08, 0.05, 0.04];
  const firstClick = Math.round(sampleRate * 0.25);
  const clickInterval = Math.round(sampleRate * 0.5);
  const clickDuration = Math.round(sampleRate * 0.01);
  for (let frame = 0; frame < samples.length; frame += 1) {
    const gain = frame < samples.length / 2 ? 0.45 : 0.85;
    let value = 0;
    for (let partial = 0; partial < frequencies.length; partial += 1) {
      value += amplitudes[partial]! * Math.sin(2 * Math.PI * frequencies[partial]! * frame / sampleRate);
    }
    value *= gain;
    const relative = frame - firstClick;
    if (relative >= 0 && Math.floor(relative / clickInterval) < 32) {
      const clickFrame = relative % clickInterval;
      if (clickFrame < clickDuration) {
        const pulseGain = frame < samples.length / 2 ? 0.18 : 0.28;
        value += pulseGain
          * Math.exp(-clickFrame / (0.002 * sampleRate))
          * Math.sin(2 * Math.PI * 4_000 * clickFrame / sampleRate);
      }
    }
    samples[frame] = Math.max(-32_768, Math.min(32_767, Math.round(32_767 * value)));
  }
  return samples;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function fileHashes(paths: readonly string[]): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [
    path,
    createHash("sha256").update(await readFile(path)).digest("hex"),
  ])));
}

async function createGeneratedFixture(root: string): Promise<GeneratedFixture> {
  const mediaDirectory = join(root, "Generated Audio With Spaces");
  await mkdir(mediaDirectory, { recursive: true });
  await writeFile(join(mediaDirectory, "clicks.wav"), pcmWave(clickSignal()));
  await writeFile(join(mediaDirectory, "harmonic.wav"), pcmWave(harmonicSignal()));
  await writeFile(join(mediaDirectory, "silence.wav"), pcmWave(new Int16Array(48_000 * 2)));
  await writeFile(join(mediaDirectory, "corrupt.wav"), Buffer.from("RIFF\0\0\0", "binary"));

  const xmlPath = join(root, "M7 Generated Library.xml");
  const trackXml = fixtureTracks.map((track, index) => (
    `    <TRACK TrackID="${track.externalId}" Name="${track.title}" Artist="${track.artist}" Genre="House" AverageBpm="${track.bpm}" Tonality="${track.key}" TotalTime="${180 + index}" Location="${xmlEscape(pathToFileURL(join(mediaDirectory, track.fileName)).href)}"/>`
  )).join("\n");
  const playlistEntries = fixtureTracks
    .map((track) => `<TRACK KeyType="TrackID" Key="${track.externalId}"/>`)
    .join("");
  await writeFile(xmlPath, `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="7.0.0"/>
  <COLLECTION Entries="${fixtureTracks.length}">
${trackXml}
  </COLLECTION>
  <PLAYLISTS><NODE Type="0" Name="ROOT" Count="1"><NODE Type="1" Name="M7 Generated" Entries="${fixtureTracks.length}">${playlistEntries}</NODE></NODE></PLAYLISTS>
</DJ_PLAYLISTS>
`, "utf8");
  const sourcePaths = [xmlPath, ...fixtureTracks.map((track) => join(mediaDirectory, track.fileName))];
  return { xmlPath, sourcePaths, hashes: await fileHashes(sourcePaths) };
}

async function waitForCore(application: ElectronApplication): Promise<void> {
  await expect.poll(() => application.evaluate(() => {
    const hook = Reflect.get(globalThis, "__DJ_COPILOT_TEST_HOOK__") as { getStatus(): { state: string } } | undefined;
    if (hook === undefined) throw new Error("Packaged core test hook is unavailable");
    return hook.getStatus().state;
  }), { timeout: 30_000, intervals: [100, 250, 500] }).toBe("ready");
}

async function launchPackaged(userDataPath: string): Promise<ElectronApplication> {
  const application = await electron.launch({
    executablePath: packagedExecutable,
    args: [`--user-data-dir=${userDataPath}`],
    env: packagedEnvironment(),
  });
  await application.firstWindow();
  await waitForCore(application);
  return application;
}

async function stubNativeDialogs(
  application: ElectronApplication,
  openPath: string,
  savePaths: readonly string[],
): Promise<void> {
  await application.evaluate(({ dialog }, values: { openPath: string; savePaths: string[] }) => {
    const queue = [...values.savePaths];
    const nativeDialog = dialog as unknown as {
      showOpenDialog: unknown;
      showSaveDialog: unknown;
    };
    nativeDialog.showOpenDialog = async () => ({ canceled: false, filePaths: [values.openPath] });
    nativeDialog.showSaveDialog = async () => {
      const filePath = queue.shift();
      if (filePath === undefined) throw new Error("Unexpected packaged save dialog");
      return { canceled: false, filePath };
    };
  }, { openPath, savePaths: [...savePaths] });
}

async function runtimeDirectory(application: ElectronApplication): Promise<string> {
  return application.evaluate(() => {
    const hook = Reflect.get(globalThis, "__DJ_COPILOT_TEST_HOOK__") as { getRuntimeDirectory(): string } | undefined;
    if (hook === undefined) throw new Error("Packaged runtime test hook is unavailable");
    return hook.getRuntimeDirectory();
  });
}

async function currentTracks(page: Page): Promise<TrackListItem[]> {
  return page.evaluate(async () => (await window.djCopilot.library.listTracks({ limit: 200 })).items);
}

async function completedAnalysis(page: Page, trackIds: string[]): Promise<AnalysisQueueStatus> {
  await expect.poll(async () => {
    const status = await page.evaluate(async (ids) => window.djCopilot.analysis.getStatus(ids), trackIds);
    return `${status.queued}:${status.running}:${status.paused}:${status.succeeded}:${status.failed}`;
  }, {
    message: "bundled FFmpeg/ffprobe and the PyInstaller core should finish every generated track",
    timeout: 120_000,
    intervals: [100, 250, 500, 1_000],
  }).toBe("0:0:0:3:1");
  return page.evaluate(async (ids) => window.djCopilot.analysis.getStatus(ids), trackIds);
}

async function completeAssistantRequest(page: Page, requestId: string): Promise<AssistantEvent[]> {
  await expect.poll(async () => (
    await page.evaluate(async (id) => window.djCopilot.assistant.poll(id, 0), requestId)
  ).terminal, {
    message: "the packaged mock Copilot proposal should reach a terminal event",
    timeout: 10_000,
    intervals: [50, 100, 250],
  }).toBe(true);
  return page.evaluate(async (id) => (
    await window.djCopilot.assistant.poll(id, 0)
  ).events, requestId);
}

test("runs the generated personal-release workflow from the packaged executable without ambient helpers", async () => {
  test.setTimeout(240_000);
  test.skip(
    !(await packagedApplicationExists()),
    "The packaged DJ Copilot.app has not been built yet.",
  );

  expect((await stat(packagedApplication)).isDirectory()).toBe(true);
  await expect(access(packagedExecutable, constants.X_OK)).resolves.toBeUndefined();
  expect(packagedExecutable).toContain("DJ Copilot.app");

  const root = await mkdtemp(join(tmpdir(), "DJ Copilot M7 Release Gate "));
  const userDataPath = join(root, "User Data With Spaces");
  const setExportPath = join(root, "M7 Packaged Set.xml");
  const diagnosticsPath = join(root, "M7 Redacted Diagnostics.json");
  const backupPath = join(root, "M7 Database Backup.sqlite3");
  expect(userDataPath).toContain(" ");
  const fixture = await createGeneratedFixture(root);
  let application: ElectronApplication | undefined;

  try {
    application = await launchPackaged(userDataPath);
    await stubNativeDialogs(application, fixture.xmlPath, [
      setExportPath,
      diagnosticsPath,
      backupPath,
    ]);
    let page = await application.firstWindow();
    expect(new URL(page.url()).protocol).toBe("file:");
    await expect(application.evaluate(({ app }) => app.isPackaged)).resolves.toBe(true);

    const imported = await page.evaluate(async () => window.djCopilot.library.importXml());
    expect(imported).toMatchObject({
      success: true,
      summary: { importedTracks: fixtureTracks.length, unavailableTracks: 0 },
    });
    const tracks = await currentTracks(page);
    expect(tracks.map((track) => track.title).sort()).toEqual(
      fixtureTracks.map((track) => track.title).sort(),
    );
    const trackByTitle = new Map(tracks.map((track) => [track.title, track]));
    const trackIds = tracks.map((track) => track.id);

    await page.evaluate(async (ids) => window.djCopilot.analysis.queue(ids), trackIds);
    const analysis = await completedAnalysis(page, trackIds);
    const analysisById = new Map(analysis.items.map((item) => [item.trackId, item]));
    const corrupt = trackByTitle.get("M7 Corrupt");
    if (corrupt === undefined) throw new Error("Generated corrupt track is missing");
    expect(analysisById.get(corrupt.id)).toMatchObject({
      status: "failed",
      features: null,
    });
    for (const title of ["M7 Clicks", "M7 Harmonic", "M7 Silence"]) {
      const track = trackByTitle.get(title);
      if (track === undefined) throw new Error(`Generated track is missing: ${title}`);
      expect(analysisById.get(track.id)?.status).toBe("succeeded");
      expect(analysisById.get(track.id)?.features).not.toBeNull();
    }

    const harmonic = trackByTitle.get("M7 Harmonic");
    const clicks = trackByTitle.get("M7 Clicks");
    if (harmonic === undefined || clicks === undefined) throw new Error("Generated discovery seeds are missing");
    const discovery = await page.evaluate(async ({ seedTrackId }) => ({
      similar: await window.djCopilot.discovery.findSimilar({ seedTrackId, filters: { genre: "House" }, limit: 10 }),
      next: await window.djCopilot.discovery.recommendNext({ seedTrackId, intent: "smooth", limit: 10 }),
    }), { seedTrackId: harmonic.id });
    expect(discovery.similar.items.length).toBeGreaterThan(0);
    expect(discovery.next.items.length).toBeGreaterThan(0);
    const currentIds = new Set(trackIds);
    for (const candidate of [...discovery.similar.items, ...discovery.next.items]) {
      expect(currentIds.has(candidate.track.id)).toBe(true);
      expect(candidate.track.id).not.toBe(harmonic.id);
    }

    const personal = await page.evaluate(async (trackId) => {
      const metadata = await window.djCopilot.library.updateTrackMetadata({
        trackId,
        rating: 5,
        tags: ["M7 packaged"],
        note: "Packaged persistence note",
      });
      const feedback = await window.djCopilot.preferences.recordFeedback({ type: "liked", trackId });
      return { metadata, profile: feedback.profile };
    }, clicks.id);
    expect(personal.metadata).toMatchObject({ rating: 5, tags: ["M7 packaged"] });
    expect(personal.profile.eventCounts.liked).toBe(1);

    const assistantStatus = await page.evaluate(async () => window.djCopilot.assistant.getStatus());
    expect(assistantStatus).toMatchObject({ state: "ready", auth: "chatgpt", sdkVersion: "0.147.0" });
    const setCountBeforeProposal = await page.evaluate(async () => (await window.djCopilot.sets.list()).items.length);
    expect(setCountBeforeProposal).toBe(0);
    const request = await page.evaluate(async () => window.djCopilot.assistant.start({
      kind: "plan",
      prompt: "Plan a smooth five-track set",
    }));
    const assistantEvents = await completeAssistantRequest(page, request.requestId);
    const proposalEvent = assistantEvents.find((event): event is Extract<AssistantEvent, { type: "proposal" }> => (
      event.type === "proposal" && event.proposal.kind === "plan"
    ));
    if (proposalEvent === undefined) throw new Error("Packaged mock Copilot did not produce its bounded plan proposal");
    expect(await page.evaluate(async () => (await window.djCopilot.sets.list()).items.length)).toBe(0);
    const confirmation = await page.evaluate(async ({ requestId, proposalId }) => (
      window.djCopilot.assistant.confirm(requestId, proposalId)
    ), { requestId: request.requestId, proposalId: proposalEvent.proposal.proposalId });
    expect(confirmation.status).toBe("created");
    if (confirmation.status !== "created") throw new Error("Packaged mock Copilot proposal was not created");
    const draft: SetDraftSnapshot = confirmation.snapshot;
    expect(draft.entries.length).toBeGreaterThan(0);

    const inspected = await page.evaluate(async (draftId) => window.djCopilot.sets.inspect({ kind: "draft", draftId }), draft.draftId);
    expect(inspected.inspectedPositionCount).toBe(draft.entries.length);
    const preparedExport = await page.evaluate(async ({ draftId, expectedRevision }) => (
      window.djCopilot.exports.prepare({ draftId, expectedRevision })
    ), { draftId: draft.draftId, expectedRevision: draft.currentRevision });
    expect(preparedExport.status).toBe("ready");
    if (preparedExport.status !== "ready") throw new Error("Packaged set export was not ready");
    const exportedSet = await page.evaluate(async (confirmationId) => (
      window.djCopilot.exports.confirm({ confirmationId })
    ), preparedExport.confirmationId);
    expect(exportedSet).toMatchObject({ status: "exported", format: "rekordbox_xml_1_0_0" });

    const snapshot: DiagnosticsSnapshot = await page.evaluate(async () => window.djCopilot.diagnostics.getSnapshot());
    expect(snapshot).toMatchObject({
      appVersion: "0.1.0",
      electronVersion: "43.3.0",
      architecture: "arm64",
      releaseMode: "personal_arm64",
      schemaVersion: 4,
      databaseIntegrity: "ok",
      resources: {
        core: { status: "available", version: "0.1.0", source: "bundled" },
        ffmpeg: { status: "available", version: "8.1.2", source: "bundled" },
        ffprobe: { status: "available", version: "8.1.2", source: "bundled" },
        codex: { status: "available", version: "0.147.0", source: "bundled" },
      },
    });
    const diagnosticsExport = await page.evaluate(async () => window.djCopilot.diagnostics.exportBundle());
    expect(diagnosticsExport).toMatchObject({
      status: "exported",
      fileName: "M7 Redacted Diagnostics.json",
    });
    const databaseBackup = await page.evaluate(async () => window.djCopilot.diagnostics.backupDatabase());
    expect(databaseBackup).toMatchObject({
      status: "backed_up",
      fileName: "M7 Database Backup.sqlite3",
      integrity: "ok",
      schemaVersion: 4,
    });

    const setXml = await readFile(setExportPath, "utf8");
    expect(setXml).toContain("<DJ_PLAYLISTS");
    expect(setXml).toContain("Smooth Five-Track Set");
    const exportedDiagnostics = JSON.parse(await readFile(diagnosticsPath, "utf8")) as DiagnosticsSnapshot;
    expect(exportedDiagnostics.releaseMode).toBe("personal_arm64");
    expect(exportedDiagnostics.resources).toEqual(snapshot.resources);
    const serializedDiagnostics = JSON.stringify(exportedDiagnostics);
    for (const forbidden of [root, userDataPath, fixture.xmlPath, "M7 Harmonic", "Packaged persistence note"]) {
      expect(serializedDiagnostics).not.toContain(forbidden);
    }
    expect((await stat(diagnosticsPath)).mode & 0o777).toBe(0o600);
    expect((await stat(backupPath)).mode & 0o777).toBe(0o600);
    expect((await readFile(backupPath)).subarray(0, 16).toString("binary")).toBe("SQLite format 3\0");
    expect(await fileHashes(fixture.sourcePaths)).toEqual(fixture.hashes);

    const firstRuntimeDirectory = await runtimeDirectory(application);
    await application.close();
    application = undefined;
    await expect(access(firstRuntimeDirectory)).rejects.toThrow();

    application = await launchPackaged(userDataPath);
    page = await application.firstWindow();
    const persisted = await page.evaluate(async (values: { trackId: string; allTrackIds: string[] }) => ({
      tracks: await window.djCopilot.library.listTracks({ limit: 200 }),
      metadata: await window.djCopilot.library.getTrackMetadata(values.trackId),
      profile: await window.djCopilot.preferences.getProfile(),
      sets: await window.djCopilot.sets.list(),
      analysis: await window.djCopilot.analysis.getStatus(values.allTrackIds),
    }), { trackId: clicks.id, allTrackIds: trackIds });
    expect(persisted.tracks.items).toHaveLength(fixtureTracks.length);
    expect(persisted.metadata).toMatchObject({
      rating: 5,
      tags: ["M7 packaged"],
      note: "Packaged persistence note",
    });
    expect(persisted.profile.eventCounts.liked).toBe(1);
    expect(persisted.sets.items.map((item) => item.title)).toContain("Smooth Five-Track Set");
    expect(persisted.analysis).toMatchObject({ succeeded: 3, failed: 1 });
    expect(await fileHashes(fixture.sourcePaths)).toEqual(fixture.hashes);

    const secondRuntimeDirectory = await runtimeDirectory(application);
    await application.close();
    application = undefined;
    await expect(access(secondRuntimeDirectory)).rejects.toThrow();
    expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);

    console.log(`M7_PACKAGED_E2E_EVIDENCE ${JSON.stringify({
      explicitPackagedExecutable: packagedExecutable,
      minimalPath: "/usr/bin:/bin",
      pathWithSpaces: true,
      importedTracks: fixtureTracks.length,
      analysis: { succeeded: 3, failed: 1, corruptIsolation: true },
      discovery: { similar: discovery.similar.items.length, next: discovery.next.items.length },
      mockCopilotConfirmed: true,
      setExported: true,
      personalizationPersisted: true,
      diagnosticsExported: true,
      databaseBackedUp: true,
      sourceHashesPreserved: true,
      relaunchPersistence: true,
      runtimeDirectoriesCleaned: true,
    })}`);
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
