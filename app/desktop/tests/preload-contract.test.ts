import { describe, expect, it, vi } from "vitest";
import { createDesktopApi } from "../src/preload/index";

describe("preload API", () => {
  it("exposes only the eighteen named renderer operations through exact fixed channels", async () => {
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

    expect(Object.keys(api)).toEqual(["system", "library", "analysis", "discovery", "sets", "exports"]);
    expect(Object.keys(api.system)).toEqual(["getStatus"]);
    expect(Object.keys(api.library)).toEqual(["importXml", "getPlaylistTree", "listTracks"]);
    expect(Object.keys(api.analysis)).toEqual(["queue", "getStatus", "pause", "resume"]);
    expect(Object.keys(api.discovery)).toEqual(["findSimilar", "recommendNext"]);
    expect(Object.keys(api.sets)).toEqual(["list", "create", "get", "mutate", "findReplacements", "inspect"]);
    expect(Object.keys(api.exports)).toEqual(["prepare", "confirm"]);
    expect("invoke" in api).toBe(false);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(api.system)).toBe(true);
    expect(Object.isFrozen(api.library)).toBe(true);
    expect(Object.isFrozen(api.analysis)).toBe(true);
    expect(Object.isFrozen(api.discovery)).toBe(true);
    expect(Object.isFrozen(api.sets)).toBe(true);
    expect(Object.isFrozen(api.exports)).toBe(true);
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
    await api.sets.list();
    await api.sets.create({ title: "Friday set", plan: { intent: "smooth", targetDurationMs: null, maxArtistRepeats: null, candidateFilters: {} }, source: { kind: "empty" } });
    await api.sets.get({ draftId: "draft-1" });
    await api.sets.mutate({ draftId: "draft-1", expectedRevision: 1, mutation: { type: "undo" } });
    await api.sets.findReplacements({ draftId: "draft-1", entryId: "entry-1" });
    await api.sets.inspect({ kind: "draft", draftId: "draft-1" });
    await api.exports.prepare({ draftId: "draft-1", expectedRevision: 1 });
    await api.exports.confirm({ confirmationId: "confirmation-1" });
    expect(invoke.mock.calls.slice(-14)).toEqual([
      ["analysis:queue", { trackIds: ["track-1"] }],
      ["analysis:getStatus", { trackIds: ["track-1"] }],
      ["analysis:pause"],
      ["analysis:resume"],
      ["discovery:findSimilar", { seedTrackId: "track-1", filters: { genre: "House" } }],
      ["discovery:recommendNext", { seedTrackId: "track-1", intent: "build", limit: 5 }],
      ["sets:list"],
      ["sets:create", { title: "Friday set", plan: { intent: "smooth", targetDurationMs: null, maxArtistRepeats: null, candidateFilters: {} }, source: { kind: "empty" } }],
      ["sets:get", { draftId: "draft-1" }],
      ["sets:mutate", { draftId: "draft-1", expectedRevision: 1, mutation: { type: "undo" } }],
      ["sets:findReplacements", { draftId: "draft-1", entryId: "entry-1" }],
      ["sets:inspect", { kind: "draft", draftId: "draft-1" }],
      ["exports:prepare", { draftId: "draft-1", expectedRevision: 1 }],
      ["exports:confirm", { confirmationId: "confirmation-1" }],
    ]);
  });
});
