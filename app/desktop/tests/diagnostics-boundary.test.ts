import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CoreDiagnostics, DiagnosticsSnapshot } from "../src/shared/contracts";
import {
  createDiagnosticsBoundary,
  writeDiagnosticsSnapshot,
} from "../src/main/diagnostics";

const capabilities: CoreDiagnostics["analysis"] = {
  available: true,
  provider: "ffmpeg-numpy-basic",
  providerVersion: "ffmpeg 8.1.2; ffprobe 8.1.2; numpy 2.4.4",
  pipelineVersion: "baseline-v1",
  availableStages: ["metadata", "basic_features"],
  unavailableStages: ["structure", "embeddings"],
  unavailableReason: null,
};

const coreDiagnostics: CoreDiagnostics = {
  coreVersion: "0.1.0",
  schemaVersion: 4,
  databaseIntegrity: "ok",
  analysis: capabilities,
};

const privacy = "No audio, library metadata, notes, credentials, paths, logs, or Codex response text included." as const;

describe("desktop diagnostics boundary", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("inspects only the frozen packaged resource locations and reports exact versions", async () => {
    const checkedExecutables: string[] = [];
    const probedExecutables: string[] = [];
    const packageFiles: string[] = [];
    const resourcesPath = "/Applications/DJ Copilot.app/Contents/Resources";
    const boundary = createDiagnosticsBoundary({
      releaseMode: "personal_arm64",
      resourcesPath,
      repositoryRoot: "/repo-that-must-not-be-used",
      appVersion: "0.1.0",
      electronVersion: "43.3.0",
      architecture: "arm64",
      now: () => new Date("2026-08-11T12:00:00.000Z"),
      isExecutable: async (path) => {
        checkedExecutables.push(path);
        return true;
      },
      probeVersion: async (path) => {
        probedExecutables.push(path);
        return path.endsWith("ffprobe")
          ? "ffprobe version 8.1.2 Copyright fixture"
          : "ffmpeg version 8.1.2 Copyright fixture";
      },
      realpath: async (path) => {
        if (path === `${resourcesPath}/app/node_modules/@openai/codex-sdk`) {
          return `${resourcesPath}/app/node_modules/.pnpm/@openai+codex-sdk@0.147.0/node_modules/@openai/codex-sdk`;
        }
        if (path.endsWith("/node_modules/@openai/codex")) {
          return `${resourcesPath}/app/node_modules/.pnpm/@openai+codex@0.147.0/node_modules/@openai/codex`;
        }
        return path;
      },
      readPackageMetadata: async (path) => {
        packageFiles.push(path);
        return path.includes("codex-sdk")
          ? { name: "@openai/codex-sdk", version: "0.147.0" }
          : { name: "@openai/codex", version: "0.147.0" };
      },
    });

    await expect(boundary.getSnapshot(coreDiagnostics)).resolves.toEqual({
      appVersion: "0.1.0",
      electronVersion: "43.3.0",
      architecture: "arm64",
      releaseMode: "personal_arm64",
      schemaVersion: 4,
      databaseIntegrity: "ok",
      analysis: capabilities,
      resources: {
        core: { status: "available", version: "0.1.0", source: "bundled", message: null },
        ffmpeg: { status: "available", version: "8.1.2", source: "bundled", message: null },
        ffprobe: { status: "available", version: "8.1.2", source: "bundled", message: null },
        codex: { status: "available", version: "0.147.0", source: "bundled", message: null },
      },
      generatedAt: "2026-08-11T12:00:00.000Z",
      privacy,
    });
    expect(checkedExecutables).toEqual([
      `${resourcesPath}/core/dj-copilot-core/dj-copilot-core`,
      `${resourcesPath}/bin/ffmpeg`,
      `${resourcesPath}/bin/ffprobe`,
    ]);
    expect(probedExecutables).toEqual([
      `${resourcesPath}/bin/ffmpeg`,
      `${resourcesPath}/bin/ffprobe`,
    ]);
    expect(packageFiles).toEqual([
      `${resourcesPath}/app/node_modules/.pnpm/@openai+codex-sdk@0.147.0/node_modules/@openai/codex-sdk/package.json`,
      `${resourcesPath}/app/node_modules/.pnpm/@openai+codex@0.147.0/node_modules/@openai/codex/package.json`,
    ]);
  });

  it("fails individual packaged resources closed on missing or near-match versions", async () => {
    const boundary = createDiagnosticsBoundary({
      releaseMode: "personal_arm64",
      resourcesPath: "/bundle/Resources",
      repositoryRoot: "/repo",
      appVersion: "0.1.0",
      electronVersion: "43.3.0",
      architecture: "arm64",
      now: () => new Date("2026-08-11T12:00:00.000Z"),
      isExecutable: async (path) => !path.endsWith("ffprobe"),
      probeVersion: async (path) => path.endsWith("ffmpeg")
        ? "ffmpeg version 8.1.20 Copyright fixture"
        : "ffprobe version 8.1.2 Copyright fixture",
      readPackageMetadata: async (path) => path.includes("codex-sdk")
        ? { name: "@openai/codex-sdk", version: "0.147.0" }
        : { name: "@openai/codex", version: "0.146.0" },
    });

    const snapshot = await boundary.getSnapshot(coreDiagnostics);

    expect(snapshot.resources.core.status).toBe("available");
    expect(snapshot.resources.ffmpeg).toEqual({
      status: "unavailable",
      version: null,
      source: "bundled",
      message: "Bundled FFmpeg 8.1.2 is unavailable.",
    });
    expect(snapshot.resources.ffprobe).toEqual({
      status: "unavailable",
      version: null,
      source: "bundled",
      message: "Bundled FFprobe 8.1.2 is unavailable.",
    });
    expect(snapshot.resources.codex).toEqual({
      status: "unavailable",
      version: null,
      source: "bundled",
      message: "Bundled Codex 0.147.0 is unavailable.",
    });
  });

  it("writes one mode-0600 JSON sibling and atomically replaces the destination", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dj-diagnostics-"));
    directories.push(directory);
    const destinationPath = join(directory, "DJ Copilot Diagnostics.json");
    await writeFile(destinationPath, "old partial diagnostics\n", { mode: 0o644 });
    const snapshot: DiagnosticsSnapshot = {
      appVersion: "0.1.0",
      electronVersion: "43.3.0",
      architecture: "arm64",
      releaseMode: "personal_arm64",
      schemaVersion: 4,
      databaseIntegrity: "ok",
      analysis: capabilities,
      resources: {
        core: { status: "available", version: "0.1.0", source: "bundled", message: null },
        ffmpeg: { status: "available", version: "8.1.2", source: "bundled", message: null },
        ffprobe: { status: "available", version: "8.1.2", source: "bundled", message: null },
        codex: { status: "available", version: "0.147.0", source: "bundled", message: null },
      },
      generatedAt: "2026-08-11T12:00:00.000Z",
      privacy,
    };

    const result = await writeDiagnosticsSnapshot(destinationPath, snapshot, {
      temporaryId: () => "fixed-id",
    });

    const bytes = await readFile(destinationPath);
    expect(JSON.parse(bytes.toString("utf8"))).toEqual(snapshot);
    expect(result).toEqual({
      sizeBytes: bytes.byteLength,
      createdAt: "2026-08-11T12:00:00.000Z",
    });
    expect((await stat(destinationPath)).mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(["DJ Copilot Diagnostics.json"]);
  });

  it("leaves an existing destination intact and removes its private temporary file when rename fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dj-diagnostics-"));
    directories.push(directory);
    const destinationPath = join(directory, "diagnostics.json");
    await writeFile(destinationPath, "existing\n");
    const boundary = createDiagnosticsBoundary({
      releaseMode: "development",
      repositoryRoot: "/repo",
      appVersion: "0.1.0",
      electronVersion: "43.3.0",
      architecture: "arm64",
      now: () => new Date("2026-08-11T12:00:00.000Z"),
      isExecutable: async () => true,
      probeVersion: async (path) => path.endsWith("ffprobe")
        ? "ffprobe version 8.1.2 fixture"
        : "ffmpeg version 8.1.2 fixture",
      readPackageMetadata: async (path) => path.includes("codex-sdk")
        ? { name: "@openai/codex-sdk", version: "0.147.0" }
        : { name: "@openai/codex", version: "0.147.0" },
    });
    const snapshot = await boundary.getSnapshot(coreDiagnostics);

    await expect(writeDiagnosticsSnapshot(destinationPath, snapshot, {
      temporaryId: () => "failed-id",
      renameFile: async () => { throw new Error("injected rename failure"); },
    })).rejects.toThrow("injected rename failure");

    expect(await readFile(destinationPath, "utf8")).toBe("existing\n");
    expect(await readdir(directory)).toEqual(["diagnostics.json"]);
  });
});
