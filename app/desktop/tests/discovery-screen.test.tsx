import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisQueueStatus,
  DesktopApi,
  DiscoveryCandidate,
  DiscoveryTrack,
  PlaylistTreeNode,
  RecommendationResponse,
  SimilarityResponse,
  TrackListItem,
  TrackPage,
  TrackPageQuery,
} from "../src/shared/contracts";
import { LibraryScreen } from "../src/renderer/src/features/library/LibraryScreen";

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

function track(id: string, title: string, overrides: Partial<TrackListItem> = {}): TrackListItem {
  return {
    id,
    title,
    artist: `Artist ${id}`,
    album: "Generated fixtures",
    genre: "House",
    bpmMilli: 124_000,
    musicalKey: "8A",
    durationMs: 240_000,
    availability: "available",
    analysis: null,
    ...overrides,
  };
}

const tracks = [
  track("track-alpha", "Alpha"),
  track("track-beta", "Beta"),
  track("track-gamma", "Gamma", { availability: "missing" }),
];

const playlists: PlaylistTreeNode[] = [
  { id: "playlist-warmup", parentId: null, name: "Warmup", kind: "playlist", order: 0, trackCount: 3 },
];

function discoveryTrack(source: TrackListItem): DiscoveryTrack {
  return {
    id: source.id,
    title: source.title,
    artist: source.artist,
    album: source.album,
    genre: source.genre,
    bpmMilli: source.bpmMilli,
    musicalKey: source.musicalKey,
    durationMs: source.durationMs,
    availability: source.availability,
  };
}

const evidenceComponents: DiscoveryCandidate["components"] = [
  {
    name: "tempo",
    scorePpm: 920_000,
    weightPpm: 250_000,
    contributionSignedPpm: 210_000,
    effect: "bonus",
    reason: "Tempo is closely aligned.",
  },
  {
    name: "key",
    scorePpm: 120_000,
    weightPpm: 250_000,
    contributionSignedPpm: -190_000,
    effect: "penalty",
    reason: "Keys are not harmonically compatible.",
  },
  {
    name: "energy",
    scorePpm: 500_000,
    weightPpm: 200_000,
    contributionSignedPpm: 0,
    effect: "neutral",
    reason: "Energy evidence is mixed.",
  },
  {
    name: "timbre",
    scorePpm: null,
    weightPpm: 150_000,
    contributionSignedPpm: 0,
    effect: "missing",
    reason: "Local timbre evidence is unavailable.",
  },
];

function candidate(
  id: string,
  title: string,
  scorePpm: number,
  confidencePpm: number,
  components: DiscoveryCandidate["components"] = evidenceComponents,
): DiscoveryCandidate {
  return {
    track: discoveryTrack(track(id, title)),
    scorePpm,
    confidencePpm,
    reasons: [`${title} keeps the transition coherent.`, `${title} has useful local evidence.`],
    components,
  };
}

function similarity(
  seed = tracks[0]!,
  items: DiscoveryCandidate[] = [
    candidate("match-one", "Match One", 920_000, 810_000),
    candidate("match-two", "Match Two", 840_000, 760_000),
  ],
): SimilarityResponse {
  return {
    seed: discoveryTrack(seed),
    algorithmVersion: "feature-similarity-v1",
    scannedCount: 8,
    truncated: false,
    items,
  };
}

function recommendation(
  intent: RecommendationResponse["intent"] = "smooth",
  items: DiscoveryCandidate[] = [candidate("next-one", "Next One", 880_000, 730_000)],
): RecommendationResponse {
  return {
    seed: discoveryTrack(tracks[0]!),
    intent,
    algorithmVersion: "transition-v1",
    scannedCount: 8,
    truncated: false,
    items,
  };
}

function page(items = tracks, nextCursor: string | null = null, truncated = false): TrackPage {
  return { items, nextCursor, truncated };
}

function createApi(): DesktopApi {
  return {
    system: {
      getStatus: vi.fn().mockResolvedValue({ state: "ready", message: null }),
    },
    library: {
      importXml: vi.fn().mockResolvedValue({
        success: false,
        error: { code: "cancelled", message: "Import cancelled" },
        preservedPreviousLibrary: true,
      }),
      getPlaylistTree: vi.fn().mockResolvedValue(playlists),
      listTracks: vi.fn().mockResolvedValue(page()),
    },
    analysis: {
      queue: vi.fn().mockResolvedValue(analysisStatus),
      getStatus: vi.fn().mockResolvedValue(analysisStatus),
      pause: vi.fn().mockResolvedValue({ ...analysisStatus, state: "paused" }),
      resume: vi.fn().mockResolvedValue({ ...analysisStatus, state: "running" }),
    },
    discovery: {
      findSimilar: vi.fn().mockResolvedValue(similarity()),
      recommendNext: vi.fn().mockResolvedValue(recommendation()),
    },
  };
}

function renderLibrary(api = createApi()) {
  Object.defineProperty(window, "djCopilot", { configurable: true, value: api });
  return { api, ...render(<LibraryScreen />) };
}

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    promise,
    resolve(value: T) {
      if (resolve === undefined) throw new Error("Deferred promise was not initialized");
      resolve(value);
    },
    reject(reason?: unknown) {
      if (reject === undefined) throw new Error("Deferred promise was not initialized");
      reject(reason);
    },
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, "djCopilot");
});

describe("discovery filters", () => {
  it("exposes every bounded filter with a programmatic label and applies human-scale values with Enter", async () => {
    const user = userEvent.setup();
    const { api } = renderLibrary();
    await screen.findByText("Alpha");

    const filters = screen.getByRole("region", { name: "Library filters" });
    const search = within(filters).getByRole("searchbox", { name: "Search library" });
    expect(within(filters).getByRole("spinbutton", { name: "Minimum BPM" })).toBeVisible();
    expect(within(filters).getByRole("spinbutton", { name: "Maximum BPM" })).toBeVisible();
    expect(within(filters).getByRole("textbox", { name: "Musical key" })).toBeVisible();
    expect(within(filters).getByRole("combobox", { name: "Key relation" })).toBeVisible();
    expect(within(filters).getByRole("textbox", { name: "Genre" })).toBeVisible();
    expect(within(filters).getByRole("spinbutton", { name: "Minimum energy (%)" })).toBeVisible();
    expect(within(filters).getByRole("spinbutton", { name: "Maximum energy (%)" })).toBeVisible();
    expect(within(filters).getByRole("combobox", { name: "Analysis state" })).toBeVisible();
    expect(within(filters).getByRole("combobox", { name: "Availability" })).toBeVisible();

    await user.type(search, "  night drive  ");
    await user.type(within(filters).getByRole("spinbutton", { name: "Minimum BPM" }), "120");
    await user.type(within(filters).getByRole("spinbutton", { name: "Maximum BPM" }), "128.5");
    await user.type(within(filters).getByRole("textbox", { name: "Musical key" }), "8A");
    await user.selectOptions(within(filters).getByRole("combobox", { name: "Key relation" }), "compatible");
    await user.type(within(filters).getByRole("textbox", { name: "Genre" }), " House ");
    await user.type(within(filters).getByRole("spinbutton", { name: "Minimum energy (%)" }), "40");
    await user.type(within(filters).getByRole("spinbutton", { name: "Maximum energy (%)" }), "80");
    await user.selectOptions(within(filters).getByRole("combobox", { name: "Analysis state" }), "analyzed");
    await user.selectOptions(within(filters).getByRole("combobox", { name: "Availability" }), "available");
    await user.type(search, "{Enter}");

    expect(api.library.listTracks).toHaveBeenLastCalledWith({
      text: "night drive",
      bpmMinMilli: 120_000,
      bpmMaxMilli: 128_500,
      musicalKey: "8A",
      keyRelation: "compatible",
      genre: "House",
      energyMinPpm: 400_000,
      energyMaxPpm: 800_000,
      analysisState: "analyzed",
      availability: "available",
    });
  });

  it("keeps active filters composed with playlist selection, paging, discovery, and Clear", async () => {
    const user = userEvent.setup();
    const api = createApi();
    api.library.listTracks = vi.fn(async (query?: TrackPageQuery) => {
      if (query?.cursor === "filtered-page-2") return page([tracks[2]!]);
      if (query?.text === "night") return page(tracks.slice(0, 2), "filtered-page-2");
      return page();
    });
    renderLibrary(api);
    await screen.findByText("Alpha");

    await user.click(screen.getByRole("treeitem", { name: /Warmup/ }));
    const filters = screen.getByRole("region", { name: "Library filters" });
    await user.type(within(filters).getByRole("searchbox", { name: "Search library" }), "night");
    await user.click(within(filters).getByRole("button", { name: "Apply filters" }));
    expect(api.library.listTracks).toHaveBeenLastCalledWith({ playlistId: "playlist-warmup", text: "night" });

    await user.click(screen.getByRole("button", { name: "Load more tracks" }));
    expect(api.library.listTracks).toHaveBeenLastCalledWith({
      playlistId: "playlist-warmup",
      text: "night",
      cursor: "filtered-page-2",
    });

    await user.click(screen.getByRole("button", { name: "Explore Alpha" }));
    expect(api.discovery.findSimilar).toHaveBeenLastCalledWith({
      seedTrackId: "track-alpha",
      filters: { playlistId: "playlist-warmup", text: "night" },
      limit: 10,
    });

    await user.click(within(filters).getByRole("button", { name: "Clear filters" }));
    expect(api.library.listTracks).toHaveBeenLastCalledWith({ playlistId: "playlist-warmup" });
  });

  it("shows loading, filtered-empty, truncated, and recoverable track-load error states", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const pendingPage = deferred<TrackPage>();
    api.library.listTracks = vi.fn()
      .mockResolvedValueOnce(page())
      .mockImplementationOnce(() => pendingPage.promise)
      .mockResolvedValueOnce(page([], null, true))
      .mockRejectedValueOnce(new Error("The library query timed out."));
    renderLibrary(api);
    await screen.findByText("Alpha");

    const filters = screen.getByRole("region", { name: "Library filters" });
    const search = within(filters).getByRole("searchbox", { name: "Search library" });
    await user.type(search, "empty{Enter}");
    expect(screen.getByText("Loading tracks…")).toBeVisible();
    expect(within(filters).getByRole("button", { name: "Filtering…" })).toBeDisabled();

    await act(async () => pendingPage.resolve(page([], null, true)));
    expect(await screen.findByText("No tracks match these filters")).toBeVisible();
    expect(screen.getByText("Showing results from the first 25,000 scanned tracks.")).toBeVisible();

    await user.clear(search);
    await user.type(search, "still empty{Enter}");
    expect(await screen.findByText("No tracks match these filters")).toBeVisible();

    await user.clear(search);
    await user.type(search, "broken{Enter}");
    expect(await screen.findByText("Tracks could not be loaded")).toBeVisible();
    expect(screen.getByText(/Some library data could not be loaded: The library query timed out\./)).toBeVisible();
  });
});

describe("inline discovery", () => {
  it("opens from an accessible row action, moves focus, and renders ordered score evidence in native details", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await screen.findByText("Alpha");

    await user.click(screen.getByRole("button", { name: "Explore Alpha" }));
    const heading = await screen.findByRole("heading", { name: "Explore Alpha" });
    expect(heading).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Similar" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Next" })).toHaveAttribute("aria-selected", "false");

    const candidates = await screen.findByRole("list", { name: "Similar candidates" });
    expect(within(candidates).getAllByRole("heading", { level: 3 }).map((item) => item.textContent))
      .toEqual(["Match One", "Match Two"]);
    const matchOne = within(candidates).getByRole("listitem", { name: /Match One/ });
    expect(within(matchOne).getByText("Score 92%")) .toBeVisible();
    expect(within(matchOne).getByText("Confidence 81%")) .toBeVisible();
    expect(within(matchOne).getByText("Match One keeps the transition coherent.")).toBeVisible();

    const evidenceSummary = within(matchOne).getByText("Score evidence for Match One");
    const details = evidenceSummary.closest("details");
    expect(details).not.toHaveAttribute("open");
    await user.click(evidenceSummary);
    expect(details).toHaveAttribute("open");
    expect(within(matchOne).getByText("Bonus")).toBeVisible();
    expect(within(matchOne).getByText("Penalty")).toBeVisible();
    expect(within(matchOne).getByText("Neutral")).toBeVisible();
    expect(within(matchOne).getByText("Missing evidence")).toBeVisible();
  });

  it("supports keyboard tab selection and exposes all eight next-track intents", async () => {
    const user = userEvent.setup();
    const { api } = renderLibrary();
    await screen.findByText("Alpha");
    await user.click(screen.getByRole("button", { name: "Explore Alpha" }));

    const similarTab = screen.getByRole("tab", { name: "Similar" });
    const nextTab = screen.getByRole("tab", { name: "Next" });
    similarTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(nextTab).toHaveFocus();
    expect(nextTab).toHaveAttribute("aria-selected", "true");
    expect(api.discovery.recommendNext).toHaveBeenLastCalledWith({
      seedTrackId: "track-alpha",
      intent: "smooth",
      limit: 10,
    });

    const intent = screen.getByRole("combobox", { name: "Transition intent" });
    expect(within(intent).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Smooth",
      "Build",
      "Peak",
      "Reset",
      "Genre shift",
      "Adventurous",
      "Singalong continuation",
      "Closer",
    ]);
    await user.selectOptions(intent, "genre_shift");
    expect(api.discovery.recommendNext).toHaveBeenLastCalledWith({
      seedTrackId: "track-alpha",
      intent: "genre_shift",
      limit: 10,
    });

    nextTab.focus();
    await user.keyboard("{Home}");
    expect(similarTab).toHaveFocus();
    expect(similarTab).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the last successful result visible during loading and after a later request fails", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const failingRequest = deferred<SimilarityResponse>();
    api.discovery.findSimilar = vi.fn()
      .mockResolvedValueOnce(similarity())
      .mockImplementationOnce(() => failingRequest.promise);
    renderLibrary(api);
    await screen.findByText("Alpha");
    await user.click(screen.getByRole("button", { name: "Explore Alpha" }));
    expect(await screen.findByText("Match One")).toBeVisible();

    const filters = screen.getByRole("region", { name: "Library filters" });
    await user.type(within(filters).getByRole("searchbox", { name: "Search library" }), "house{Enter}");
    expect(await screen.findByRole("status", { name: "Discovery request status" })).toHaveTextContent("Finding similar tracks…");
    expect(screen.getByText("Match One")).toBeVisible();

    await act(async () => failingRequest.reject(new Error("Discovery timed out.")));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Similar tracks could not be loaded. Showing the last successful results.",
    );
    expect(screen.getByText("Match One")).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry similar tracks" })).toBeEnabled();
  });

  it("renders an actionable empty recommendation state", async () => {
    const user = userEvent.setup();
    const api = createApi();
    api.discovery.recommendNext = vi.fn().mockResolvedValue(recommendation("smooth", []));
    renderLibrary(api);
    await screen.findByText("Alpha");
    await user.click(screen.getByRole("button", { name: "Explore Alpha" }));
    await user.click(screen.getByRole("tab", { name: "Next" }));

    expect(await screen.findByText("No candidates matched")).toBeVisible();
    expect(screen.getByText("Try another intent, loosen the filters, or choose a different seed.")).toBeVisible();
  });

  it("suppresses a stale response after a newer seed succeeds", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const alphaRequest = deferred<SimilarityResponse>();
    const betaRequest = deferred<SimilarityResponse>();
    api.discovery.findSimilar = vi.fn((request) => (
      request.seedTrackId === "track-alpha" ? alphaRequest.promise : betaRequest.promise
    ));
    renderLibrary(api);
    await screen.findByText("Alpha");

    await user.click(screen.getByRole("button", { name: "Explore Alpha" }));
    await user.click(screen.getByRole("button", { name: "Explore Beta" }));
    await act(async () => betaRequest.resolve(similarity(tracks[1]!, [candidate("fresh", "Fresh Result", 900_000, 800_000)])));
    expect(await screen.findByText("Fresh Result")).toBeVisible();

    await act(async () => alphaRequest.resolve(similarity(tracks[0]!, [candidate("stale", "Stale Result", 990_000, 900_000)])));
    expect(screen.queryByText("Stale Result")).not.toBeInTheDocument();
    expect(screen.getByText("Fresh Result")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Explore Beta" })).toBeVisible();
  });
});
