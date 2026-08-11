import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { registerIpcHandlers } from "../src/main/ipc";
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
});

describe("guarded IPC", () => {
  const fixture = resolve(process.cwd(), "../../fixtures/rekordbox/phase0-library.xml");

  function harness(overrides: Partial<{ senderUrl: string; testXml: string }> = {}) {
    const handlers = new Map<string, (event: { senderFrame: { url: string } }, payload?: unknown) => Promise<unknown>>();
    registerIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [fixture] }) },
      getWindow: () => null,
      repositoryRoot: resolve(process.cwd(), "../.."),
      rendererUrl: "http://127.0.0.1:5173",
      environment: { DJ_COPILOT_TEST_MODE: "1", ...(overrides.testXml ? { DJ_COPILOT_TEST_XML: overrides.testXml } : {}) },
      status: () => ({ state: "ready", message: null }),
      client: () => ({
        request: async (command, payload) => {
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
    return { handlers, event };
  }

  it("owns the import path and validates core results before returning them", async () => {
    const { handlers, event } = harness({ testXml: fixture });

    await expect(handlers.get("library:importXml")!(event)).resolves.toEqual({
      success: true,
      summary: { revision: 1, sourceSha256: "a".repeat(64), importedTracks: 4, importedPlaylists: 2, unavailableTracks: 1 },
    });
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
