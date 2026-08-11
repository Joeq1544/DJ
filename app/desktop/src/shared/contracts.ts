import { z } from "zod";

const idSchema = z.string().min(1).max(128);
const messageSchema = z.string().min(1).max(500);
const displayTextSchema = z.string().max(1_000).nullable();
const nonnegativeIntegerSchema = z.number().int().nonnegative();
const ppmSchema = z.number().int().min(0).max(1_000_000);
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
});

export const trackPageQuerySchema = z.strictObject({
  playlistId: idSchema.optional(),
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.number().int().min(1).max(200).default(100),
});

export const trackPageSchema = z.strictObject({
  items: z.array(trackListItemSchema).max(200),
  nextCursor: z.string().min(1).max(2_048).nullable(),
});

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
export type TrackPageQuery = z.input<typeof trackPageQuerySchema>;
export type TrackPage = z.infer<typeof trackPageSchema>;
export type PlaylistTreeNode = z.infer<typeof playlistTreeNodeSchema>;
export type ImportSummary = z.infer<typeof importSummarySchema>;
export type ImportResult = z.infer<typeof importResultSchema>;
export type AnalysisFeatures = z.infer<typeof analysisFeaturesSchema>;
export type AnalysisCapabilities = z.infer<typeof analysisCapabilitiesSchema>;
export type AnalysisSummary = z.infer<typeof analysisSummarySchema>;
export type AnalysisQueueStatus = z.infer<typeof analysisQueueStatusSchema>;
export type AnalysisTrackIds = z.infer<typeof analysisTrackIdsSchema>;
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
  };
  analysis: {
    queue(trackIds: string[]): Promise<AnalysisQueueStatus>;
    getStatus(trackIds?: string[]): Promise<AnalysisQueueStatus>;
    pause(): Promise<AnalysisQueueStatus>;
    resume(): Promise<AnalysisQueueStatus>;
  };
}
