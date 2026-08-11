import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { registerIpcHandlers } from "../src/main/ipc";
import { installGracefulShutdown } from "../src/main/shutdown";
import {
  createWindowOptions,
  installContentSecurityPolicy,
  installWindowSecurity,
} from "../src/main/window-security";

describe("window security", () => {
  it("uses an isolated sandboxed preload", () => {
    expect(createWindowOptions("/app/preload.cjs").webPreferences).toEqual({
      preload: "/app/preload.cjs",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
  });

  it("denies untrusted navigation and every new window", () => {
    let navigate: ((event: { preventDefault(): void }, url: string) => void) | undefined;
    let openHandler: (() => { action: string }) | undefined;
    const webContents = {
      on: vi.fn((name: string, callback: typeof navigate) => {
        if (name === "will-navigate") navigate = callback;
      }),
      setWindowOpenHandler: vi.fn((callback: typeof openHandler) => {
        openHandler = callback;
      }),
    };
    installWindowSecurity(webContents, "http://127.0.0.1:5173");
    const denied = { preventDefault: vi.fn() };
    navigate!(denied, "https://example.test");
    const allowed = { preventDefault: vi.fn() };
    navigate!(allowed, "http://127.0.0.1:5173");

    expect(denied.preventDefault).toHaveBeenCalledOnce();
    expect(allowed.preventDefault).not.toHaveBeenCalled();
    expect(openHandler!()).toEqual({ action: "deny" });
  });

  it("adds a restrictive CSP header to renderer responses", () => {
    let listener: ((details: { responseHeaders?: Record<string, string[]> }, callback: (headers: { responseHeaders: Record<string, string[]> }) => void) => void) | undefined;
    installContentSecurityPolicy({
      webRequest: {
        onHeadersReceived: vi.fn((callback) => {
          listener = callback;
        }),
      },
    });
    let headers: Record<string, string[]> | undefined;
    listener!({}, (result) => {
      headers = result.responseHeaders;
    });

    expect(headers?.["Content-Security-Policy"]?.[0]).toContain("default-src 'self'");
    expect(headers?.["Content-Security-Policy"]?.[0]).toContain("object-src 'none'");
  });

  it("permits Vite's inline development preamble without weakening packaged CSP", () => {
    const captureCsp = (development: boolean) => {
      let listener: ((details: { responseHeaders?: Record<string, string[]> }, callback: (headers: { responseHeaders: Record<string, string[]> }) => void) => void) | undefined;
      installContentSecurityPolicy({
        webRequest: { onHeadersReceived: vi.fn((callback) => { listener = callback; }) },
      }, development);
      let policy = "";
      listener!({}, (result) => { policy = result.responseHeaders["Content-Security-Policy"]![0]!; });
      return policy;
    };

    expect(captureCsp(true)).toContain("script-src 'self' 'unsafe-inline'");
    expect(captureCsp(true)).toContain("connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173");
    expect(captureCsp(false)).toContain("script-src 'self'");
    expect(captureCsp(false)).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(captureCsp(false)).toContain("connect-src 'self'");
    expect(captureCsp(false)).not.toContain("127.0.0.1");
  });
});

describe("main shutdown", () => {
  it("waits for core cleanup before a guarded second quit", async () => {
    let beforeQuit: ((event: { preventDefault(): void }) => void) | undefined;
    const order: string[] = [];
    let finishStop: (() => void) | undefined;
    const stopped = new Promise<void>((resolve) => { finishStop = resolve; });
    installGracefulShutdown(
      {
        on: (_event, listener) => { beforeQuit = listener; },
        quit: () => { order.push("quit"); },
      },
      async () => {
        order.push("stop");
        await stopped;
      },
    );
    const firstEvent = { preventDefault: vi.fn() };
    beforeQuit!(firstEvent);

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(order).toEqual(["stop"]);
    const pendingEvent = { preventDefault: vi.fn() };
    beforeQuit!(pendingEvent);
    expect(pendingEvent.preventDefault).toHaveBeenCalledOnce();
    expect(order).toEqual(["stop"]);
    finishStop!();
    await expect.poll(() => order, { timeout: 1_000, interval: 5 }).toEqual(["stop", "quit"]);
    const completedEvent = { preventDefault: vi.fn() };
    beforeQuit!(completedEvent);
    expect(completedEvent.preventDefault).not.toHaveBeenCalled();
  });
});

describe("guarded IPC", () => {
  const fixture = resolve(process.cwd(), "../../fixtures/rekordbox/phase0-library.xml");
  const discoveryTrack = {
    id: "track-1",
    title: "Generated Seed",
    artist: "Fixture Artist",
    album: null,
    genre: "House",
    bpmMilli: 120_000,
    musicalKey: "8A",
    durationMs: 180_000,
    availability: "available",
  };
  const similarityResult = {
    seed: discoveryTrack,
    algorithmVersion: "feature-similarity-v1",
    scannedCount: 1,
    truncated: false,
    items: [],
  };
  const recommendationResult = {
    seed: discoveryTrack,
    intent: "smooth",
    algorithmVersion: "transition-v1",
    scannedCount: 1,
    truncated: false,
    items: [],
  };
  const analysisStatus = {
    state: "running",
    queued: 1,
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
    items: [
      {
        trackId: "track-1",
        status: "queued",
        progressPpm: 0,
        attemptCount: 0,
        errorCode: null,
        errorMessage: null,
        features: null,
      },
    ],
  };

  function harness(overrides: Partial<{
    senderUrl: string;
    testXml: string;
    cancelled: boolean;
    discoveryResult: unknown;
  }> = {}) {
    const handlers = new Map<string, (event: { senderFrame: { url: string } }, payload?: unknown) => Promise<unknown>>();
    const requests: string[] = [];
    const requestCalls: Array<[string, unknown]> = [];
    registerIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      dialog: { showOpenDialog: async () => ({ canceled: overrides.cancelled ?? false, filePaths: [fixture] }) },
      getWindow: () => null,
      repositoryRoot: resolve(process.cwd(), "../.."),
      rendererUrl: "http://127.0.0.1:5173",
      environment: { DJ_COPILOT_TEST_MODE: "1", ...(overrides.testXml ? { DJ_COPILOT_TEST_XML: overrides.testXml } : {}) },
      status: () => ({ state: "ready", message: null }),
      client: () => ({
        request: async (command, payload) => {
          requests.push(command);
          requestCalls.push([command, payload]);
          if (command === "import_library") {
            expect(payload).toEqual({ sourcePath: fixture });
            return {
              success: true,
              summary: { revision: 1, sourceSha256: "a".repeat(64), importedTracks: 4, importedPlaylists: 2, unavailableTracks: 1 },
            };
          }
          if (command === "get_playlist_tree") return [];
          if (command === "list_tracks") return { items: [], nextCursor: null, truncated: false };
          if (command === "find_similar_tracks") return overrides.discoveryResult ?? similarityResult;
          if (command === "recommend_next_tracks") return overrides.discoveryResult ?? recommendationResult;
          if (
            command === "queue_analysis" ||
            command === "get_analysis_status" ||
            command === "pause_analysis" ||
            command === "resume_analysis"
          ) return analysisStatus;
          return { status: "ok" };
        },
      }),
    });
    const event = { senderFrame: { url: overrides.senderUrl ?? "http://127.0.0.1:5173" } };
    return { handlers, event, requests, requestCalls };
  }

  it("owns the import path and validates core results before returning them", async () => {
    const { handlers, event } = harness({ testXml: fixture });

    await expect(handlers.get("library:importXml")!(event)).resolves.toEqual({
      success: true,
      summary: { revision: 1, sourceSha256: "a".repeat(64), importedTracks: 4, importedPlaylists: 2, unavailableTracks: 1 },
    });
  });

  it("returns a stable cancellation result without forwarding an import", async () => {
    const { handlers, event, requests } = harness({ cancelled: true });

    await expect(handlers.get("library:importXml")!(event)).resolves.toEqual({
      success: false,
      error: { code: "cancelled", message: "No XML selected" },
      preservedPreviousLibrary: true,
    });
    expect(requests).toEqual([]);
  });

  it("rejects an untrusted sender with a stable error", async () => {
    const { handlers, event } = harness({ senderUrl: "https://attacker.test" });

    await expect(handlers.get("system:getStatus")!(event)).rejects.toThrow("Untrusted IPC sender");
  });

  it("rejects malformed list payloads and empty playlist IDs", async () => {
    const { handlers, event } = harness();

    await expect(handlers.get("library:listTracks")!(event, { limit: 201 })).rejects.toThrow("Invalid IPC payload");
    await expect(handlers.get("library:listTracks")!(event, { playlistId: "" })).rejects.toThrow("Invalid IPC payload");
  });

  it("guards every fixed analysis channel and returns its validated core result", async () => {
    const { handlers, event } = harness();

    await expect(handlers.get("analysis:queue")!(event, { trackIds: ["track-1"] })).resolves.toEqual(analysisStatus);
    await expect(handlers.get("analysis:getStatus")!(event, { trackIds: ["track-1"] })).resolves.toEqual(analysisStatus);
    await expect(handlers.get("analysis:pause")!(event)).resolves.toEqual(analysisStatus);
    await expect(handlers.get("analysis:resume")!(event)).resolves.toEqual(analysisStatus);
    await expect(handlers.get("analysis:queue")!(event, { trackIds: [] })).rejects.toThrow("Invalid IPC payload");
    await expect(handlers.get("analysis:getStatus")!(event, null)).rejects.toThrow("Invalid IPC payload");
    await expect(handlers.get("analysis:pause")!(event, {})).rejects.toThrow("Invalid IPC payload");
  });

  it("rejects an untrusted analysis sender and a path-bearing core result", async () => {
    const untrusted = harness({ senderUrl: "https://attacker.test" });
    await expect(
      untrusted.handlers.get("analysis:getStatus")!(untrusted.event, { trackIds: ["track-1"] }),
    ).rejects.toThrow("Untrusted IPC sender");

    const handlers = new Map<string, (event: { senderFrame: { url: string } }, payload?: unknown) => Promise<unknown>>();
    registerIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      getWindow: () => null,
      repositoryRoot: resolve(process.cwd(), "../.."),
      rendererUrl: "http://127.0.0.1:5173",
      status: () => ({ state: "ready", message: null }),
      client: () => ({
        request: async () => ({ ...analysisStatus, sourcePath: "/private/music/track.wav" }),
      }),
    });
    const event = { senderFrame: { url: "http://127.0.0.1:5173" } };
    await expect(handlers.get("analysis:getStatus")!(event)).rejects.toThrow("Core response failed validation");
  });

  it("looks up the current core client for analysis after the supervisor replaces it", async () => {
    const handlers = new Map<string, (event: { senderFrame: { url: string } }, payload?: unknown) => Promise<unknown>>();
    type TestClient = { request(command: string, payload: unknown): Promise<unknown> };
    const firstClient: TestClient = { request: async () => analysisStatus };
    const recoveredStatus = { ...analysisStatus, state: "paused", queued: 0, paused: 1 };
    const restartedClient: TestClient = { request: async () => recoveredStatus };
    let activeClient = firstClient;
    registerIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      getWindow: () => null,
      repositoryRoot: resolve(process.cwd(), "../.."),
      rendererUrl: "http://127.0.0.1:5173",
      status: () => ({ state: "ready", message: null }),
      client: (() => activeClient) as never,
    });
    const event = { senderFrame: { url: "http://127.0.0.1:5173" } };

    await expect(handlers.get("analysis:getStatus")!(event)).resolves.toEqual(analysisStatus);
    activeClient = restartedClient;
    await expect(handlers.get("analysis:getStatus")!(event)).resolves.toEqual(recoveredStatus);
  });

  it("maps only the two fixed discovery channels to validated core commands", async () => {
    const { handlers, event, requestCalls } = harness();

    await expect(
      handlers.get("discovery:findSimilar")!(event, {
        seedTrackId: "track-1",
        filters: { playlistId: "playlist-1", bpmMinMilli: 90_000, availability: "available" },
      }),
    ).resolves.toEqual(similarityResult);
    await expect(
      handlers.get("discovery:recommendNext")!(event, {
        seedTrackId: "track-1",
        intent: "smooth",
        limit: 20,
      }),
    ).resolves.toEqual(recommendationResult);

    expect(requestCalls.slice(-2)).toEqual([
      [
        "find_similar_tracks",
        {
          seedTrackId: "track-1",
          filters: { playlistId: "playlist-1", bpmMinMilli: 90_000, availability: "available" },
          limit: 10,
        },
      ],
      ["recommend_next_tracks", { seedTrackId: "track-1", intent: "smooth", limit: 20 }],
    ]);
  });

  it("rejects untrusted discovery senders and malformed discovery payloads", async () => {
    const untrusted = harness({ senderUrl: "https://attacker.test" });
    await expect(
      untrusted.handlers.get("discovery:findSimilar")!(untrusted.event, { seedTrackId: "track-1" }),
    ).rejects.toThrow("Untrusted IPC sender");
    await expect(
      untrusted.handlers.get("discovery:recommendNext")!(untrusted.event, {
        seedTrackId: "track-1",
        intent: "smooth",
      }),
    ).rejects.toThrow("Untrusted IPC sender");

    const { handlers, event } = harness();
    await expect(
      handlers.get("discovery:findSimilar")!(event, { seedTrackId: "", shell: true }),
    ).rejects.toThrow("Invalid IPC payload");
    await expect(
      handlers.get("discovery:recommendNext")!(event, {
        seedTrackId: "track-1",
        intent: "unknown",
      }),
    ).rejects.toThrow("Invalid IPC payload");
    await expect(
      handlers.get("discovery:findSimilar")!(event, {
        seedTrackId: "track-1",
        filters: { bpmMinMilli: 130_000, bpmMaxMilli: 120_000 },
      }),
    ).rejects.toThrow("Invalid IPC payload");
  });

  it("rejects malformed and path-bearing discovery results from core", async () => {
    const malformed = harness({
      discoveryResult: {
        ...similarityResult,
        seed: { ...discoveryTrack, sourcePath: "/private/music/seed.wav" },
      },
    });

    await expect(
      malformed.handlers.get("discovery:findSimilar")!(malformed.event, { seedTrackId: "track-1" }),
    ).rejects.toThrow("Core response failed validation");

    const wrongAlgorithm = harness({
      discoveryResult: { ...recommendationResult, algorithmVersion: "transition-v2" },
    });
    await expect(
      wrongAlgorithm.handlers.get("discovery:recommendNext")!(wrongAlgorithm.event, {
        seedTrackId: "track-1",
        intent: "smooth",
      }),
    ).rejects.toThrow("Core response failed validation");
  });

  it("keeps save destinations in main, binds a ready preview to one single-use confirmation, and returns only a display name", async () => {
    const handlers = new Map<string, (event: { senderFrame: { url: string } }, payload?: unknown) => Promise<unknown>>();
    const calls: Array<[string, unknown]> = [];
    registerIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      dialog: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
        showSaveDialog: async () => ({ canceled: false, filePath: "/exports/Friday set.xml" }),
      },
      getWindow: () => null,
      repositoryRoot: resolve(process.cwd(), "../.."),
      rendererUrl: "http://127.0.0.1:5173",
      status: () => ({ state: "ready", message: null }),
      now: () => 1_000,
      createConfirmationId: () => "confirmation-1",
      realpath: async (path) => path,
      lstat: async () => { throw Object.assign(new Error("absent"), { code: "ENOENT" }); },
      client: () => ({
        request: async (command, payload) => {
          calls.push([command, payload]);
          if (command === "preview_set_export") {
            return {
              status: "ready", draftId: "draft-1", revision: 3, playlistName: "Friday set", trackCount: 4,
              knownDurationMs: 720_000, unknownDurationCount: 0, warnings: [], expectedDestinationState: "absent",
            };
          }
          return {
            status: "exported", draftId: "draft-1", revision: 3, playlistName: "Friday set", trackCount: 4,
            overwritten: false, format: "rekordbox_xml_1_0_0", destinationState: "replaced",
          };
        },
      }),
    });
    const event = { senderFrame: { url: "http://127.0.0.1:5173" } };

    await expect(handlers.get("exports:prepare")!(event, { draftId: "draft-1", expectedRevision: 3 })).resolves.toEqual({
      status: "ready", confirmationId: "confirmation-1", playlistName: "Friday set", trackCount: 4,
      knownDurationMs: 720_000, unknownDurationCount: 0, destinationDisplay: "Friday set.xml", willReplaceExisting: false, warnings: [],
    });
    await expect(handlers.get("exports:confirm")!(event, { confirmationId: "confirmation-1" })).resolves.toMatchObject({ status: "exported" });
    expect(calls).toEqual([
      ["preview_set_export", { draftId: "draft-1", expectedRevision: 3, destinationPath: "/exports/Friday set.xml", expectedDestinationState: "absent" }],
      ["export_set_draft", { draftId: "draft-1", expectedRevision: 3, destinationPath: "/exports/Friday set.xml", expectedDestinationState: "absent" }],
    ]);
    await expect(handlers.get("exports:confirm")!(event, { confirmationId: "confirmation-1" })).resolves.toEqual({
      status: "blocked", reasons: [{ code: "invalid_confirmation", message: "The export confirmation is unavailable or has expired" }], destinationState: "unchanged",
    });
  });

  it("rejects untrusted, cancelled, unsafe, raced, and expired export confirmations without forwarding a path", async () => {
    const handlers = new Map<string, (event: { senderFrame: { url: string } }, payload?: unknown) => Promise<unknown>>();
    let now = 0;
    let lstatCalls = 0;
    const requests: string[] = [];
    registerIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      dialog: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
        showSaveDialog: async () => ({ canceled: false, filePath: "/exports/unsafe.xml" }),
      },
      getWindow: () => null,
      repositoryRoot: resolve(process.cwd(), "../.."),
      rendererUrl: "http://127.0.0.1:5173",
      status: () => ({ state: "ready", message: null }),
      now: () => now,
      createConfirmationId: () => "confirmation-2",
      realpath: async (path) => path,
      lstat: async () => {
        lstatCalls += 1;
        if (lstatCalls === 1) throw Object.assign(new Error("absent"), { code: "ENOENT" });
        return { isSymbolicLink: () => false, isFile: () => true };
      },
      client: () => ({
        request: async (command) => {
          requests.push(command);
          return {
            status: "ready", draftId: "draft-1", revision: 3, playlistName: "Friday set", trackCount: 4,
            knownDurationMs: 720_000, unknownDurationCount: 0, warnings: [], expectedDestinationState: "absent",
          };
        },
      }),
    });
    const event = { senderFrame: { url: "http://127.0.0.1:5173" } };
    const attacker = { senderFrame: { url: "https://attacker.test" } };

    await expect(handlers.get("exports:prepare")!(attacker, { draftId: "draft-1", expectedRevision: 3 })).rejects.toThrow("Untrusted IPC sender");
    await handlers.get("exports:prepare")!(event, { draftId: "draft-1", expectedRevision: 3 });
    await expect(handlers.get("exports:confirm")!(event, { confirmationId: "confirmation-2" })).resolves.toEqual({
      status: "blocked", reasons: [{ code: "destination_changed", message: "The export destination changed before confirmation" }], destinationState: "unchanged",
    });
    expect(requests).toEqual(["preview_set_export"]);

    now = 1;
    lstatCalls = 0;
    await handlers.get("exports:prepare")!(event, { draftId: "draft-1", expectedRevision: 3 });
    now = 600_002;
    await expect(handlers.get("exports:confirm")!(event, { confirmationId: "confirmation-2" })).resolves.toMatchObject({ status: "blocked", destinationState: "unchanged" });
    await expect(handlers.get("exports:confirm")!(event, { confirmationId: "confirmation-2", destinationPath: "/exports/other.xml" })).rejects.toThrow("Invalid IPC payload");
  });

  it("handles native save cancellation, overwrite state, core preview blocks, and transport uncertainty honestly", async () => {
    const handlers = new Map<string, (event: { senderFrame: { url: string } }, payload?: unknown) => Promise<unknown>>();
    let cancelled = true;
    let previewBlocked = false;
    let exportDisconnects = false;
    registerIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      dialog: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
        showSaveDialog: async () => ({ canceled: cancelled, filePath: "/exports/existing.xml" }),
      },
      getWindow: () => null,
      repositoryRoot: resolve(process.cwd(), "../.."),
      rendererUrl: "http://127.0.0.1:5173",
      status: () => ({ state: "ready", message: null }),
      createConfirmationId: () => "confirmation-3",
      realpath: async (path) => path,
      lstat: async () => ({ isSymbolicLink: () => false, isFile: () => true }),
      client: () => ({
        request: async (command) => {
          if (command === "preview_set_export") {
            if (previewBlocked) return { status: "blocked", reasons: [{ code: "source_alias", message: "Export would replace the imported source" }], destinationState: "unchanged" };
            return { status: "ready", draftId: "draft-1", revision: 3, playlistName: "Existing", trackCount: 1, knownDurationMs: 180_000, unknownDurationCount: 0, warnings: [], expectedDestinationState: "regular_file" };
          }
          if (exportDisconnects) throw new Error("Core connection closed");
          return { status: "exported", draftId: "draft-1", revision: 3, playlistName: "Existing", trackCount: 1, overwritten: true, format: "rekordbox_xml_1_0_0", destinationState: "replaced" };
        },
      }),
    });
    const event = { senderFrame: { url: "http://127.0.0.1:5173" } };

    await expect(handlers.get("exports:prepare")!(event, { draftId: "draft-1", expectedRevision: 3 })).resolves.toEqual({ status: "cancelled" });
    cancelled = false;
    await expect(handlers.get("exports:prepare")!(event, { draftId: "draft-1", expectedRevision: 3 })).resolves.toMatchObject({ status: "ready", willReplaceExisting: true });
    exportDisconnects = true;
    await expect(handlers.get("exports:confirm")!(event, { confirmationId: "confirmation-3" })).resolves.toMatchObject({ status: "blocked", destinationState: "unknown" });
    previewBlocked = true;
    await expect(handlers.get("exports:prepare")!(event, { draftId: "draft-1", expectedRevision: 3 })).resolves.toEqual({
      status: "blocked", reasons: [{ code: "source_alias", message: "Export would replace the imported source" }],
    });
  });
});
