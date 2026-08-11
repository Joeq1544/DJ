import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisFeatures,
  AnalysisQueueStatus,
  DesktopApi,
  PlaylistTreeNode,
  TrackListItem,
} from "../src/shared/contracts";
import { LibraryScreen } from "../src/renderer/src/features/library/LibraryScreen";

const capabilities: AnalysisQueueStatus["capabilities"] = {
  available: true,
  provider: "ffmpeg-numpy-basic",
  providerVersion: "ffmpeg 8.1.2; ffprobe 8.1.2; numpy 2.4.4",
  pipelineVersion: "baseline-v1",
  availableStages: ["metadata", "basic_features"],
  unavailableStages: ["structure", "embeddings"],
  unavailableReason: null,
};

const features: AnalysisFeatures = {
  fingerprint: "a".repeat(64),
  fileSize: 48_000_000,
  mtimeNs: 1_725_000_000_000_000_000,
  codec: "pcm_s24le",
  container: "wav",
  durationMs: 245_000,
  sampleRateHz: 48_000,
  channels: 2,
  bpmMilli: 120_500,
  tempoConfidencePpm: 873_000,
  tempoCandidatesMilli: [120_500, 60_250],
  onsetCount: 128,
  beatStrengthPpm: 812_000,
  musicalKey: "C♯",
  mode: "minor",
  keyConfidencePpm: 924_000,
  rmsMilliDbfs: -14_321,
  peakMilliDbfs: -500,
  crestFactorMilliDb: 13_821,
  energyPpm: 721_000,
  dynamicRangeMilliDb: 8_500,
  onsetRateMilliHz: 2_415,
  spectralCentroidHz: 2_450,
  brightnessPpm: 641_000,
  energyCurvePpm: [
    100_000, 200_000, 300_000, 400_000,
    500_000, 600_000, 700_000, 800_000,
    900_000, 1_000_000, 900_000, 800_000,
    700_000, 600_000, 500_000, 400_000,
  ],
  provider: "ffmpeg-numpy-basic",
  providerVersion: "ffmpeg 8.1.2; ffprobe 8.1.2; numpy 2.4.4",
  pipelineVersion: "baseline-v1",
  limitations: ["Tempo is an estimate.", "Structure is not available."],
};

type AnalysisItem = AnalysisQueueStatus["items"][number];

function analysisItem(
  trackId: string,
  status: AnalysisItem["status"],
  overrides: Partial<Omit<AnalysisItem, "trackId" | "status">> = {},
): AnalysisItem {
  return {
    trackId,
    status,
    progressPpm: status === "succeeded" ? 1_000_000 : 0,
    attemptCount: status === "not_queued" ? 0 : 1,
    errorCode: null,
    errorMessage: null,
    features: status === "succeeded" ? features : null,
    ...overrides,
  };
}

function analysisStatus(overrides: Partial<AnalysisQueueStatus> = {}): AnalysisQueueStatus {
  return {
    state: "idle",
    queued: 0,
    running: 0,
    paused: 0,
    succeeded: 0,
    failed: 0,
    progressPpm: 0,
    capabilities,
    items: [],
    ...overrides,
  };
}

function track(
  id: string,
  title: string,
  availability: TrackListItem["availability"] = "available",
  analysis: TrackListItem["analysis"] = null,
): TrackListItem {
  return {
    id,
    title,
    artist: `Artist ${id}`,
    album: null,
    genre: null,
    bpmMilli: 121_000,
    musicalKey: "8A",
    durationMs: 245_000,
    availability,
    analysis,
  };
}

const tracks = [
  track("track-1", "Cue One"),
  track("track-2", "Cue Two"),
  track("track-3", "Missing Tune", "missing"),
  track("track-4", "Unreadable Tune", "unreadable"),
];

const tree: PlaylistTreeNode[] = [
  { id: "playlist-warmup", parentId: null, name: "Warmup", kind: "playlist", order: 0, trackCount: 4 },
];

function createApi(options: {
  tracks?: TrackListItem[];
  status?: AnalysisQueueStatus;
} = {}): DesktopApi {
  const status = options.status ?? analysisStatus();
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
      getPlaylistTree: vi.fn().mockResolvedValue(tree),
      listTracks: vi.fn().mockResolvedValue({ items: options.tracks ?? tracks, nextCursor: null }),
    },
    analysis: {
      queue: vi.fn().mockResolvedValue(status),
      getStatus: vi.fn().mockResolvedValue(status),
      pause: vi.fn().mockResolvedValue(analysisStatus({ state: "paused" })),
      resume: vi.fn().mockResolvedValue(analysisStatus({ state: "running" })),
    },
    discovery: {
      findSimilar: vi.fn(async () => { throw new Error("Discovery is not configured in this analysis test."); }),
      recommendNext: vi.fn(async () => { throw new Error("Discovery is not configured in this analysis test."); }),
    },
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

describe("analysis workstation", () => {
  it("selects only analyzable rows by accessible track name and preserves selection when queueing fails", async () => {
    const user = userEvent.setup();
    const api = createApi();
    api.analysis.queue = vi.fn().mockRejectedValue(new Error("The analysis queue is busy."));
    renderLibrary(api);

    const cueOne = await screen.findByRole("row", { name: /Cue One/ });
    const cueTwo = screen.getByRole("row", { name: /Cue Two/ });
    const missing = screen.getByRole("row", { name: /Missing Tune/ });
    const unreadable = screen.getByRole("row", { name: /Unreadable Tune/ });
    expect(within(cueOne).getByRole("checkbox", { name: "Select Cue One for analysis" })).toBeEnabled();
    expect(within(cueTwo).getByRole("checkbox", { name: "Select Cue Two for analysis" })).toBeEnabled();
    expect(within(missing).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(unreadable).queryByRole("checkbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Select all analyzable tracks" }));
    const analyze = screen.getByRole("button", { name: "Analyze 2 selected" });
    await user.click(analyze);

    expect(api.analysis.queue).toHaveBeenCalledWith(["track-1", "track-2"]);
    expect(await screen.findByRole("alert")).toHaveTextContent("The analysis queue is busy.");
    expect(within(cueOne).getByRole("checkbox", { name: "Select Cue One for analysis" })).toBeChecked();
    expect(within(cueTwo).getByRole("checkbox", { name: "Select Cue Two for analysis" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Analyze 2 selected" })).toBeEnabled();
  });

  it("caps select-all at two hundred stable known IDs", async () => {
    const user = userEvent.setup();
    const manyTracks = Array.from({ length: 201 }, (_, index) => track(`track-${index + 1}`, `Cue ${index + 1}`));
    const api = createApi({ tracks: manyTracks });
    renderLibrary(api);

    await screen.findByText("Cue 201");
    await user.click(screen.getByRole("checkbox", { name: "Select all analyzable tracks" }));
    await user.click(screen.getByRole("button", { name: "Analyze 200 selected" }));

    expect(api.analysis.queue).toHaveBeenCalledWith(manyTracks.slice(0, 200).map(({ id }) => id));
    expect(screen.getByRole("checkbox", { name: "Select Cue 201 for analysis" })).toBeDisabled();
  });

  it("exposes scaled running progress and pause, then applies the returned paused state", async () => {
    const user = userEvent.setup();
    const running = analysisStatus({
      state: "running",
      queued: 1,
      running: 1,
      succeeded: 2,
      progressPpm: 420_000,
    });
    const paused = analysisStatus({
      state: "paused",
      queued: 0,
      paused: 2,
      succeeded: 2,
      progressPpm: 420_000,
    });
    const api = createApi({ status: running });
    api.analysis.pause = vi.fn().mockResolvedValue(paused);
    renderLibrary(api);

    const progress = await screen.findByRole("progressbar", { name: "Analysis progress" });
    expect(progress).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText("42% complete")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Pause analysis" }));

    expect(api.analysis.pause).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Resume analysis" })).toBeEnabled();
  });

  it("restores a paused queue response as paused after remount", async () => {
    const paused = analysisStatus({ state: "paused", paused: 2, progressPpm: 500_000 });
    const api = createApi({ status: paused });
    const first = renderLibrary(api);
    expect(await screen.findByRole("button", { name: "Resume analysis" })).toBeEnabled();

    first.unmount();
    renderLibrary(api);
    expect(await screen.findByRole("button", { name: "Resume analysis" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Pause analysis" })).not.toBeInTheDocument();
  });

  it("shows complete local feature evidence with provenance, limitations, and a semantic sixteen-cell energy profile", async () => {
    const succeeded = analysisItem("track-1", "succeeded");
    renderLibrary(createApi({ tracks: [track("track-1", "Cue One", "available", succeeded)] }));

    const evidence = await screen.findByRole("region", { name: "Local analysis for Cue One" });
    expect(within(evidence).getByText("pcm_s24le / wav")).toBeVisible();
    expect(within(evidence).getByText("4:05.0")).toBeVisible();
    expect(within(evidence).getByText("48,000 Hz")).toBeVisible();
    expect(within(evidence).getByText("2 channels")).toBeVisible();
    expect(within(evidence).getByText("120.5 BPM")).toBeVisible();
    expect(within(evidence).getByText("Tempo confidence 87%")).toBeVisible();
    expect(within(evidence).getByText("C♯ minor")).toBeVisible();
    expect(within(evidence).getByText("Key confidence 92%")).toBeVisible();
    expect(within(evidence).getByText("-14.3 dBFS")).toBeVisible();
    expect(within(evidence).getByText("Energy 72%")).toBeVisible();
    expect(within(evidence).getByText("128 onsets · 2.4 Hz · beat strength 81%")).toBeVisible();
    expect(within(evidence).getByText("2,450 Hz · brightness 64%")).toBeVisible();
    expect(within(evidence).getByText("ffmpeg-numpy-basic")).toBeVisible();
    expect(within(evidence).getByText("baseline-v1")).toBeVisible();
    expect(within(evidence).getByText("Tempo is an estimate.")).toBeVisible();
    expect(within(evidence).getByText(/Energy profile: 10%, 20%, 30%, 40%/)).toBeVisible();
    const strip = evidence.querySelector(".energy-strip");
    expect(strip).toHaveAttribute("aria-hidden", "true");
    expect(strip?.querySelectorAll(".energy-strip__cell")).toHaveLength(16);
    expect(screen.getByText("Structure unavailable")).toBeVisible();
    expect(screen.getByText("Embeddings unavailable")).toBeVisible();
  });

  it("keeps successful evidence visible while a failed row is selected and requeued", async () => {
    const user = userEvent.setup();
    const succeeded = analysisItem("track-1", "succeeded");
    const failed = analysisItem("track-2", "failed", {
      attemptCount: 2,
      errorCode: "unsupported_audio",
      errorMessage: "The source audio format is unsupported.",
    });
    const queued = analysisStatus({
      state: "running",
      queued: 1,
      items: [analysisItem("track-2", "queued", { attemptCount: 3 })],
    });
    const api = createApi({
      tracks: [
        track("track-1", "Cue One", "available", succeeded),
        track("track-2", "Cue Two", "available", failed),
      ],
    });
    api.analysis.queue = vi.fn().mockResolvedValue(queued);
    renderLibrary(api);

    expect(await screen.findByRole("region", { name: "Local analysis for Cue One" })).toBeVisible();
    const failedRow = screen.getByRole("row", { name: /Cue Two/ });
    expect(screen.getByText("The source audio format is unsupported.")).toBeVisible();
    await user.click(within(failedRow).getByRole("checkbox", { name: "Select Cue Two for analysis" }));
    await user.click(screen.getByRole("button", { name: "Analyze 1 selected" }));

    expect(api.analysis.queue).toHaveBeenCalledWith(["track-2"]);
    expect(screen.getByRole("region", { name: "Local analysis for Cue One" })).toBeVisible();
    expect(within(screen.getByRole("row", { name: /Cue Two/ })).getByText("Queued")).toBeVisible();
  });

  it("disables analysis with the provider reason while playlist browsing remains usable", async () => {
    const user = userEvent.setup();
    const unavailable = analysisStatus({
      capabilities: {
        ...capabilities,
        available: false,
        providerVersion: null,
        unavailableReason: "FFmpeg 8.1.2 and ffprobe 8.1.2 were not found.",
      },
    });
    const api = createApi({ status: unavailable });
    renderLibrary(api);

    const row = await screen.findByRole("row", { name: /Cue One/ });
    await user.click(within(row).getByRole("checkbox", { name: "Select Cue One for analysis" }));
    expect(screen.getByRole("button", { name: "Analyze 1 selected" })).toBeDisabled();
    expect(screen.getByText("FFmpeg 8.1.2 and ffprobe 8.1.2 were not found.")).toBeVisible();

    await user.click(screen.getByRole("treeitem", { name: /Warmup/ }));
    expect(api.library.listTracks).toHaveBeenLastCalledWith({ playlistId: "playlist-warmup" });
    expect(screen.getByText("Cue One")).toBeVisible();
  });

  it("polls once per second without overlap and merges out-of-order job updates by track ID", async () => {
    vi.useFakeTimers();
    let resolvePoll: ((value: AnalysisQueueStatus) => void) | undefined;
    const pendingPoll = new Promise<AnalysisQueueStatus>((resolve) => {
      resolvePoll = resolve;
    });
    const api = createApi();
    api.analysis.getStatus = vi.fn()
      .mockResolvedValueOnce(analysisStatus())
      .mockImplementationOnce(() => pendingPoll)
      .mockResolvedValue(analysisStatus());
    renderLibrary(api);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const cueOne = screen.getByRole("row", { name: /Cue One/ });
    fireEvent.click(within(cueOne).getByRole("checkbox", { name: "Select Cue One for analysis" }));
    fireEvent.click(screen.getByRole("treeitem", { name: /Warmup/ }));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(api.analysis.getStatus).toHaveBeenNthCalledWith(2, ["track-1", "track-2", "track-3", "track-4"]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(api.analysis.getStatus).toHaveBeenCalledTimes(2);

    const pollUpdate = analysisStatus({
      state: "running",
      running: 1,
      failed: 1,
      progressPpm: 500_000,
      items: [
        analysisItem("track-2", "succeeded"),
        analysisItem("track-1", "failed", {
          errorCode: "decode_failed",
          errorMessage: "The source audio could not be decoded.",
        }),
      ],
    });
    if (resolvePoll === undefined) throw new Error("Expected the analysis poll to start");
    const pollResolver = resolvePoll;
    await act(async () => {
      pollResolver(pollUpdate);
      await pendingPoll;
      await Promise.resolve();
    });

    expect(screen.getByRole("region", { name: "Local analysis for Cue Two" })).toBeVisible();
    expect(screen.getByText("The source audio could not be decoded.")).toBeVisible();
    expect(screen.getByRole("treeitem", { name: /Warmup/ })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("row", { name: /Cue One/ })).getByRole("checkbox")).toBeChecked();
    expect(screen.getByText("Cue One")).toBeVisible();
    expect(screen.getByText("Cue Two")).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(api.analysis.getStatus).toHaveBeenNthCalledWith(3, ["track-1", "track-2", "track-3", "track-4"]);
  });
});
