import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  AnalysisQueueStatus,
  DesktopApi,
  DiagnosticsSnapshot,
} from "../src/shared/contracts";
import { DiagnosticsPanel } from "../src/renderer/src/features/library/DiagnosticsPanel";

const analysisStatus: AnalysisQueueStatus = {
  state: "running",
  queued: 1,
  running: 1,
  paused: 0,
  succeeded: 0,
  failed: 0,
  progressPpm: 0,
  capabilities: {
    available: true,
    provider: "ffmpeg-numpy-basic",
    providerVersion: "ffmpeg 8.1.2; ffprobe 8.1.2; numpy 2.4.4",
    pipelineVersion: "baseline-v1",
    availableStages: ["metadata", "basic_features"],
    unavailableStages: ["structure", "embeddings"],
    unavailableReason: null,
  },
  items: [],
};

const snapshot: DiagnosticsSnapshot = {
  appVersion: "0.1.0",
  electronVersion: "43.3.0",
  architecture: "arm64",
  releaseMode: "personal_arm64",
  schemaVersion: 4,
  databaseIntegrity: "ok",
  analysis: analysisStatus.capabilities,
  resources: {
    core: { status: "available", version: "0.1.0", source: "bundled", message: null },
    ffmpeg: { status: "available", version: "8.1.2", source: "bundled", message: null },
    ffprobe: { status: "available", version: "8.1.2", source: "bundled", message: null },
    codex: { status: "unavailable", version: null, source: "bundled", message: "Codex binary is unavailable" },
  },
  generatedAt: "2026-08-11T12:00:00.000Z",
  privacy: "No audio, library metadata, notes, credentials, paths, logs, or Codex response text included.",
};

function createApi(): Pick<DesktopApi, "analysis" | "diagnostics"> {
  return {
    analysis: {
      queue: vi.fn().mockResolvedValue(analysisStatus),
      getStatus: vi.fn().mockResolvedValue(analysisStatus),
      pause: vi.fn().mockResolvedValue(analysisStatus),
      resume: vi.fn().mockResolvedValue(analysisStatus),
      rebuild: vi.fn().mockResolvedValue(analysisStatus),
    },
    diagnostics: {
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      backupDatabase: vi.fn().mockResolvedValue({
        status: "backed_up",
        schemaVersion: 4,
        integrity: "ok",
        sizeBytes: 4096,
        createdAt: "2026-08-11T12:01:00.000Z",
        fileName: "DJ Copilot Backup.sqlite3",
      }),
      exportBundle: vi.fn().mockResolvedValue({
        status: "exported",
        fileName: "DJ Copilot Diagnostics.json",
        sizeBytes: 2048,
        createdAt: "2026-08-11T12:02:00.000Z",
      }),
      showDataFolder: vi.fn().mockResolvedValue({ opened: true }),
    },
  };
}

function renderPanel(api = createApi(), selectedTrackIds: string[] = []) {
  const onAnalysisRebuilt = vi.fn();
  return {
    api,
    onAnalysisRebuilt,
    ...render(
      <DiagnosticsPanel
        api={api}
        selectedTrackIds={selectedTrackIds}
        onAnalysisRebuilt={onAnalysisRebuilt}
      />,
    ),
  };
}

describe("DiagnosticsPanel", () => {
  it("states the redaction and offline restore boundaries before any action", () => {
    renderPanel();

    expect(screen.getByText("Diagnostics exports contain no audio, library metadata, personal notes, credentials, file paths, logs, or Codex response text.")).toBeVisible();
    expect(screen.getByText("Database restores stay offline. Quit DJ Copilot before following the recovery guide; this screen never restores a running database.")).toBeVisible();
  });

  it("loads a current path-free resource snapshot only after explicit refresh", async () => {
    const user = userEvent.setup();
    const { api } = renderPanel();
    const panel = screen.getByRole("region", { name: "Diagnostics and recovery" });

    expect(api.diagnostics.getSnapshot).not.toHaveBeenCalled();
    await user.click(within(panel).getByRole("button", { name: "Refresh diagnostics" }));

    expect(await within(panel).findByText("App 0.1.0 · Electron 43.3.0 · arm64 · personal build")).toBeVisible();
    expect(within(panel).getByText("Database schema 4 · integrity OK")).toBeVisible();
    expect(within(panel).getByText("Analysis available · ffmpeg-numpy-basic · baseline-v1")).toBeVisible();
    expect(within(panel).getAllByText("Available · 8.1.2 · bundled")).toHaveLength(2);
    expect(within(panel).getByText("Unavailable · Codex binary is unavailable · bundled")).toBeVisible();
    expect(api.diagnostics.getSnapshot).toHaveBeenCalledTimes(1);
  });

  it("reports a completed database backup with only its safe file name", async () => {
    const user = userEvent.setup();
    const { api } = renderPanel();

    await user.click(screen.getByRole("button", { name: "Back up database" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Database backup created: DJ Copilot Backup.sqlite3 (4096 bytes).");
    expect(api.diagnostics.backupDatabase).toHaveBeenCalledTimes(1);
  });

  it("reports a cancelled database backup without implying a file was written", async () => {
    const user = userEvent.setup();
    const api = createApi();
    api.diagnostics.backupDatabase = vi.fn().mockResolvedValue({ status: "cancelled" });
    renderPanel(api);

    await user.click(screen.getByRole("button", { name: "Back up database" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Database backup cancelled. No file was written.");
  });

  it("gives a failed database backup an actionable retry path", async () => {
    const user = userEvent.setup();
    const api = createApi();
    api.diagnostics.backupDatabase = vi.fn().mockRejectedValue(new Error("/private/path should not cross"));
    renderPanel(api);

    await user.click(screen.getByRole("button", { name: "Back up database" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Database backup could not be created. Check the destination write access and try again.");
    expect(screen.queryByText(/private\/path/)).not.toBeInTheDocument();
  });

  it("reports a redacted diagnostics export with only its safe file name", async () => {
    const user = userEvent.setup();
    const { api } = renderPanel();

    await user.click(screen.getByRole("button", { name: "Export redacted diagnostics" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Redacted diagnostics exported: DJ Copilot Diagnostics.json (2048 bytes).");
    expect(api.diagnostics.exportBundle).toHaveBeenCalledTimes(1);
  });

  it("confirms that the app data folder was opened", async () => {
    const user = userEvent.setup();
    const { api } = renderPanel();

    await user.click(screen.getByRole("button", { name: "Show data folder" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Data folder opened in Finder.");
    expect(api.diagnostics.showDataFolder).toHaveBeenCalledTimes(1);
  });

  it("requires keyboard-focused confirmation before rebuilding the selected analysis", async () => {
    const user = userEvent.setup();
    const { api, onAnalysisRebuilt } = renderPanel(createApi(), ["track-2", "track-1"]);

    await user.click(screen.getByRole("button", { name: "Rebuild selected analysis" }));

    const confirmation = screen.getByRole("group", { name: "Confirm analysis rebuild" });
    expect(within(confirmation).getByText("This removes existing local analysis for 2 selected tracks and queues fresh analysis. Rekordbox and source audio stay unchanged.")).toBeVisible();
    expect(within(confirmation).getByRole("button", { name: "Confirm rebuild" })).toHaveFocus();
    expect(api.analysis.rebuild).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");

    expect(api.analysis.rebuild).toHaveBeenCalledWith(["track-2", "track-1"]);
    expect(onAnalysisRebuilt).toHaveBeenCalledWith(analysisStatus);
    expect(await screen.findByRole("status")).toHaveTextContent("Analysis rebuild started for 2 selected tracks. Fresh analysis was queued.");
    expect(screen.getByRole("button", { name: "Rebuild selected analysis" })).toHaveFocus();
  });
});
