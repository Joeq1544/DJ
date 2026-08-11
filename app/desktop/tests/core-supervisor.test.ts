import { EventEmitter } from "node:events";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CoreSupervisor } from "../src/main/core-supervisor";

class FakeChild extends EventEmitter {
  readonly stderr = new EventEmitter();
  killed = false;
  exitCode: number | null = null;

  kill(): boolean {
    this.killed = true;
    this.exitCode = 0;
    queueMicrotask(() => this.emit("exit", 0, null));
    return true;
  }
}

describe("CoreSupervisor", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("restarts one unexpected core exit and becomes ready again", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dj-supervisor-"));
    directories.push(directory);
    const children: FakeChild[] = [];
    const supervisor = new CoreSupervisor({
      userDataPath: directory,
      repositoryRoot: "/repo",
      spawn: () => {
        const child = new FakeChild();
        children.push(child);
        return child as never;
      },
      createClient: () => ({ request: async () => ({ status: "ok" }), close() {} }),
    });

    await supervisor.start();
    children[0]!.emit("exit", 1, null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(children).toHaveLength(2);
    expect(supervisor.status()).toEqual({ state: "ready", message: null });
    await supervisor.stop();
  });

  it("becomes degraded after the second unexpected exit within thirty seconds", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dj-supervisor-"));
    directories.push(directory);
    const children: FakeChild[] = [];
    const supervisor = new CoreSupervisor({
      userDataPath: directory,
      repositoryRoot: "/repo",
      spawn: () => {
        const child = new FakeChild();
        children.push(child);
        return child as never;
      },
      createClient: () => ({ request: async () => ({ status: "ok" }), close() {} }),
    });

    await supervisor.start();
    children[0]!.emit("exit", 1, null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    children[1]!.emit("exit", 1, null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(children).toHaveLength(2);
    expect(supervisor.status()).toEqual({
      state: "degraded",
      message: "Core service stopped unexpectedly",
    });
    await supervisor.stop();
  });

  it("allows a new bounded restart window after thirty seconds", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dj-supervisor-"));
    directories.push(directory);
    const children: FakeChild[] = [];
    let clock = 0;
    const supervisor = new CoreSupervisor({
      userDataPath: directory,
      repositoryRoot: "/repo",
      now: () => clock,
      spawn: () => {
        const child = new FakeChild();
        children.push(child);
        return child as never;
      },
      createClient: () => ({ request: async () => ({ status: "ok" }), close() {} }),
    });

    await supervisor.start();
    children[0]!.emit("exit", 1, null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    clock = 30_001;
    children[1]!.emit("exit", 1, null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(children).toHaveLength(3);
    expect(supervisor.status()).toEqual({ state: "ready", message: null });
    await supervisor.stop();
  });

  it("creates a private runtime directory and stops without restarting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dj-supervisor-"));
    directories.push(directory);
    const child = new FakeChild();
    const supervisor = new CoreSupervisor({
      userDataPath: directory,
      repositoryRoot: "/repo",
      spawn: () => child as never,
      createClient: () => ({ request: async () => ({ status: "ok" }), close() {} }),
    });

    await supervisor.start();
    const mode = (await stat(supervisor.runtimeDirectory())).mode & 0o777;
    await supervisor.stop();
    child.emit("exit", 0, null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mode).toBe(0o700);
    expect(child.killed).toBe(true);
    expect(supervisor.status().state).not.toBe("retrying");
  });
});
