import { useEffect, useId, useRef, useState } from "react";
import type { AnalysisQueueStatus, DesktopApi, DiagnosticsSnapshot } from "../../../../shared/contracts";

interface DiagnosticsPanelProps {
  api: Pick<DesktopApi, "analysis" | "diagnostics"> | null;
  selectedTrackIds: string[];
  onAnalysisRebuilt(status: AnalysisQueueStatus): void;
}

type ActiveAction = "refresh" | "backup" | "export" | "show-folder" | "rebuild";

const resourceLabels: Record<keyof DiagnosticsSnapshot["resources"], string> = {
  core: "Core",
  ffmpeg: "FFmpeg",
  ffprobe: "FFprobe",
  codex: "Codex",
};

function releaseModeLabel(mode: DiagnosticsSnapshot["releaseMode"]): string {
  return mode === "personal_arm64" ? "personal build" : "development";
}

function resourceSummary(resource: DiagnosticsSnapshot["resources"][keyof DiagnosticsSnapshot["resources"]]): string {
  return resource.status === "available"
    ? `Available · ${resource.version} · ${resource.source}`
    : `Unavailable · ${resource.message} · ${resource.source}`;
}

export function DiagnosticsPanel({ api, selectedTrackIds, onAnalysisRebuilt }: DiagnosticsPanelProps) {
  const id = useId();
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [activeAction, setActiveAction] = useState<ActiveAction | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingRebuildTrackIds, setPendingRebuildTrackIds] = useState<string[] | null>(null);
  const rebuildTriggerRef = useRef<HTMLButtonElement | null>(null);
  const shouldRestoreRebuildFocus = useRef(false);

  const restoreRebuildFocus = () => {
    shouldRestoreRebuildFocus.current = true;
  };

  useEffect(() => {
    if (activeAction !== null || pendingRebuildTrackIds !== null || !shouldRestoreRebuildFocus.current) return;
    shouldRestoreRebuildFocus.current = false;
    rebuildTriggerRef.current?.focus();
  }, [activeAction, pendingRebuildTrackIds]);

  const refresh = async () => {
    setActiveAction("refresh");
    setActionMessage(null);
    setActionError(null);
    if (api === null) {
      setActionError("Diagnostics are unavailable. Restart DJ Copilot and try again.");
      setActiveAction(null);
      return;
    }
    try {
      setSnapshot(await api.diagnostics.getSnapshot());
      setActionMessage("Diagnostics snapshot refreshed.");
    } catch {
      setActionError("Diagnostics could not be refreshed. Restart DJ Copilot and try again.");
    } finally {
      setActiveAction(null);
    }
  };

  const backupDatabase = async () => {
    setActiveAction("backup");
    setActionMessage(null);
    setActionError(null);
    if (api === null) {
      setActionError("Database backup is unavailable. Restart DJ Copilot and try again.");
      setActiveAction(null);
      return;
    }
    try {
      const result = await api.diagnostics.backupDatabase();
      setActionMessage(result.status === "cancelled"
        ? "Database backup cancelled. No file was written."
        : `Database backup created: ${result.fileName} (${result.sizeBytes} bytes).`);
    } catch {
      setActionError("Database backup could not be created. Check the destination write access and try again.");
    } finally {
      setActiveAction(null);
    }
  };

  const exportDiagnostics = async () => {
    setActiveAction("export");
    setActionMessage(null);
    setActionError(null);
    if (api === null) {
      setActionError("Diagnostics export is unavailable. Restart DJ Copilot and try again.");
      setActiveAction(null);
      return;
    }
    try {
      const result = await api.diagnostics.exportBundle();
      setActionMessage(result.status === "cancelled"
        ? "Diagnostics export cancelled. No file was written."
        : `Redacted diagnostics exported: ${result.fileName} (${result.sizeBytes} bytes).`);
    } catch {
      setActionError("Diagnostics could not be exported. Check the destination write access and try again.");
    } finally {
      setActiveAction(null);
    }
  };

  const showDataFolder = async () => {
    setActiveAction("show-folder");
    setActionMessage(null);
    setActionError(null);
    if (api === null) {
      setActionError("The data folder is unavailable. Restart DJ Copilot and try again.");
      setActiveAction(null);
      return;
    }
    try {
      await api.diagnostics.showDataFolder();
      setActionMessage("Data folder opened in Finder.");
    } catch {
      setActionError("The data folder could not be opened. Restart DJ Copilot and try again.");
    } finally {
      setActiveAction(null);
    }
  };

  const confirmRebuild = async () => {
    const trackIds = pendingRebuildTrackIds;
    if (trackIds === null || trackIds.length === 0) return;
    setActiveAction("rebuild");
    setActionMessage(null);
    setActionError(null);
    if (api === null) {
      setActionError("Analysis rebuild is unavailable. Restart DJ Copilot and try again.");
      setActiveAction(null);
      setPendingRebuildTrackIds(null);
      restoreRebuildFocus();
      return;
    }
    try {
      const status = await api.analysis.rebuild(trackIds);
      onAnalysisRebuilt(status);
      setActionMessage(`Analysis rebuild started for ${trackIds.length} selected ${trackIds.length === 1 ? "track" : "tracks"}. Fresh analysis was queued.`);
    } catch {
      setActionError("Selected analysis could not be rebuilt. Keep the tracks selected and try again.");
    } finally {
      setActiveAction(null);
      setPendingRebuildTrackIds(null);
      restoreRebuildFocus();
    }
  };

  const cancelRebuild = () => {
    setPendingRebuildTrackIds(null);
    setActionError(null);
    setActionMessage("Analysis rebuild cancelled. Existing analysis was kept.");
    restoreRebuildFocus();
  };

  return (
    <section className="diagnostics-panel" aria-labelledby={`${id}-heading`} aria-busy={activeAction !== null}>
      <header className="diagnostics-panel__heading">
        <div>
          <p className="eyebrow">Local support tools</p>
          <h2 id={`${id}-heading`}>Diagnostics and recovery</h2>
        </div>
        <button className="diagnostics-button" type="button" disabled={activeAction !== null} onClick={() => { void refresh(); }}>
          {activeAction === "refresh" ? "Refreshing diagnostics…" : "Refresh diagnostics"}
        </button>
      </header>
      {snapshot === null ? (
        <p className="diagnostics-panel__unchecked">Not checked yet. Refresh when you need a current snapshot.</p>
      ) : (
        <div className="diagnostics-panel__snapshot">
          <p className="diagnostics-panel__build">{`App ${snapshot.appVersion} · Electron ${snapshot.electronVersion} · ${snapshot.architecture} · ${releaseModeLabel(snapshot.releaseMode)}`}</p>
          <p className="diagnostics-panel__snapshot-note">{`Database schema ${snapshot.schemaVersion} · integrity ${snapshot.databaseIntegrity.toUpperCase()}`}</p>
          <p className="diagnostics-panel__snapshot-note">{snapshot.analysis.available
            ? `Analysis available · ${snapshot.analysis.provider} · ${snapshot.analysis.pipelineVersion}`
            : `Analysis unavailable · ${snapshot.analysis.unavailableReason}`}</p>
          <dl className="diagnostics-panel__resources">
            {(Object.keys(resourceLabels) as Array<keyof DiagnosticsSnapshot["resources"]>).map((resourceName) => (
              <div className={`diagnostics-panel__resource diagnostics-panel__resource--${snapshot.resources[resourceName].status}`} key={resourceName}>
                <dt>{resourceLabels[resourceName]}</dt>
                <dd>{resourceSummary(snapshot.resources[resourceName])}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <div className="diagnostics-panel__actions">
        <button className="diagnostics-button" type="button" disabled={activeAction !== null} onClick={() => { void backupDatabase(); }}>
          {activeAction === "backup" ? "Backing up database…" : "Back up database"}
        </button>
        <button className="diagnostics-button" type="button" disabled={activeAction !== null} onClick={() => { void exportDiagnostics(); }}>
          {activeAction === "export" ? "Exporting diagnostics…" : "Export redacted diagnostics"}
        </button>
        <button className="diagnostics-button" type="button" disabled={activeAction !== null} onClick={() => { void showDataFolder(); }}>
          {activeAction === "show-folder" ? "Opening data folder…" : "Show data folder"}
        </button>
        <button
          ref={rebuildTriggerRef}
          className="diagnostics-button diagnostics-button--rebuild"
          type="button"
          aria-describedby={`${id}-rebuild-help`}
          disabled={activeAction !== null || pendingRebuildTrackIds !== null || selectedTrackIds.length === 0}
          onClick={() => {
            setActionMessage(null);
            setActionError(null);
            setPendingRebuildTrackIds([...selectedTrackIds]);
          }}
        >
          Rebuild selected analysis
        </button>
      </div>
      <p className="diagnostics-panel__help" id={`${id}-rebuild-help`}>
        {selectedTrackIds.length === 0
          ? "Select one or more available tracks in the table to rebuild their local analysis."
          : `${selectedTrackIds.length} ${selectedTrackIds.length === 1 ? "track is" : "tracks are"} selected for local analysis actions.`}
      </p>
      {pendingRebuildTrackIds === null ? null : (
        <div className="diagnostics-panel__confirmation" role="group" aria-labelledby={`${id}-rebuild-confirmation-title`}>
          <h3 id={`${id}-rebuild-confirmation-title`}>Confirm analysis rebuild</h3>
          <p>{`This removes existing local analysis for ${pendingRebuildTrackIds.length} selected ${pendingRebuildTrackIds.length === 1 ? "track" : "tracks"} and queues fresh analysis. Rekordbox and source audio stay unchanged.`}</p>
          <div className="diagnostics-panel__confirmation-actions">
            <button className="diagnostics-button diagnostics-button--confirm" type="button" autoFocus disabled={activeAction !== null} onClick={() => { void confirmRebuild(); }}>
              {activeAction === "rebuild" ? "Rebuilding analysis…" : "Confirm rebuild"}
            </button>
            <button className="diagnostics-button" type="button" disabled={activeAction !== null} onClick={cancelRebuild}>Cancel rebuild</button>
          </div>
        </div>
      )}
      {actionMessage === null ? null : <p className="diagnostics-panel__message diagnostics-panel__message--success" role="status" aria-live="polite">{actionMessage}</p>}
      {actionError === null ? null : <p className="diagnostics-panel__message diagnostics-panel__message--error" role="alert">{actionError}</p>}
      <div className="diagnostics-panel__limitations">
        <p>Diagnostics exports contain no audio, library metadata, personal notes, credentials, file paths, logs, or Codex response text.</p>
        <p>Database restores stay offline. Quit DJ Copilot before following the recovery guide; this screen never restores a running database.</p>
      </div>
    </section>
  );
}
