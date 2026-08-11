import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { access, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
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

async function expectSupervisorState(
  children: FakeChild[],
  supervisor: CoreSupervisor,
  count: number,
  state: "ready" | "degraded",
): Promise<void> {
  await expect.poll(
    () => ({ childCount: children.length, state: supervisor.status().state }),
    { timeout: 1_000, interval: 5 },
  ).toEqual({ childCount: count, state });
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

    await expectSupervisorState(children, supervisor, 2, "ready");
    expect(supervisor.status()).toEqual({ state: "ready", message: null });
    await supervisor.stop();
  });

  it("removes the stale private socket before restarting a killed core", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dj-supervisor-"));
    directories.push(directory);
    const children: FakeChild[] = [];
    const staleSocketStates: boolean[] = [];
    const supervisor = new CoreSupervisor({
      userDataPath: directory,
      repositoryRoot: "/repo",
      spawn: () => {
        staleSocketStates.push(existsSync(join(supervisor.runtimeDirectory(), "core.sock")));
        const child = new FakeChild();
        children.push(child);
        return child as never;
      },
      createClient: () => ({ request: async () => ({ status: "ok" }), close() {} }),
    });

    await supervisor.start();
    await writeFile(join(supervisor.runtimeDirectory(), "core.sock"), "stale socket");
    children[0]!.emit("exit", 1, null);

    await expectSupervisorState(children, supervisor, 2, "ready");
    expect(staleSocketStates).toEqual([false, false]);
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
    await expectSupervisorState(children, supervisor, 2, "ready");
    children[1]!.emit("exit", 1, null);

    await expectSupervisorState(children, supervisor, 2, "degraded");
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
    await expectSupervisorState(children, supervisor, 2, "ready");
    clock = 30_001;
    children[1]!.emit("exit", 1, null);

    await expectSupervisorState(children, supervisor, 3, "ready");
    expect(supervisor.status()).toEqual({ state: "ready", message: null });
    await supervisor.stop();
  });

  it("creates a private runtime directory and stops without restarting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dj-supervisor-"));
    directories.push(directory);
    const unrelatedDirectory = await mkdtemp(join(tmpdir(), "dj-unrelated-"));
    directories.push(unrelatedDirectory);
    const child = new FakeChild();
    const supervisor = new CoreSupervisor({
      userDataPath: directory,
      repositoryRoot: "/repo",
      spawn: () => child as never,
      createClient: () => ({ request: async () => ({ status: "ok" }), close() {} }),
    });

    await supervisor.start();
    const runtimeDirectory = supervisor.runtimeDirectory();
    const mode = (await stat(runtimeDirectory)).mode & 0o777;
    await supervisor.stop();
    child.emit("exit", 0, null);

    await expect.poll(() => supervisor.status().state, { timeout: 1_000, interval: 5 }).not.toBe("retrying");
    expect(mode).toBe(0o700);
    expect(child.killed).toBe(true);
    expect(supervisor.status().state).not.toBe("retrying");
    await expect(access(runtimeDirectory)).rejects.toThrow();
    await expect(access(unrelatedDirectory)).resolves.toBeUndefined();
  });

  it("cleans its runtime after an already-exited worker and a second no-child stop", async () => {
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
    const runtimeDirectory = supervisor.runtimeDirectory();
    child.exitCode = 0;
    await supervisor.stop();

    await expect(access(runtimeDirectory)).rejects.toThrow();
    await expect(supervisor.stop()).resolves.toBeUndefined();
  });
});
