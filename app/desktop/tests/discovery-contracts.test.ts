import { describe, expect, it } from "vitest";
import {
  coreRequestSchema,
  discoveryCandidateSchema,
  discoveryIntentSchema,
  discoveryTrackSchema,
  findSimilarRequestSchema,
  recommendationResponseSchema,
  recommendNextRequestSchema,
  scoreComponentSchema,
  similarityResponseSchema,
  trackFiltersSchema,
  trackPageQuerySchema,
  trackPageSchema,
} from "../src/shared/contracts";

const discoveryTrack = {
  id: "track-seed",
  title: "Generated Seed",
  artist: "Fixture Artist",
  album: "Fixture Album",
  genre: "House",
  bpmMilli: 120_000,
  musicalKey: "8A",
  durationMs: 180_000,
  availability: "available",
} as const;

const availableComponent = {
  name: "tempo",
  scorePpm: 900_000,
  weightPpm: 250_000,
  contributionSignedPpm: 200_000,
  effect: "bonus",
  reason: "Tempo is closely matched.",
} as const;

const pythonWireSimilarityResponse = {
  seed: {
    id: "track-seed",
    title: "Generated Seed",
    artist: "Fixture Artist",
    album: "Fixture Album",
    genre: "House",
    bpmMilli: 120000,
    musicalKey: "8A",
    durationMs: 180000,
    availability: "available",
  },
  algorithmVersion: "feature-similarity-v1",
  scannedCount: 8,
  truncated: false,
  items: [
    {
      track: {
        id: "track-candidate",
        title: "Generated Candidate",
        artist: "Fixture Artist",
        album: null,
        genre: "House",
        bpmMilli: 121000,
        musicalKey: "9A",
        durationMs: 175000,
        availability: "available",
      },
      scorePpm: 842500,
      confidencePpm: 655000,
      reasons: ["Tempo is closely matched.", "Keys are compatible.", "Timbre evidence is unavailable."],
      components: [
        {
          name: "tempo",
          scorePpm: 930000,
          weightPpm: 250000,
          contributionSignedPpm: 215000,
          effect: "bonus",
          reason: "Tempo is closely matched.",
        },
        {
          name: "key",
          scorePpm: 900000,
          weightPpm: 250000,
          contributionSignedPpm: 200000,
          effect: "bonus",
          reason: "Keys are compatible.",
        },
        {
          name: "energy",
          scorePpm: 500000,
          weightPpm: 200000,
          contributionSignedPpm: 0,
          effect: "neutral",
          reason: "Energy is moderately close.",
        },
        {
          name: "style",
          scorePpm: 1000000,
          weightPpm: 150000,
          contributionSignedPpm: 150000,
          effect: "bonus",
          reason: "Genre is continuous.",
        },
        {
          name: "timbre",
          scorePpm: null,
          weightPpm: 150000,
          contributionSignedPpm: 0,
          effect: "missing",
          reason: "Timbre evidence is unavailable.",
        },
      ],
    },
  ],
} as const;

describe("M3 track filters", () => {
  it("accepts every inclusive string and scaled-number endpoint", () => {
    expect(
      trackFiltersSchema.parse({
        playlistId: "p",
        text: "x".repeat(200),
        bpmMinMilli: 30_000,
        bpmMaxMilli: 400_000,
        musicalKey: "K".repeat(64),
        keyRelation: "compatible",
        genre: "g".repeat(200),
        energyMinPpm: 0,
        energyMaxPpm: 1_000_000,
        analysisState: "not_analyzed",
        availability: "unreadable",
      }),
    ).toEqual({
      playlistId: "p",
      text: "x".repeat(200),
      bpmMinMilli: 30_000,
      bpmMaxMilli: 400_000,
      musicalKey: "K".repeat(64),
      keyRelation: "compatible",
      genre: "g".repeat(200),
      energyMinPpm: 0,
      energyMaxPpm: 1_000_000,
      analysisState: "not_analyzed",
      availability: "unreadable",
    });
  });

  it.each([
    ["empty text", { text: "" }],
    ["long text", { text: "x".repeat(201) }],
    ["low BPM", { bpmMinMilli: 29_999 }],
    ["high BPM", { bpmMaxMilli: 400_001 }],
    ["empty key", { musicalKey: "" }],
    ["long key", { musicalKey: "K".repeat(65) }],
    ["empty genre", { genre: "" }],
    ["long genre", { genre: "g".repeat(201) }],
    ["low energy", { energyMinPpm: -1 }],
    ["high energy", { energyMaxPpm: 1_000_001 }],
    ["fractional energy", { energyMinPpm: 0.5 }],
    ["unknown analysis state", { analysisState: "pending" }],
    ["unknown availability", { availability: "offline" }],
    ["unknown key relation", { musicalKey: "8A", keyRelation: "adjacent" }],
    ["unknown property", { rating: 5 }],
  ])("rejects %s", (_label, filters) => {
    expect(trackFiltersSchema.safeParse(filters).success).toBe(false);
  });

  it("rejects contradictory ranges and a key relation without a musical key", () => {
    expect(trackFiltersSchema.safeParse({ bpmMinMilli: 121_000, bpmMaxMilli: 120_000 }).success).toBe(false);
    expect(trackFiltersSchema.safeParse({ energyMinPpm: 800_000, energyMaxPpm: 700_000 }).success).toBe(false);
    expect(trackFiltersSchema.safeParse({ keyRelation: "exact" }).success).toBe(false);
    expect(trackFiltersSchema.safeParse({ musicalKey: "8A", keyRelation: "exact" }).success).toBe(true);
  });

  it("keeps filter fields flat in track paging and rejects filter nesting", () => {
    expect(trackPageQuerySchema.parse({ text: "fixture", limit: 1 })).toEqual({ text: "fixture", limit: 1 });
    expect(trackPageQuerySchema.safeParse({ filters: { text: "fixture" } }).success).toBe(false);
  });
});

describe("M3 discovery requests", () => {
  it("accepts all eight exact intents", () => {
    const intents = [
      "smooth",
      "build",
      "peak",
      "reset",
      "genre_shift",
      "adventurous",
      "singalong_continuation",
      "closer",
    ];
    expect(intents.map((intent) => discoveryIntentSchema.parse(intent))).toEqual(intents);
    expect(discoveryIntentSchema.safeParse("warmup").success).toBe(false);
  });

  it("defaults discovery limits to ten and accepts only one through twenty", () => {
    expect(findSimilarRequestSchema.parse({ seedTrackId: "s" })).toEqual({ seedTrackId: "s", limit: 10 });
    expect(recommendNextRequestSchema.parse({ seedTrackId: "s", intent: "closer", limit: 1 })).toEqual({
      seedTrackId: "s",
      intent: "closer",
      limit: 1,
    });
    expect(findSimilarRequestSchema.safeParse({ seedTrackId: "s", limit: 20 }).success).toBe(true);
    expect(findSimilarRequestSchema.safeParse({ seedTrackId: "s", limit: 0 }).success).toBe(false);
    expect(findSimilarRequestSchema.safeParse({ seedTrackId: "s", limit: 21 }).success).toBe(false);
  });

  it("bounds stable seed IDs and nests only the strict filter shape", () => {
    expect(findSimilarRequestSchema.safeParse({ seedTrackId: "s".repeat(128), filters: {} }).success).toBe(true);
    expect(findSimilarRequestSchema.safeParse({ seedTrackId: "" }).success).toBe(false);
    expect(findSimilarRequestSchema.safeParse({ seedTrackId: "s".repeat(129) }).success).toBe(false);
    expect(findSimilarRequestSchema.safeParse({ seedTrackId: "s", filters: { cursor: "opaque" } }).success).toBe(false);
    expect(findSimilarRequestSchema.safeParse({ seedTrackId: "s", filters: { limit: 5 } }).success).toBe(false);
    expect(findSimilarRequestSchema.safeParse({ seedTrackId: "s", sourcePath: "/music/s.wav" }).success).toBe(false);
  });

  it("adds only the two fixed discovery core commands", () => {
    expect(
      coreRequestSchema.parse({
        version: 1,
        id: "r1",
        command: "find_similar_tracks",
        payload: { seedTrackId: "s", filters: { genre: "House" } },
      }),
    ).toEqual({
      version: 1,
      id: "r1",
      command: "find_similar_tracks",
      payload: { seedTrackId: "s", filters: { genre: "House" }, limit: 10 },
    });
    expect(
      coreRequestSchema.safeParse({
        version: 1,
        id: "r2",
        command: "recommend_next_tracks",
        payload: { seedTrackId: "s", intent: "smooth", extra: true },
      }).success,
    ).toBe(false);
  });
});

describe("M3 discovery responses", () => {
  it("accepts one literal Python-wire similarity response unchanged", () => {
    expect(similarityResponseSchema.parse(pythonWireSimilarityResponse)).toEqual(pythonWireSimilarityResponse);
  });

  it("accepts nullable missing scores and signed contribution endpoints", () => {
    expect(
      scoreComponentSchema.parse({
        name: "structure",
        scorePpm: null,
        weightPpm: 1_000_000,
        contributionSignedPpm: 0,
        effect: "missing",
        reason: "Structure evidence is unavailable.",
      }),
    ).toMatchObject({ scorePpm: null, effect: "missing" });
    expect(scoreComponentSchema.safeParse({ ...availableComponent, contributionSignedPpm: -1_000_000 }).success).toBe(true);
    expect(scoreComponentSchema.safeParse({ ...availableComponent, contributionSignedPpm: 1_000_000 }).success).toBe(true);
    expect(scoreComponentSchema.safeParse({ ...availableComponent, contributionSignedPpm: -1_000_001 }).success).toBe(false);
    expect(scoreComponentSchema.safeParse({ ...availableComponent, contributionSignedPpm: 1_000_001 }).success).toBe(false);
  });

  it("enforces the missing-score/effect relation and score effect bands", () => {
    expect(scoreComponentSchema.safeParse({ ...availableComponent, scorePpm: null, effect: "bonus" }).success).toBe(false);
    expect(scoreComponentSchema.safeParse({ ...availableComponent, scorePpm: null, effect: "missing", contributionSignedPpm: 1 }).success).toBe(false);
    expect(scoreComponentSchema.safeParse({ ...availableComponent, scorePpm: 399_999, effect: "penalty" }).success).toBe(true);
    expect(scoreComponentSchema.safeParse({ ...availableComponent, scorePpm: 400_000, effect: "neutral" }).success).toBe(true);
    expect(scoreComponentSchema.safeParse({ ...availableComponent, scorePpm: 599_999, effect: "neutral" }).success).toBe(true);
    expect(scoreComponentSchema.safeParse({ ...availableComponent, scorePpm: 600_000, effect: "bonus" }).success).toBe(true);
    expect(scoreComponentSchema.safeParse({ ...availableComponent, scorePpm: 600_000, effect: "neutral" }).success).toBe(false);
  });

  it("bounds discovery track fields without permitting private paths", () => {
    expect(
      discoveryTrackSchema.safeParse({
        ...discoveryTrack,
        id: "i".repeat(128),
        title: "t".repeat(1_000),
        artist: "a".repeat(1_000),
        album: "b".repeat(1_000),
        genre: "g".repeat(1_000),
        musicalKey: "k".repeat(64),
        bpmMilli: 1,
        durationMs: 0,
      }).success,
    ).toBe(true);
    expect(discoveryTrackSchema.safeParse({ ...discoveryTrack, id: "i".repeat(129) }).success).toBe(false);
    expect(discoveryTrackSchema.safeParse({ ...discoveryTrack, title: "t".repeat(1_001) }).success).toBe(false);
    expect(discoveryTrackSchema.safeParse({ ...discoveryTrack, musicalKey: "k".repeat(65) }).success).toBe(false);
    expect(discoveryTrackSchema.safeParse({ ...discoveryTrack, bpmMilli: 0 }).success).toBe(false);
    expect(discoveryTrackSchema.safeParse({ ...discoveryTrack, durationMs: -1 }).success).toBe(false);
    expect(discoveryTrackSchema.safeParse({ ...discoveryTrack, sourcePath: "/private/music/seed.wav" }).success).toBe(false);
  });

  it("bounds candidate scores, confidence, reasons, and component arrays", () => {
    const candidate = {
      track: discoveryTrack,
      scorePpm: 0,
      confidencePpm: 1_000_000,
      reasons: ["r".repeat(200)],
      components: [availableComponent],
    };
    expect(discoveryCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(discoveryCandidateSchema.safeParse({ ...candidate, scorePpm: -1 }).success).toBe(false);
    expect(discoveryCandidateSchema.safeParse({ ...candidate, confidencePpm: 1_000_001 }).success).toBe(false);
    expect(discoveryCandidateSchema.safeParse({ ...candidate, reasons: [] }).success).toBe(false);
    expect(discoveryCandidateSchema.safeParse({ ...candidate, reasons: ["r", "r", "r", "r"] }).success).toBe(false);
    expect(discoveryCandidateSchema.safeParse({ ...candidate, reasons: ["r".repeat(201)] }).success).toBe(false);
    expect(discoveryCandidateSchema.safeParse({ ...candidate, components: [] }).success).toBe(false);
    expect(discoveryCandidateSchema.safeParse({ ...candidate, components: Array(8).fill(availableComponent) }).success).toBe(true);
    expect(discoveryCandidateSchema.safeParse({ ...candidate, components: Array(9).fill(availableComponent) }).success).toBe(false);
  });

  it("caps responses at twenty items and twenty-five thousand scanned tracks", () => {
    const candidate = pythonWireSimilarityResponse.items[0];
    expect(
      similarityResponseSchema.safeParse({
        ...pythonWireSimilarityResponse,
        scannedCount: 25_000,
        items: Array(20).fill(candidate),
      }).success,
    ).toBe(true);
    expect(similarityResponseSchema.safeParse({ ...pythonWireSimilarityResponse, scannedCount: 25_001 }).success).toBe(false);
    expect(similarityResponseSchema.safeParse({ ...pythonWireSimilarityResponse, items: Array(21).fill(candidate) }).success).toBe(false);
  });

  it("accepts only the exact recommendation shape and algorithm version", () => {
    const response = {
      ...pythonWireSimilarityResponse,
      intent: "genre_shift",
      algorithmVersion: "transition-v1",
    };
    expect(recommendationResponseSchema.parse(response)).toEqual(response);
    expect(recommendationResponseSchema.safeParse({ ...response, intent: "unknown" }).success).toBe(false);
    expect(recommendationResponseSchema.safeParse({ ...response, algorithmVersion: "transition-v2" }).success).toBe(false);
    expect(recommendationResponseSchema.safeParse({ ...response, debug: true }).success).toBe(false);
  });

  it("requires TrackPage truncation and rejects every extra TrackPage property", () => {
    expect(trackPageSchema.safeParse({ items: [], nextCursor: null }).success).toBe(false);
    expect(trackPageSchema.safeParse({ items: [], nextCursor: null, truncated: false }).success).toBe(true);
    expect(trackPageSchema.safeParse({ items: [], nextCursor: null, truncated: false, total: 0 }).success).toBe(false);
  });
});
