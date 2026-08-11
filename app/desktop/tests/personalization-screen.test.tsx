import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisQueueStatus,
  CompareRecommendationsResponse,
  DesktopApi,
  DiscoveryCandidate,
  DiscoveryTrack,
  PlaylistTreeNode,
  PreferenceProfile,
  RecommendationResponse,
  SavedFilter,
  TrackListItem,
  TrackMetadata,
  TrackPageQuery,
} from "../src/shared/contracts";
import { LibraryScreen } from "../src/renderer/src/features/library/LibraryScreen";

const emptyEventCounts: PreferenceProfile["eventCounts"] = {
  liked: 0,
  disliked: 0,
  accepted: 0,
  rejected: 0,
  skipped: 0,
  manualReplacement: 0,
  manualReorder: 0,
  pinned: 0,
  removed: 0,
  banned: 0,
};

function profile(
  status: PreferenceProfile["status"],
  effectiveEvidenceCount: number,
  overrides: Partial<PreferenceProfile> = {},
): PreferenceProfile {
  return {
    algorithmVersion: "preference-linear-v1",
    revision: (status === "baseline" ? "a" : status === "learning" ? "b" : "c").repeat(64),
    status,
    totalPersonalDataCount: effectiveEvidenceCount,
    effectiveEvidenceCount,
    minimumEvidenceCount: 5,
    preferenceWeightPpm: status === "active" ? Math.min(150_000, (effectiveEvidenceCount - 4) * 15_000) : 0,
    eventCounts: emptyEventCounts,
    trackAffinities: [],
    trackAffinitiesTruncated: false,
    genreAffinities: [],
    genreAffinitiesTruncated: false,
    ...overrides,
  };
}

const baselineProfile = profile("baseline", 0);
const learningProfile = profile("learning", 2, {
  eventCounts: { ...emptyEventCounts, liked: 1, accepted: 1 },
});
const activeProfile = profile("active", 5, {
  eventCounts: { ...emptyEventCounts, liked: 2, accepted: 2, skipped: 1 },
  trackAffinities: [
    { trackId: "track-alpha", title: "Alpha", artist: "Artist A", scorePpm: 1_000_000, evidenceCount: 3 },
  ],
  genreAffinities: [{ genre: "House", scorePpm: 750_000, evidenceCount: 2 }],
});

function track(
  id: string,
  title: string,
  userMetadata: TrackListItem["userMetadata"] = { rating: null, tags: [], note: null },
): TrackListItem {
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
    userMetadata,
  };
}

const initialTracks = [
  track("track-alpha", "Alpha", { rating: 4, tags: ["Warm"], note: "Opening option" }),
  track("track-beta", "Beta"),
];

const playlists: PlaylistTreeNode[] = [
  { id: "playlist-warmup", parentId: null, name: "Warmup", kind: "playlist", order: 0, trackCount: 2 },
];

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

function discoveryTrack(item: TrackListItem): DiscoveryTrack {
  const { analysis: _analysis, userMetadata: _userMetadata, ...value } = item;
  return value;
}

function candidate(item: TrackListItem, scorePpm: number): DiscoveryCandidate {
  return {
    track: discoveryTrack(item),
    scorePpm,
    confidencePpm: 800_000,
    reasons: [`${item.title} fits the transition.`],
    components: [{
      name: "tempo",
      scorePpm: 800_000,
      weightPpm: 1_000_000,
      contributionSignedPpm: 300_000,
      effect: "bonus",
      reason: "Tempo is aligned.",
    }],
  };
}

const nextOne = candidate(track("next-one", "Next One"), 900_000);
const nextTwo = candidate(track("next-two", "Next Two"), 850_000);

function recommendation(
  items: DiscoveryCandidate[],
  algorithmVersion: RecommendationResponse["algorithmVersion"],
): RecommendationResponse {
  return {
    seed: discoveryTrack(initialTracks[0]!),
    intent: "smooth",
    algorithmVersion,
    scannedCount: 8,
    truncated: false,
    items,
  };
}

function comparison(currentProfile: PreferenceProfile): CompareRecommendationsResponse {
  const isActive = currentProfile.status === "active";
  return {
    profile: currentProfile,
    baseline: recommendation([nextOne, nextTwo], "transition-v1"),
    personalized: recommendation(
      isActive ? [nextTwo, nextOne] : [nextOne, nextTwo],
      isActive ? "transition-v1+preference-linear-v1" : "transition-v1",
    ),
    rankChanges: isActive
      ? [
          { trackId: "next-one", baselineRank: 1, personalizedRank: 2, delta: -1 },
          { trackId: "next-two", baselineRank: 2, personalizedRank: 1, delta: 1 },
        ]
      : [
          { trackId: "next-one", baselineRank: 1, personalizedRank: 1, delta: 0 },
          { trackId: "next-two", baselineRank: 2, personalizedRank: 2, delta: 0 },
        ],
  };
}

const metadata: TrackMetadata = {
  trackId: "track-alpha",
  rating: 4,
  tags: ["Warm"],
  note: "Opening option",
  updatedAt: "2026-08-11T12:00:00Z",
};

const savedFilters: SavedFilter[] = [
  {
    id: "filter-valid",
    name: "Warm picks",
    filters: { playlistId: "playlist-warmup", text: "night", ratingMin: 4, tag: "Warm" },
    createdAt: "2026-08-11T12:00:00Z",
    updatedAt: "2026-08-11T12:00:00Z",
  },
  {
    id: "filter-stale",
    name: "Missing playlist",
    filters: { playlistId: "playlist-gone", tag: "Peak" },
    createdAt: "2026-08-11T12:00:00Z",
    updatedAt: "2026-08-11T12:00:00Z",
  },
];

function createApi(): DesktopApi {
  let visibleTracks = initialTracks;
  return {
    system: { getStatus: vi.fn().mockResolvedValue({ state: "ready", message: null }) },
    library: {
      importXml: vi.fn().mockResolvedValue({
        success: false,
        error: { code: "cancelled", message: "Import cancelled" },
        preservedPreviousLibrary: true,
      }),
      getPlaylistTree: vi.fn().mockResolvedValue(playlists),
      listTracks: vi.fn(async (_query?: TrackPageQuery) => ({ items: visibleTracks, nextCursor: null, truncated: false })),
      getTrackMetadata: vi.fn().mockResolvedValue(metadata),
      updateTrackMetadata: vi.fn(async (request) => {
        const saved = { ...request, updatedAt: "2026-08-11T12:05:00Z" };
        visibleTracks = visibleTracks.map((item) => item.id === request.trackId
          ? { ...item, userMetadata: { rating: request.rating, tags: request.tags, note: request.note } }
          : item);
        return saved;
      }),
      listSavedFilters: vi.fn().mockResolvedValue({ items: savedFilters }),
      saveSavedFilter: vi.fn(async (request) => ({
        id: request.id ?? "filter-new",
        name: request.name,
        filters: request.filters,
        createdAt: "2026-08-11T12:00:00Z",
        updatedAt: "2026-08-11T12:00:00Z",
      })),
      deleteSavedFilter: vi.fn().mockResolvedValue({ deleted: true }),
    },
    analysis: {
      queue: vi.fn().mockResolvedValue(analysisStatus),
      getStatus: vi.fn().mockResolvedValue(analysisStatus),
      pause: vi.fn().mockResolvedValue(analysisStatus),
      resume: vi.fn().mockResolvedValue(analysisStatus),
    },
    discovery: {
      findSimilar: vi.fn().mockResolvedValue({
        seed: discoveryTrack(initialTracks[0]!),
        algorithmVersion: "feature-similarity-v1",
        scannedCount: 2,
        truncated: false,
        items: [],
      }),
      recommendNext: vi.fn().mockResolvedValue(recommendation([nextOne, nextTwo], "transition-v1")),
    },
    preferences: {
      getProfile: vi.fn().mockResolvedValue(baselineProfile),
      recordFeedback: vi.fn().mockResolvedValue({ recorded: true, profile: learningProfile }),
      compareRecommendations: vi.fn().mockResolvedValue(comparison(learningProfile)),
      reset: vi.fn().mockResolvedValue({
        status: "reset",
        clearedFeedbackCount: 5,
        clearedRatingCount: 1,
        profile: baselineProfile,
      }),
      prepareExport: vi.fn().mockResolvedValue({
        status: "ready",
        confirmationId: "preference-confirmation",
        destinationDisplay: "dj-preferences.json",
        willReplaceExisting: true,
        effectiveEvidenceCount: 5,
        profileStatus: "active",
      }),
      confirmExport: vi.fn().mockResolvedValue({
        status: "exported",
        overwritten: true,
        format: "dj-copilot-preferences-v1",
        destinationState: "replaced",
      }),
    },
    assistant: {
      getStatus: vi.fn().mockResolvedValue({ state: "unavailable", auth: "unknown", message: "Copilot is not configured in this test.", sdkVersion: null }),
      beginLogin: vi.fn(async () => { throw new Error("Copilot is not configured in this personalization test."); }),
      start: vi.fn(async () => { throw new Error("Copilot is not configured in this personalization test."); }),
      poll: vi.fn(async () => { throw new Error("Copilot is not configured in this personalization test."); }),
      cancel: vi.fn(async () => { throw new Error("Copilot is not configured in this personalization test."); }),
      confirm: vi.fn(async () => { throw new Error("Copilot is not configured in this personalization test."); }),
    },
    sets: {
      list: vi.fn().mockResolvedValue({ items: [] }),
      create: vi.fn(async () => { throw new Error("Sets are not configured in this personalization test."); }),
      get: vi.fn(async () => { throw new Error("Sets are not configured in this personalization test."); }),
      mutate: vi.fn(async () => { throw new Error("Sets are not configured in this personalization test."); }),
      findReplacements: vi.fn(async () => { throw new Error("Sets are not configured in this personalization test."); }),
      inspect: vi.fn(async () => { throw new Error("Sets are not configured in this personalization test."); }),
    },
    exports: {
      prepare: vi.fn(async () => { throw new Error("Set exports are not configured in this personalization test."); }),
      confirm: vi.fn(async () => { throw new Error("Set exports are not configured in this personalization test."); }),
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

describe("personal library metadata", () => {
  it("loads, saves, and restores last-saved metadata while recording direct feedback", async () => {
    const user = userEvent.setup();
    const { api } = renderLibrary();
    await screen.findByText("Alpha");

    const editTrigger = screen.getByRole("button", { name: "Edit details for Alpha" });
    await user.click(editTrigger);
    const panel = await screen.findByRole("region", { name: "Personal details for Alpha" });
    expect(within(panel).getByRole("combobox", { name: "Rating" })).toHaveValue("4");
    expect(within(panel).getByRole("textbox", { name: "Tags" })).toHaveValue("Warm");
    expect(within(panel).getByRole("textbox", { name: "Notes" })).toHaveValue("Opening option");

    await user.selectOptions(within(panel).getByRole("combobox", { name: "Rating" }), "5");
    await user.clear(within(panel).getByRole("textbox", { name: "Tags" }));
    await user.type(within(panel).getByRole("textbox", { name: "Tags" }), " Peak , Vocal , peak ");
    await user.clear(within(panel).getByRole("textbox", { name: "Notes" }));
    await user.type(within(panel).getByRole("textbox", { name: "Notes" }), "  Late set choice  ");
    await user.click(within(panel).getByRole("button", { name: "Save personal details" }));

    expect(api.library.updateTrackMetadata).toHaveBeenCalledWith({
      trackId: "track-alpha",
      rating: 5,
      tags: ["Peak", "Vocal"],
      note: "Late set choice",
    });
    expect(await within(panel).findByText("Personal details saved.")).toBeVisible();
    expect(await screen.findByText("★★★★★")).toBeVisible();
    expect(screen.getByText("Peak · Vocal")).toBeVisible();

    vi.mocked(api.library.updateTrackMetadata).mockRejectedValueOnce(new Error("The metadata store is busy."));
    await user.selectOptions(within(panel).getByRole("combobox", { name: "Rating" }), "1");
    await user.click(within(panel).getByRole("button", { name: "Save personal details" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("The metadata store is busy.");
    expect(within(panel).getByRole("combobox", { name: "Rating" })).toHaveValue("5");

    await user.click(within(panel).getByRole("button", { name: "Like Alpha" }));
    expect(api.preferences.recordFeedback).toHaveBeenCalledWith({ type: "liked", trackId: "track-alpha" });
    expect(await within(panel).findByText("Like recorded.")).toBeVisible();
    expect(await screen.findByText(/Learning from 2 of 5 signals/u)).toBeVisible();

    await user.click(within(panel).getByRole("button", { name: "Dislike Alpha" }));
    expect(api.preferences.recordFeedback).toHaveBeenLastCalledWith({ type: "disliked", trackId: "track-alpha" });
    expect(await within(panel).findByText("Dislike recorded.")).toBeVisible();
    await user.click(within(panel).getByRole("button", { name: "Close personal details" }));
    expect(editTrigger).toHaveFocus();
  });
});

describe("saved personal library views", () => {
  it("composes text, rating, tag, and playlist filters and preserves the current view for a stale saved playlist", async () => {
    const user = userEvent.setup();
    const { api } = renderLibrary();
    await screen.findByText("Alpha");
    await user.click(screen.getByRole("treeitem", { name: /Warmup/u }));

    const filters = screen.getByRole("region", { name: "Library filters" });
    await user.type(within(filters).getByRole("searchbox", { name: "Search library" }), "notes match");
    await user.selectOptions(within(filters).getByRole("combobox", { name: "Minimum rating" }), "4");
    await user.type(within(filters).getByRole("textbox", { name: "Exact tag" }), " Warm ");
    await user.click(within(filters).getByRole("button", { name: "Apply filters" }));
    expect(api.library.listTracks).toHaveBeenLastCalledWith({
      playlistId: "playlist-warmup",
      text: "notes match",
      ratingMin: 4,
      tag: "Warm",
    });

    const saved = await screen.findByRole("region", { name: "Saved filters" });
    await user.type(within(saved).getByRole("textbox", { name: "Filter name" }), "Tonight");
    await user.click(within(saved).getByRole("button", { name: "Save current filter" }));
    expect(api.library.saveSavedFilter).toHaveBeenCalledWith({
      name: "Tonight",
      filters: { playlistId: "playlist-warmup", text: "notes match", ratingMin: 4, tag: "Warm" },
    });
    expect(await within(saved).findByText("Tonight")).toBeVisible();

    const callsBeforeStaleLoad = vi.mocked(api.library.listTracks).mock.calls.length;
    await user.click(within(saved).getByRole("button", { name: "Load Missing playlist" }));
    expect(await within(saved).findByRole("alert")).toHaveTextContent("The saved playlist is no longer in this library.");
    expect(vi.mocked(api.library.listTracks).mock.calls).toHaveLength(callsBeforeStaleLoad);
    expect(screen.getByRole("treeitem", { name: /Warmup/u })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Alpha")).toBeVisible();

    await user.click(within(saved).getByRole("button", { name: "Load Warm picks" }));
    expect(api.library.listTracks).toHaveBeenLastCalledWith({
      playlistId: "playlist-warmup",
      text: "night",
      ratingMin: 4,
      tag: "Warm",
    });
    await waitFor(() => expect(within(filters).getByRole("searchbox", { name: "Search library" })).toHaveValue("night"));

    await user.click(within(saved).getByRole("button", { name: "Delete Warm picks" }));
    expect(api.library.deleteSavedFilter).toHaveBeenCalledWith("filter-valid");
    expect(within(saved).queryByText("Warm picks")).not.toBeInTheDocument();
    expect(within(saved).getByRole("textbox", { name: "Filter name" })).toHaveFocus();
  });
});

describe("recommendation feedback and visible ranking comparison", () => {
  it("keeps learning rankings at baseline, then shows active personalized order and rank deltas after feedback", async () => {
    const user = userEvent.setup();
    const api = createApi();
    vi.mocked(api.preferences.compareRecommendations)
      .mockResolvedValueOnce(comparison(learningProfile))
      .mockResolvedValueOnce(comparison(activeProfile))
      .mockResolvedValueOnce(comparison(activeProfile));
    vi.mocked(api.preferences.recordFeedback)
      .mockResolvedValueOnce({ recorded: true, profile: activeProfile })
      .mockResolvedValueOnce({ recorded: true, profile: activeProfile });
    renderLibrary(api);
    await screen.findByText("Alpha");

    await user.click(screen.getByRole("button", { name: "Explore Alpha" }));
    await user.click(screen.getByRole("tab", { name: "Next" }));
    const discovery = screen.getByRole("region", { name: "Explore Alpha" });
    expect(await within(discovery).findByText("Learning from 2 of 5 signals. Rankings stay at the non-personal baseline.")).toBeVisible();
    let candidates = within(discovery).getByRole("list", { name: "Next-track candidates" });
    expect(within(candidates).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent))
      .toEqual(["Next One", "Next Two"]);
    expect(within(within(candidates).getByRole("listitem", { name: /Next One/u })).getByText("Baseline #1 · no rank change"))
      .toBeVisible();

    await user.click(within(candidates).getByRole("button", { name: "Accept Next One" }));
    expect(api.preferences.recordFeedback).toHaveBeenCalledWith({
      type: "accepted",
      trackId: "next-one",
      seedTrackId: "track-alpha",
      intent: "smooth",
    });
    await waitFor(() => expect(api.preferences.compareRecommendations).toHaveBeenCalledTimes(2));
    expect(await within(discovery).findByText("Personalization active · 5 signals · 1.5% weight")).toBeVisible();
    candidates = within(discovery).getByRole("list", { name: "Next-track candidates" });
    expect(within(candidates).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent))
      .toEqual(["Next Two", "Next One"]);
    expect(within(within(candidates).getByRole("listitem", { name: /Next Two/u })).getByText("Baseline #2 · up 1"))
      .toBeVisible();

    await user.click(within(candidates).getByRole("button", { name: "Skip Next One" }));
    expect(api.preferences.recordFeedback).toHaveBeenLastCalledWith({
      type: "skipped",
      trackId: "next-one",
      seedTrackId: "track-alpha",
      intent: "smooth",
    });
    await waitFor(() => expect(api.preferences.compareRecommendations).toHaveBeenCalledTimes(3));

    vi.mocked(api.preferences.recordFeedback).mockRejectedValueOnce(new Error("Feedback could not be recorded."));
    await user.click(within(candidates).getByRole("button", { name: "Reject Next Two" }));
    expect(await within(discovery).findByRole("alert")).toHaveTextContent("Feedback could not be recorded.");
    expect(within(candidates).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent))
      .toEqual(["Next Two", "Next One"]);
  });

  it("invalidates an open personalized comparison when preferences are reset", async () => {
    const user = userEvent.setup();
    let resolveResetComparison: ((value: CompareRecommendationsResponse) => void) | undefined;
    const api = createApi();
    vi.mocked(api.preferences.getProfile).mockResolvedValue(activeProfile);
    vi.mocked(api.preferences.compareRecommendations)
      .mockResolvedValueOnce(comparison(activeProfile))
      .mockImplementationOnce(() => new Promise<CompareRecommendationsResponse>((resolve) => {
        resolveResetComparison = resolve;
      }));
    renderLibrary(api);
    await screen.findByText("Alpha");

    await user.click(screen.getByRole("button", { name: "Explore Alpha" }));
    await user.click(screen.getByRole("tab", { name: "Next" }));
    const discovery = screen.getByRole("region", { name: "Explore Alpha" });
    expect(await within(discovery).findByText("Personalization active · 5 signals · 1.5% weight")).toBeVisible();
    let candidates = within(discovery).getByRole("list", { name: "Next-track candidates" });
    expect(within(candidates).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent))
      .toEqual(["Next Two", "Next One"]);

    const preferencePanel = screen.getByRole("region", { name: "Preference profile" });
    await user.click(within(preferencePanel).getByRole("button", { name: "Reset preferences" }));
    await user.click(within(preferencePanel).getByRole("button", { name: "Confirm preference reset" }));
    expect(await within(preferencePanel).findByText("Reset 5 feedback events and 1 rating. Saved filters and personal notes remain.")).toBeVisible();

    expect(within(discovery).queryByText("Personalization active · 5 signals · 1.5% weight")).not.toBeInTheDocument();
    expect(within(discovery).queryByRole("list", { name: "Next-track candidates" })).not.toBeInTheDocument();
    await waitFor(() => expect(api.preferences.compareRecommendations).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveResetComparison?.(comparison(baselineProfile));
    });
    expect(await within(discovery).findByText("No preference evidence yet. Recommendations use the non-personal baseline.")).toBeVisible();
    candidates = within(discovery).getByRole("list", { name: "Next-track candidates" });
    expect(within(candidates).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent))
      .toEqual(["Next One", "Next Two"]);
    expect(within(candidates).getByText("Baseline #1 · no rank change")).toBeVisible();
    expect(within(candidates).queryByText("Baseline #2 · up 1")).not.toBeInTheDocument();
  });
});

describe("preference profile controls", () => {
  it("inspects evidence, confirms export, and discloses the exact reset scope before clearing", async () => {
    const user = userEvent.setup();
    const api = createApi();
    vi.mocked(api.preferences.getProfile).mockResolvedValue(activeProfile);
    renderLibrary(api);

    const panel = await screen.findByRole("region", { name: "Preference profile" });
    expect(await within(panel).findByText("Personalization active · 5 signals · 1.5% weight")).toBeVisible();
    await user.click(within(panel).getByText("Inspect preference evidence"));
    expect(within(panel).getByText("Alpha · Artist A")).toBeVisible();
    expect(within(panel).getByText("House")).toBeVisible();

    const exportTrigger = within(panel).getByRole("button", { name: "Prepare preference export" });
    await user.click(exportTrigger);
    expect(await within(panel).findByText("dj-preferences.json already exists and will be replaced.")).toBeVisible();
    await user.click(within(panel).getByRole("button", { name: "Confirm preference export" }));
    expect(api.preferences.confirmExport).toHaveBeenCalledWith("preference-confirmation");
    expect(await within(panel).findByText("Preference export replaced the selected JSON file.")).toBeVisible();
    expect(exportTrigger).toHaveFocus();

    const resetTrigger = within(panel).getByRole("button", { name: "Reset preferences" });
    await user.click(resetTrigger);
    expect(within(panel).getByText(
      "This clears ratings and learned feedback. Tags, notes, saved filters, sets, analysis, and the imported library stay intact.",
    )).toBeVisible();
    const trackRequestsBeforeReset = vi.mocked(api.library.listTracks).mock.calls.length;
    await user.click(within(panel).getByRole("button", { name: "Confirm preference reset" }));
    expect(api.preferences.reset).toHaveBeenCalledTimes(1);
    expect(await within(panel).findByText("Reset 5 feedback events and 1 rating. Saved filters and personal notes remain.")).toBeVisible();
    expect(within(panel).getByText("No preference evidence yet. Recommendations use the non-personal baseline.")).toBeVisible();
    await waitFor(() => expect(vi.mocked(api.library.listTracks).mock.calls.length).toBeGreaterThan(trackRequestsBeforeReset));
    expect(resetTrigger).toHaveFocus();
  });

  it("ignores a stale initial profile response after newer direct feedback", async () => {
    const user = userEvent.setup();
    let resolveProfile: ((value: PreferenceProfile) => void) | undefined;
    const api = createApi();
    api.preferences.getProfile = vi.fn(() => new Promise<PreferenceProfile>((resolve) => { resolveProfile = resolve; }));
    renderLibrary(api);
    await screen.findByText("Alpha");

    await user.click(screen.getByRole("button", { name: "Edit details for Alpha" }));
    const metadataPanel = await screen.findByRole("region", { name: "Personal details for Alpha" });
    await user.click(within(metadataPanel).getByRole("button", { name: "Like Alpha" }));
    const preferencePanel = screen.getByRole("region", { name: "Preference profile" });
    expect(await within(preferencePanel).findByText(/Learning from 2 of 5 signals/u)).toBeVisible();

    await act(async () => {
      resolveProfile?.(baselineProfile);
    });
    expect(within(preferencePanel).getByText(/Learning from 2 of 5 signals/u)).toBeVisible();
    expect(within(preferencePanel).queryByText(/Personalization active/u)).not.toBeInTheDocument();
  });
});
