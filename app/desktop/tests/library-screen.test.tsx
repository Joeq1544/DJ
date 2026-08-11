import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AppStatus,
  DesktopApi,
  ImportResult,
  PlaylistTreeNode,
  TrackListItem,
} from "../src/shared/contracts";
import { LibraryScreen } from "../src/renderer/src/features/library/LibraryScreen";

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
      listTracks: vi.fn().mockResolvedValue({ items: options.tracks ?? tracks, nextCursor: null }),
    },
  };
}

function renderLibrary(api = createApi()) {
  Object.defineProperty(window, "djCopilot", { configurable: true, value: api });
  return { api, ...render(<LibraryScreen />) };
}

afterEach(() => {
  Reflect.deleteProperty(window, "djCopilot");
});

describe("LibraryScreen", () => {
  it("shows loading before the initial library data arrives", () => {
    const api = createApi();
    api.system.getStatus = vi.fn(() => new Promise<AppStatus>(() => undefined));
    renderLibrary(api);

    expect(screen.getByRole("status")).toHaveTextContent("Loading library workspace");
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

  it("supports tree navigation with arrows and Enter selection", async () => {
    const user = userEvent.setup();
    const { api } = renderLibrary();
    const allTracks = await screen.findByRole("treeitem", { name: /All Tracks/ });

    allTracks.focus();
    await user.keyboard("{ArrowDown}{ArrowRight}{ArrowDown}");
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

  it("keeps import, tree, and track table reachable with semantic controls", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await screen.findByText("Library service ready");

    await user.tab();
    expect(screen.getByRole("button", { name: "Import Rekordbox XML" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("treeitem", { name: /All Tracks/ })).toHaveFocus();
    expect(screen.getByRole("navigation", { name: "Library navigation" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "BPM" })).toBeInTheDocument();
  });

  it("gives a degraded core state an actionable next step", async () => {
    renderLibrary(createApi({ status: { state: "degraded", message: "Core process stopped" } }));

    expect(await screen.findByText("Library service is unavailable")).toBeVisible();
    expect(screen.getByText("Start the DJ Copilot core service, then import or refresh this library.")).toBeVisible();
  });

  it("invites import when the library is empty", async () => {
    renderLibrary(createApi({ tree: [], tracks: [] }));

    expect(await screen.findByText("No tracks imported yet")).toBeVisible();
    expect(screen.getByText("Import a Rekordbox XML file to start browsing your library.")).toBeVisible();
  });
});
