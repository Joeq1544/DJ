import { describe, expect, it } from "vitest";
import {
  exportConfirmRequestSchema,
  exportPrepareRequestSchema,
  exportPrepareResultSchema,
  setDraftCreateRequestSchema,
  setDraftGetRequestSchema,
  setDraftInspectRequestSchema,
  setDraftInspectResultSchema,
  setDraftMutationRequestSchema,
  setDraftReplacementRequestSchema,
} from "../src/shared/contracts";

const plan = {
  intent: "smooth",
  targetDurationMs: null,
  maxArtistRepeats: null,
  candidateFilters: {},
};

describe("M4 set contracts", () => {
  it("accepts each closed creation source and rejects unknown fields, invalid bounds, and external IDs", () => {
    const base = { title: "Friday set", plan };
    for (const source of [
      { kind: "empty" },
      { kind: "tracks", trackIds: ["track-1", "track-2"] },
      { kind: "playlist", playlistId: "playlist-1" },
      { kind: "generated", seedTrackId: "track-1", maxTracks: 50 },
    ]) {
      expect(setDraftCreateRequestSchema.parse({ ...base, source })).toMatchObject({ source });
    }
    expect(setDraftCreateRequestSchema.safeParse({ ...base, source: { kind: "tracks", trackIds: ["track-1", "track-1"] } }).success).toBe(false);
    expect(setDraftCreateRequestSchema.safeParse({ ...base, source: { kind: "generated", maxTracks: 51 } }).success).toBe(false);
    expect(setDraftCreateRequestSchema.safeParse({ ...base, source: { kind: "playlist", playlistId: "playlist-1", externalId: "42" } }).success).toBe(false);
    expect(setDraftCreateRequestSchema.safeParse({ ...base, source: { kind: "empty", sourcePath: "/private/library.xml" } }).success).toBe(false);
    expect(setDraftCreateRequestSchema.safeParse({ ...base, plan: { ...plan, targetDurationMs: 899_999 } }).success).toBe(false);
    expect(setDraftCreateRequestSchema.safeParse({ ...base, plan: { ...plan, candidateFilters: { bpmMinMilli: 130_000, bpmMaxMilli: 120_000 } } }).success).toBe(false);
  });

  it("accepts only the documented mutation union with a current revision", () => {
    const base = { draftId: "draft-1", expectedRevision: 2 };
    const mutations = [
      { type: "rename", title: "Afterhours" },
      { type: "set_plan", plan },
      { type: "insert_track", trackId: "track-2", toIndex: 0 },
      { type: "move_entry", entryId: "entry-1", toIndex: 3 },
      { type: "set_track_pin", entryId: "entry-1", pinned: true },
      { type: "set_position_pin", entryId: "entry-1", pinned: false },
      { type: "remove_entry", entryId: "entry-1" },
      { type: "ban_entry", entryId: "entry-1" },
      { type: "unban_track", trackId: "track-1" },
      { type: "replace_entry", entryId: "entry-1", replacementTrackId: "track-2" },
      { type: "set_entry_goal", entryId: "entry-1", role: "build", targetEnergyPpm: 700_000 },
      { type: "optimize" },
      { type: "undo" },
      { type: "redo" },
      { type: "save_version", label: "First pass" },
      { type: "restore_version", version: 1 },
    ];
    for (const mutation of mutations) expect(setDraftMutationRequestSchema.parse({ ...base, mutation })).toMatchObject({ mutation });
    expect(setDraftMutationRequestSchema.safeParse({ ...base, mutation: { type: "optimize", entryId: "entry-1" } }).success).toBe(false);
    expect(setDraftMutationRequestSchema.safeParse({ ...base, mutation: { type: "set_entry_goal", entryId: "entry-1", role: "nope", targetEnergyPpm: 0 } }).success).toBe(false);
    expect(setDraftMutationRequestSchema.safeParse({ ...base, expectedRevision: 0, mutation: { type: "undo" } }).success).toBe(false);
  });

  it("keeps every public payload path-free and uses current app IDs", () => {
    expect(setDraftGetRequestSchema.safeParse({ draftId: "draft-1", revision: 4, sourcePath: "/private/library.xml" }).success).toBe(false);
    expect(setDraftReplacementRequestSchema.safeParse({ draftId: "draft-1", entryId: "entry-1", revision: 1, externalTrackId: "42" }).success).toBe(false);
    expect(setDraftInspectRequestSchema.parse({ kind: "draft", draftId: "draft-1", revision: 1 })).toMatchObject({ kind: "draft" });
    expect(setDraftInspectRequestSchema.parse({ kind: "playlist", playlistId: "playlist-1" })).toMatchObject({ kind: "playlist" });
    expect(setDraftInspectRequestSchema.safeParse({ kind: "playlist", playlistId: "playlist-1", revision: 1 }).success).toBe(false);
    expect(exportPrepareRequestSchema.safeParse({ draftId: "draft-1", expectedRevision: 1, destinationPath: "/tmp/out.xml" }).success).toBe(false);
    expect(exportConfirmRequestSchema.safeParse({ confirmationId: "", destinationPath: "/tmp/out.xml" }).success).toBe(false);
  });

  it("returns bounded, path-free inspection and export preparation results", () => {
    const inspection = {
      sourcePositionCount: 101,
      inspectedPositionCount: 100,
      inputTruncated: true,
      knownDurationMs: 1_200_000,
      unknownDurationCount: 1,
      points: [],
      transitions: [],
      warnings: [],
      matchedWarningCount: 0,
      warningsTruncated: false,
      scannedCount: 25_000,
      scanTruncated: true,
      organizationLabel: "Suggestions only—nothing has changed in Rekordbox.",
      organizationSuggestions: [],
      matchedSuggestionCount: 0,
      suggestionsTruncated: false,
    };
    expect(setDraftInspectResultSchema.parse(inspection)).toEqual(inspection);
    expect(setDraftInspectResultSchema.safeParse({ ...inspection, sourcePath: "/private/library.xml" }).success).toBe(false);
    expect(setDraftInspectResultSchema.safeParse({ ...inspection, inspectedPositionCount: 101 }).success).toBe(false);
    const ready = {
      status: "ready",
      confirmationId: "confirmation-1",
      playlistName: "Friday set",
      trackCount: 4,
      knownDurationMs: 720_000,
      unknownDurationCount: 0,
      destinationDisplay: "Friday set.xml",
      willReplaceExisting: false,
      warnings: [],
    };
    expect(exportPrepareResultSchema.parse(ready)).toEqual(ready);
    expect(exportPrepareResultSchema.safeParse({ ...ready, destinationPath: "/private/out.xml" }).success).toBe(false);
  });
});
