import { describe, expect, it } from "vitest";
import {
  buildDiscoveryContext,
  buildDraftContext,
  collectContextTrackIds,
  serializeAssistantContext,
} from "../src/main/assistant/context";
import type { RecommendationResponse, SetDraftSnapshot } from "../src/shared/contracts";

const track = (id: string) => ({
  id,
  title: `Track ${id}`,
  artist: "Fixture Artist",
  album: null,
  genre: "House",
  bpmMilli: 124_000,
  musicalKey: "8A",
  durationMs: 180_000,
  availability: "available" as const,
});

describe("assistant context", () => {
  it("keeps recommendation evidence path-free, immutable, and capped at twenty tracks", () => {
    const response = {
      seed: { ...track("seed"), sourcePath: "/private/source.wav" },
      intent: "build",
      algorithmVersion: "transition-v1",
      scannedCount: 30,
      truncated: false,
      items: Array.from({ length: 25 }, (_, index) => ({
        track: { ...track(`track-${index}`), sourcePath: `/private/${index}.wav` },
        scorePpm: 900_000 - index,
        confidencePpm: 800_000,
        reasons: ["Exact local evidence"],
        components: [{
          name: "tempo" as const,
          scorePpm: 900_000,
          weightPpm: 300_000,
          contributionSignedPpm: 270_000,
          effect: "bonus" as const,
          reason: "Tempo is compatible",
        }],
      })),
    } as unknown as RecommendationResponse;

    const context = buildDiscoveryContext(response);
    const serialized = serializeAssistantContext(context);

    expect(context.candidates).toHaveLength(19);
    expect(collectContextTrackIds(context)).toHaveLength(20);
    expect(serialized).not.toContain("sourcePath");
    expect(serialized).not.toContain("/private/");
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.candidates[0])).toBe(true);
  });

  it("caps draft context at one hundred entries and omits notes, paths, and unbounded messages", () => {
    const snapshot = {
      draftId: "draft-1",
      currentRevision: 3,
      contentRevision: 3,
      title: "Fixture draft",
      plan: {
        intent: "smooth",
        targetDurationMs: null,
        maxArtistRepeats: null,
        candidateFilters: {},
      },
      entries: Array.from({ length: 105 }, (_, index) => ({
        id: `entry-${index}`,
        trackId: `track-${index}`,
        track: {
          ...track(`track-${index}`),
          title: "T".repeat(1_000),
          artist: "A".repeat(1_000),
          album: "B".repeat(1_000),
          genre: "G".repeat(1_000),
          sourcePath: `/private/${index}.wav`,
          userMetadata: { rating: 5, tags: [], note: "private note" },
        },
        resolution: "resolved" as const,
        bpmMilli: 124_000,
        musicalKey: "8A",
        energyPpm: 700_000,
        trackPinned: false,
        positionPinned: false,
        role: null,
        targetEnergyPpm: null,
      })),
      bans: [],
      knownDurationMs: 18_000_000,
      unknownDurationCount: 0,
      unmetConstraints: [{ code: "fixture", message: "/private/log private note" }],
      canUndo: true,
      canRedo: false,
      versions: [],
      viewingVersion: null,
    } as unknown as SetDraftSnapshot;

    const context = buildDraftContext(snapshot);
    const serialized = serializeAssistantContext(context);

    expect(context.entries).toHaveLength(100);
    expect(context.entriesTruncated).toBe(true);
    expect(collectContextTrackIds(context)).toHaveLength(100);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(131_072);
    expect(serialized).not.toContain("sourcePath");
    expect(serialized).not.toContain("userMetadata");
    expect(serialized).not.toContain("private note");
    expect(serialized).not.toContain("/private/");
  });
});
