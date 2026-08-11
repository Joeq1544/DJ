import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CoreClient } from "../src/main/core-client";

const response = (id: string, result: unknown) =>
  JSON.stringify({ version: 1, id, ok: true, result }) + "\n";

async function socketServer(
  handler: (socket: Socket, line: string) => void,
): Promise<{ socketPath: string; close(): Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "dj-client-"));
  const socketPath = join(directory, "core.sock");
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    let buffer = "";
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        handler(socket, line);
        newline = buffer.indexOf("\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return {
    socketPath,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe("CoreClient", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((close) => close()));
  });

  it("matches interleaved core responses to their requests", async () => {
    const received: Array<{ id: string; command: string }> = [];
    const server = await socketServer((socket, line) => {
      const request = JSON.parse(line) as { id: string; command: string };
      received.push(request);
      setTimeout(() => socket.write(response(request.id, { value: request.command })), request.command === "health" ? 20 : 0);
    });
    cleanup.push(() => server.close());
    const client = new CoreClient(server.socketPath, { requestTimeoutMs: 250 });

    await expect(
      Promise.all([
        client.request("health", {}),
        client.request("get_playlist_tree", {}),
      ]),
    ).resolves.toEqual([{ value: "health" }, { value: "get_playlist_tree" }]);
    client.close();
  });

  it("opens a fresh connection for the single-request core service protocol", async () => {
    const server = await socketServer((socket, line) => {
      const request = JSON.parse(line) as { id: string; command: string };
      socket.end(response(request.id, { command: request.command }));
    });
    cleanup.push(() => server.close());
    const client = new CoreClient(server.socketPath, { requestTimeoutMs: 250 });

    await expect(client.request("health", {})).resolves.toEqual({ command: "health" });
    await expect(client.request("get_playlist_tree", {})).resolves.toEqual({ command: "get_playlist_tree" });
    client.close();
  });

  it("rejects a command outside the versioned core schema", async () => {
    const client = new CoreClient("/unused/core.sock");

    await expect(client.request("shell" as never, {})).rejects.toThrow(
      "Invalid core request",
    );
  });

  it("rejects a line larger than one MiB before parsing it", async () => {
    const server = await socketServer((socket) => {
      socket.write("x".repeat(1_048_577) + "\n");
    });
    cleanup.push(() => server.close());
    const client = new CoreClient(server.socketPath, { requestTimeoutMs: 250 });

    await expect(client.request("health", {})).rejects.toThrow(
      "Core response exceeds 1 MiB",
    );
    client.close();
  });

  it("times out a connection which never becomes writable", async () => {
    class NeverConnectSocket extends EventEmitter {
      write() {
        return true;
      }
      destroy() {
        this.emit("close");
      }
    }
    const client = new CoreClient("/unused/core.sock", {
      connectionTimeoutMs: 20,
      createConnection: () => new NeverConnectSocket() as never,
    });

    await expect(client.request("health", {})).rejects.toThrow(
      "Core connection timed out",
    );
  });

  it("rejects every pending request when the core socket closes", async () => {
    const server = await socketServer((socket) => socket.end());
    cleanup.push(() => server.close());
    const client = new CoreClient(server.socketPath, { requestTimeoutMs: 250 });

    await expect(client.request("health", {})).rejects.toThrow(
      "Core connection closed",
    );
    client.close();
  });
});
