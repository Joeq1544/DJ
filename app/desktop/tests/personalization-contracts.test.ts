import { describe, expect, it } from "vitest";
import {
  compareRecommendationsRequestSchema,
  compareRecommendationsResponseSchema,
  coreRequestSchema,
  preferenceExportConfirmResultSchema,
  preferenceExportPrepareResultSchema,
  preferenceExportSnapshotSchema,
  preferenceProfileSchema,
  recordFeedbackRequestSchema,
  savedFilterListSchema,
  savedFilterSaveRequestSchema,
  trackFiltersSchema,
  trackMetadataSchema,
  trackMetadataUpdateRequestSchema,
} from "../src/shared/contracts";

const eventCounts = {
  liked: 0,
  disliked: 0,
  accepted: 5,
  rejected: 0,
  skipped: 0,
  manualReplacement: 0,
  manualReorder: 0,
  pinned: 0,
  removed: 0,
  banned: 0,
} as const;

const profile = {
  algorithmVersion: "preference-linear-v1",
  revision: "a".repeat(64),
  status: "active",
  totalPersonalDataCount: 5,
  effectiveEvidenceCount: 5,
  minimumEvidenceCount: 5,
  preferenceWeightPpm: 15_000,
  eventCounts,
  trackAffinities: [{ trackId: "track-2", title: "Beta", artist: "Artist", scorePpm: 1_000_000, evidenceCount: 5 }],
  trackAffinitiesTruncated: false,
  genreAffinities: [{ genre: "house", scorePpm: 1_000_000, evidenceCount: 5 }],
  genreAffinitiesTruncated: false,
} as const;

const track = {
  id: "track-1",
  title: "Alpha",
  artist: "Artist",
  album: null,
  genre: "House",
  bpmMilli: 120_000,
  musicalKey: "8A",
  durationMs: 180_000,
  availability: "available",
} as const;

const candidate = {
  track,
  scorePpm: 800_000,
  confidencePpm: 700_000,
  reasons: ["Tempo compatibility is a bonus."],
  components: [{
    name: "tempo",
    scorePpm: 800_000,
    weightPpm: 300_000,
    contributionSignedPpm: 180_000,
    effect: "bonus",
    reason: "Tempo compatibility is a bonus.",
  }],
} as const;

const recommendation = {
  seed: track,
  intent: "smooth",
  algorithmVersion: "transition-v1",
  scannedCount: 2,
  truncated: false,
  items: [candidate],
} as const;

describe("M5 metadata and saved-filter contracts", () => {
  it("adds only bounded rating/tag filters and strict metadata", () => {
    expect(trackFiltersSchema.parse({ ratingMin: 1, tag: "Warmup" })).toEqual({ ratingMin: 1, tag: "Warmup" });
    expect(trackFiltersSchema.safeParse({ ratingMin: 0 }).success).toBe(false);
    expect(trackFiltersSchema.safeParse({ ratingMin: 6 }).success).toBe(false);
    expect(trackFiltersSchema.safeParse({ tag: "" }).success).toBe(false);
    expect(trackFiltersSchema.safeParse({ tag: "x".repeat(41) }).success).toBe(false);

    const metadata = { trackId: "track-1", rating: 5, tags: ["Warmup", "Chicago"], note: "Long intro", updatedAt: "1" };
    expect(trackMetadataSchema.parse(metadata)).toEqual(metadata);
    expect(trackMetadataUpdateRequestSchema.safeParse({ ...metadata, updatedAt: undefined }).success).toBe(false);
    expect(trackMetadataUpdateRequestSchema.safeParse({ trackId: "track-1", rating: 5, tags: ["House", "house"], note: null }).success).toBe(false);
    expect(trackMetadataUpdateRequestSchema.safeParse({ trackId: "track-1", rating: null, tags: [], note: "x".repeat(2_001) }).success).toBe(false);
  });

  it("bounds saved filter records and rejects renderer-owned paths", () => {
    const record = {
      id: "filter-1",
      name: "Warm high-rated",
      filters: { playlistId: "playlist-1", ratingMin: 4, tag: "Warmup" },
      createdAt: "1",
      updatedAt: "2",
    };
    expect(savedFilterListSchema.parse({ items: [record] })).toEqual({ items: [record] });
    expect(savedFilterSaveRequestSchema.parse({ name: record.name, filters: record.filters })).toEqual({ name: record.name, filters: record.filters });
    expect(savedFilterSaveRequestSchema.safeParse({ name: record.name, filters: {}, sourcePath: "/private/library.xml" }).success).toBe(false);
  });
});

describe("M5 feedback and preference contracts", () => {
  it("accepts only direct and recommendation feedback variants", () => {
    expect(recordFeedbackRequestSchema.parse({ type: "liked", trackId: "track-1" })).toEqual({ type: "liked", trackId: "track-1" });
    expect(recordFeedbackRequestSchema.parse({ type: "accepted", trackId: "track-2", seedTrackId: "track-1", intent: "smooth" })).toMatchObject({ type: "accepted" });
    expect(recordFeedbackRequestSchema.safeParse({ type: "accepted", trackId: "track-2" }).success).toBe(false);
    expect(recordFeedbackRequestSchema.safeParse({ type: "manual_reorder", trackId: "track-2" }).success).toBe(false);
    expect(recordFeedbackRequestSchema.safeParse({ type: "liked", trackId: "track-1", seedTrackId: "track-2" }).success).toBe(false);
  });

  it("keeps profile evidence, weights, and affinities bounded and path-free", () => {
    expect(preferenceProfileSchema.parse(profile)).toEqual(profile);
    expect(preferenceProfileSchema.safeParse({ ...profile, preferenceWeightPpm: 150_001 }).success).toBe(false);
    expect(preferenceProfileSchema.safeParse({ ...profile, status: "learning", preferenceWeightPpm: 1 }).success).toBe(false);
    expect(preferenceProfileSchema.safeParse({ ...profile, sourcePath: "/private/audio.wav" }).success).toBe(false);
  });

  it("compares one exact baseline/personalized candidate universe", () => {
    const personalized = { ...recommendation, algorithmVersion: "transition-v1+preference-linear-v1" } as const;
    const response = {
      profile,
      baseline: recommendation,
      personalized,
      rankChanges: [{ trackId: "track-1", baselineRank: 1, personalizedRank: 1, delta: 0 }],
    };
    expect(compareRecommendationsRequestSchema.parse({ seedTrackId: "track-1", intent: "smooth", limit: 20 })).toMatchObject({ limit: 20 });
    expect(compareRecommendationsResponseSchema.parse(response)).toEqual(response);
    expect(compareRecommendationsResponseSchema.safeParse({ ...response, personalized: { ...personalized, items: [] } }).success).toBe(false);
    expect(compareRecommendationsResponseSchema.safeParse({ ...response, baseline: { ...recommendation, algorithmVersion: "transition-v1+preference-linear-v1" } }).success).toBe(false);
    expect(compareRecommendationsResponseSchema.safeParse({ ...response, personalized: { ...personalized, seed: { ...track, id: "other-seed" } } }).success).toBe(false);
  });
});

describe("M5 preference export and core commands", () => {
  it("validates a bounded private export without display metadata or paths", () => {
    const snapshot = {
      format: "dj-copilot-preferences-v1",
      algorithmVersion: "preference-linear-v1",
      revision: profile.revision,
      status: "active",
      totalPersonalDataCount: 5,
      effectiveEvidenceCount: 5,
      minimumEvidenceCount: 5,
      preferenceWeightPpm: 15_000,
      ratingCount: 0,
      eventCounts,
      trackAffinities: [{ trackId: "track-2", scorePpm: 1_000_000, evidenceCount: 5 }],
      trackAffinitiesTruncated: false,
      genreAffinities: profile.genreAffinities,
      genreAffinitiesTruncated: false,
    };
    expect(preferenceExportSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(preferenceExportSnapshotSchema.safeParse({ ...snapshot, note: "private" }).success).toBe(false);
    expect(preferenceExportSnapshotSchema.safeParse({ ...snapshot, status: "learning", preferenceWeightPpm: 15_000 }).success).toBe(false);
    expect(preferenceExportPrepareResultSchema.parse({ status: "ready", confirmationId: "confirm-1", destinationDisplay: "preferences.json", willReplaceExisting: false, effectiveEvidenceCount: 5, profileStatus: "active" })).toMatchObject({ status: "ready" });
    expect(preferenceExportConfirmResultSchema.parse({ status: "exported", overwritten: false, format: "dj-copilot-preferences-v1", destinationState: "replaced" })).toMatchObject({ status: "exported" });
  });

  it("adds only fixed strict core operations", () => {
    const requests = [
      ["get_track_metadata", { trackId: "track-1" }],
      ["update_track_metadata", { trackId: "track-1", rating: 5, tags: ["Warmup"], note: null }],
      ["list_saved_filters", {}],
      ["save_saved_filter", { name: "Warmup", filters: { tag: "Warmup" } }],
      ["delete_saved_filter", { id: "filter-1" }],
      ["get_preference_profile", {}],
      ["record_feedback", { type: "disliked", trackId: "track-1" }],
      ["compare_recommendations", { seedTrackId: "track-1", intent: "smooth" }],
      ["reset_preferences", {}],
      ["get_preference_export", {}],
    ] as const;
    for (const [command, payload] of requests) {
      expect(coreRequestSchema.safeParse({ version: 1, id: command, command, payload }).success).toBe(true);
    }
    expect(coreRequestSchema.safeParse({ version: 1, id: "bad", command: "record_feedback", payload: { type: "liked", trackId: "track-1", path: "/tmp/a" } }).success).toBe(false);
  });
});
