import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisQueueStatus,
  AppStatus,
  DesktopApi,
  ImportResult,
  PlaylistTreeNode,
  TrackListItem,
} from "../src/shared/contracts";
import { LibraryScreen } from "../src/renderer/src/features/library/LibraryScreen";
import { PlaylistTree } from "../src/renderer/src/features/library/PlaylistTree";

const tracks: TrackListItem[] = [
  {
    id: "track-1",
    title: "Sæglópur",
    artist: "Sigur Rós",
    album: "Takk...",
    genre: "Post-rock",
    bpmMilli: 120_000,
    musicalKey: "8A",
    durationMs: 431_000,
    availability: "available",
    analysis: null,
  },
  {
    id: "track-2",
    title: "Blue Monday",
    artist: "New Order",
    album: "Power, Corruption & Lies",
    genre: "Synth-pop",
    bpmMilli: 130_000,
    musicalKey: "9A",
    durationMs: 448_000,
    availability: "missing",
    analysis: null,
  },
  {
    id: "track-3",
    title: "Ain't No Mountain High Enough",
    artist: "Marvin Gaye & Tammi Terrell",
    album: "United",
    genre: "Soul",
    bpmMilli: 128_000,
    musicalKey: "11B",
    durationMs: 151_000,
    availability: "unreadable",
    analysis: null,
  },
  {
    id: "track-4",
    title: null,
    artist: null,
    album: null,
    genre: null,
    bpmMilli: null,
    musicalKey: null,
    durationMs: null,
    availability: "available",
    analysis: null,
  },
];

const tree: PlaylistTreeNode[] = [
  { id: "folder-night", parentId: null, name: "Night sets", kind: "folder", order: 0, trackCount: 0 },
  { id: "playlist-warmup", parentId: "folder-night", name: "Warmup", kind: "playlist", order: 0, trackCount: 2 },
  { id: "playlist-peak", parentId: "folder-night", name: "Peak time", kind: "playlist", order: 1, trackCount: 2 },
];

const successfulImport: ImportResult = {
  success: true,
  summary: {
    revision: 1,
    sourceSha256: "a".repeat(64),
    importedTracks: 4,
    importedPlaylists: 2,
    unavailableTracks: 2,
  },
};

const analysisStatus: AnalysisQueueStatus = {
  state: "idle",
  queued: 0,
  running: 0,
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

function createApi(options: {
  status?: AppStatus;
  tree?: PlaylistTreeNode[];
  tracks?: TrackListItem[];
  importResult?: ImportResult;
} = {}): DesktopApi {
  return {
    system: {
      getStatus: vi.fn().mockResolvedValue(options.status ?? { state: "ready", message: null }),
    },
    library: {
      importXml: vi.fn().mockResolvedValue(options.importResult ?? successfulImport),
      getPlaylistTree: vi.fn().mockResolvedValue(options.tree ?? tree),
      listTracks: vi.fn().mockResolvedValue({ items: options.tracks ?? tracks, nextCursor: null, truncated: false }),
    },
    analysis: {
      queue: vi.fn().mockResolvedValue(analysisStatus),
      getStatus: vi.fn().mockResolvedValue(analysisStatus),
      pause: vi.fn().mockResolvedValue({ ...analysisStatus, state: "paused" }),
      resume: vi.fn().mockResolvedValue({ ...analysisStatus, state: "running" }),
    },
    discovery: {
      findSimilar: vi.fn(async () => { throw new Error("Discovery is not configured in this library test."); }),
      recommendNext: vi.fn(async () => { throw new Error("Discovery is not configured in this library test."); }),
    },
    sets: { list: vi.fn(async () => ({ items: [] })), create: vi.fn(async () => { throw new Error("Sets are not configured in this library test."); }), get: vi.fn(async () => { throw new Error("Sets are not configured in this library test."); }), mutate: vi.fn(async () => { throw new Error("Sets are not configured in this library test."); }), findReplacements: vi.fn(async () => { throw new Error("Sets are not configured in this library test."); }), inspect: vi.fn(async () => { throw new Error("Sets are not configured in this library test."); }) },
    exports: { prepare: vi.fn(async () => { throw new Error("Exports are not configured in this library test."); }), confirm: vi.fn(async () => { throw new Error("Exports are not configured in this library test."); }) },
  };
}

function renderLibrary(api = createApi()) {
  Object.defineProperty(window, "djCopilot", { configurable: true, value: api });
  return { api, ...render(<LibraryScreen />) };
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, "djCopilot");
});

describe("LibraryScreen", () => {
  it("shows loading before the initial library data arrives", () => {
    const api = createApi();
    api.system.getStatus = vi.fn(() => new Promise<AppStatus>(() => undefined));
    renderLibrary(api);

    expect(within(screen.getByRole("region", { name: "Library service state" })).getByRole("status"))
      .toHaveTextContent("Loading library workspace");
    expect(screen.getByRole("tree", { name: "Playlists" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Tracks" })).toBeInTheDocument();
  });

  it("reports an unavailable desktop bridge without renderer-side fallback access", async () => {
    render(<LibraryScreen />);

    expect(await screen.findByText("Library service is unavailable")).toBeVisible();
    expect(screen.getByText("The secure desktop connection is unavailable. Restart DJ Copilot and try again.")).toBeVisible();
  });

  it("renders initial status, hierarchy, and four fixture tracks", async () => {
    renderLibrary();

    expect(await screen.findByText("Library service ready")).toBeVisible();
    expect(screen.getByRole("treeitem", { name: /Night sets/ })).toBeVisible();
    expect(screen.getAllByRole("row")).toHaveLength(5);
    expect(screen.getByText("Sæglópur")).toBeVisible();
    expect(screen.getByText("Untitled track")).toBeVisible();
  });

  it("refreshes the core status after initial load", async () => {
    vi.useFakeTimers();
    const api = createApi();
    renderLibrary(api);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Library service ready")).toBeVisible();
    api.system.getStatus = vi.fn().mockResolvedValue({ state: "retrying", message: "Restarting core service" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(screen.getByText("Reconnecting to library service")).toBeVisible();
    expect(screen.getByText("Restarting core service")).toBeVisible();
  });

  it("labels missing tracks with an icon and readable status text", async () => {
    renderLibrary();

    const row = await screen.findByRole("row", { name: /Blue Monday/ });
    expect(within(row).getByText("⚠", { selector: '[aria-hidden="true"]' })).toBeVisible();
    expect(within(row).getByText("Missing")).toBeVisible();
  });

  it("imports Rekordbox XML when the primary toolbar control is used", async () => {
    const user = userEvent.setup();
    const { api } = renderLibrary();

    await screen.findByText("Library service ready");
    await user.click(screen.getByRole("button", { name: "Import Rekordbox XML" }));

    expect(api.library.importXml).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("4 tracks imported and 2 playlists.")).toBeVisible();
  });

  it("keeps visible rows and raises an alert when import preserves the previous library", async () => {
    const user = userEvent.setup();
    const { api } = renderLibrary(createApi({
      importResult: {
        success: false,
        error: { code: "unsafe_xml", message: "DTD is not allowed" },
        preservedPreviousLibrary: true,
      },
    }));

    expect(await screen.findByText("Blue Monday")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Import Rekordbox XML" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("DTD is not allowed. Your existing library is still available.");
    expect(screen.getByText("Blue Monday")).toBeVisible();
    expect(api.library.importXml).toHaveBeenCalledTimes(1);
  });

  it("keeps rows and announces nothing when the native import picker is cancelled", async () => {
    const user = userEvent.setup();
    const { api } = renderLibrary(createApi({
      importResult: {
        success: false,
        error: { code: "cancelled", message: "Import cancelled" },
        preservedPreviousLibrary: true,
      },
    }));

    expect(await screen.findByText("Blue Monday")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Import Rekordbox XML" }));

    expect(api.library.importXml).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Blue Monday")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Import cancelled")).not.toBeInTheDocument();
  });

  it("loads the selected playlist with its playlist id", async () => {
    const user = userEvent.setup();
    const { api } = renderLibrary();

    const warmup = await screen.findByRole("treeitem", { name: /Warmup/ });
    await user.click(warmup);

    expect(api.library.listTracks).toHaveBeenLastCalledWith({ playlistId: "playlist-warmup" });
  });

  it("toggles folders on mouse click without requesting their direct tracks", async () => {
    const user = userEvent.setup();
    const { api } = renderLibrary();
    const nightSets = await screen.findByRole("treeitem", { name: /Night sets/ });

    expect(nightSets).not.toHaveTextContent("0");
    await user.click(nightSets);
    expect(screen.queryByRole("treeitem", { name: /Warmup/ })).not.toBeInTheDocument();
    expect(api.library.listTracks).not.toHaveBeenCalledWith({ playlistId: "folder-night" });

    await user.click(nightSets);
    expect(screen.getByRole("treeitem", { name: /Warmup/ })).toBeVisible();
    expect(api.library.listTracks).not.toHaveBeenCalledWith({ playlistId: "folder-night" });
  });

  it("appends the next track page and resets pagination for a playlist selection", async () => {
    const user = userEvent.setup();
    const api = createApi();
    let resolveNextPage: ((page: { items: TrackListItem[]; nextCursor: null; truncated: false }) => void) | undefined;
    api.library.listTracks = vi.fn()
      .mockResolvedValueOnce({ items: tracks.slice(0, 2), nextCursor: "cursor-2", truncated: false })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveNextPage = resolve;
      }))
      .mockResolvedValueOnce({ items: [tracks[3]], nextCursor: null, truncated: false });
    renderLibrary(api);

    expect(await screen.findByText("Blue Monday")).toBeVisible();
    const loadMore = screen.getByRole("button", { name: "Load more tracks" });
    await user.click(loadMore);
    expect(loadMore).toBeDisabled();

    expect(api.library.listTracks).toHaveBeenLastCalledWith({ cursor: "cursor-2" });
    if (resolveNextPage === undefined) throw new Error("Expected the next page request");
    const nextPageResolver = resolveNextPage;
    await act(async () => {
      nextPageResolver({ items: tracks.slice(2), nextCursor: null, truncated: false });
    });
    expect(await screen.findByText("Ain't No Mountain High Enough")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Load more tracks" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("treeitem", { name: /Warmup/ }));
    expect(await screen.findByText("Untitled track")).toBeVisible();
    expect(screen.queryByText("Blue Monday")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more tracks" })).not.toBeInTheDocument();
  });

  it("supports tree navigation with arrows and Enter selection", async () => {
    const user = userEvent.setup();
    const { api } = renderLibrary();
    const allTracks = await screen.findByRole("treeitem", { name: /All Tracks/ });

    allTracks.focus();
    await user.keyboard("{ArrowDown}{ArrowLeft}");
    expect(screen.queryByRole("treeitem", { name: /Warmup/ })).not.toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("treeitem", { name: /Warmup/ })).toBeVisible();
    expect(screen.getByRole("treeitem", { name: /Night sets/ })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("treeitem", { name: /Warmup/ })).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(api.library.listTracks).toHaveBeenLastCalledWith({ playlistId: "playlist-warmup" });

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("treeitem", { name: /Night sets/ })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.queryByRole("treeitem", { name: /Warmup/ })).not.toBeInTheDocument();
    await user.keyboard("{ArrowUp}");
    expect(allTracks).toHaveFocus();
  });

  it("assigns a bounded visual depth token to arbitrarily nested tree items", () => {
    render(
      <PlaylistTree
        nodes={[
          { id: "root", parentId: null, name: "Root", kind: "folder", order: 0, trackCount: 0 },
          { id: "warmup", parentId: "root", name: "Warmup", kind: "folder", order: 0, trackCount: 0 },
          { id: "opening", parentId: "warmup", name: "Opening", kind: "playlist", order: 0, trackCount: 1 },
        ]}
        selectedId={null}
        onSelect={() => undefined}
      />,
    );

    const opening = screen.getByRole("treeitem", { name: /Opening/ });
    expect(opening).toHaveAttribute("aria-level", "3");
    expect(opening).toHaveStyle("--tree-indent: 2rem");
  });

  it("keeps import, tree, and track table reachable with semantic controls", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await screen.findByText("Library service ready");

    await user.tab();
    expect(screen.getByRole("button", { name: "Import Rekordbox XML" })).toHaveFocus();

    const expectedTabOrder = [
      screen.getByRole("searchbox", { name: "Search library" }),
      screen.getByRole("spinbutton", { name: "Minimum BPM" }),
      screen.getByRole("spinbutton", { name: "Maximum BPM" }),
      screen.getByRole("textbox", { name: "Musical key" }),
      screen.getByRole("textbox", { name: "Genre" }),
      screen.getByRole("spinbutton", { name: "Minimum energy (%)" }),
      screen.getByRole("spinbutton", { name: "Maximum energy (%)" }),
      screen.getByRole("combobox", { name: "Analysis state" }),
      screen.getByRole("combobox", { name: "Availability" }),
      screen.getByRole("button", { name: "Apply filters" }),
      screen.getByRole("checkbox", { name: "Select all analyzable tracks" }),
      screen.getByRole("checkbox", { name: "Select Sæglópur for analysis" }),
      screen.getByRole("button", { name: "Explore Sæglópur" }),
      screen.getByRole("button", { name: "Explore Blue Monday" }),
      screen.getByRole("button", { name: "Explore Ain't No Mountain High Enough" }),
      screen.getByRole("checkbox", { name: "Select Untitled track for analysis" }),
      screen.getByRole("button", { name: "Explore Untitled track" }),
      screen.getByRole("treeitem", { name: /All Tracks/ }),
    ];

    for (const control of expectedTabOrder) {
      await user.tab();
      expect(control).toHaveFocus();
    }
    expect(screen.getByRole("navigation", { name: "Library navigation" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Imported BPM" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Local BPM" })).toBeInTheDocument();
  });

  it("gives a degraded core state an actionable next step", async () => {
    renderLibrary(createApi({ status: { state: "degraded", message: "Core process stopped" } }));

    expect(await screen.findByText("Library service is unavailable")).toBeVisible();
    expect(screen.getByText("Quit and reopen DJ Copilot, then try again.")).toBeVisible();
  });

  it("invites import when the library is empty", async () => {
    renderLibrary(createApi({ tree: [], tracks: [] }));

    expect(await screen.findByText("No tracks imported yet")).toBeVisible();
    expect(screen.getByText("Import a Rekordbox XML file to start browsing your library.")).toBeVisible();
  });
});
