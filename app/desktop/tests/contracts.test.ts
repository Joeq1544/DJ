import { describe, expect, it } from "vitest";
import {
  appStatusSchema,
  coreRequestSchema,
  importResultSchema,
  playlistTreeSchema,
  trackPageQuerySchema,
  trackPageSchema,
} from "../src/shared/contracts";

describe("desktop boundary contracts", () => {
  it("rejects a track page larger than the renderer limit", () => {
    expect(trackPageQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
  });

  it("defaults a collection page to one hundred tracks", () => {
    expect(trackPageQuerySchema.parse({})).toEqual({ limit: 100 });
  });

  it("rejects commands outside the M1 core surface", () => {
    expect(
      coreRequestSchema.safeParse({
        version: 1,
        id: "r1",
        command: "shell",
        payload: {},
      }).success,
    ).toBe(false);
  });

  it("preserves the previous library in every import failure", () => {
    const result = importResultSchema.parse({
      success: false,
      error: { code: "unsafe_xml", message: "DTD is not allowed" },
      preservedPreviousLibrary: true,
    });
    if (result.success) {
      throw new Error("Expected the failure branch");
    }
    expect(result.preservedPreviousLibrary).toBe(true);
  });

  it("rejects private paths and unknown fields in display DTOs", () => {
    const page = {
      items: [
        {
          id: "app-track-1",
          title: "Opening Track",
          artist: "Fixture Artist",
          album: null,
          genre: null,
          bpmMilli: 120_000,
          musicalKey: "8A",
          durationMs: 180_000,
          availability: "missing",
          normalizedPath: "/private/music/opening.wav",
        },
      ],
      nextCursor: null,
    };
    expect(trackPageSchema.safeParse(page).success).toBe(false);
  });

  it("accepts the complete ready and playlist tree DTOs", () => {
    expect(appStatusSchema.parse({ state: "ready", message: null })).toEqual({
      state: "ready",
      message: null,
    });
    expect(
      playlistTreeSchema.parse([
        {
          id: "playlist-1",
          parentId: null,
          name: "Warmup",
          kind: "folder",
          order: 0,
          trackCount: 0,
        },
      ]),
    ).toHaveLength(1);
  });
});
