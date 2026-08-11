import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AnalysisQueueStatus,
  AnalysisSummary,
  AppStatus,
  DesktopApi,
  PlaylistTreeNode,
  TrackFilters,
  TrackListItem,
  TrackPageQuery,
  SetDraftSnapshot,
} from "../../../../shared/contracts";
import { AnalysisControls } from "../analysis/AnalysisControls";
import { DiscoveryFilters } from "../discovery/DiscoveryFilters";
import { DiscoveryPanel, type DiscoverySeed } from "../discovery/DiscoveryPanel";
import { ImportPanel } from "./ImportPanel";
import { PlaylistTree } from "./PlaylistTree";
import { StatusPanel } from "./StatusPanel";
import { TrackTable } from "./TrackTable";
import { SetDraftLauncher } from "../sets/SetDraftLauncher";
import { SetWorkspace } from "../sets/SetWorkspace";

interface DjCopilotWindow extends Window {
  djCopilot: DesktopApi;
}

const MAX_ANALYSIS_TRACKS = 200;

type AnalysisAction = "queue" | "pause" | "resume" | null;

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function summaryFromQueueItem(item: AnalysisQueueStatus["items"][number]): AnalysisSummary {
  return {
    status: item.status,
    progressPpm: item.progressPpm,
    attemptCount: item.attemptCount,
    errorCode: item.errorCode,
    errorMessage: item.errorMessage,
    features: item.features,
  };
}

function mergeQueueStatus(
  current: AnalysisQueueStatus | null,
  update: AnalysisQueueStatus,
): AnalysisQueueStatus {
  if (current === null || current.items.length === 0) return update;
  const updates = new Map(update.items.map((item) => [item.trackId, item]));
  const merged = current.items.map((item) => updates.get(item.trackId) ?? item);
  const knownIds = new Set(current.items.map((item) => item.trackId));
  for (const item of update.items) {
    if (!knownIds.has(item.trackId)) merged.push(item);
  }
  return { ...update, items: merged.slice(0, MAX_ANALYSIS_TRACKS) };
}

function uniqueTrackIds(trackIds: string[]): string[] {
  return Array.from(new Set(trackIds));
}

function stableSelectedIds(tracks: TrackListItem[] | null, selectedTrackIds: ReadonlySet<string>): string[] {
  const renderedIds = new Set((tracks ?? []).map((track) => track.id));
  const visibleSelected = (tracks ?? [])
    .filter((track) => selectedTrackIds.has(track.id))
    .map((track) => track.id);
  const selectedOutsideView = Array.from(selectedTrackIds)
    .filter((trackId) => !renderedIds.has(trackId))
    .sort((left, right) => left.localeCompare(right));
  return uniqueTrackIds([...visibleSelected, ...selectedOutsideView]).slice(0, MAX_ANALYSIS_TRACKS);
}

function stablePollIds(tracks: TrackListItem[] | null, selectedTrackIds: ReadonlySet<string>): string[] {
  const visible = tracks ?? [];
  const visibleIds = new Set(visible.map((track) => track.id));
  const selected = visible.filter((track) => selectedTrackIds.has(track.id)).map((track) => track.id);
  const selectedOutsideView = Array.from(selectedTrackIds)
    .filter((trackId) => !visibleIds.has(trackId))
    .sort((left, right) => left.localeCompare(right));
  const remaining = visible.filter((track) => !selectedTrackIds.has(track.id)).map((track) => track.id);
  return uniqueTrackIds([...selected, ...selectedOutsideView, ...remaining]).slice(0, MAX_ANALYSIS_TRACKS);
}

function desktopApi(): DesktopApi | null {
  return (window as unknown as DjCopilotWindow).djCopilot;
}

function filtersWithPlaylist(playlistId: string | null, filters: TrackFilters): TrackFilters {
  return playlistId === null ? filters : { ...filters, playlistId };
}

function trackQuery(
  playlistId: string | null,
  filters: TrackFilters,
  cursor?: string,
): TrackPageQuery | undefined {
  const query: TrackPageQuery = filtersWithPlaylist(playlistId, filters);
  if (cursor !== undefined) query.cursor = cursor;
  return Object.keys(query).length === 0 ? undefined : query;
}

function requestTrackPage(api: DesktopApi, query: TrackPageQuery | undefined) {
  return query === undefined ? api.library.listTracks() : api.library.listTracks(query);
}

export function LibraryScreen() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [tree, setTree] = useState<PlaylistTreeNode[]>([]);
  const [tracks, setTracks] = useState<TrackListItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<TrackFilters>({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [tracksTruncated, setTracksTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tracksLoading, setTracksLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [partialError, setPartialError] = useState<string | null>(null);
  const [trackLoadError, setTrackLoadError] = useState<string | null>(null);
  const [discoverySeed, setDiscoverySeed] = useState<DiscoverySeed | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(() => new Set());
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisQueueStatus | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(true);
  const [analysisAction, setAnalysisAction] = useState<AnalysisAction>(null);
  const [analysisStatusError, setAnalysisStatusError] = useState<string | null>(null);
  const [analysisActionError, setAnalysisActionError] = useState<string | null>(null);
  const [setSnapshot, setSetSnapshot] = useState<SetDraftSnapshot | null>(null);
  const statusRefreshInProgress = useRef(false);
  const analysisPollInProgress = useRef(false);
  const trackRequestSequence = useRef(0);
  const tracksRef = useRef<TrackListItem[] | null>(tracks);
  const selectedTrackIdsRef = useRef<ReadonlySet<string>>(selectedTrackIds);

  tracksRef.current = tracks;
  selectedTrackIdsRef.current = selectedTrackIds;

  const discoveryFilters = useMemo(
    () => filtersWithPlaylist(selectedId, activeFilters),
    [activeFilters, selectedId],
  );

  const mergeAnalysisStatus = useCallback((update: AnalysisQueueStatus) => {
    setAnalysisStatus((current) => mergeQueueStatus(current, update));
    if (update.items.length === 0) return;
    const summaries = new Map(update.items.map((item) => [item.trackId, summaryFromQueueItem(item)]));
    setTracks((current) => current?.map((track) => {
      const analysis = summaries.get(track.id);
      return analysis === undefined ? track : { ...track, analysis };
    }) ?? current);
  }, []);

  const loadTracks = useCallback(async (playlistId: string | null, filters: TrackFilters) => {
    const requestSequence = ++trackRequestSequence.current;
    setTracksLoading(true);
    setLoadingMore(false);
    setTracks(null);
    setNextCursor(null);
    setTracksTruncated(false);
    setTrackLoadError(null);
    const api = desktopApi();
    if (api === null || api === undefined) {
      setPartialError("The secure desktop connection is unavailable.");
      setTrackLoadError("The secure desktop connection is unavailable.");
      setTracks([]);
      setTracksLoading(false);
      return;
    }
    try {
      const page = await requestTrackPage(api, trackQuery(playlistId, filters));
      if (requestSequence !== trackRequestSequence.current) return;
      setTracks(page.items);
      setNextCursor(page.nextCursor);
      setTracksTruncated(page.truncated);
      setPartialError(null);
      setTrackLoadError(null);
    } catch (error) {
      if (requestSequence !== trackRequestSequence.current) return;
      const message = error instanceof Error ? error.message : "Tracks could not be loaded.";
      setPartialError(message);
      setTrackLoadError(message);
      setTracks([]);
      setNextCursor(null);
    } finally {
      if (requestSequence === trackRequestSequence.current) setTracksLoading(false);
    }
  }, []);

  const refreshLibrary = useCallback(async (filters: TrackFilters = {}) => {
    const requestSequence = ++trackRequestSequence.current;
    setLoading(true);
    setTracksLoading(true);
    setLoadingMore(false);
    setTracks(null);
    setNextCursor(null);
    setTracksTruncated(false);
    setTrackLoadError(null);
    const api = desktopApi();
    if (api === null || api === undefined) {
      setStatus({
        state: "degraded",
        message: "The secure desktop connection is unavailable. Restart DJ Copilot and try again.",
      });
      setTracks([]);
      setPartialError(null);
      setTrackLoadError("The secure desktop connection is unavailable.");
      setTracksLoading(false);
      setLoading(false);
      return;
    }
    statusRefreshInProgress.current = true;
    const statusRequest = api.system.getStatus().finally(() => {
      statusRefreshInProgress.current = false;
    });
    const [statusResult, treeResult, trackResult] = await Promise.allSettled([
      statusRequest,
      api.library.getPlaylistTree(),
      requestTrackPage(api, trackQuery(null, filters)),
    ]);
    const errors: string[] = [];
    if (statusResult.status === "fulfilled") setStatus(statusResult.value);
    else errors.push("service state");
    if (treeResult.status === "fulfilled") setTree(treeResult.value);
    else errors.push("playlist tree");
    if (trackResult.status === "fulfilled" && requestSequence === trackRequestSequence.current) {
      setTracks(trackResult.value.items);
      setNextCursor(trackResult.value.nextCursor);
      setTracksTruncated(trackResult.value.truncated);
      setTrackLoadError(null);
    } else if (trackResult.status === "rejected" && requestSequence === trackRequestSequence.current) {
      errors.push("tracks");
      setTracks([]);
      setNextCursor(null);
      setTrackLoadError("Tracks could not be loaded.");
    }
    setPartialError(errors.length > 0 ? `Could not load ${errors.join(" and ")}.` : null);
    if (requestSequence === trackRequestSequence.current) setTracksLoading(false);
    setLoading(false);
  }, []);

  const refreshStatus = useCallback(async () => {
    if (statusRefreshInProgress.current) return;
    const api = desktopApi();
    if (api === null || api === undefined) {
      setStatus({
        state: "degraded",
        message: "The secure desktop connection is unavailable. Restart DJ Copilot and try again.",
      });
      return;
    }
    statusRefreshInProgress.current = true;
    try {
      setStatus(await api.system.getStatus());
    } catch {
      setStatus({ state: "degraded", message: "The library service status could not be refreshed." });
    } finally {
      statusRefreshInProgress.current = false;
    }
  }, []);

  const refreshAnalysis = useCallback(async () => {
    if (analysisPollInProgress.current) return;
    const api = desktopApi();
    if (api === null || api === undefined) {
      setAnalysisStatusError("The secure desktop connection is unavailable.");
      setAnalysisLoading(false);
      return;
    }
    analysisPollInProgress.current = true;
    try {
      const trackIds = stablePollIds(tracksRef.current, selectedTrackIdsRef.current);
      const nextStatus = trackIds.length === 0
        ? await api.analysis.getStatus()
        : await api.analysis.getStatus(trackIds);
      mergeAnalysisStatus(nextStatus);
      setAnalysisStatusError(null);
    } catch (error) {
      setAnalysisStatusError(readableError(error, "Analysis status could not be refreshed."));
    } finally {
      analysisPollInProgress.current = false;
      setAnalysisLoading(false);
    }
  }, [mergeAnalysisStatus]);

  useEffect(() => {
    void refreshLibrary();
    void refreshAnalysis();
    const statusPoll = window.setInterval(() => {
      void refreshStatus();
    }, 2_000);
    const analysisPoll = window.setInterval(() => {
      void refreshAnalysis();
    }, 1_000);
    return () => {
      window.clearInterval(statusPoll);
      window.clearInterval(analysisPoll);
    };
  }, [refreshAnalysis, refreshLibrary, refreshStatus]);

  const selectPlaylist = async (playlistId: string | null) => {
    setSelectedId(playlistId);
    await loadTracks(playlistId, activeFilters);
  };

  const loadMoreTracks = async () => {
    if (nextCursor === null || loadingMore) return;
    const requestSequence = ++trackRequestSequence.current;
    const api = desktopApi();
    if (api === null || api === undefined) {
      setPartialError("The secure desktop connection is unavailable.");
      setTrackLoadError("The secure desktop connection is unavailable.");
      setNextCursor(null);
      return;
    }
    setLoadingMore(true);
    try {
      const page = await requestTrackPage(api, trackQuery(selectedId, activeFilters, nextCursor));
      if (requestSequence !== trackRequestSequence.current) return;
      setTracks((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
      setTracksTruncated(page.truncated);
      setPartialError(null);
      setTrackLoadError(null);
    } catch (error) {
      if (requestSequence !== trackRequestSequence.current) return;
      const message = error instanceof Error ? error.message : "More tracks could not be loaded.";
      setPartialError(message);
      setNextCursor(null);
    } finally {
      if (requestSequence === trackRequestSequence.current) setLoadingMore(false);
    }
  };

  const applyFilters = async (filters: TrackFilters) => {
    setActiveFilters(filters);
    await loadTracks(selectedId, filters);
  };

  const clearFilters = async () => {
    const filters: TrackFilters = {};
    setActiveFilters(filters);
    await loadTracks(selectedId, filters);
  };

  const importXml = async () => {
    setImporting(true);
    setImportMessage(null);
    setImportError(null);
    const api = desktopApi();
    if (api === null || api === undefined) {
      setImportError("The secure desktop connection is unavailable. Restart DJ Copilot and try again.");
      setImporting(false);
      return;
    }
    try {
      const result = await api.library.importXml();
      if (result.success) {
        setImportMessage(`${result.summary.importedTracks} tracks imported and ${result.summary.importedPlaylists} playlists.`);
        setSelectedId(null);
        setSelectedTrackIds(new Set());
        setDiscoverySeed(null);
        await refreshLibrary(activeFilters);
      } else if (result.error.code === "cancelled") {
        return;
      } else {
        setImportError(`${result.error.message}. Your existing library is still available.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The Rekordbox XML import could not be completed.";
      setImportError(`${message}. Your existing library is still available.`);
    } finally {
      setImporting(false);
    }
  };

  const toggleTrack = useCallback((trackId: string, selected: boolean) => {
    setSelectedTrackIds((current) => {
      if (selected && current.size >= MAX_ANALYSIS_TRACKS) return current;
      const next = new Set(current);
      if (selected) next.add(trackId);
      else next.delete(trackId);
      return next;
    });
  }, []);

  const toggleAll = useCallback((trackIds: string[], selected: boolean) => {
    setSelectedTrackIds((current) => {
      const next = new Set(current);
      if (selected) {
        for (const trackId of trackIds) {
          if (next.size >= MAX_ANALYSIS_TRACKS) break;
          next.add(trackId);
        }
      } else {
        for (const trackId of trackIds) next.delete(trackId);
      }
      return next;
    });
  }, []);

  const queueSelected = async () => {
    const trackIds = stableSelectedIds(tracksRef.current, selectedTrackIdsRef.current);
    if (trackIds.length === 0) return;
    const api = desktopApi();
    if (api === null || api === undefined) {
      setAnalysisActionError("The secure desktop connection is unavailable.");
      return;
    }
    setAnalysisAction("queue");
    setAnalysisActionError(null);
    try {
      mergeAnalysisStatus(await api.analysis.queue(trackIds));
    } catch (error) {
      setAnalysisActionError(readableError(error, "Selected tracks could not be queued for analysis."));
    } finally {
      setAnalysisAction(null);
    }
  };

  const pauseAnalysis = async () => {
    const api = desktopApi();
    if (api === null || api === undefined) {
      setAnalysisActionError("The secure desktop connection is unavailable.");
      return;
    }
    setAnalysisAction("pause");
    setAnalysisActionError(null);
    try {
      mergeAnalysisStatus(await api.analysis.pause());
    } catch (error) {
      setAnalysisActionError(readableError(error, "Analysis could not be paused."));
    } finally {
      setAnalysisAction(null);
    }
  };

  const resumeAnalysis = async () => {
    const api = desktopApi();
    if (api === null || api === undefined) {
      setAnalysisActionError("The secure desktop connection is unavailable.");
      return;
    }
    setAnalysisAction("resume");
    setAnalysisActionError(null);
    try {
      mergeAnalysisStatus(await api.analysis.resume());
    } catch (error) {
      setAnalysisActionError(readableError(error, "Analysis could not be resumed."));
    } finally {
      setAnalysisAction(null);
    }
  };

  return (
    <main className="library-workstation">
      <div className="library-content">
        <ImportPanel importing={importing} onImport={() => { void importXml(); }} />
        <StatusPanel status={status} loading={loading} partialError={partialError} importMessage={importMessage} importError={importError} />
        <AnalysisControls
          status={analysisStatus}
          loading={analysisLoading}
          selectedCount={selectedTrackIds.size}
          action={analysisAction}
          error={analysisActionError ?? analysisStatusError}
          onAnalyze={() => { void queueSelected(); }}
          onPause={() => { void pauseAnalysis(); }}
          onResume={() => { void resumeAnalysis(); }}
        />
        <DiscoveryFilters
          activeFilters={activeFilters}
          loading={tracksLoading}
          onApply={(filters) => { void applyFilters(filters); }}
          onClear={() => { void clearFilters(); }}
        />
        {discoverySeed === null ? null : (
          <DiscoveryPanel
            key={discoverySeed.id}
            api={desktopApi() ?? null}
            seed={discoverySeed}
            filters={discoveryFilters}
          />
        )}
        <TrackTable
          tracks={tracks}
          loading={tracksLoading}
          filtered={Object.keys(activeFilters).length > 0}
          truncated={tracksTruncated}
          loadError={trackLoadError}
          nextCursor={nextCursor}
          loadingMore={loadingMore}
          selectedTrackIds={selectedTrackIds}
          onToggleTrack={toggleTrack}
          onToggleAll={toggleAll}
          onExplore={(track) => setDiscoverySeed({
            id: track.id,
            title: track.title ?? "Untitled track",
            artist: track.artist ?? "Unknown artist",
          })}
          onLoadMore={() => { void loadMoreTracks(); }}
        />
      </div>
      <aside className="library-sidebar">
        <div className="library-sidebar__brand">DJ COPILOT</div>
        <PlaylistTree nodes={tree} selectedId={selectedId} onSelect={(playlistId) => { void selectPlaylist(playlistId); }} />
      </aside>
      <div className="set-workspace-slot">
        <SetDraftLauncher
          api={desktopApi() ?? null}
          selectedTrackIds={stableSelectedIds(tracks, selectedTrackIds)}
          playlistId={selectedId}
          seedTrackId={discoverySeed?.id ?? null}
          onOpen={setSetSnapshot}
        />
        {setSnapshot === null ? null : <SetWorkspace
          api={desktopApi() ?? null}
          snapshot={setSnapshot}
          availableTracks={(tracks ?? []).map(({ analysis: _analysis, ...track }) => track)}
          onSnapshot={setSetSnapshot}
          onClose={() => setSetSnapshot(null)}
        />}
      </div>
    </main>
  );
}
