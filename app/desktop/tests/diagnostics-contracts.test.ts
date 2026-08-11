import { describe, expect, it } from "vitest";
import {
  coreDiagnosticsSchema,
  coreRequestSchema,
  databaseBackupResultSchema,
  diagnosticsExportResultSchema,
  diagnosticsSnapshotSchema,
} from "../src/shared/contracts";

const unavailableAnalysis = {
  available: false,
  provider: "ffmpeg-numpy-basic",
  providerVersion: null,
  pipelineVersion: "baseline-v1",
  availableStages: ["metadata", "basic_features"],
  unavailableStages: ["structure", "embeddings"],
  unavailableReason: "The bundled analysis helper is unavailable.",
} as const;

describe("M7 diagnostics contracts", () => {
  it("accepts one bounded path-free diagnostics snapshot", () => {
    const snapshot = diagnosticsSnapshotSchema.parse({
      appVersion: "0.1.0",
      electronVersion: "43.3.0",
      architecture: "arm64",
      releaseMode: "personal_arm64",
      schemaVersion: 4,
      databaseIntegrity: "ok",
      analysis: unavailableAnalysis,
      resources: {
        core: { status: "available", version: "0.1.0", source: "bundled", message: null },
        ffmpeg: { status: "available", version: "8.1.2", source: "bundled", message: null },
        ffprobe: { status: "available", version: "8.1.2", source: "bundled", message: null },
        codex: { status: "available", version: "0.147.0", source: "bundled", message: null },
      },
      generatedAt: "2026-08-11T12:00:00.000Z",
      privacy: "No audio, library metadata, notes, credentials, paths, logs, or Codex response text included.",
    });
    expect(snapshot.resources.codex.version).toBe("0.147.0");
  });

  it("rejects paths and private fields in exported diagnostics", () => {
    const base = {
      appVersion: "0.1.0",
      electronVersion: "43.3.0",
      architecture: "arm64",
      releaseMode: "development",
      schemaVersion: 4,
      databaseIntegrity: "ok",
      analysis: unavailableAnalysis,
      resources: {
        core: { status: "available", version: "0.1.0", source: "development", message: null },
        ffmpeg: { status: "unavailable", version: null, source: "development", message: "Not installed." },
        ffprobe: { status: "unavailable", version: null, source: "development", message: "Not installed." },
        codex: { status: "available", version: "0.147.0", source: "development", message: null },
      },
      generatedAt: "2026-08-11T12:00:00.000Z",
      privacy: "No audio, library metadata, notes, credentials, paths, logs, or Codex response text included.",
    };
    expect(diagnosticsSnapshotSchema.safeParse({ ...base, databasePath: "/private/library.sqlite3" }).success).toBe(false);
    expect(diagnosticsSnapshotSchema.safeParse({ ...base, resources: { ...base.resources, core: { ...base.resources.core, path: "/private/core" } } }).success).toBe(false);
  });

  it("requires unavailable resources to carry a safe reason and no version", () => {
    const invalidResource = {
      status: "unavailable",
      version: "8.1.2",
      source: "bundled",
      message: null,
    };
    expect(
      diagnosticsSnapshotSchema.shape.resources.shape.ffmpeg.safeParse(invalidResource).success,
    ).toBe(false);
  });

  it("accepts only basename-only backup and diagnostics export results", () => {
    expect(databaseBackupResultSchema.parse({ status: "cancelled" })).toEqual({ status: "cancelled" });
    expect(
      databaseBackupResultSchema.safeParse({
        status: "backed_up",
        fileName: "DJ Copilot Backup.sqlite3",
        schemaVersion: 4,
        integrity: "ok",
        sizeBytes: 4096,
        createdAt: "2026-08-11T12:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      databaseBackupResultSchema.safeParse({
        status: "backed_up",
        fileName: "/private/DJ Copilot Backup.sqlite3",
        schemaVersion: 4,
        integrity: "ok",
        sizeBytes: 4096,
        createdAt: "2026-08-11T12:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      diagnosticsExportResultSchema.safeParse({
        status: "exported",
        fileName: "DJ Copilot Diagnostics.json",
        sizeBytes: 1024,
        createdAt: "2026-08-11T12:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("adds only the three private core commands needed by recovery", () => {
    expect(coreRequestSchema.safeParse({ version: 1, id: "r1", command: "rebuild_analysis", payload: { trackIds: ["track-1"] } }).success).toBe(true);
    expect(coreRequestSchema.safeParse({ version: 1, id: "r2", command: "get_diagnostics", payload: {} }).success).toBe(true);
    expect(coreRequestSchema.safeParse({ version: 1, id: "r3", command: "backup_database", payload: { destinationPath: "/tmp/backup.sqlite3" } }).success).toBe(true);
    expect(coreRequestSchema.safeParse({ version: 1, id: "r4", command: "backup_database", payload: { destinationPath: "" } }).success).toBe(false);
  });

  it("validates the private core diagnostics result independently", () => {
    expect(
      coreDiagnosticsSchema.parse({
        coreVersion: "0.1.0",
        schemaVersion: 4,
        databaseIntegrity: "ok",
        analysis: unavailableAnalysis,
      }).databaseIntegrity,
    ).toBe("ok");
  });
});
