import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { registerIpcHandlers } from "../src/main/ipc";

const ready = {
  state: "ready" as const,
  auth: "chatgpt" as const,
  message: "Codex is ready.",
  sdkVersion: "0.147.0" as const,
};

function harness() {
  const handlers = new Map<string, (event: { senderFrame: { url: string } | null }, payload?: unknown) => Promise<unknown>>();
  const assistant = {
    getStatus: vi.fn(async () => ready),
    beginLogin: vi.fn(async () => ready),
    start: vi.fn(() => ({ requestId: "request-1" })),
    poll: vi.fn(() => ({
      events: [{ sequence: 1, type: "completed" as const, evidenceTrackIds: [] }],
      nextSequence: 1,
      terminal: true,
    })),
    cancel: vi.fn(() => ({ status: "cancelled" as const })),
    confirm: vi.fn(async () => ({
      status: "blocked" as const,
      code: "not_found" as const,
      message: "This proposal is unavailable.",
    })),
  };
  registerIpcHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    getWindow: () => null,
    repositoryRoot: resolve(process.cwd(), "../.."),
    rendererUrl: "http://127.0.0.1:5173",
    status: () => ({ state: "ready", message: null }),
    client: () => ({ request: async () => ({}) }),
    assistant,
  });
  const trusted = { senderFrame: { url: "http://127.0.0.1:5173" } };
  return { handlers, assistant, trusted };
}

describe("assistant IPC boundary", () => {
  it("registers only fixed assistant operations and strictly forwards validated values", async () => {
    const { handlers, assistant, trusted } = harness();

    await expect(handlers.get("assistant:getStatus")!(trusted)).resolves.toEqual(ready);
    await expect(handlers.get("assistant:beginLogin")!(trusted)).resolves.toEqual(ready);
    await expect(handlers.get("assistant:start")!(trusted, {
      kind: "search", prompt: "  Find warm house tracks  ",
    })).resolves.toEqual({ requestId: "request-1" });
    await expect(handlers.get("assistant:poll")!(trusted, {
      requestId: "request-1", afterSequence: 0,
    })).resolves.toMatchObject({ terminal: true });
    await expect(handlers.get("assistant:cancel")!(trusted, { requestId: "request-1" })).resolves.toEqual({ status: "cancelled" });
    await expect(handlers.get("assistant:confirm")!(trusted, {
      requestId: "request-1", proposalId: "proposal-1",
    })).resolves.toMatchObject({ status: "blocked", code: "not_found" });

    expect(assistant.start).toHaveBeenCalledWith({ kind: "search", prompt: "Find warm house tracks" });
    expect(assistant.poll).toHaveBeenCalledWith("request-1", 0);
    expect(assistant.cancel).toHaveBeenCalledWith("request-1");
    expect(assistant.confirm).toHaveBeenCalledWith("request-1", "proposal-1");
  });

  it("rejects untrusted senders and unknown or malformed fields before coordinator use", async () => {
    const { handlers, assistant, trusted } = harness();
    const attacker = { senderFrame: { url: "https://attacker.test" } };

    await expect(handlers.get("assistant:getStatus")!(attacker)).rejects.toThrow("Untrusted IPC sender");
    await expect(handlers.get("assistant:getStatus")!(trusted, {})).rejects.toThrow("Invalid IPC payload");
    await expect(handlers.get("assistant:start")!(trusted, {
      kind: "search", prompt: "Find tracks", sourcePath: "/private/music.wav",
    })).rejects.toThrow("Invalid IPC payload");
    await expect(handlers.get("assistant:poll")!(trusted, {
      requestId: "request-1", afterSequence: -1,
    })).rejects.toThrow("Invalid IPC payload");
    await expect(handlers.get("assistant:cancel")!(trusted, {
      requestId: "request-1", extra: true,
    })).rejects.toThrow("Invalid IPC payload");
    await expect(handlers.get("assistant:confirm")!(trusted, {
      requestId: "request-1", proposalId: "proposal-1", mutation: { type: "optimize" },
    })).rejects.toThrow("Invalid IPC payload");
    expect(assistant.start).not.toHaveBeenCalled();
    expect(assistant.poll).not.toHaveBeenCalled();
    expect(assistant.cancel).not.toHaveBeenCalled();
    expect(assistant.confirm).not.toHaveBeenCalled();
  });
});
