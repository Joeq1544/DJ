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

  function harness(overrides: Partial<{ senderUrl: string; testXml: string; cancelled: boolean }> = {}) {
    const handlers = new Map<string, (event: { senderFrame: { url: string } }, payload?: unknown) => Promise<unknown>>();
    const requests: string[] = [];
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
          if (command === "import_library") {
            expect(payload).toEqual({ sourcePath: fixture });
            return {
              success: true,
              summary: { revision: 1, sourceSha256: "a".repeat(64), importedTracks: 4, importedPlaylists: 2, unavailableTracks: 1 },
            };
          }
          if (command === "get_playlist_tree") return [];
          if (command === "list_tracks") return { items: [], nextCursor: null };
          return { status: "ok" };
        },
      }),
    });
    const event = { senderFrame: { url: overrides.senderUrl ?? "http://127.0.0.1:5173" } };
    return { handlers, event, requests };
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

  it("looks up the current core client after the supervisor replaces it", async () => {
    const handlers = new Map<string, (event: { senderFrame: { url: string } }, payload?: unknown) => Promise<unknown>>();
    type TestClient = { request(command: string, payload: unknown): Promise<unknown> };
    const firstClient: TestClient = { request: async () => [] };
    const restartedClient: TestClient = {
      request: async () => [{ id: "playlist-1", parentId: null, name: "Recovered", kind: "playlist", order: 0, trackCount: 0 }],
    };
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

    await expect(handlers.get("library:getPlaylistTree")!(event)).resolves.toEqual([]);
    activeClient = restartedClient;
    await expect(handlers.get("library:getPlaylistTree")!(event)).resolves.toEqual([
      { id: "playlist-1", parentId: null, name: "Recovered", kind: "playlist", order: 0, trackCount: 0 },
    ]);
  });
});
