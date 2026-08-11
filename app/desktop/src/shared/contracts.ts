import { z } from "zod";

const idSchema = z.string().min(1).max(128);
const messageSchema = z.string().min(1).max(500);
const displayTextSchema = z.string().max(1_000).nullable();
const nonnegativeIntegerSchema = z.number().int().nonnegative();
const ppmSchema = z.number().int().min(0).max(1_000_000);
const signedPpmSchema = z.number().int().min(-1_000_000).max(1_000_000);
const providerSchema = z.literal("ffmpeg-numpy-basic");
const providerVersionSchema = z.literal("ffmpeg 8.1.2; ffprobe 8.1.2; numpy 2.4.4");
const pipelineVersionSchema = z.literal("baseline-v1");

export const analysisFeaturesSchema = z.strictObject({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  fileSize: nonnegativeIntegerSchema,
  mtimeNs: z.number().nonnegative().refine(Number.isInteger),
  codec: z.string().min(1).max(128),
  container: z.string().min(1).max(128),
  durationMs: z.number().int().positive(),
  sampleRateHz: z.number().int().positive(),
  channels: z.number().int().min(1).max(64),
  bpmMilli: z.number().int().min(60_000).max(200_000).nullable(),
  tempoConfidencePpm: ppmSchema,
  tempoCandidatesMilli: z.array(z.number().int().min(60_000).max(200_000)).max(3),
  onsetCount: nonnegativeIntegerSchema,
  beatStrengthPpm: ppmSchema,
  musicalKey: z.string().min(1).max(64).nullable(),
  mode: z.enum(["major", "minor"]).nullable(),
  keyConfidencePpm: ppmSchema,
  rmsMilliDbfs: z.number().int().nullable(),
  peakMilliDbfs: z.number().int().nullable(),
  crestFactorMilliDb: z.number().int().nullable(),
  energyPpm: ppmSchema,
  dynamicRangeMilliDb: z.number().int().nullable(),
  onsetRateMilliHz: nonnegativeIntegerSchema,
  spectralCentroidHz: nonnegativeIntegerSchema.nullable(),
  brightnessPpm: ppmSchema,
  energyCurvePpm: z.array(ppmSchema).length(16),
  provider: providerSchema,
  providerVersion: providerVersionSchema,
  pipelineVersion: pipelineVersionSchema,
  limitations: z.array(z.string().min(1).max(500)).max(16),
});

export const analysisCapabilitiesSchema = z
  .strictObject({
    available: z.boolean(),
    provider: providerSchema,
    providerVersion: providerVersionSchema.nullable(),
    pipelineVersion: pipelineVersionSchema,
    availableStages: z.tuple([z.literal("metadata"), z.literal("basic_features")]),
    unavailableStages: z.tuple([z.literal("structure"), z.literal("embeddings")]),
    unavailableReason: messageSchema.nullable(),
  })
  .superRefine((capabilities, context) => {
    if (capabilities.available && (capabilities.providerVersion === null || capabilities.unavailableReason !== null)) {
      context.addIssue({ code: "custom", message: "Available analysis capabilities require exact provenance" });
    }
    if (!capabilities.available && (capabilities.providerVersion !== null || capabilities.unavailableReason === null)) {
      context.addIssue({ code: "custom", message: "Unavailable analysis capabilities require a reason" });
    }
  });

export const analysisSummarySchema = z.strictObject({
  status: z.enum(["not_queued", "queued", "running", "paused", "succeeded", "failed"]),
  progressPpm: ppmSchema,
  attemptCount: nonnegativeIntegerSchema,
  errorCode: z.string().min(1).max(64).nullable(),
  errorMessage: messageSchema.nullable(),
  features: analysisFeaturesSchema.nullable(),
});

export const analysisQueueItemSchema = z.strictObject({
  trackId: idSchema,
  ...analysisSummarySchema.shape,
});

export const analysisQueueStatusSchema = z.strictObject({
  state: z.enum(["idle", "running", "paused"]),
  queued: nonnegativeIntegerSchema,
  running: nonnegativeIntegerSchema,
  paused: nonnegativeIntegerSchema,
  succeeded: nonnegativeIntegerSchema,
  failed: nonnegativeIntegerSchema,
  progressPpm: ppmSchema,
  capabilities: analysisCapabilitiesSchema,
  items: z.array(analysisQueueItemSchema).max(200),
});

export const analysisTrackIdsSchema = z
  .array(idSchema)
  .min(1)
  .max(200)
  .refine((trackIds) => new Set(trackIds).size === trackIds.length, "Track IDs must be unique");

export const analysisQueueRequestSchema = z.strictObject({
  trackIds: analysisTrackIdsSchema,
});

export const analysisStatusQuerySchema = z.strictObject({
  trackIds: analysisTrackIdsSchema.optional(),
});

export const appStatusSchema = z.strictObject({
  state: z.enum(["starting", "ready", "retrying", "degraded"]),
  message: z.string().max(500).nullable(),
});

const userTagSchema = z.string().min(1).max(40).refine(
  (tag) => tag === tag.trim() && tag === tag.normalize("NFKC"),
  "Tags must be trimmed and Unicode-normalized",
);

const userTagsSchema = z.array(userTagSchema).max(20).superRefine((tags, context) => {
  const normalized = new Set<string>();
  tags.forEach((tag, index) => {
    const key = tag.normalize("NFKC").toLowerCase();
    if (normalized.has(key)) {
      context.addIssue({ code: "custom", path: [index], message: "Tags must be unique ignoring case" });
    }
    normalized.add(key);
  });
});

const trackMetadataValueSchema = z.strictObject({
  rating: z.number().int().min(1).max(5).nullable(),
  tags: userTagsSchema,
  note: z.string().min(1).max(2_000).nullable(),
});

export const trackMetadataSchema = z.strictObject({
  trackId: idSchema,
  ...trackMetadataValueSchema.shape,
  updatedAt: z.string().min(1).max(64),
});

export const trackMetadataGetRequestSchema = z.strictObject({ trackId: idSchema });

export const trackMetadataUpdateRequestSchema = z.strictObject({
  trackId: idSchema,
  ...trackMetadataValueSchema.shape,
});

export const trackListItemSchema = z.strictObject({
  id: idSchema,
  title: displayTextSchema,
  artist: displayTextSchema,
  album: displayTextSchema,
  genre: displayTextSchema,
  bpmMilli: z.number().int().positive().nullable(),
  musicalKey: z.string().max(64).nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  availability: z.enum(["available", "missing", "unreadable"]),
  analysis: analysisSummarySchema.nullable(),
  userMetadata: trackMetadataValueSchema,
});

const trackFilterShape = {
  playlistId: idSchema.optional(),
  text: z.string().min(1).max(200).optional(),
  bpmMinMilli: z.number().int().min(30_000).max(400_000).optional(),
  bpmMaxMilli: z.number().int().min(30_000).max(400_000).optional(),
  musicalKey: z.string().min(1).max(64).optional(),
  keyRelation: z.enum(["exact", "compatible"]).optional(),
  genre: z.string().min(1).max(200).optional(),
  energyMinPpm: ppmSchema.optional(),
  energyMaxPpm: ppmSchema.optional(),
  analysisState: z.enum(["any", "analyzed", "not_analyzed", "failed"]).optional(),
  availability: z.enum(["any", "available", "missing", "unreadable"]).optional(),
  ratingMin: z.number().int().min(1).max(5).optional(),
  tag: userTagSchema.optional(),
};

interface TrackFilterRelations {
  bpmMinMilli?: number | undefined;
  bpmMaxMilli?: number | undefined;
  musicalKey?: string | undefined;
  keyRelation?: "exact" | "compatible" | undefined;
  energyMinPpm?: number | undefined;
  energyMaxPpm?: number | undefined;
}

function validateTrackFilterRelations(filters: TrackFilterRelations, context: z.RefinementCtx): void {
  if (
    filters.bpmMinMilli !== undefined &&
    filters.bpmMaxMilli !== undefined &&
    filters.bpmMinMilli > filters.bpmMaxMilli
  ) {
    context.addIssue({ code: "custom", path: ["bpmMaxMilli"], message: "Maximum BPM must not be less than minimum BPM" });
  }
  if (
    filters.energyMinPpm !== undefined &&
    filters.energyMaxPpm !== undefined &&
    filters.energyMinPpm > filters.energyMaxPpm
  ) {
    context.addIssue({ code: "custom", path: ["energyMaxPpm"], message: "Maximum energy must not be less than minimum energy" });
  }
  if (filters.keyRelation !== undefined && filters.musicalKey === undefined) {
    context.addIssue({ code: "custom", path: ["keyRelation"], message: "Key relation requires a musical key" });
  }
}

export const trackFiltersSchema = z.strictObject(trackFilterShape).superRefine(validateTrackFilterRelations);

export const trackPageQuerySchema = z.strictObject({
  ...trackFilterShape,
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.number().int().min(1).max(200).default(100),
}).superRefine(validateTrackFilterRelations);

export const trackPageSchema = z.strictObject({
  items: z.array(trackListItemSchema).max(200),
  nextCursor: z.string().min(1).max(2_048).nullable(),
  truncated: z.boolean(),
});

export const discoveryIntentSchema = z.enum([
  "smooth",
  "build",
  "peak",
  "reset",
  "genre_shift",
  "adventurous",
  "singalong_continuation",
  "closer",
]);

const discoveryLimitSchema = z.number().int().min(1).max(20).default(10);

export const findSimilarRequestSchema = z.strictObject({
  seedTrackId: idSchema,
  filters: trackFiltersSchema.optional(),
  limit: discoveryLimitSchema,
});

export const recommendNextRequestSchema = z.strictObject({
  seedTrackId: idSchema,
  intent: discoveryIntentSchema,
  filters: trackFiltersSchema.optional(),
  limit: discoveryLimitSchema,
});

export const discoveryTrackSchema = trackListItemSchema.omit({ analysis: true, userMetadata: true });

export const scoreComponentSchema = z
  .strictObject({
    name: z.enum(["tempo", "key", "energy", "style", "timbre", "vocal", "structure", "preference"]),
    scorePpm: ppmSchema.nullable(),
    weightPpm: ppmSchema,
    contributionSignedPpm: signedPpmSchema,
    effect: z.enum(["bonus", "penalty", "neutral", "missing"]),
    reason: z.string().min(1).max(200),
  })
  .superRefine((component, context) => {
    if (component.scorePpm === null) {
      if (component.effect !== "missing") {
        context.addIssue({ code: "custom", path: ["effect"], message: "A missing score requires a missing effect" });
      }
      if (component.contributionSignedPpm !== 0) {
        context.addIssue({ code: "custom", path: ["contributionSignedPpm"], message: "A missing score has no contribution" });
      }
      return;
    }
    const expectedEffect = component.scorePpm >= 600_000
      ? "bonus"
      : component.scorePpm < 400_000
        ? "penalty"
        : "neutral";
    if (component.effect !== expectedEffect) {
      context.addIssue({ code: "custom", path: ["effect"], message: "Effect does not match the component score" });
    }
  });

export const discoveryCandidateSchema = z.strictObject({
  track: discoveryTrackSchema,
  scorePpm: ppmSchema,
  confidencePpm: ppmSchema,
  reasons: z.array(z.string().min(1).max(200)).min(1).max(3),
  components: z.array(scoreComponentSchema).min(1).max(8),
});

const discoveryResponseShape = {
  seed: discoveryTrackSchema,
  scannedCount: z.number().int().min(0).max(25_000),
  truncated: z.boolean(),
  items: z.array(discoveryCandidateSchema).max(20),
};

export const similarityResponseSchema = z.strictObject({
  ...discoveryResponseShape,
  algorithmVersion: z.literal("feature-similarity-v1"),
});

export const recommendationResponseSchema = z.strictObject({
  ...discoveryResponseShape,
  intent: discoveryIntentSchema,
  algorithmVersion: z.enum(["transition-v1", "transition-v1+preference-linear-v1"]),
});

export const savedFilterSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1).max(80),
  filters: trackFiltersSchema,
  createdAt: z.string().min(1).max(64),
  updatedAt: z.string().min(1).max(64),
});

export const savedFilterListSchema = z.strictObject({ items: z.array(savedFilterSchema).max(50) });

export const savedFilterSaveRequestSchema = z.strictObject({
  id: idSchema.optional(),
  name: z.string().min(1).max(80),
  filters: trackFiltersSchema,
});

export const savedFilterDeleteRequestSchema = z.strictObject({ id: idSchema });
export const savedFilterDeleteResultSchema = z.strictObject({ deleted: z.literal(true) });

const directFeedbackSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("liked"), trackId: idSchema }),
  z.strictObject({ type: z.literal("disliked"), trackId: idSchema }),
]);

const recommendationFeedbackSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("accepted"), trackId: idSchema, seedTrackId: idSchema, intent: discoveryIntentSchema }),
  z.strictObject({ type: z.literal("rejected"), trackId: idSchema, seedTrackId: idSchema, intent: discoveryIntentSchema }),
  z.strictObject({ type: z.literal("skipped"), trackId: idSchema, seedTrackId: idSchema, intent: discoveryIntentSchema }),
]);

export const recordFeedbackRequestSchema = z.union([directFeedbackSchema, recommendationFeedbackSchema]);

export const preferenceEventCountsSchema = z.strictObject({
  liked: nonnegativeIntegerSchema,
  disliked: nonnegativeIntegerSchema,
  accepted: nonnegativeIntegerSchema,
  rejected: nonnegativeIntegerSchema,
  skipped: nonnegativeIntegerSchema,
  manualReplacement: nonnegativeIntegerSchema,
  manualReorder: nonnegativeIntegerSchema,
  pinned: nonnegativeIntegerSchema,
  removed: nonnegativeIntegerSchema,
  banned: nonnegativeIntegerSchema,
});

const preferenceTrackAffinitySchema = z.strictObject({
  trackId: idSchema,
  title: displayTextSchema,
  artist: displayTextSchema,
  scorePpm: ppmSchema,
  evidenceCount: z.number().int().positive(),
});

const preferenceGenreAffinitySchema = z.strictObject({
  genre: z.string().min(1).max(1_000),
  scorePpm: ppmSchema,
  evidenceCount: z.number().int().positive(),
});

const preferenceProfileShape = {
  algorithmVersion: z.literal("preference-linear-v1"),
  revision: z.string().regex(/^[a-f0-9]{64}$/u),
  status: z.enum(["baseline", "learning", "active"]),
  totalPersonalDataCount: nonnegativeIntegerSchema,
  effectiveEvidenceCount: nonnegativeIntegerSchema,
  minimumEvidenceCount: z.literal(5),
  preferenceWeightPpm: z.number().int().min(0).max(150_000),
  eventCounts: preferenceEventCountsSchema,
  trackAffinities: z.array(preferenceTrackAffinitySchema).max(50),
  trackAffinitiesTruncated: z.boolean(),
  genreAffinities: z.array(preferenceGenreAffinitySchema).max(50),
  genreAffinitiesTruncated: z.boolean(),
};

interface PreferenceEvidenceRelations {
  status: "baseline" | "learning" | "active";
  totalPersonalDataCount: number;
  effectiveEvidenceCount: number;
  minimumEvidenceCount: 5;
  preferenceWeightPpm: number;
}

function validatePreferenceEvidence(profile: PreferenceEvidenceRelations, context: z.RefinementCtx): void {
  const expectedStatus = profile.effectiveEvidenceCount === 0
    ? "baseline"
    : profile.effectiveEvidenceCount < profile.minimumEvidenceCount
      ? "learning"
      : "active";
  if (profile.status !== expectedStatus) {
    context.addIssue({ code: "custom", path: ["status"], message: "Preference status disagrees with evidence" });
  }
  const expectedWeight = expectedStatus === "active"
    ? Math.min(150_000, (profile.effectiveEvidenceCount - 4) * 15_000)
    : 0;
  if (profile.preferenceWeightPpm !== expectedWeight) {
    context.addIssue({ code: "custom", path: ["preferenceWeightPpm"], message: "Preference weight disagrees with evidence" });
  }
}

export const preferenceProfileSchema = z.strictObject(preferenceProfileShape).superRefine(validatePreferenceEvidence);

export const recordFeedbackResultSchema = z.strictObject({
  recorded: z.literal(true),
  profile: preferenceProfileSchema,
});

export const compareRecommendationsRequestSchema = recommendNextRequestSchema;

export const recommendationRankChangeSchema = z.strictObject({
  trackId: idSchema,
  baselineRank: z.number().int().min(1).max(20),
  personalizedRank: z.number().int().min(1).max(20),
  delta: z.number().int().min(-19).max(19),
});

export const compareRecommendationsResponseSchema = z.strictObject({
  profile: preferenceProfileSchema,
  baseline: recommendationResponseSchema,
  personalized: recommendationResponseSchema,
  rankChanges: z.array(recommendationRankChangeSchema).max(20),
}).superRefine((comparison, context) => {
  if (comparison.baseline.algorithmVersion !== "transition-v1") {
    context.addIssue({ code: "custom", path: ["baseline", "algorithmVersion"], message: "Baseline must use transition-v1" });
  }
  const expectedPersonalizedVersion = comparison.profile.status === "active"
    ? "transition-v1+preference-linear-v1"
    : "transition-v1";
  if (comparison.personalized.algorithmVersion !== expectedPersonalizedVersion) {
    context.addIssue({ code: "custom", path: ["personalized", "algorithmVersion"], message: "Personalized algorithm version disagrees with profile status" });
  }
  if (
    comparison.baseline.seed.id !== comparison.personalized.seed.id ||
    comparison.baseline.intent !== comparison.personalized.intent ||
    comparison.baseline.scannedCount !== comparison.personalized.scannedCount ||
    comparison.baseline.truncated !== comparison.personalized.truncated
  ) {
    context.addIssue({ code: "custom", path: ["personalized"], message: "Baseline and personalized request context must match" });
  }
  const baselineIds = comparison.baseline.items.map((item) => item.track.id);
  const personalizedIds = comparison.personalized.items.map((item) => item.track.id);
  if (
    baselineIds.length !== personalizedIds.length ||
    new Set(baselineIds).size !== baselineIds.length ||
    new Set(personalizedIds).size !== personalizedIds.length ||
    baselineIds.some((trackId) => !personalizedIds.includes(trackId))
  ) {
    context.addIssue({ code: "custom", path: ["personalized", "items"], message: "Baseline and personalized candidates must match" });
  }
  if (comparison.rankChanges.length !== baselineIds.length) {
    context.addIssue({ code: "custom", path: ["rankChanges"], message: "Every candidate requires one rank change" });
    return;
  }
  comparison.rankChanges.forEach((change, index) => {
    const baselineRank = baselineIds.indexOf(change.trackId) + 1;
    const personalizedRank = personalizedIds.indexOf(change.trackId) + 1;
    if (
      baselineRank === 0 ||
      personalizedRank === 0 ||
      change.baselineRank !== baselineRank ||
      change.personalizedRank !== personalizedRank ||
      change.delta !== baselineRank - personalizedRank
    ) {
      context.addIssue({ code: "custom", path: ["rankChanges", index], message: "Rank change disagrees with candidate order" });
    }
  });
});

export const preferenceResetResultSchema = z.strictObject({
  status: z.literal("reset"),
  clearedFeedbackCount: nonnegativeIntegerSchema,
  clearedRatingCount: nonnegativeIntegerSchema,
  profile: preferenceProfileSchema,
});

const exportTrackAffinitySchema = preferenceTrackAffinitySchema.omit({ title: true, artist: true });

export const preferenceExportSnapshotSchema = z.strictObject({
  format: z.literal("dj-copilot-preferences-v1"),
  algorithmVersion: z.literal("preference-linear-v1"),
  revision: z.string().regex(/^[a-f0-9]{64}$/u),
  status: z.enum(["baseline", "learning", "active"]),
  totalPersonalDataCount: nonnegativeIntegerSchema,
  effectiveEvidenceCount: nonnegativeIntegerSchema,
  minimumEvidenceCount: z.literal(5),
  preferenceWeightPpm: z.number().int().min(0).max(150_000),
  ratingCount: nonnegativeIntegerSchema,
  eventCounts: preferenceEventCountsSchema,
  trackAffinities: z.array(exportTrackAffinitySchema).max(50),
  trackAffinitiesTruncated: z.boolean(),
  genreAffinities: z.array(preferenceGenreAffinitySchema).max(50),
  genreAffinitiesTruncated: z.boolean(),
}).superRefine(validatePreferenceEvidence);

export const playlistTreeNodeSchema = z.strictObject({
  id: idSchema,
  parentId: idSchema.nullable(),
  name: z.string().min(1).max(1_000),
  kind: z.enum(["folder", "playlist"]),
  order: z.number().int().nonnegative(),
  trackCount: z.number().int().nonnegative(),
});

export const playlistTreeSchema = z.array(playlistTreeNodeSchema).max(25_000);

export const importSummarySchema = z.strictObject({
  revision: z.number().int().positive(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  importedTracks: z.number().int().nonnegative(),
  importedPlaylists: z.number().int().nonnegative(),
  unavailableTracks: z.number().int().nonnegative(),
});

export const importResultSchema = z.discriminatedUnion("success", [
  z.strictObject({
    success: z.literal(true),
    summary: importSummarySchema,
  }),
  z.strictObject({
    success: z.literal(false),
    error: z.strictObject({
      code: z.string().min(1).max(64),
      message: messageSchema,
    }),
    preservedPreviousLibrary: z.literal(true),
  }),
]);

const revisionSchema = z.number().int().positive().max(2_147_483_647);
const indexSchema = z.number().int().min(0).max(99);
const setRoleSchema = z.enum(["warmup", "groove", "build", "peak", "singalong", "reset", "bridge", "closer"]);
const strictTrackIdsSchema = z.array(idSchema).min(1).max(100).refine(
  (trackIds) => new Set(trackIds).size === trackIds.length,
  "Track IDs must be unique",
);

export const setDraftPlanSchema = z.strictObject({
  intent: discoveryIntentSchema,
  targetDurationMs: z.number().int().min(900_000).max(28_800_000).nullable(),
  maxArtistRepeats: z.number().int().min(1).max(20).nullable(),
  candidateFilters: trackFiltersSchema,
});

const setDraftSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("empty") }),
  z.strictObject({ kind: z.literal("tracks"), trackIds: strictTrackIdsSchema }),
  z.strictObject({ kind: z.literal("playlist"), playlistId: idSchema }),
  z.strictObject({
    kind: z.literal("generated"),
    seedTrackId: idSchema.optional(),
    maxTracks: z.number().int().min(1).max(50),
  }),
]);

export const setDraftCreateRequestSchema = z.strictObject({
  title: z.string().min(1).max(200),
  plan: setDraftPlanSchema,
  source: setDraftSourceSchema,
});

export const setDraftGetRequestSchema = z.strictObject({
  draftId: idSchema,
  revision: revisionSchema.optional(),
});

const setDraftMutationSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("rename"), title: z.string().min(1).max(200) }),
  z.strictObject({ type: z.literal("set_plan"), plan: setDraftPlanSchema }),
  z.strictObject({ type: z.literal("insert_track"), trackId: idSchema, toIndex: z.number().int().min(0).max(100) }),
  z.strictObject({ type: z.literal("move_entry"), entryId: idSchema, toIndex: indexSchema }),
  z.strictObject({ type: z.literal("set_track_pin"), entryId: idSchema, pinned: z.boolean() }),
  z.strictObject({ type: z.literal("set_position_pin"), entryId: idSchema, pinned: z.boolean() }),
  z.strictObject({ type: z.literal("remove_entry"), entryId: idSchema }),
  z.strictObject({ type: z.literal("ban_entry"), entryId: idSchema }),
  z.strictObject({ type: z.literal("unban_track"), trackId: idSchema }),
  z.strictObject({ type: z.literal("replace_entry"), entryId: idSchema, replacementTrackId: idSchema }),
  z.strictObject({
    type: z.literal("set_entry_goal"),
    entryId: idSchema,
    role: setRoleSchema.nullable(),
    targetEnergyPpm: ppmSchema.nullable(),
  }),
  z.strictObject({ type: z.literal("optimize") }),
  z.strictObject({ type: z.literal("undo") }),
  z.strictObject({ type: z.literal("redo") }),
  z.strictObject({ type: z.literal("save_version"), label: z.string().min(1).max(100) }),
  z.strictObject({ type: z.literal("restore_version"), version: revisionSchema }),
]);

export const setDraftMutationRequestSchema = z.strictObject({
  draftId: idSchema,
  expectedRevision: revisionSchema,
  mutation: setDraftMutationSchema,
});

export const setDraftReplacementRequestSchema = z.strictObject({
  draftId: idSchema,
  entryId: idSchema,
  revision: revisionSchema.optional(),
});

export const setDraftInspectRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("draft"), draftId: idSchema, revision: revisionSchema.optional() }),
  z.strictObject({ kind: z.literal("playlist"), playlistId: idSchema }),
]);

export const setDraftEntrySchema = z.strictObject({
  id: idSchema,
  trackId: idSchema,
  track: discoveryTrackSchema.nullable(),
  resolution: z.enum(["resolved", "missing"]),
  bpmMilli: z.number().int().positive().nullable(),
  musicalKey: z.string().min(1).max(64).nullable(),
  energyPpm: ppmSchema.nullable(),
  trackPinned: z.boolean(),
  positionPinned: z.boolean(),
  role: setRoleSchema.nullable(),
  targetEnergyPpm: ppmSchema.nullable(),
}).superRefine((entry, context) => {
  if ((entry.resolution === "resolved") !== (entry.track !== null)) {
    context.addIssue({ code: "custom", message: "Resolution and current track disagree" });
  }
});

export const setDraftVersionSchema = z.strictObject({
  version: revisionSchema,
  revision: revisionSchema,
  label: z.string().min(1).max(100),
});

export const setDraftSnapshotSchema = z.strictObject({
  draftId: idSchema,
  currentRevision: revisionSchema,
  contentRevision: revisionSchema,
  title: z.string().min(1).max(200),
  plan: setDraftPlanSchema,
  entries: z.array(setDraftEntrySchema).max(100),
  bans: z.array(idSchema).max(200).refine((bans) => new Set(bans).size === bans.length && bans.every((ban, index) => index === 0 || bans[index - 1]! < ban), "Bans must be unique and sorted"),
  knownDurationMs: nonnegativeIntegerSchema,
  unknownDurationCount: nonnegativeIntegerSchema,
  unmetConstraints: z.array(z.strictObject({ code: z.string().min(1).max(64), message: messageSchema })).max(20),
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  versions: z.array(setDraftVersionSchema).max(100),
  viewingVersion: revisionSchema.nullable(),
});

export const setDraftListItemSchema = z.strictObject({
  draftId: idSchema,
  currentRevision: revisionSchema,
  title: z.string().min(1).max(200),
  trackCount: z.number().int().min(0).max(100),
  knownDurationMs: nonnegativeIntegerSchema,
  unknownDurationCount: nonnegativeIntegerSchema,
});

export const setDraftListResultSchema = z.strictObject({ items: z.array(setDraftListItemSchema).max(100) });

export const setDraftMutationResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("updated"), snapshot: setDraftSnapshotSchema }),
  z.strictObject({ status: z.literal("conflict"), currentRevision: revisionSchema }),
]);

export const setTransitionSchema = z.strictObject({
  fromPosition: z.number().int().min(0).max(99),
  toPosition: z.number().int().min(1).max(100),
  scorePpm: ppmSchema,
  confidencePpm: ppmSchema,
  utilitySignedPpm: signedPpmSchema,
  reasons: z.array(z.string().min(1).max(200)).max(3),
  components: z.array(scoreComponentSchema).min(1).max(8),
});

export const setDraftReplacementResultSchema = z.strictObject({
  scannedCount: z.number().int().min(0).max(25_000),
  scanTruncated: z.boolean(),
  items: z.array(z.strictObject({
    track: discoveryTrackSchema,
    scorePpm: ppmSchema,
    confidencePpm: ppmSchema,
    goalScorePpm: ppmSchema.nullable(),
    affectedTransitions: z.array(setTransitionSchema).max(2),
  })).max(10),
});

const setInspectionPointSchema = z.strictObject({
  position: z.number().int().min(0).max(99),
  entryId: idSchema.nullable(),
  trackId: idSchema,
  track: discoveryTrackSchema.nullable(),
  resolution: z.enum(["resolved", "missing"]),
  bpmMilli: z.number().int().positive().nullable(),
  musicalKey: z.string().min(1).max(64).nullable(),
  energyPpm: ppmSchema.nullable(),
  energyDirection: z.enum(["rise", "fall", "flat", "unknown"]),
  bpmDirection: z.enum(["rise", "fall", "flat", "unknown"]),
});

const setWarningSchema = z.strictObject({ code: z.string().min(1).max(64), message: messageSchema });

const organizationSuggestionSchema = z.strictObject({
  kind: z.enum(["energy_group", "genre_group", "not_in_playlist"]),
  label: z.string().min(1).max(200),
  evidence: z.string().min(1).max(500),
  trackIds: z.array(idSchema).max(100),
  matchedTrackCount: nonnegativeIntegerSchema,
  trackIdsTruncated: z.boolean(),
});

export const setDraftInspectResultSchema = z.strictObject({
  sourcePositionCount: nonnegativeIntegerSchema,
  inspectedPositionCount: z.number().int().min(0).max(100),
  inputTruncated: z.boolean(),
  knownDurationMs: nonnegativeIntegerSchema,
  unknownDurationCount: nonnegativeIntegerSchema,
  points: z.array(setInspectionPointSchema).max(100),
  transitions: z.array(setTransitionSchema).max(99),
  warnings: z.array(setWarningSchema).max(200),
  matchedWarningCount: nonnegativeIntegerSchema,
  warningsTruncated: z.boolean(),
  scannedCount: z.number().int().min(0).max(25_000),
  scanTruncated: z.boolean(),
  organizationLabel: z.literal("Suggestions only—nothing has changed in Rekordbox."),
  organizationSuggestions: z.array(organizationSuggestionSchema).max(20),
  matchedSuggestionCount: nonnegativeIntegerSchema,
  suggestionsTruncated: z.boolean(),
}).superRefine((result, context) => {
  if (result.inspectedPositionCount > result.sourcePositionCount) {
    context.addIssue({ code: "custom", path: ["inspectedPositionCount"], message: "Cannot inspect more positions than supplied" });
  }
  if (result.inputTruncated !== (result.sourcePositionCount > result.inspectedPositionCount)) {
    context.addIssue({ code: "custom", path: ["inputTruncated"], message: "Input truncation metadata disagrees" });
  }
});

export const exportPrepareRequestSchema = z.strictObject({ draftId: idSchema, expectedRevision: revisionSchema });
export const exportConfirmRequestSchema = z.strictObject({ confirmationId: idSchema });

const exportReasonSchema = z.strictObject({ code: z.string().min(1).max(64), message: messageSchema });

export const preferenceExportPrepareResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("cancelled") }),
  z.strictObject({ status: z.literal("blocked"), reasons: z.array(exportReasonSchema).min(1).max(20) }),
  z.strictObject({
    status: z.literal("ready"),
    confirmationId: idSchema,
    destinationDisplay: z.string().min(1).max(1_000),
    willReplaceExisting: z.boolean(),
    effectiveEvidenceCount: nonnegativeIntegerSchema,
    profileStatus: z.enum(["baseline", "learning", "active"]),
  }),
]);

export const preferenceExportConfirmRequestSchema = z.strictObject({ confirmationId: idSchema });

export const preferenceExportConfirmResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("exported"),
    overwritten: z.boolean(),
    format: z.literal("dj-copilot-preferences-v1"),
    destinationState: z.literal("replaced"),
  }),
  z.strictObject({
    status: z.literal("blocked"),
    reasons: z.array(exportReasonSchema).min(1).max(20),
    destinationState: z.enum(["unchanged", "unknown"]),
  }),
]);

export const exportPrepareResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("cancelled") }),
  z.strictObject({ status: z.literal("blocked"), reasons: z.array(exportReasonSchema).min(1).max(20) }),
  z.strictObject({
    status: z.literal("ready"),
    confirmationId: idSchema,
    playlistName: z.string().min(1).max(200),
    trackCount: z.number().int().min(0).max(100),
    knownDurationMs: nonnegativeIntegerSchema,
    unknownDurationCount: nonnegativeIntegerSchema,
    destinationDisplay: z.string().min(1).max(1_000),
    willReplaceExisting: z.boolean(),
    warnings: z.array(z.string().min(1).max(500)).max(20),
  }),
]);

export const exportConfirmResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("exported"),
    draftId: idSchema,
    revision: revisionSchema,
    playlistName: z.string().min(1).max(200),
    trackCount: z.number().int().min(0).max(100),
    overwritten: z.boolean(),
    format: z.literal("rekordbox_xml_1_0_0"),
    destinationState: z.literal("replaced"),
  }),
  z.strictObject({
    status: z.literal("blocked"),
    reasons: z.array(exportReasonSchema).min(1).max(20),
    destinationState: z.enum(["unchanged", "unknown"]),
  }),
]);

const assistantPromptSchema = z.string().trim().min(1).max(2_000);
const assistantTextSchema = z.string().max(8_000);
const assistantSummarySchema = z.string().trim().min(1).max(500);
const assistantSequenceSchema = z.number().int().nonnegative().max(2_147_483_647);
const assistantSdkVersionSchema = z.literal("0.147.0");

export const assistantAuthStatusSchema = z.strictObject({
  state: z.enum(["checking", "ready", "signed_out", "unsupported_auth", "unavailable"]),
  auth: z.enum(["chatgpt", "none", "other", "unknown"]),
  message: z.string().min(1).max(500).refine((message) => !/sk-[A-Za-z0-9_-]{4,}/u.test(message), "Status must not contain credential-shaped text"),
  sdkVersion: assistantSdkVersionSchema.nullable(),
}).superRefine((status, context) => {
  const expectedAuth = {
    checking: "unknown",
    ready: "chatgpt",
    signed_out: "none",
    unsupported_auth: "other",
    unavailable: "unknown",
  } as const;
  if (status.auth !== expectedAuth[status.state]) {
    context.addIssue({ code: "custom", path: ["auth"], message: "Assistant state and authentication category disagree" });
  }
  if (status.state === "ready" && status.sdkVersion !== "0.147.0") {
    context.addIssue({ code: "custom", path: ["sdkVersion"], message: "A ready provider requires the selected SDK version" });
  }
});

const assistantExplainContextSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("selected_track"), selectedTrackId: idSchema }),
  z.strictObject({ kind: z.literal("next"), selectedTrackId: idSchema, intent: discoveryIntentSchema }),
  z.strictObject({ kind: z.literal("draft"), draftId: idSchema, expectedRevision: revisionSchema }),
]);

export const assistantTaskRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("search"), prompt: assistantPromptSchema, selectedTrackId: idSchema.optional() }),
  z.strictObject({ kind: z.literal("plan"), prompt: assistantPromptSchema, selectedTrackId: idSchema.optional() }),
  z.strictObject({
    kind: z.literal("revise"),
    prompt: assistantPromptSchema,
    draftId: idSchema,
    expectedRevision: revisionSchema,
  }),
  z.strictObject({ kind: z.literal("explain"), prompt: assistantPromptSchema, context: assistantExplainContextSchema }),
]);

const assistantConfirmedMutationSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("rename"), title: z.string().min(1).max(200) }),
  z.strictObject({ type: z.literal("set_plan"), plan: setDraftPlanSchema }),
  z.strictObject({ type: z.literal("move_entry"), entryId: idSchema, toIndex: indexSchema }),
  z.strictObject({ type: z.literal("set_track_pin"), entryId: idSchema, pinned: z.boolean() }),
  z.strictObject({ type: z.literal("set_position_pin"), entryId: idSchema, pinned: z.boolean() }),
  z.strictObject({ type: z.literal("remove_entry"), entryId: idSchema }),
  z.strictObject({ type: z.literal("ban_entry"), entryId: idSchema }),
  z.strictObject({ type: z.literal("replace_entry"), entryId: idSchema, replacementTrackId: idSchema }),
  z.strictObject({
    type: z.literal("set_entry_goal"),
    entryId: idSchema,
    role: setRoleSchema.nullable(),
    targetEnergyPpm: ppmSchema.nullable(),
  }),
  z.strictObject({ type: z.literal("optimize") }),
]);

export const assistantProposalSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("plan"),
    proposalId: idSchema,
    summary: assistantSummarySchema,
    title: z.string().trim().min(1).max(200),
    plan: setDraftPlanSchema,
    source: z.strictObject({
      kind: z.literal("generated"),
      seedTrackId: idSchema.optional(),
      maxTracks: z.number().int().min(1).max(50),
    }),
    expiresAt: z.string().min(1).max(64),
  }),
  z.strictObject({
    kind: z.literal("revision"),
    proposalId: idSchema,
    summary: assistantSummarySchema,
    draftId: idSchema,
    expectedRevision: revisionSchema,
    mutation: assistantConfirmedMutationSchema,
    evidenceTrackIds: z.array(idSchema).max(20).refine((ids) => new Set(ids).size === ids.length, "Evidence track IDs must be unique"),
    expiresAt: z.string().min(1).max(64),
  }),
]);

export const assistantSearchResultSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("filters"), summary: assistantSummarySchema, filters: trackFiltersSchema, response: trackPageSchema }),
  z.strictObject({
    mode: z.literal("similar"),
    summary: assistantSummarySchema,
    seedTrackId: idSchema,
    response: similarityResponseSchema,
  }),
  z.strictObject({
    mode: z.literal("next"),
    summary: assistantSummarySchema,
    seedTrackId: idSchema,
    intent: discoveryIntentSchema,
    response: recommendationResponseSchema,
  }),
  z.strictObject({ mode: z.literal("unsupported"), reason: assistantSummarySchema }),
]);

const assistantErrorCodeSchema = z.enum([
  "signed_out",
  "unsupported_auth",
  "timeout",
  "cancelled",
  "invalid_response",
  "invalid_context",
  "conflict",
  "unavailable",
  "unknown",
]);

export const assistantEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    sequence: assistantSequenceSchema,
    type: z.literal("activity"),
    activity: z.enum(["checking_auth", "interpreting", "searching_local", "preparing_proposal", "explaining", "validating"]),
  }),
  z.strictObject({ sequence: assistantSequenceSchema, type: z.literal("text_snapshot"), text: assistantTextSchema }),
  z.strictObject({ sequence: assistantSequenceSchema, type: z.literal("search_result"), result: assistantSearchResultSchema }),
  z.strictObject({ sequence: assistantSequenceSchema, type: z.literal("proposal"), proposal: assistantProposalSchema }),
  z.strictObject({
    sequence: assistantSequenceSchema,
    type: z.literal("completed"),
    evidenceTrackIds: z.array(idSchema).max(20).refine((ids) => new Set(ids).size === ids.length, "Evidence track IDs must be unique"),
  }),
  z.strictObject({ sequence: assistantSequenceSchema, type: z.literal("cancelled") }),
  z.strictObject({
    sequence: assistantSequenceSchema,
    type: z.literal("failed"),
    error: z.strictObject({ code: assistantErrorCodeSchema, message: z.string().min(1).max(500) }),
  }),
]);

export const assistantStartResultSchema = z.strictObject({ requestId: idSchema });
export const assistantPollRequestSchema = z.strictObject({ requestId: idSchema, afterSequence: assistantSequenceSchema });
export const assistantPollResultSchema = z.strictObject({
  events: z.array(assistantEventSchema).max(50),
  nextSequence: assistantSequenceSchema,
  terminal: z.boolean(),
}).superRefine((result, context) => {
  let previous = -1;
  result.events.forEach((event, index) => {
    if (event.sequence <= previous) {
      context.addIssue({ code: "custom", path: ["events", index, "sequence"], message: "Event sequence must be strictly increasing" });
    }
    previous = event.sequence;
    if ((event.type === "completed" || event.type === "cancelled" || event.type === "failed") && index !== result.events.length - 1) {
      context.addIssue({ code: "custom", path: ["events", index], message: "A terminal event must be last" });
    }
  });
  if (result.events.length > 0 && result.nextSequence < result.events[result.events.length - 1]!.sequence) {
    context.addIssue({ code: "custom", path: ["nextSequence"], message: "Next sequence cannot precede returned events" });
  }
});
export const assistantCancelRequestSchema = z.strictObject({ requestId: idSchema });
export const assistantCancelResultSchema = z.strictObject({ status: z.enum(["cancelled", "already_terminal", "not_found"]) });
export const assistantConfirmRequestSchema = z.strictObject({ requestId: idSchema, proposalId: idSchema });
export const assistantConfirmResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("created"), snapshot: setDraftSnapshotSchema }),
  z.strictObject({ status: z.literal("updated"), snapshot: setDraftSnapshotSchema }),
  z.strictObject({ status: z.literal("conflict"), currentRevision: revisionSchema }),
  z.strictObject({
    status: z.literal("blocked"),
    code: z.enum(["not_found", "expired", "mismatch", "stale", "invalid", "unavailable"]),
    message: z.string().min(1).max(500),
  }),
]);

export const privateExportPreviewRequestSchema = z.strictObject({
  draftId: idSchema,
  expectedRevision: revisionSchema,
  destinationPath: z.string().min(1).max(4_096),
  expectedDestinationState: z.enum(["absent", "regular_file"]),
});

export const privateExportPreviewResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ready"),
    draftId: idSchema,
    revision: revisionSchema,
    playlistName: z.string().min(1).max(200),
    trackCount: z.number().int().min(0).max(100),
    knownDurationMs: nonnegativeIntegerSchema,
    unknownDurationCount: nonnegativeIntegerSchema,
    warnings: z.array(z.string().min(1).max(500)).max(20),
    expectedDestinationState: z.enum(["absent", "regular_file"]),
  }),
  z.strictObject({
    status: z.literal("blocked"),
    reasons: z.array(exportReasonSchema).min(1).max(20),
    destinationState: z.literal("unchanged"),
  }),
]);

const requestBase = {
  version: z.literal(1),
  id: idSchema,
};

export const coreRequestSchema = z.discriminatedUnion("command", [
  z.strictObject({
    ...requestBase,
    command: z.literal("health"),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("import_library"),
    payload: z.strictObject({ sourcePath: z.string().min(1).max(4_096) }),
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("get_playlist_tree"),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("list_tracks"),
    payload: trackPageQuerySchema,
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("find_similar_tracks"),
    payload: findSimilarRequestSchema,
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("recommend_next_tracks"),
    payload: recommendNextRequestSchema,
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("get_track_metadata"),
    payload: trackMetadataGetRequestSchema,
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("update_track_metadata"),
    payload: trackMetadataUpdateRequestSchema,
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("list_saved_filters"),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("save_saved_filter"),
    payload: savedFilterSaveRequestSchema,
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("delete_saved_filter"),
    payload: savedFilterDeleteRequestSchema,
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("get_preference_profile"),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("record_feedback"),
    payload: recordFeedbackRequestSchema,
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("compare_recommendations"),
    payload: compareRecommendationsRequestSchema,
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("reset_preferences"),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("get_preference_export"),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("queue_analysis"),
    payload: analysisQueueRequestSchema,
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("get_analysis_status"),
    payload: analysisStatusQuerySchema,
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("pause_analysis"),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("resume_analysis"),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("list_set_drafts"),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("create_set_draft"),
    payload: setDraftCreateRequestSchema,
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("get_set_draft"),
    payload: setDraftGetRequestSchema,
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("mutate_set_draft"),
    payload: setDraftMutationRequestSchema,
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("find_set_replacements"),
    payload: setDraftReplacementRequestSchema,
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("analyze_set"),
    payload: setDraftInspectRequestSchema,
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("preview_set_export"),
    payload: privateExportPreviewRequestSchema,
  }),
  z.strictObject({
    ...requestBase,
    command: z.literal("export_set_draft"),
    payload: privateExportPreviewRequestSchema,
  }),
]);

export const coreResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    version: z.literal(1),
    id: idSchema,
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.strictObject({
    version: z.literal(1),
    id: idSchema,
    ok: z.literal(false),
    error: z.strictObject({
      code: z.string().min(1).max(64),
      message: messageSchema,
      preservedPreviousLibrary: z.boolean().optional(),
    }),
  }),
]);

export type AppStatus = z.infer<typeof appStatusSchema>;
export type TrackListItem = z.infer<typeof trackListItemSchema>;
export type TrackFilters = z.input<typeof trackFiltersSchema>;
export type TrackPageQuery = z.input<typeof trackPageQuerySchema>;
export type TrackPage = z.infer<typeof trackPageSchema>;
export type DiscoveryIntent = z.infer<typeof discoveryIntentSchema>;
export type FindSimilarRequest = z.input<typeof findSimilarRequestSchema>;
export type RecommendNextRequest = z.input<typeof recommendNextRequestSchema>;
export type DiscoveryTrack = z.infer<typeof discoveryTrackSchema>;
export type ScoreComponent = z.infer<typeof scoreComponentSchema>;
export type DiscoveryCandidate = z.infer<typeof discoveryCandidateSchema>;
export type SimilarityResponse = z.infer<typeof similarityResponseSchema>;
export type RecommendationResponse = z.infer<typeof recommendationResponseSchema>;
export type TrackMetadata = z.infer<typeof trackMetadataSchema>;
export type TrackMetadataUpdateRequest = z.infer<typeof trackMetadataUpdateRequestSchema>;
export type SavedFilter = z.infer<typeof savedFilterSchema>;
export type SavedFilterSaveRequest = z.infer<typeof savedFilterSaveRequestSchema>;
export type RecordFeedbackRequest = z.infer<typeof recordFeedbackRequestSchema>;
export type PreferenceProfile = z.infer<typeof preferenceProfileSchema>;
export type CompareRecommendationsRequest = z.input<typeof compareRecommendationsRequestSchema>;
export type CompareRecommendationsResponse = z.infer<typeof compareRecommendationsResponseSchema>;
export type PreferenceResetResult = z.infer<typeof preferenceResetResultSchema>;
export type PreferenceExportSnapshot = z.infer<typeof preferenceExportSnapshotSchema>;
export type PreferenceExportPrepareResult = z.infer<typeof preferenceExportPrepareResultSchema>;
export type PreferenceExportConfirmResult = z.infer<typeof preferenceExportConfirmResultSchema>;
export type PlaylistTreeNode = z.infer<typeof playlistTreeNodeSchema>;
export type ImportSummary = z.infer<typeof importSummarySchema>;
export type ImportResult = z.infer<typeof importResultSchema>;
export type AnalysisFeatures = z.infer<typeof analysisFeaturesSchema>;
export type AnalysisCapabilities = z.infer<typeof analysisCapabilitiesSchema>;
export type AnalysisSummary = z.infer<typeof analysisSummarySchema>;
export type AnalysisQueueStatus = z.infer<typeof analysisQueueStatusSchema>;
export type AnalysisTrackIds = z.infer<typeof analysisTrackIdsSchema>;
export type SetDraftPlan = z.infer<typeof setDraftPlanSchema>;
export type SetDraftCreateRequest = z.infer<typeof setDraftCreateRequestSchema>;
export type SetDraftGetRequest = z.infer<typeof setDraftGetRequestSchema>;
export type SetDraftMutationRequest = z.infer<typeof setDraftMutationRequestSchema>;
export type SetDraftReplacementRequest = z.infer<typeof setDraftReplacementRequestSchema>;
export type SetDraftInspectRequest = z.infer<typeof setDraftInspectRequestSchema>;
export type SetDraftListResult = z.infer<typeof setDraftListResultSchema>;
export type SetDraftSnapshot = z.infer<typeof setDraftSnapshotSchema>;
export type SetDraftMutationResult = z.infer<typeof setDraftMutationResultSchema>;
export type SetDraftReplacementResult = z.infer<typeof setDraftReplacementResultSchema>;
export type SetDraftInspectResult = z.infer<typeof setDraftInspectResultSchema>;
export type ExportPrepareResult = z.infer<typeof exportPrepareResultSchema>;
export type ExportConfirmResult = z.infer<typeof exportConfirmResultSchema>;
export type AssistantAuthStatus = z.infer<typeof assistantAuthStatusSchema>;
export type AssistantTaskRequest = z.infer<typeof assistantTaskRequestSchema>;
export type AssistantProposal = z.infer<typeof assistantProposalSchema>;
export type AssistantSearchResult = z.infer<typeof assistantSearchResultSchema>;
export type AssistantEvent = z.infer<typeof assistantEventSchema>;
export type AssistantStartResult = z.infer<typeof assistantStartResultSchema>;
export type AssistantPollResult = z.infer<typeof assistantPollResultSchema>;
export type AssistantCancelResult = z.infer<typeof assistantCancelResultSchema>;
export type AssistantConfirmResult = z.infer<typeof assistantConfirmResultSchema>;
export type CoreRequest = z.infer<typeof coreRequestSchema>;
export type CoreResponse = z.infer<typeof coreResponseSchema>;

export interface DesktopApi {
  system: {
    getStatus(): Promise<AppStatus>;
  };
  library: {
    importXml(): Promise<ImportResult>;
    getPlaylistTree(): Promise<PlaylistTreeNode[]>;
    listTracks(query?: TrackPageQuery): Promise<TrackPage>;
    getTrackMetadata(trackId: string): Promise<TrackMetadata>;
    updateTrackMetadata(request: TrackMetadataUpdateRequest): Promise<TrackMetadata>;
    listSavedFilters(): Promise<{ items: SavedFilter[] }>;
    saveSavedFilter(request: SavedFilterSaveRequest): Promise<SavedFilter>;
    deleteSavedFilter(id: string): Promise<{ deleted: true }>;
  };
  analysis: {
    queue(trackIds: string[]): Promise<AnalysisQueueStatus>;
    getStatus(trackIds?: string[]): Promise<AnalysisQueueStatus>;
    pause(): Promise<AnalysisQueueStatus>;
    resume(): Promise<AnalysisQueueStatus>;
  };
  discovery: {
    findSimilar(request: FindSimilarRequest): Promise<SimilarityResponse>;
    recommendNext(request: RecommendNextRequest): Promise<RecommendationResponse>;
  };
  preferences: {
    getProfile(): Promise<PreferenceProfile>;
    recordFeedback(request: RecordFeedbackRequest): Promise<{ recorded: true; profile: PreferenceProfile }>;
    compareRecommendations(request: CompareRecommendationsRequest): Promise<CompareRecommendationsResponse>;
    reset(): Promise<PreferenceResetResult>;
    prepareExport(): Promise<PreferenceExportPrepareResult>;
    confirmExport(confirmationId: string): Promise<PreferenceExportConfirmResult>;
  };
  assistant: {
    getStatus(): Promise<AssistantAuthStatus>;
    beginLogin(): Promise<AssistantAuthStatus>;
    start(request: AssistantTaskRequest): Promise<AssistantStartResult>;
    poll(requestId: string, afterSequence: number): Promise<AssistantPollResult>;
    cancel(requestId: string): Promise<AssistantCancelResult>;
    confirm(requestId: string, proposalId: string): Promise<AssistantConfirmResult>;
  };
  sets: {
    list(): Promise<SetDraftListResult>;
    create(request: SetDraftCreateRequest): Promise<SetDraftSnapshot>;
    get(request: SetDraftGetRequest): Promise<SetDraftSnapshot>;
    mutate(request: SetDraftMutationRequest): Promise<SetDraftMutationResult>;
    findReplacements(request: SetDraftReplacementRequest): Promise<SetDraftReplacementResult>;
    inspect(request: SetDraftInspectRequest): Promise<SetDraftInspectResult>;
  };
  exports: {
    prepare(request: { draftId: string; expectedRevision: number }): Promise<ExportPrepareResult>;
    confirm(request: { confirmationId: string }): Promise<ExportConfirmResult>;
  };
}
