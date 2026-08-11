import { z } from "zod";

const idSchema = z.string().min(1).max(128);
const messageSchema = z.string().min(1).max(500);
const displayTextSchema = z.string().max(1_000).nullable();

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
}
