import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPreferenceExportCoordinator,
  type PreferenceExportFileSystem,
} from "../src/main/preference-export";

const snapshot = {
  format: "dj-copilot-preferences-v1",
  algorithmVersion: "preference-linear-v1",
  revision: "a".repeat(64),
  status: "learning",
  totalPersonalDataCount: 1,
  effectiveEvidenceCount: 1,
  minimumEvidenceCount: 5,
  preferenceWeightPpm: 0,
  ratingCount: 0,
  eventCounts: {
    liked: 1, disliked: 0, accepted: 0, rejected: 0, skipped: 0,
    manualReplacement: 0, manualReorder: 0, pinned: 0, removed: 0, banned: 0,
  },
  trackAffinities: [{ trackId: "track-1", scorePpm: 1_000_000, evidenceCount: 1 }],
  trackAffinitiesTruncated: false,
  genreAffinities: [{ genre: "house", scorePpm: 1_000_000, evidenceCount: 1 }],
  genreAffinitiesTruncated: false,
} as const;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dj-copilot-preference-export-"));
  temporaryDirectories.push(directory);
  return directory;
}

const diskFileSystem: PreferenceExportFileSystem = {
  realpath,
  lstat,
  open: async (path, flags, mode) => open(path, flags, mode),
  readFile,
  rename,
  unlink,
};

describe("preference export", () => {
  it("prepares a path-free token and atomically writes strict mode-0600 JSON exactly once", async () => {
    const directory = await temporaryDirectory();
    const destinationPath = join(directory, "my-preferences.json");
    const fetchSnapshot = vi.fn(async () => snapshot);
    const coordinator = createPreferenceExportCoordinator({
      showSaveDialog: async () => ({ canceled: false, filePath: destinationPath }),
      fetchSnapshot,
      now: () => 1_000,
      createConfirmationId: () => "confirmation-1",
      createTempId: () => "temp-1",
    });

    const prepared = await coordinator.prepare();
    expect(prepared).toEqual({
      status: "ready",
      confirmationId: "confirmation-1",
      destinationDisplay: "my-preferences.json",
      willReplaceExisting: false,
      effectiveEvidenceCount: 1,
      profileStatus: "learning",
    });
    expect(JSON.stringify(prepared)).not.toContain(directory);

    await expect(coordinator.confirm("confirmation-1")).resolves.toEqual({
      status: "exported",
      overwritten: false,
      format: "dj-copilot-preferences-v1",
      destinationState: "replaced",
    });
    expect(JSON.parse(await readFile(destinationPath, "utf8"))).toEqual(snapshot);
    expect((await stat(destinationPath)).mode & 0o777).toBe(0o600);
    expect((await readdir(directory)).filter((name) => name.includes(".tmp"))).toEqual([]);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    await expect(coordinator.confirm("confirmation-1")).resolves.toMatchObject({
      status: "blocked",
      destinationState: "unchanged",
      reasons: [{ code: "invalid_confirmation" }],
    });
  });

  it("discloses overwrite and blocks relative, non-JSON, directory, and symlink destinations", async () => {
    const directory = await temporaryDirectory();
    const existingPath = join(directory, "existing.json");
    await writeFile(existingPath, "old", "utf8");
    const existing = createPreferenceExportCoordinator({
      showSaveDialog: async () => ({ canceled: false, filePath: existingPath }),
      fetchSnapshot: async () => snapshot,
      createConfirmationId: () => "overwrite-confirmation",
      createTempId: () => "overwrite-temp",
    });

    await expect(existing.prepare()).resolves.toMatchObject({
      status: "ready",
      destinationDisplay: "existing.json",
      willReplaceExisting: true,
    });
    await expect(existing.confirm("overwrite-confirmation")).resolves.toMatchObject({
      status: "exported",
      overwritten: true,
    });
    expect(JSON.parse(await readFile(existingPath, "utf8"))).toEqual(snapshot);
    expect((await stat(existingPath)).mode & 0o777).toBe(0o600);

    const directoryDestination = join(directory, "folder.json");
    await mkdir(directoryDestination);
    const symlinkDestination = join(directory, "link.json");
    await symlink(existingPath, symlinkDestination);
    for (const selectedPath of [
      "relative.json",
      join(directory, "preferences.txt"),
      directoryDestination,
      symlinkDestination,
    ]) {
      const coordinator = createPreferenceExportCoordinator({
        showSaveDialog: async () => ({ canceled: false, filePath: selectedPath }),
        fetchSnapshot: async () => snapshot,
      });
      await expect(coordinator.prepare()).resolves.toMatchObject({
        status: "blocked",
        reasons: [{ code: "invalid_destination" }],
      });
    }
  });

  it("expires tokens and consumes them on profile or destination races without changing the destination", async () => {
    const directory = await temporaryDirectory();
    const destinationPath = join(directory, "preferences.json");
    let now = 0;
    let currentSnapshot = snapshot;
    let nextConfirmation = 0;
    const coordinator = createPreferenceExportCoordinator({
      showSaveDialog: async () => ({ canceled: false, filePath: destinationPath }),
      fetchSnapshot: async () => currentSnapshot,
      now: () => now,
      createConfirmationId: () => `confirmation-${++nextConfirmation}`,
      createTempId: () => "temp",
    });

    await coordinator.prepare();
    now = 600_001;
    await expect(coordinator.confirm("confirmation-1")).resolves.toMatchObject({
      status: "blocked",
      reasons: [{ code: "invalid_confirmation" }],
      destinationState: "unchanged",
    });

    await coordinator.prepare();
    currentSnapshot = { ...snapshot, revision: "b".repeat(64) };
    await expect(coordinator.confirm("confirmation-2")).resolves.toMatchObject({
      status: "blocked",
      reasons: [{ code: "profile_changed" }],
      destinationState: "unchanged",
    });
    await expect(coordinator.confirm("confirmation-2")).resolves.toMatchObject({
      reasons: [{ code: "invalid_confirmation" }],
    });

    currentSnapshot = snapshot;
    await coordinator.prepare();
    await writeFile(destinationPath, "external change", "utf8");
    await expect(coordinator.confirm("confirmation-3")).resolves.toMatchObject({
      status: "blocked",
      reasons: [{ code: "destination_changed" }],
      destinationState: "unchanged",
    });
    expect(await readFile(destinationPath, "utf8")).toBe("external change");
  });

  it("strictly reparses the temporary JSON, cleans it on failure, and leaves the destination unchanged", async () => {
    const directory = await temporaryDirectory();
    const destinationPath = join(directory, "preferences.json");
    const fileSystem: PreferenceExportFileSystem = {
      ...diskFileSystem,
      readFile: async () => JSON.stringify({ ...snapshot, sourcePath: "/private/music.wav" }),
    };
    const coordinator = createPreferenceExportCoordinator({
      showSaveDialog: async () => ({ canceled: false, filePath: destinationPath }),
      fetchSnapshot: async () => snapshot,
      createConfirmationId: () => "confirmation-corrupt",
      createTempId: () => "corrupt-temp",
      fileSystem,
    });

    await coordinator.prepare();
    await expect(coordinator.confirm("confirmation-corrupt")).resolves.toMatchObject({
      status: "blocked",
      reasons: [{ code: "export_failed" }],
      destinationState: "unchanged",
    });
    await expect(lstat(destinationPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(directory)).toEqual([]);
  });

  it("rechecks destination state immediately before replace and reports a rename uncertainty honestly", async () => {
    const directory = await temporaryDirectory();
    const racedDestination = join(directory, "raced.json");
    let lstatCalls = 0;
    const racingFileSystem: PreferenceExportFileSystem = {
      ...diskFileSystem,
      lstat: async (path) => {
        lstatCalls += 1;
        if (lstatCalls < 3) return lstat(path);
        return { isFile: () => true, isSymbolicLink: () => false };
      },
    };
    const racing = createPreferenceExportCoordinator({
      showSaveDialog: async () => ({ canceled: false, filePath: racedDestination }),
      fetchSnapshot: async () => snapshot,
      createConfirmationId: () => "confirmation-race",
      createTempId: () => "race-temp",
      fileSystem: racingFileSystem,
    });
    await racing.prepare();
    await expect(racing.confirm("confirmation-race")).resolves.toMatchObject({
      status: "blocked",
      reasons: [{ code: "destination_changed" }],
      destinationState: "unchanged",
    });
    await expect(lstat(racedDestination)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(directory)).toEqual([]);

    const uncertainDestination = join(directory, "uncertain.json");
    const uncertainFileSystem: PreferenceExportFileSystem = {
      ...diskFileSystem,
      rename: async (sourcePath, destinationPath) => {
        await rename(sourcePath, destinationPath);
        throw new Error("connection lost after rename");
      },
    };
    const uncertain = createPreferenceExportCoordinator({
      showSaveDialog: async () => ({ canceled: false, filePath: uncertainDestination }),
      fetchSnapshot: async () => snapshot,
      createConfirmationId: () => "confirmation-uncertain",
      createTempId: () => "uncertain-temp",
      fileSystem: uncertainFileSystem,
    });
    await uncertain.prepare();
    await expect(uncertain.confirm("confirmation-uncertain")).resolves.toMatchObject({
      status: "blocked",
      reasons: [{ code: "export_outcome_unknown" }],
      destinationState: "unknown",
    });
    expect(JSON.parse(await readFile(uncertainDestination, "utf8"))).toEqual(snapshot);
    expect((await readdir(directory)).filter((name) => name.includes(".tmp"))).toEqual([]);
  });
});
