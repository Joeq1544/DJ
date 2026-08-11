import { describe, expect, it, vi } from "vitest";
import { AssistantCoordinator } from "../src/main/assistant/coordinator";
import {
  AIProviderError,
  type AIProvider,
  type AIProviderEventHandler,
  type AIProviderOutputSchema,
  type AIProviderResult,
  type AIProviderStructuredResult,
  type AIProviderTask,
} from "../src/main/assistant/provider";
import type {
  AssistantAuthStatus,
  CoreRequest,
  DiscoveryCandidate,
  DiscoveryTrack,
  SetDraftInspectResult,
  SetDraftSnapshot,
} from "../src/shared/contracts";

const discoveryTrack = (id: string): DiscoveryTrack => ({
  id,
  title: `Track ${id}`,
  artist: "Fixture Artist",
  album: null,
  genre: "House",
  bpmMilli: 124_000,
  musicalKey: "8A",
  durationMs: 180_000,
  availability: "available",
});

const candidate = (id: string): DiscoveryCandidate => ({
  track: discoveryTrack(id),
  scorePpm: 812_345,
  confidencePpm: 800_000,
  reasons: ["Fixture evidence"],
  components: [{
    name: "tempo",
    scorePpm: 900_000,
    weightPpm: 300_000,
    contributionSignedPpm: 270_000,
    effect: "bonus",
    reason: "Tempo is compatible",
  }],
});

const similarity = (limit = 1) => ({
  seed: discoveryTrack("track-1"),
  algorithmVersion: "feature-similarity-v1" as const,
  scannedCount: 3,
  truncated: false,
  items: limit > 1 ? [candidate("track-2")] : [],
});

const recommendation = {
  seed: discoveryTrack("track-1"),
  intent: "build" as const,
  algorithmVersion: "transition-v1" as const,
  scannedCount: 3,
  truncated: false,
  items: [candidate("track-2")],
};

const draftSnapshot = (revision = 3): SetDraftSnapshot => ({
  draftId: "draft-1",
  currentRevision: revision,
  contentRevision: revision,
  title: "Fixture draft",
  plan: { intent: "smooth", targetDurationMs: null, maxArtistRepeats: null, candidateFilters: {} },
  entries: [{
    id: "entry-1",
    trackId: "track-1",
    track: discoveryTrack("track-1"),
    resolution: "resolved",
    bpmMilli: 124_000,
    musicalKey: "8A",
    energyPpm: 700_000,
    trackPinned: false,
    positionPinned: false,
    role: null,
    targetEnergyPpm: null,
  }],
  bans: [],
  knownDurationMs: 180_000,
  unknownDurationCount: 0,
  unmetConstraints: [],
  canUndo: false,
  canRedo: false,
  versions: [],
  viewingVersion: null,
});

const inspection: SetDraftInspectResult = {
  sourcePositionCount: 1,
  inspectedPositionCount: 1,
  inputTruncated: false,
  knownDurationMs: 180_000,
  unknownDurationCount: 0,
  points: [{
    position: 0,
    entryId: "entry-1",
    trackId: "track-1",
    track: discoveryTrack("track-1"),
    resolution: "resolved",
    bpmMilli: 124_000,
    musicalKey: "8A",
    energyPpm: 700_000,
    energyDirection: "unknown",
    bpmDirection: "unknown",
  }],
  transitions: [],
  warnings: [],
  matchedWarningCount: 0,
  warningsTruncated: false,
  scannedCount: 3,
  scanTruncated: false,
  organizationLabel: "Suggestions only—nothing has changed in Rekordbox.",
  organizationSuggestions: [],
  matchedSuggestionCount: 0,
  suggestionsTruncated: false,
};

class ScriptedProvider implements AIProvider {
  readonly tasks: AIProviderTask[] = [];
  readonly structuredValues: unknown[] = [];
  textResult: AIProviderResult = { text: "[track:track-1] uses bpmMilli 124000." };
  textEvents: string[] = [];
  status: AssistantAuthStatus = {
    state: "ready", auth: "chatgpt", message: "Codex is ready.", sdkVersion: "0.147.0",
  };
  structuredRun?: <Output>(
    task: AIProviderTask,
    schema: AIProviderOutputSchema<Output>,
    signal: AbortSignal,
    onEvent: AIProviderEventHandler,
  ) => Promise<AIProviderStructuredResult<Output>>;
  textRun?: (
    task: AIProviderTask,
    signal: AbortSignal,
    onEvent: AIProviderEventHandler,
  ) => Promise<AIProviderResult>;

  async getStatus() { return this.status; }
  async beginLogin(_signal: AbortSignal) { return this.status; }

  async runStructured<Output>(
    task: AIProviderTask,
    schema: AIProviderOutputSchema<Output>,
    signal: AbortSignal,
    onEvent: AIProviderEventHandler,
  ): Promise<AIProviderStructuredResult<Output>> {
    this.tasks.push(task);
    if (this.structuredRun) return this.structuredRun(task, schema, signal, onEvent);
    const value = schema.zodSchema.parse(this.structuredValues.shift()) as Output;
    if (schema.validateKnownIds && !schema.validateKnownIds(value)) {
      throw new AIProviderError("invalid_response", "Unknown identifier");
    }
    return { text: JSON.stringify(value), value };
  }

  async runText(task: AIProviderTask, signal: AbortSignal, onEvent: AIProviderEventHandler) {
    this.tasks.push(task);
    if (this.textRun) return this.textRun(task, signal, onEvent);
    for (const text of this.textEvents) onEvent({ type: "text_snapshot", text });
    return this.textResult;
  }
}

function harness(options: { provider?: ScriptedProvider; now?: () => number } = {}) {
  const provider = options.provider ?? new ScriptedProvider();
  const calls: Array<[CoreRequest["command"], unknown]> = [];
  let coreHandler = async (command: CoreRequest["command"], payload: unknown): Promise<unknown> => {
    if (command === "find_similar_tracks") return similarity((payload as { limit: number }).limit);
    if (command === "recommend_next_tracks") return recommendation;
    if (command === "list_tracks") return {
      items: [{
        ...discoveryTrack("track-2"),
        analysis: null,
        userMetadata: { rating: null, tags: [], note: null },
      }],
      nextCursor: null,
      truncated: false,
    };
    if (command === "get_set_draft") return draftSnapshot();
    if (command === "analyze_set") return inspection;
    if (command === "find_set_replacements") return {
      scannedCount: 3,
      scanTruncated: false,
      items: [{
        track: discoveryTrack("track-2"),
        scorePpm: 812_345,
        confidencePpm: 800_000,
        goalScorePpm: null,
        affectedTransitions: [],
      }],
    };
    if (command === "create_set_draft") return draftSnapshot(1);
    if (command === "mutate_set_draft") return { status: "updated", snapshot: draftSnapshot(4) };
    throw new Error(`Unexpected core command: ${command}`);
  };
  const ids = ["request-1", "proposal-1", "request-2", "proposal-2"];
  const coordinator = new AssistantCoordinator({
    provider,
    client: () => ({
      request: async (command, payload) => {
        calls.push([command, payload]);
        return coreHandler(command, payload);
      },
    }),
    ...(options.now === undefined ? {} : { now: options.now }),
    createId: () => ids.shift() ?? "later-id",
  });
  return {
    coordinator,
    provider,
    calls,
    setCoreHandler(handler: typeof coreHandler) { coreHandler = handler; },
  };
}

async function terminalEvents(coordinator: AssistantCoordinator, requestId: string) {
  await expect.poll(() => coordinator.poll(requestId, 0).terminal, { timeout: 1_000, interval: 5 }).toBe(true);
  return coordinator.poll(requestId, 0).events;
}

describe("assistant coordinator search and request lifecycle", () => {
  it("routes interpreted filters to the exact current list command and returns only validated local cards", async () => {
    const { coordinator, provider, calls } = harness();
    provider.structuredValues.push({ type: "filters", summary: "Warm house", filters: { genre: "House", bpmMinMilli: 120_000 } });

    const { requestId } = coordinator.start({ kind: "search", prompt: "Find warm house tracks" });
    const events = await terminalEvents(coordinator, requestId);

    expect(calls).toEqual([["list_tracks", { genre: "House", bpmMinMilli: 120_000, limit: 20 }]]);
    expect(provider.tasks[0]).toMatchObject({ kind: "search" });
    expect(provider.tasks[0]!.prompt.endsWith("Find warm house tracks")).toBe(true);
    expect(events.map(({ type }) => type)).toEqual([
      "activity", "activity", "search_result", "completed",
    ]);
    expect(events[2]).toMatchObject({
      type: "search_result",
      result: { mode: "filters", summary: "Warm house", filters: { genre: "House", bpmMinMilli: 120_000 } },
    });
  });

  it("substitutes the already validated selected track for similar and next routing", async () => {
    const similarHarness = harness();
    similarHarness.provider.structuredValues.push({ type: "similar", summary: "Nearby tracks", useSelectedTrack: true });
    const similarRequest = similarHarness.coordinator.start({
      kind: "search", prompt: "Find tracks similar to this", selectedTrackId: "track-1",
    });
    const similarEvents = await terminalEvents(similarHarness.coordinator, similarRequest.requestId);
    expect(similarHarness.calls).toEqual([
      ["find_similar_tracks", { seedTrackId: "track-1", limit: 1 }],
      ["find_similar_tracks", { seedTrackId: "track-1", limit: 20 }],
    ]);
    expect(similarEvents.find(({ type }) => type === "search_result")).toMatchObject({
      type: "search_result", result: { mode: "similar", seedTrackId: "track-1" },
    });

    const nextHarness = harness();
    nextHarness.provider.structuredValues.push({ type: "next", summary: "Build energy", useSelectedTrack: true, intent: "build" });
    const nextRequest = nextHarness.coordinator.start({
      kind: "search", prompt: "What should I play next to build energy?", selectedTrackId: "track-1",
    });
    const nextEvents = await terminalEvents(nextHarness.coordinator, nextRequest.requestId);
    expect(nextHarness.calls).toEqual([
      ["find_similar_tracks", { seedTrackId: "track-1", limit: 1 }],
      ["recommend_next_tracks", { seedTrackId: "track-1", intent: "build", limit: 20 }],
    ]);
    expect(nextEvents.find(({ type }) => type === "search_result")).toMatchObject({
      type: "search_result", result: { mode: "next", seedTrackId: "track-1", intent: "build" },
    });
  });

  it("rejects duplicate active work, cancels exactly once, and discards late provider output", async () => {
    const provider = new ScriptedProvider();
    let finish: (() => void) | undefined;
    provider.structuredRun = async <Output>(_task: AIProviderTask, _schema: AIProviderOutputSchema<Output>, _signal: AbortSignal) => new Promise<AIProviderStructuredResult<Output>>((resolve) => {
      finish = () => resolve({
        text: "{}",
        value: { type: "unsupported", reason: "late" } as Output,
      });
    });
    const { coordinator } = harness({ provider });
    const first = coordinator.start({ kind: "search", prompt: "Wait" });

    expect(() => coordinator.start({ kind: "search", prompt: "Duplicate" })).toThrow("already active");
    expect(coordinator.cancel(first.requestId)).toEqual({ status: "cancelled" });
    expect(coordinator.cancel(first.requestId)).toEqual({ status: "already_terminal" });
    finish!();
    await Promise.resolve();

    const events = coordinator.poll(first.requestId, 0).events;
    expect(events.filter(({ type }) => type === "cancelled")).toHaveLength(1);
    expect(events.some(({ type }) => type === "completed" || type === "search_result")).toBe(false);
  });

  it("caps retained events and aborts active work during shutdown without accepting late results", async () => {
    const provider = new ScriptedProvider();
    let finish: ((value: AIProviderResult) => void) | undefined;
    let observedSignal: AbortSignal | undefined;
    provider.textRun = async (_task, signal, onEvent) => {
      observedSignal = signal;
      for (let index = 0; index < 80; index += 1) {
        onEvent({ type: "text_snapshot", text: "[track:track-1] uses bpmMilli 124000." });
      }
      return new Promise((resolve) => { finish = resolve; });
    };
    const { coordinator } = harness({ provider });
    const request = coordinator.start({
      kind: "explain",
      prompt: "Explain this track",
      context: { kind: "selected_track", selectedTrackId: "track-1" },
    });
    await expect.poll(() => provider.tasks.length, { timeout: 1_000, interval: 5 }).toBe(1);

    coordinator.shutdown();
    expect(observedSignal?.aborted).toBe(true);
    finish!({ text: "[track:track-1] uses bpmMilli 124000." });
    await Promise.resolve();

    const events = coordinator.poll(request.requestId, 0).events;
    expect(events.length).toBeLessThanOrEqual(50);
    expect(events.at(-1)?.type).toBe("cancelled");
    expect(events.some(({ type }) => type === "completed")).toBe(false);
  });

  it("validates status and login responses and reduces provider errors to stable categories", async () => {
    const { coordinator, provider } = harness();
    await expect(coordinator.getStatus()).resolves.toMatchObject({ state: "ready", auth: "chatgpt" });
    provider.status = { state: "ready", auth: "other", message: "raw bad state", sdkVersion: "0.147.0" } as AssistantAuthStatus;
    await expect(coordinator.getStatus()).resolves.toEqual({
      state: "unavailable", auth: "unknown", message: "Copilot is unavailable.", sdkVersion: null,
    });
    provider.beginLogin = async () => { throw new AIProviderError("signed_out", "raw helper output"); };
    await expect(coordinator.beginLogin()).resolves.toEqual({
      state: "signed_out", auth: "none", message: "Sign in with ChatGPT to use Copilot.", sdkVersion: null,
    });
  });

  it("never overlaps task, status, and login provider operations", async () => {
    const provider = new ScriptedProvider();
    let finishTask: (() => void) | undefined;
    let statusCalls = 0;
    let loginCalls = 0;
    provider.getStatus = async () => {
      statusCalls += 1;
      return provider.status;
    };
    provider.beginLogin = async () => {
      loginCalls += 1;
      return provider.status;
    };
    provider.structuredRun = async <Output>(_task: AIProviderTask, schema: AIProviderOutputSchema<Output>) => new Promise<AIProviderStructuredResult<Output>>((resolve) => {
      finishTask = () => resolve({
        text: "{}",
        value: schema.zodSchema.parse({ type: "unsupported", reason: "Done" }),
      });
    });
    const { coordinator } = harness({ provider });
    const task = coordinator.start({ kind: "search", prompt: "Wait" });
    await expect(coordinator.getStatus()).resolves.toMatchObject({ state: "checking", auth: "unknown" });
    await expect(coordinator.beginLogin()).resolves.toMatchObject({ state: "unavailable" });
    expect(statusCalls).toBe(0);
    expect(loginCalls).toBe(0);
    coordinator.cancel(task.requestId);
    finishTask!();

    let finishLogin: (() => void) | undefined;
    provider.beginLogin = async () => new Promise((resolve) => {
      finishLogin = () => resolve(provider.status);
    });
    const login = coordinator.beginLogin();
    expect(() => coordinator.start({ kind: "search", prompt: "No overlap" })).toThrow("already active");
    finishLogin!();
    await expect(login).resolves.toMatchObject({ state: "ready" });

    let finishStatus: (() => void) | undefined;
    provider.getStatus = async () => new Promise((resolve) => {
      finishStatus = () => resolve(provider.status);
    });
    const status = coordinator.getStatus();
    expect(() => coordinator.start({ kind: "search", prompt: "No status overlap" })).toThrow("already active");
    finishStatus!();
    await expect(status).resolves.toMatchObject({ state: "ready" });
  });

  it("fails a locally returned search page that exceeds the requested evidence cap", async () => {
    const { coordinator, provider, setCoreHandler } = harness();
    provider.structuredValues.push({ type: "filters", summary: "House", filters: { genre: "House" } });
    setCoreHandler(async (command) => {
      if (command !== "list_tracks") throw new Error("unexpected");
      return {
        items: Array.from({ length: 21 }, (_, index) => ({
          ...discoveryTrack(`track-${index}`),
          analysis: null,
          userMetadata: { rating: null, tags: [], note: null },
        })),
        nextCursor: null,
        truncated: false,
      };
    });
    const request = coordinator.start({ kind: "search", prompt: "Find house" });
    const events = await terminalEvents(coordinator, request.requestId);

    expect(events.at(-1)).toMatchObject({ type: "failed", error: { code: "invalid_response" } });
    expect(events.some(({ type }) => type === "search_result")).toBe(false);
  });

  it("rejects a provider-invented playlist identifier that was never supplied as context", async () => {
    const { coordinator, provider, calls } = harness();
    provider.structuredValues.push({
      type: "filters", summary: "Invented playlist", filters: { playlistId: "playlist-invented" },
    });
    const request = coordinator.start({ kind: "search", prompt: "Find my playlist" });
    const events = await terminalEvents(coordinator, request.requestId);

    expect(events.at(-1)).toMatchObject({ type: "failed", error: { code: "invalid_response" } });
    expect(calls).toEqual([]);
  });
});

describe("assistant coordinator proposals and grounded explanations", () => {
  it("keeps a generated plan read-only until one matching, unexpired confirmation", async () => {
    const { coordinator, provider, calls } = harness();
    provider.structuredValues.push({
      type: "create_draft",
      summary: "Five-track smooth set",
      title: "Smooth five",
      plan: { intent: "smooth", targetDurationMs: null, maxArtistRepeats: 2, candidateFilters: {} },
      maxTracks: 5,
      useSelectedTrackAsSeed: false,
    });

    const request = coordinator.start({ kind: "plan", prompt: "Plan a smooth five-track set" });
    const events = await terminalEvents(coordinator, request.requestId);
    const proposalEvent = events.find(({ type }) => type === "proposal");
    expect(proposalEvent).toMatchObject({
      type: "proposal",
      proposal: { kind: "plan", proposalId: "proposal-1", source: { kind: "generated", maxTracks: 5 } },
    });
    expect(calls).toEqual([]);

    await expect(coordinator.confirm(request.requestId, "wrong-proposal")).resolves.toMatchObject({
      status: "blocked", code: "mismatch",
    });
    expect(calls).toEqual([]);
    await expect(coordinator.confirm(request.requestId, "proposal-1")).resolves.toMatchObject({ status: "created" });
    expect(calls).toEqual([["create_set_draft", {
      title: "Smooth five",
      plan: { intent: "smooth", targetDurationMs: null, maxArtistRepeats: 2, candidateFilters: {} },
      source: { kind: "generated", maxTracks: 5 },
    }]]);
    await expect(coordinator.confirm(request.requestId, "proposal-1")).resolves.toMatchObject({
      status: "blocked", code: "not_found",
    });
    expect(calls).toHaveLength(1);
  });

  it("expires a plan confirmation after ten minutes without writing", async () => {
    let now = 1_000;
    const { coordinator, provider, calls } = harness({ now: () => now });
    provider.structuredValues.push({
      type: "create_draft",
      summary: "Small set",
      title: "Small set",
      plan: { intent: "smooth", targetDurationMs: null, maxArtistRepeats: null, candidateFilters: {} },
      maxTracks: 5,
      useSelectedTrackAsSeed: false,
    });
    const request = coordinator.start({ kind: "plan", prompt: "Plan a set" });
    await terminalEvents(coordinator, request.requestId);
    now += 600_001;

    await expect(coordinator.confirm(request.requestId, "proposal-1")).resolves.toMatchObject({
      status: "blocked", code: "expired",
    });
    expect(calls).toEqual([]);
  });

  it("remembers an expired proposal long enough to return an explicit expiry after timer cleanup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      const { coordinator, provider, calls } = harness();
      provider.structuredValues.push({
        type: "create_draft",
        summary: "Small set",
        title: "Small set",
        plan: { intent: "smooth", targetDurationMs: null, maxArtistRepeats: null, candidateFilters: {} },
        maxTracks: 5,
        useSelectedTrackAsSeed: false,
      });
      const request = coordinator.start({ kind: "plan", prompt: "Plan a set" });
      for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
      expect(coordinator.poll(request.requestId, 0).terminal).toBe(true);

      vi.advanceTimersByTime(600_001);
      await expect(coordinator.confirm(request.requestId, "proposal-1")).resolves.toMatchObject({
        status: "blocked", code: "expired",
      });
      expect(calls).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves replace_with_best locally and confirms only the normalized current mutation", async () => {
    const { coordinator, provider, calls } = harness();
    provider.structuredValues.push({ type: "replace_with_best", entryId: "entry-1" });

    const request = coordinator.start({
      kind: "revise",
      prompt: "Replace this with the best option",
      draftId: "draft-1",
      expectedRevision: 3,
    });
    const events = await terminalEvents(coordinator, request.requestId);
    expect(events.find(({ type }) => type === "proposal")).toMatchObject({
      type: "proposal",
      proposal: {
        kind: "revision",
        proposalId: "proposal-1",
        draftId: "draft-1",
        expectedRevision: 3,
        mutation: { type: "replace_entry", entryId: "entry-1", replacementTrackId: "track-2" },
        evidenceTrackIds: ["track-1", "track-2"],
      },
    });
    expect(calls).toEqual([
      ["get_set_draft", { draftId: "draft-1" }],
      ["find_set_replacements", { draftId: "draft-1", entryId: "entry-1", revision: 3 }],
    ]);

    await expect(coordinator.confirm(request.requestId, "proposal-1")).resolves.toMatchObject({ status: "updated" });
    expect(calls.slice(-2)).toEqual([
      ["get_set_draft", { draftId: "draft-1" }],
      ["mutate_set_draft", {
        draftId: "draft-1",
        expectedRevision: 3,
        mutation: { type: "replace_entry", entryId: "entry-1", replacementTrackId: "track-2" },
      }],
    ]);
  });

  it("returns unchanged for a valid confirmed revision no-op and consumes the proposal once", async () => {
    const { coordinator, provider, calls, setCoreHandler } = harness();
    provider.structuredValues.push({ type: "rename", title: "Fixture draft" });
    setCoreHandler(async (command) => {
      if (command === "get_set_draft") return draftSnapshot(3);
      if (command === "mutate_set_draft") {
        return { status: "updated", snapshot: draftSnapshot(3) };
      }
      throw new Error("unexpected");
    });
    const request = coordinator.start({
      kind: "revise",
      prompt: "Keep this set named Fixture draft",
      draftId: "draft-1",
      expectedRevision: 3,
    });
    await terminalEvents(coordinator, request.requestId);

    await expect(coordinator.confirm(request.requestId, "proposal-1")).resolves.toEqual({
      status: "unchanged",
      snapshot: draftSnapshot(3),
    });
    await expect(coordinator.confirm(request.requestId, "proposal-1")).resolves.toMatchObject({
      status: "blocked",
      code: "not_found",
    });
    expect(calls.filter(([command]) => command === "mutate_set_draft")).toEqual([["mutate_set_draft", {
      draftId: "draft-1",
      expectedRevision: 3,
      mutation: { type: "rename", title: "Fixture draft" },
    }]]);
  });

  it("rejects a replacement response that does not identify a distinct current candidate", async () => {
    const { coordinator, provider, setCoreHandler } = harness();
    provider.structuredValues.push({ type: "replace_with_best", entryId: "entry-1" });
    setCoreHandler(async (command) => {
      if (command === "get_set_draft") return draftSnapshot();
      if (command === "find_set_replacements") {
        return {
          scannedCount: 1,
          scanTruncated: false,
          items: [{
            track: discoveryTrack("track-1"),
            scorePpm: 812_345,
            confidencePpm: 800_000,
            goalScorePpm: null,
            affectedTransitions: [],
          }],
        };
      }
      throw new Error("unexpected");
    });
    const request = coordinator.start({
      kind: "revise", prompt: "Replace it", draftId: "draft-1", expectedRevision: 3,
    });
    const events = await terminalEvents(coordinator, request.requestId);

    expect(events.at(-1)).toMatchObject({ type: "failed", error: { code: "invalid_response" } });
    expect(events.some(({ type }) => type === "proposal")).toBe(false);
  });

  it("blocks a malformed core confirmation response as invalid after consuming the proposal", async () => {
    const { coordinator, provider, calls, setCoreHandler } = harness();
    provider.structuredValues.push({
      type: "create_draft",
      summary: "Small set",
      title: "Small set",
      plan: { intent: "smooth", targetDurationMs: null, maxArtistRepeats: null, candidateFilters: {} },
      maxTracks: 5,
      useSelectedTrackAsSeed: false,
    });
    const request = coordinator.start({ kind: "plan", prompt: "Plan a set" });
    await terminalEvents(coordinator, request.requestId);
    setCoreHandler(async () => ({ status: "ok", sourcePath: "/private/music.wav" }));

    await expect(coordinator.confirm(request.requestId, "proposal-1")).resolves.toMatchObject({
      status: "blocked", code: "invalid",
    });
    await expect(coordinator.confirm(request.requestId, "proposal-1")).resolves.toMatchObject({
      status: "blocked", code: "not_found",
    });
    expect(calls.filter(([command]) => command === "create_set_draft")).toHaveLength(1);
  });

  it("fails stale revision requests before provider use and returns a current conflict before mutation", async () => {
    const stale = harness();
    stale.setCoreHandler(async (command) => {
      if (command === "get_set_draft") return draftSnapshot(4);
      throw new Error("unexpected");
    });
    const staleRequest = stale.coordinator.start({
      kind: "revise", prompt: "Rename", draftId: "draft-1", expectedRevision: 3,
    });
    const staleEvents = await terminalEvents(stale.coordinator, staleRequest.requestId);
    expect(staleEvents.at(-1)).toMatchObject({ type: "failed", error: { code: "conflict" } });
    expect(stale.provider.tasks).toEqual([]);

    const conflict = harness();
    conflict.provider.structuredValues.push({ type: "rename", title: "Sunset Session" });
    const request = conflict.coordinator.start({
      kind: "revise", prompt: "Rename this set to Sunset Session", draftId: "draft-1", expectedRevision: 3,
    });
    await terminalEvents(conflict.coordinator, request.requestId);
    conflict.setCoreHandler(async (command) => {
      if (command === "get_set_draft") return draftSnapshot(4);
      throw new Error("mutation must not run");
    });
    await expect(conflict.coordinator.confirm(request.requestId, "proposal-1")).resolves.toEqual({
      status: "conflict", currentRevision: 4,
    });
    expect(conflict.calls.filter(([command]) => command === "mutate_set_draft")).toEqual([]);
  });

  it("streams only safe snapshots and validates final draft citations before completion", async () => {
    const { coordinator, provider, calls } = harness();
    provider.textEvents = [
      "Ignore this unknown [track:invented].",
      "[track:track-1] uses bpmMilli 124000.",
    ];
    provider.textResult = { text: "[track:track-1] uses bpmMilli 124000." };
    const request = coordinator.start({
      kind: "explain",
      prompt: "Explain this draft",
      context: { kind: "draft", draftId: "draft-1", expectedRevision: 3 },
    });
    const events = await terminalEvents(coordinator, request.requestId);

    expect(calls).toEqual([
      ["get_set_draft", { draftId: "draft-1" }],
      ["analyze_set", { kind: "draft", draftId: "draft-1", revision: 3 }],
    ]);
    expect(events.filter(({ type }) => type === "text_snapshot")).toEqual([
      expect.objectContaining({ type: "text_snapshot", text: "[track:track-1] uses bpmMilli 124000." }),
    ]);
    expect(events.at(-1)).toMatchObject({ type: "completed", evidenceTrackIds: ["track-1"] });
  });

  it("fails unknown citations and altered numeric claims as invalid_response", async () => {
    for (const text of [
      "[track:invented] is a match.",
      "[track:track-1] has bpmMilli 999999.",
    ]) {
      const { coordinator, provider } = harness();
      provider.textResult = { text };
      const request = coordinator.start({
        kind: "explain",
        prompt: "Explain",
        context: { kind: "selected_track", selectedTrackId: "track-1" },
      });
      const events = await terminalEvents(coordinator, request.requestId);
      expect(events.at(-1)).toMatchObject({ type: "failed", error: { code: "invalid_response" } });
      expect(events.some(({ type }) => type === "completed")).toBe(false);
    }
  });
});
