import { useCallback, useEffect, useRef, useState } from "react";
import type { AppStatus, DesktopApi, PlaylistTreeNode, TrackListItem } from "../../../../shared/contracts";
import { ImportPanel } from "./ImportPanel";
import { PlaylistTree } from "./PlaylistTree";
import { StatusPanel } from "./StatusPanel";
import { TrackTable } from "./TrackTable";

interface DjCopilotWindow extends Window {
  djCopilot: DesktopApi;
}

function desktopApi(): DesktopApi | null {
  return (window as unknown as DjCopilotWindow).djCopilot;
}

export function LibraryScreen() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [tree, setTree] = useState<PlaylistTreeNode[]>([]);
  const [tracks, setTracks] = useState<TrackListItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tracksLoading, setTracksLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [partialError, setPartialError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const statusRefreshInProgress = useRef(false);

  const loadTracks = useCallback(async (playlistId: string | null) => {
    setTracksLoading(true);
    setTracks(null);
    setNextCursor(null);
    const api = desktopApi();
    if (api === null || api === undefined) {
      setPartialError("The secure desktop connection is unavailable.");
      setTracks([]);
      setTracksLoading(false);
      return;
    }
    try {
      const page = await api.library.listTracks(playlistId === null ? undefined : { playlistId });
      setTracks(page.items);
      setNextCursor(page.nextCursor);
      setPartialError(null);
    } catch (error) {
      setPartialError(error instanceof Error ? error.message : "Tracks could not be loaded.");
      setTracks([]);
      setNextCursor(null);
    } finally {
      setTracksLoading(false);
    }
  }, []);

  const refreshLibrary = useCallback(async () => {
    setLoading(true);
    setTracksLoading(true);
    setTracks(null);
    setNextCursor(null);
    const api = desktopApi();
    if (api === null || api === undefined) {
      setStatus({
        state: "degraded",
        message: "The secure desktop connection is unavailable. Restart DJ Copilot and try again.",
      });
      setTracks([]);
      setPartialError(null);
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
      api.library.listTracks(),
    ]);
    const errors: string[] = [];
    if (statusResult.status === "fulfilled") setStatus(statusResult.value);
    else errors.push("service state");
    if (treeResult.status === "fulfilled") setTree(treeResult.value);
    else errors.push("playlist tree");
    if (trackResult.status === "fulfilled") {
      setTracks(trackResult.value.items);
      setNextCursor(trackResult.value.nextCursor);
    } else {
      errors.push("tracks");
      setTracks([]);
      setNextCursor(null);
    }
    setPartialError(errors.length > 0 ? `Could not load ${errors.join(" and ")}.` : null);
    setTracksLoading(false);
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

  useEffect(() => {
    void refreshLibrary();
    const statusPoll = window.setInterval(() => {
      void refreshStatus();
    }, 2_000);
    return () => window.clearInterval(statusPoll);
  }, [refreshLibrary, refreshStatus]);

  const selectPlaylist = async (playlistId: string | null) => {
    setSelectedId(playlistId);
    await loadTracks(playlistId);
  };

  const loadMoreTracks = async () => {
    if (nextCursor === null || loadingMore) return;
    const api = desktopApi();
    if (api === null || api === undefined) {
      setPartialError("The secure desktop connection is unavailable.");
      setNextCursor(null);
      return;
    }
    setLoadingMore(true);
    try {
      const page = await api.library.listTracks(selectedId === null
        ? { cursor: nextCursor }
        : { playlistId: selectedId, cursor: nextCursor });
      setTracks((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
      setPartialError(null);
    } catch (error) {
      setPartialError(error instanceof Error ? error.message : "More tracks could not be loaded.");
      setNextCursor(null);
    } finally {
      setLoadingMore(false);
    }
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
        await refreshLibrary();
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

  return (
    <main className="library-workstation">
      <div className="library-content">
        <ImportPanel importing={importing} onImport={() => { void importXml(); }} />
        <StatusPanel status={status} loading={loading} partialError={partialError} importMessage={importMessage} importError={importError} />
        <TrackTable tracks={tracks} loading={tracksLoading} nextCursor={nextCursor} loadingMore={loadingMore} onLoadMore={() => { void loadMoreTracks(); }} />
      </div>
      <aside className="library-sidebar">
        <div className="library-sidebar__brand">DJ COPILOT</div>
        <PlaylistTree nodes={tree} selectedId={selectedId} onSelect={(playlistId) => { void selectPlaylist(playlistId); }} />
      </aside>
    </main>
  );
}
