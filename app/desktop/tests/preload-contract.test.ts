import { describe, expect, it, vi } from "vitest";
import { createDesktopApi } from "../src/preload/index";

describe("preload API", () => {
  it("exposes only the ten named renderer operations through exact fixed channels", async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === "system:getStatus") return { state: "ready", message: null };
      if (channel === "library:importXml") return { success: false, error: { code: "cancelled", message: "No XML selected" }, preservedPreviousLibrary: true };
      if (channel === "library:getPlaylistTree") return [];
      if (channel === "library:listTracks") return { items: [], nextCursor: null, truncated: false };
      if (channel === "discovery:findSimilar") return { algorithmVersion: "feature-similarity-v1", items: [] };
      if (channel === "discovery:recommendNext") return { algorithmVersion: "transition-v1", items: [] };
      return { state: "idle", queued: 0, running: 0, paused: 0, succeeded: 0, failed: 0, progressPpm: 0, capabilities: { available: false }, items: [] };
    });
    const api = createDesktopApi({ invoke });

    expect(Object.keys(api)).toEqual(["system", "library", "analysis", "discovery"]);
    expect(Object.keys(api.system)).toEqual(["getStatus"]);
    expect(Object.keys(api.library)).toEqual(["importXml", "getPlaylistTree", "listTracks"]);
    expect(Object.keys(api.analysis)).toEqual(["queue", "getStatus", "pause", "resume"]);
    expect(Object.keys(api.discovery)).toEqual(["findSimilar", "recommendNext"]);
    expect("invoke" in api).toBe(false);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(api.system)).toBe(true);
    expect(Object.isFrozen(api.library)).toBe(true);
    expect(Object.isFrozen(api.analysis)).toBe(true);
    expect(Object.isFrozen(api.discovery)).toBe(true);
    await expect(api.system.getStatus()).resolves.toEqual({ state: "ready", message: null });
    await expect(api.library.listTracks({ limit: 1 })).resolves.toEqual({ items: [], nextCursor: null, truncated: false });
    await expect(api.analysis.queue(["track-1"])).resolves.toMatchObject({ state: "idle" });
    await expect(api.analysis.getStatus(["track-1"])).resolves.toMatchObject({ state: "idle" });
    await expect(api.analysis.pause()).resolves.toMatchObject({ state: "idle" });
    await expect(api.analysis.resume()).resolves.toMatchObject({ state: "idle" });
    await expect(
      api.discovery.findSimilar({ seedTrackId: "track-1", filters: { genre: "House" } }),
    ).resolves.toMatchObject({ algorithmVersion: "feature-similarity-v1" });
    await expect(
      api.discovery.recommendNext({ seedTrackId: "track-1", intent: "build", limit: 5 }),
    ).resolves.toMatchObject({ algorithmVersion: "transition-v1" });
    expect(invoke.mock.calls.slice(-6)).toEqual([
      ["analysis:queue", { trackIds: ["track-1"] }],
      ["analysis:getStatus", { trackIds: ["track-1"] }],
      ["analysis:pause"],
      ["analysis:resume"],
      ["discovery:findSimilar", { seedTrackId: "track-1", filters: { genre: "House" } }],
      ["discovery:recommendNext", { seedTrackId: "track-1", intent: "build", limit: 5 }],
    ]);
  });
});
