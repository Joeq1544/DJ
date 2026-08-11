import { describe, expect, it, vi } from "vitest";
import { createDesktopApi } from "../src/preload/index";

describe("preload API", () => {
  it("exposes only the four named renderer operations", async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === "system:getStatus") return { state: "ready", message: null };
      if (channel === "library:importXml") return { success: false, error: { code: "cancelled", message: "No XML selected" }, preservedPreviousLibrary: true };
      if (channel === "library:getPlaylistTree") return [];
      return { items: [], nextCursor: null };
    });
    const api = createDesktopApi({ invoke });

    expect(Object.keys(api)).toEqual(["system", "library"]);
    expect(Object.keys(api.system)).toEqual(["getStatus"]);
    expect(Object.keys(api.library)).toEqual(["importXml", "getPlaylistTree", "listTracks"]);
    expect(Object.isFrozen(api)).toBe(true);
    await expect(api.system.getStatus()).resolves.toEqual({ state: "ready", message: null });
    await expect(api.library.listTracks({ limit: 1 })).resolves.toEqual({ items: [], nextCursor: null });
  });
});
