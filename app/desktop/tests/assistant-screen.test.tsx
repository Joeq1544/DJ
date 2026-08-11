import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AssistantAuthStatus,
  AssistantPollResult,
  AssistantProposal,
  AssistantSearchResult,
  DesktopApi,
  SetDraftSnapshot,
  TrackListItem,
} from "../src/shared/contracts";
import { CopilotPanel, type CopilotPanelProps } from "../src/renderer/src/features/assistant/CopilotPanel";

const selectedTrack = {
  id: "track-1",
  title: "Sæglópur",
  artist: "Sigur Rós",
};

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
    analysis: {
      status: "succeeded",
      progressPpm: 1_000_000,
      attemptCount: 1,
      errorCode: null,
      errorMessage: null,
      features: {
        fingerprint: "a".repeat(64),
        fileSize: 12_345,
        mtimeNs: 1,
        codec: "pcm_s16le",
        container: "wav",
        durationMs: 431_000,
        sampleRateHz: 44_100,
        channels: 2,
        bpmMilli: 121_000,
        tempoConfidencePpm: 880_000,
        tempoCandidatesMilli: [121_000],
        onsetCount: 600,
        beatStrengthPpm: 700_000,
        musicalKey: "8A",
        mode: "minor",
        keyConfidencePpm: 830_000,
        rmsMilliDbfs: -12_000,
        peakMilliDbfs: -1_000,
        crestFactorMilliDb: 11_000,
        energyPpm: 720_000,
        dynamicRangeMilliDb: 8_000,
        onsetRateMilliHz: 1_400,
        spectralCentroidHz: 1_800,
        brightnessPpm: 410_000,
        energyCurvePpm: Array.from({ length: 16 }, () => 720_000),
        provider: "ffmpeg-numpy-basic",
        providerVersion: "ffmpeg 8.1.2; ffprobe 8.1.2; numpy 2.4.4",
        pipelineVersion: "baseline-v1",
        limitations: [],
      },
    },
    userMetadata: { rating: 5, tags: ["Warm"], note: null },
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
    availability: "available",
    analysis: null,
    userMetadata: { rating: null, tags: [], note: null },
  },
];

const draft: SetDraftSnapshot = {
  draftId: "draft-1",
  currentRevision: 4,
  contentRevision: 4,
  title: "Late night arc",
  plan: {
    intent: "build",
    targetDurationMs: 3_600_000,
    maxArtistRepeats: 2,
    candidateFilters: { genre: "House" },
  },
  entries: [],
  bans: [],
  knownDurationMs: 0,
  unknownDurationCount: 0,
  unmetConstraints: [],
  canUndo: false,
  canRedo: false,
  versions: [],
  viewingVersion: null,
};

const readyStatus: AssistantAuthStatus = {
  state: "ready",
  auth: "chatgpt",
  message: "Signed in with ChatGPT.",
  sdkVersion: "0.147.0",
};

const emptySearchResult: AssistantSearchResult = {
  mode: "filters",
  summary: "Warm house below 125 BPM",
  filters: { genre: "House", bpmMaxMilli: 125_000 },
  response: { items: [], nextCursor: null, truncated: false },
};

const localSearchResult: AssistantSearchResult = {
  ...emptySearchResult,
  response: { items: tracks, nextCursor: null, truncated: false },
};

const nextSearchResult: AssistantSearchResult = {
  mode: "next",
  summary: "Build while keeping the transition smooth",
  seedTrackId: "track-1",
  intent: "build",
  response: {
    seed: {
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
    scannedCount: 237,
    truncated: false,
    items: [{
      track: {
        id: "track-2",
        title: "Blue Monday",
        artist: "New Order",
        album: "Power, Corruption & Lies",
        genre: "Synth-pop",
        bpmMilli: 130_000,
        musicalKey: "9A",
        durationMs: 448_000,
        availability: "available",
      },
      scorePpm: 845_000,
      confidencePpm: 910_000,
      reasons: ["Tempo and key support the requested build."],
      components: [{
        name: "tempo",
        scorePpm: 760_000,
        weightPpm: 250_000,
        contributionSignedPpm: 190_000,
        effect: "bonus",
        reason: "A controlled ten BPM lift.",
      }],
    }],
    intent: "build",
    algorithmVersion: "transition-v1",
  },
};

const planProposal: AssistantProposal = {
  kind: "plan",
  proposalId: "proposal-plan-1",
  summary: "Create a one-hour build from the selected track.",
  title: "One-hour build",
  plan: {
    intent: "build",
    targetDurationMs: 3_600_000,
    maxArtistRepeats: 2,
    candidateFilters: { genre: "House" },
  },
  source: { kind: "generated", seedTrackId: "track-1", maxTracks: 12 },
  expiresAt: "2026-08-11T12:10:00.000Z",
};

const revisionProposal: AssistantProposal = {
  kind: "revision",
  proposalId: "proposal-revision-1",
  summary: "Rename the current draft.",
  draftId: "draft-1",
  expectedRevision: 4,
  mutation: { type: "rename", title: "Deeper late night arc" },
  evidenceTrackIds: ["track-1"],
  expiresAt: "2026-08-11T12:10:00.000Z",
};

function terminalPoll(...events: AssistantPollResult["events"]): AssistantPollResult {
  return {
    events,
    nextSequence: events.at(-1)?.sequence ?? 0,
    terminal: true,
  };
}

function createAssistantApi(polls: AssistantPollResult[] = []): DesktopApi["assistant"] {
  let requestNumber = 0;
  return {
    getStatus: vi.fn().mockResolvedValue(readyStatus),
    beginLogin: vi.fn().mockResolvedValue(readyStatus),
    start: vi.fn().mockImplementation(async () => ({ requestId: `request-${++requestNumber}` })),
    poll: vi.fn().mockImplementation(async () => polls.shift() ?? terminalPoll({
      sequence: 1,
      type: "failed",
      error: { code: "invalid_response", message: "No fixture response." },
    })),
    cancel: vi.fn().mockResolvedValue({ status: "cancelled" }),
    confirm: vi.fn().mockResolvedValue({ status: "created", snapshot: draft }),
  };
}

function renderCopilot(
  api = createAssistantApi(),
  overrides: Partial<Omit<CopilotPanelProps, "api" | "onOpenDraft">> = {},
) {
  const onOpenDraft = vi.fn();
  const props: CopilotPanelProps = {
    api,
    selectedTrack,
    draft,
    knownTracks: tracks,
    onOpenDraft,
    ...overrides,
  };
  return { api, onOpenDraft, props, ...render(<CopilotPanel {...props} />) };
}

async function waitUntilReady() {
  await userEvent.setup().click(screen.getByRole("button", { name: "Refresh Copilot status" }));
  expect(await screen.findByText("ChatGPT ready")).toBeVisible();
}

async function submitPrompt(user: ReturnType<typeof userEvent.setup>, prompt: string) {
  const input = screen.getByRole("textbox", { name: "Ask Copilot" });
  await user.clear(input);
  await user.type(input, prompt);
  await user.click(screen.getByRole("button", { name: "Run Copilot" }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("CopilotPanel", () => {
  it("leaves status unchecked on mount and keeps status, sign-in, and submit as explicit user actions", async () => {
    const user = userEvent.setup();
    let resolveStatus: ((status: AssistantAuthStatus) => void) | undefined;
    const api = createAssistantApi();
    api.getStatus = vi.fn(() => new Promise<AssistantAuthStatus>((resolve) => { resolveStatus = resolve; }));
    renderCopilot(api);

    expect(screen.getByRole("region", { name: "Copilot" })).toBeVisible();
    expect(screen.getByRole("status", { name: "Copilot authentication status" })).toHaveTextContent("Copilot status not checked");
    expect(api.getStatus).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Refresh Copilot status" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sign in with ChatGPT" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Run Copilot" })).toBeEnabled();
    expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();

    await submitPrompt(user, "find warm tracks");
    expect(api.start).toHaveBeenCalledWith({ kind: "search", prompt: "find warm tracks", selectedTrackId: "track-1" });
    expect(api.getStatus).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Run Copilot" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "Refresh Copilot status" }));
    expect(api.getStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status", { name: "Copilot authentication status" })).toHaveTextContent("Checking ChatGPT sign-in");

    await act(async () => {
      resolveStatus?.({ state: "signed_out", auth: "none", message: "Sign in to continue.", sdkVersion: null });
    });
    expect(screen.getByText("ChatGPT sign-in required")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Sign in with ChatGPT" }));

    expect(api.beginLogin).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("ChatGPT ready")).toBeVisible();
    expect(screen.getByText("Codex SDK 0.147.0")).toBeVisible();
    expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();
  });

  it("shows unsupported and unavailable auth recovery through the status refresh control", async () => {
    const user = userEvent.setup();
    const api = createAssistantApi();
    api.getStatus = vi.fn()
      .mockResolvedValueOnce({ state: "unsupported_auth", auth: "other", message: "Switch Codex to ChatGPT authentication.", sdkVersion: null })
      .mockResolvedValueOnce({ state: "unavailable", auth: "unknown", message: "Codex is unavailable.", sdkVersion: null });
    renderCopilot(api);

    await user.click(screen.getByRole("button", { name: "Refresh Copilot status" }));
    expect(await screen.findByText("Unsupported Codex authentication")).toBeVisible();
    expect(screen.getByRole("button", { name: "Sign in with ChatGPT" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Refresh Copilot status" }));

    expect(await screen.findByText("Copilot unavailable")).toBeVisible();
    expect(screen.getByText("Codex is unavailable.")).toBeVisible();
  });

  it("keeps Search and Plan set available while explaining unavailable draft and explanation contexts", async () => {
    const user = userEvent.setup();
    const api = createAssistantApi();
    const view = renderCopilot(api, { selectedTrack: null, draft: null });
    await waitUntilReady();

    expect(screen.getByRole("tab", { name: "Search" })).toBeEnabled();
    expect(screen.getByRole("tab", { name: "Plan set" })).toBeEnabled();
    expect(screen.getByRole("tab", { name: "Revise draft" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Explain" })).toBeDisabled();
    expect(screen.getByText("Open a set draft to revise it with Copilot.")).toBeVisible();
    expect(screen.getByText("Explore a track or open a draft to ask for an explanation.")).toBeVisible();

    view.rerender(<CopilotPanel {...view.props} selectedTrack={selectedTrack} draft={null} />);
    const searchTab = screen.getByRole("tab", { name: "Search" });
    searchTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Plan set" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Explain" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Revise draft" })).toBeDisabled();
  });

  it("submits exact Search, Plan set, Revise draft, and Explain request shapes", async () => {
    const user = userEvent.setup();
    const failure = terminalPoll({ sequence: 1, type: "failed", error: { code: "unknown", message: "Test stop." } });
    const api = createAssistantApi([failure, failure, failure, failure]);
    renderCopilot(api);
    await waitUntilReady();

    await submitPrompt(user, "find warm tracks");
    await waitFor(() => expect(screen.getByRole("button", { name: "Run Copilot" })).toBeEnabled());
    expect(api.start).toHaveBeenNthCalledWith(1, { kind: "search", prompt: "find warm tracks", selectedTrackId: "track-1" });

    await user.click(screen.getByRole("tab", { name: "Plan set" }));
    await submitPrompt(user, "build one hour");
    await waitFor(() => expect(screen.getByRole("button", { name: "Run Copilot" })).toBeEnabled());
    expect(api.start).toHaveBeenNthCalledWith(2, { kind: "plan", prompt: "build one hour", selectedTrackId: "track-1" });

    await user.click(screen.getByRole("tab", { name: "Revise draft" }));
    await submitPrompt(user, "make the ending deeper");
    await waitFor(() => expect(screen.getByRole("button", { name: "Run Copilot" })).toBeEnabled());
    expect(api.start).toHaveBeenNthCalledWith(3, { kind: "revise", prompt: "make the ending deeper", draftId: "draft-1", expectedRevision: 4 });

    await user.click(screen.getByRole("tab", { name: "Explain" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Explanation context" }), "next");
    await user.selectOptions(screen.getByRole("combobox", { name: "Transition intent" }), "build");
    await submitPrompt(user, "why this direction?");
    await waitFor(() => expect(screen.getByRole("button", { name: "Run Copilot" })).toBeEnabled());
    expect(api.start).toHaveBeenNthCalledWith(4, {
      kind: "explain",
      prompt: "why this direction?",
      context: { kind: "next", selectedTrackId: "track-1", intent: "build" },
    });
  });

  it("shows streamed snapshots, cancels the active request, ignores partial output as a result, and restores prompt focus", async () => {
    const user = userEvent.setup();
    const api = createAssistantApi([{
      events: [
        { sequence: 1, type: "activity", activity: "interpreting" },
        { sequence: 2, type: "text_snapshot", text: "Interpreting the requested energy arc…" },
      ],
      nextSequence: 2,
      terminal: false,
    }]);
    api.poll = vi.fn()
      .mockResolvedValueOnce({
        events: [
          { sequence: 1, type: "activity", activity: "interpreting" },
          { sequence: 2, type: "text_snapshot", text: "Interpreting the requested energy arc…" },
        ],
        nextSequence: 2,
        terminal: false,
      })
      .mockImplementation(() => new Promise(() => undefined));
    renderCopilot(api);
    await waitUntilReady();

    await submitPrompt(user, "explain the arc");
    expect(await screen.findByText("Interpreting your request…")).toBeVisible();
    expect(screen.getByText("Interpreting the requested energy arc…")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel Copilot" }));

    expect(api.cancel).toHaveBeenCalledWith("request-1");
    expect(await screen.findByText("Copilot request cancelled. Nothing was changed.")).toBeVisible();
    expect(screen.queryByText("Interpreting the requested energy arc…")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Ask Copilot" })).toHaveFocus();
  });

  it("treats an unchanged confirmation as a successful no-op and refreshes the current draft", async () => {
    const user = userEvent.setup();
    const unchanged = { ...draft, title: "Late night arc", currentRevision: 4, contentRevision: 4 };
    const api = createAssistantApi([terminalPoll(
      { sequence: 1, type: "proposal", proposal: revisionProposal },
      { sequence: 2, type: "completed", evidenceTrackIds: ["track-1"] },
    )]);
    api.confirm = vi.fn().mockResolvedValue({ status: "unchanged", snapshot: unchanged });
    const { onOpenDraft } = renderCopilot(api);
    await waitUntilReady();

    await user.click(screen.getByRole("tab", { name: "Revise draft" }));
    await submitPrompt(user, "keep this title if it is already current");
    await user.click(await screen.findByRole("button", { name: "Confirm proposal" }));

    expect(onOpenDraft).toHaveBeenCalledWith(unchanged);
    expect(screen.getByText("No draft change was needed. Refreshed Late night arc.")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Copilot proposal" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Ask Copilot" })).toHaveFocus();
  });

  it("keeps a completed result when completion wins a pending cancel race", async () => {
    const user = userEvent.setup();
    let resolvePoll: ((result: AssistantPollResult) => void) | undefined;
    let resolveCancel: ((result: { status: "cancelled" }) => void) | undefined;
    const api = createAssistantApi();
    api.poll = vi.fn(() => new Promise<AssistantPollResult>((resolve) => { resolvePoll = resolve; }));
    api.cancel = vi.fn(() => new Promise<{ status: "cancelled" }>((resolve) => { resolveCancel = resolve; }));
    renderCopilot(api);
    await waitUntilReady();

    await submitPrompt(user, "find warm tracks");
    await waitFor(() => expect(api.poll).toHaveBeenCalledWith("request-1", 0));
    await user.click(screen.getByRole("button", { name: "Cancel Copilot" }));
    await act(async () => {
      resolvePoll?.(terminalPoll(
        { sequence: 1, type: "search_result", result: localSearchResult },
        { sequence: 2, type: "completed", evidenceTrackIds: ["track-1", "track-2"] },
      ));
    });
    expect(await screen.findByText("Blue Monday")).toBeVisible();

    await act(async () => {
      resolveCancel?.({ status: "cancelled" });
    });
    expect(screen.queryByText("Copilot request cancelled. Nothing was changed.")).not.toBeInTheDocument();
    expect(screen.getByText("Blue Monday")).toBeVisible();
  });

  it("renders exact local filter results without replacing app-supplied evidence", async () => {
    const user = userEvent.setup();
    const api = createAssistantApi([terminalPoll(
      { sequence: 1, type: "search_result", result: localSearchResult },
      { sequence: 2, type: "completed", evidenceTrackIds: ["track-1", "track-2"] },
    )]);
    renderCopilot(api);
    await waitUntilReady();

    await submitPrompt(user, "warm house below 125");
    const result = await screen.findByRole("region", { name: "Copilot result" });
    expect(within(result).getByText("Warm house below 125 BPM")).toBeVisible();
    expect(within(result).getByText("House", { selector: "dd" })).toBeVisible();
    const localTracks = within(result).getByRole("list", { name: "Local tracks" });
    expect(within(localTracks).getByText("Sæglópur")).toBeVisible();
    expect(within(localTracks).getByText("Sigur Rós")).toBeVisible();
    expect(within(localTracks).getByText(/120 BPM/)).toBeVisible();
    expect(within(localTracks).getByText(/5 stars/)).toBeVisible();
    expect(within(localTracks).getByText("Local BPM 121 · 880,000 ppm confidence")).toBeVisible();
    expect(within(localTracks).getByText("Local energy 720,000 ppm")).toBeVisible();
    expect(within(localTracks).getByText("Local key 8A · 830,000 ppm confidence")).toBeVisible();
  });

  it("renders app-supplied recommendation scores, reasons, and components unchanged", async () => {
    const user = userEvent.setup();
    const api = createAssistantApi([terminalPoll(
      { sequence: 1, type: "search_result", result: nextSearchResult },
      { sequence: 2, type: "completed", evidenceTrackIds: ["track-2"] },
    )]);
    renderCopilot(api);
    await waitUntilReady();

    await submitPrompt(user, "what should follow?");
    const result = await screen.findByRole("region", { name: "Copilot result" });
    expect(within(result).getByText("Build while keeping the transition smooth")).toBeVisible();
    expect(within(result).getByText("845,000 ppm score")).toBeVisible();
    expect(within(result).getByText("910,000 ppm confidence")).toBeVisible();
    expect(within(result).getByText("Tempo and key support the requested build.")).toBeVisible();
    expect(within(result).getByText("760,000 ppm score · 250,000 ppm weight · +190,000 ppm contribution")).toBeVisible();
  });

  it("keeps a plan proposal separate and opens the confirmed draft only after explicit confirmation", async () => {
    const user = userEvent.setup();
    const created = { ...draft, draftId: "draft-created", title: "One-hour build", currentRevision: 1, contentRevision: 1 };
    const api = createAssistantApi([terminalPoll(
      { sequence: 1, type: "proposal", proposal: planProposal },
      { sequence: 2, type: "completed", evidenceTrackIds: ["track-1"] },
    )]);
    api.confirm = vi.fn().mockResolvedValue({ status: "created", snapshot: created });
    const { onOpenDraft } = renderCopilot(api);
    await waitUntilReady();

    await user.click(screen.getByRole("tab", { name: "Plan set" }));
    await submitPrompt(user, "make a one-hour build");
    const proposal = await screen.findByRole("region", { name: "Copilot proposal" });
    expect(within(proposal).getByText("Proposal — not applied")).toBeVisible();
    expect(within(proposal).getByText("One-hour build")).toBeVisible();
    expect(within(proposal).getByText("track-1")).toBeVisible();
    expect(within(proposal).getByText("genre: House")).toBeVisible();
    expect(within(proposal).getByText("Nothing changes until you confirm.")).toBeVisible();
    expect(api.confirm).not.toHaveBeenCalled();
    expect(onOpenDraft).not.toHaveBeenCalled();

    await user.click(within(proposal).getByRole("button", { name: "Confirm proposal" }));
    expect(api.confirm).toHaveBeenCalledWith("request-1", "proposal-plan-1");
    expect(onOpenDraft).toHaveBeenCalledWith(created);
    expect(screen.queryByRole("region", { name: "Copilot proposal" })).not.toBeInTheDocument();
    expect(screen.getByText("Proposal confirmed. Opened One-hour build.")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Ask Copilot" })).toHaveFocus();
  });

  it("discards a revision proposal without confirmation and restores prompt focus", async () => {
    const user = userEvent.setup();
    const api = createAssistantApi([terminalPoll(
      { sequence: 1, type: "proposal", proposal: revisionProposal },
      { sequence: 2, type: "completed", evidenceTrackIds: ["track-1"] },
    )]);
    renderCopilot(api);
    await waitUntilReady();

    await user.click(screen.getByRole("tab", { name: "Revise draft" }));
    await submitPrompt(user, "rename this draft");
    const proposal = await screen.findByRole("region", { name: "Copilot proposal" });
    expect(within(proposal).getByText("Rename draft to “Deeper late night arc”")).toBeVisible();
    await user.click(within(proposal).getByRole("button", { name: "Discard proposal" }));

    expect(api.confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Copilot proposal" })).not.toBeInTheDocument();
    expect(screen.getByText("Proposal discarded. Nothing changed.")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Ask Copilot" })).toHaveFocus();
  });

  it("preserves the last successful result through timeout and invalid-response failures", async () => {
    const user = userEvent.setup();
    const api = createAssistantApi([
      terminalPoll(
        { sequence: 1, type: "search_result", result: localSearchResult },
        { sequence: 2, type: "completed", evidenceTrackIds: ["track-1", "track-2"] },
      ),
      terminalPoll({ sequence: 1, type: "failed", error: { code: "timeout", message: "Deadline elapsed." } }),
      terminalPoll({ sequence: 1, type: "failed", error: { code: "invalid_response", message: "Schema rejected." } }),
    ]);
    renderCopilot(api);
    await waitUntilReady();

    await submitPrompt(user, "find warm tracks");
    expect(await screen.findByText("Blue Monday")).toBeVisible();
    await submitPrompt(user, "try a wider search");
    expect(await screen.findByRole("alert")).toHaveTextContent("Copilot timed out. Nothing was changed. Showing the last successful Copilot result.");
    expect(screen.getByText("Blue Monday")).toBeVisible();

    await submitPrompt(user, "try again");
    expect(await screen.findByRole("alert")).toHaveTextContent("Copilot returned an invalid response. Nothing was changed. Showing the last successful Copilot result.");
    expect(screen.getByText("Blue Monday")).toBeVisible();
  });

  it("handles conflict and stale confirmation results without opening or overwriting a draft", async () => {
    const user = userEvent.setup();
    const secondProposal = { ...planProposal, proposalId: "proposal-plan-2" };
    const api = createAssistantApi([
      terminalPoll(
        { sequence: 1, type: "proposal", proposal: planProposal },
        { sequence: 2, type: "completed", evidenceTrackIds: [] },
      ),
      terminalPoll(
        { sequence: 1, type: "proposal", proposal: secondProposal },
        { sequence: 2, type: "completed", evidenceTrackIds: [] },
      ),
    ]);
    api.confirm = vi.fn()
      .mockResolvedValueOnce({ status: "conflict", currentRevision: 7 })
      .mockResolvedValueOnce({ status: "blocked", code: "stale", message: "Draft revision is stale." });
    const { onOpenDraft } = renderCopilot(api);
    await waitUntilReady();
    await user.click(screen.getByRole("tab", { name: "Plan set" }));

    await submitPrompt(user, "first proposal");
    await user.click(await screen.findByRole("button", { name: "Confirm proposal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Draft changed before confirmation. Current revision is 7. Nothing was overwritten.");
    expect(onOpenDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Ask Copilot" })).toHaveFocus();

    await submitPrompt(user, "second proposal");
    await user.click(await screen.findByRole("button", { name: "Confirm proposal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This proposal is stale. Nothing was changed.");
    expect(onOpenDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Ask Copilot" })).toHaveFocus();
  });

  it("renders empty and unsupported searches as honest non-error states", async () => {
    const user = userEvent.setup();
    const unsupported: AssistantSearchResult = { mode: "unsupported", reason: "That request cannot be mapped to local search." };
    const api = createAssistantApi([
      terminalPoll(
        { sequence: 1, type: "search_result", result: emptySearchResult },
        { sequence: 2, type: "completed", evidenceTrackIds: [] },
      ),
      terminalPoll(
        { sequence: 1, type: "search_result", result: unsupported },
        { sequence: 2, type: "completed", evidenceTrackIds: [] },
      ),
    ]);
    renderCopilot(api);
    await waitUntilReady();

    await submitPrompt(user, "find impossible tracks");
    expect(await screen.findByText("No local tracks matched")).toBeVisible();
    expect(screen.getByText("Try a broader description or fewer constraints.")).toBeVisible();

    await submitPrompt(user, "write an export for me");
    expect(await screen.findByText("Copilot could not perform that search")).toBeVisible();
    expect(screen.getByText("That request cannot be mapped to local search.")).toBeVisible();
  });

  it("renders an unsupported plan reason without inventing a proposal or an invalid-response error", async () => {
    const user = userEvent.setup();
    const api = createAssistantApi([terminalPoll(
      { sequence: 1, type: "text_snapshot", text: "That request would require more than one draft mutation." },
      { sequence: 2, type: "completed", evidenceTrackIds: [] },
    )]);
    renderCopilot(api);
    await waitUntilReady();
    await user.click(screen.getByRole("tab", { name: "Plan set" }));

    await submitPrompt(user, "rewrite several parts of this set");
    const result = await screen.findByRole("region", { name: "Copilot result" });
    expect(within(result).getByText("Copilot did not propose a change")).toBeVisible();
    expect(within(result).getByText("That request would require more than one draft mutation.")).toBeVisible();
    expect(screen.queryByRole("region", { name: "Copilot proposal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("turns only completed known track references into citations and leaves unknown text inert", async () => {
    const user = userEvent.setup();
    const api = createAssistantApi([terminalPoll(
      { sequence: 1, type: "text_snapshot", text: "Use [track:track-1] as the bridge; ignore [track:not-supplied]." },
      { sequence: 2, type: "completed", evidenceTrackIds: ["track-1"] },
    )]);
    renderCopilot(api);
    await waitUntilReady();
    await user.click(screen.getByRole("tab", { name: "Explain" }));

    await submitPrompt(user, "explain the bridge");
    const result = await screen.findByRole("region", { name: "Copilot result" });
    expect(within(result).getByLabelText("Track citation: Sæglópur by Sigur Rós")).toHaveTextContent("Sæglópur");
    expect(within(result).getByText(/\[track:not-supplied\]/)).toBeVisible();
    expect(within(result).queryByRole("link")).not.toBeInTheDocument();
  });
});
