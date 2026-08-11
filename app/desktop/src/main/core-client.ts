import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { coreRequestSchema, coreResponseSchema, type CoreRequest } from "../shared/contracts";

const MAX_LINE_BYTES = 1_048_576;
const IMPORT_REQUEST_TIMEOUT_MS = 120_000;

type SocketLike = Pick<Socket, "on" | "once" | "write" | "destroy">;

export interface CoreClientOptions {
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
  importRequestTimeoutMs?: number;
  createConnection?: (socketPath: string) => SocketLike;
}

export class CoreServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly preservedPreviousLibrary?: boolean,
  ) {
    super(message);
    this.name = "CoreServiceError";
  }
}

interface PendingRequest {
  socket: SocketLike;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class CoreClient {
  private readonly connectionTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly importRequestTimeoutMs: number;
  private readonly connect: (socketPath: string) => SocketLike;
  private closed = false;
  private readonly activeSockets = new Set<SocketLike>();
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly socketPath: string, options: CoreClientOptions = {}) {
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? 5_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
    this.importRequestTimeoutMs = options.importRequestTimeoutMs ?? IMPORT_REQUEST_TIMEOUT_MS;
    this.connect = options.createConnection ?? ((path) => createConnection(path));
  }

  async request(command: CoreRequest["command"], payload: unknown): Promise<unknown> {
    const request = { version: 1 as const, id: randomUUID(), command, payload };
    if (!coreRequestSchema.safeParse(request).success) throw new Error("Invalid core request");
    const socket = await this.openSocket();
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.rejectPending(request.id, new Error("Core request timed out"));
        socket.destroy();
      }, command === "import_library" ? this.importRequestTimeoutMs : this.requestTimeoutMs);
      this.pending.set(request.id, { socket, resolve, reject, timeout });
      try {
        socket.write(`${JSON.stringify(request)}\n`);
      } catch {
        this.rejectPending(request.id, new Error("Core connection closed"));
      }
    });
  }

  close(): void {
    this.closed = true;
    for (const socket of this.activeSockets) socket.destroy();
    this.activeSockets.clear();
    this.rejectAll(new Error("Core connection closed"));
  }

  private openSocket(): Promise<SocketLike> {
    if (this.closed) return Promise.reject(new Error("Core connection closed"));
    return new Promise<SocketLike>((resolve, reject) => {
      const socket = this.connect(this.socketPath);
      this.activeSockets.add(socket);
      let connected = false;
      let settled = false;
      let lineBuffer = "";
      const timer = setTimeout(() => finish(new Error("Core connection timed out")), this.connectionTimeoutMs);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          this.activeSockets.delete(socket);
          socket.destroy();
          reject(error);
        } else {
          connected = true;
          resolve(socket);
        }
      };
      socket.once("connect", () => finish());
      socket.on("data", (chunk: Buffer | string) => {
        lineBuffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (Buffer.byteLength(lineBuffer, "utf8") > MAX_LINE_BYTES) {
          this.rejectForSocket(socket, new Error("Core response exceeds 1 MiB"));
          socket.destroy();
          return;
        }
        let newline = lineBuffer.indexOf("\n");
        while (newline >= 0) {
          const line = lineBuffer.slice(0, newline);
          lineBuffer = lineBuffer.slice(newline + 1);
          this.handleLine(socket, line);
          newline = lineBuffer.indexOf("\n");
        }
      });
      socket.on("error", () => {
        if (!connected) finish(new Error("Core connection failed"));
        else this.rejectForSocket(socket, new Error("Core connection closed"));
      });
      socket.on("close", () => {
        this.activeSockets.delete(socket);
        if (!connected) finish(new Error("Core connection closed"));
        else this.rejectForSocket(socket, new Error("Core connection closed"));
      });
    });
  }

  private handleLine(socket: SocketLike, line: string): void {
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
      this.rejectForSocket(socket, new Error("Core response exceeds 1 MiB"));
      socket.destroy();
      return;
    }
    let unknown: unknown;
    try {
      unknown = JSON.parse(line);
    } catch {
      this.rejectForSocket(socket, new Error("Invalid core response"));
      return;
    }
    const parsed = coreResponseSchema.safeParse(unknown);
    if (!parsed.success) {
      this.rejectForSocket(socket, new Error("Invalid core response"));
      return;
    }
    const pending = this.pending.get(parsed.data.id);
    if (!pending || pending.socket !== socket) {
      this.rejectForSocket(socket, new Error("Invalid core response"));
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(parsed.data.id);
    if (parsed.data.ok) pending.resolve(parsed.data.result);
    else pending.reject(new CoreServiceError(parsed.data.error.code, parsed.data.error.message, parsed.data.error.preservedPreviousLibrary));
  }

  private rejectForSocket(socket: SocketLike, error: Error): void {
    for (const [id, pending] of this.pending) {
      if (pending.socket === socket) this.rejectPending(id, error);
    }
  }

  private rejectPending(id: string, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(id);
    pending.reject(error);
  }

  private rejectAll(error: Error): void {
    for (const id of this.pending.keys()) this.rejectPending(id, error);
  }
}
