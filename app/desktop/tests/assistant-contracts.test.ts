import { describe, expect, it } from "vitest";
import {
  assistantAuthStatusSchema,
  assistantConfirmResultSchema,
  assistantEventSchema,
  assistantPollResultSchema,
  assistantProposalSchema,
  assistantTaskRequestSchema,
  coreRequestSchema,
} from "../src/shared/contracts";

const plan = {
  intent: "build",
  targetDurationMs: 3_600_000,
  maxArtistRepeats: 2,
  candidateFilters: { genre: "House" },
} as const;

describe("M6 assistant contracts", () => {
  it("accepts only the four bounded public request variants", () => {
    expect(assistantTaskRequestSchema.parse({
      kind: "search",
      prompt: "  warm house around 124 BPM  ",
      selectedTrackId: "track-1",
    })).toEqual({
      kind: "search",
      prompt: "warm house around 124 BPM",
      selectedTrackId: "track-1",
    });
    expect(assistantTaskRequestSchema.safeParse({
      kind: "plan",
      prompt: "Build a one-hour sunset set",
      selectedTrackId: "track-1",
    }).success).toBe(true);
    expect(assistantTaskRequestSchema.safeParse({
      kind: "revise",
      prompt: "Move the closer earlier",
      draftId: "draft-1",
      expectedRevision: 3,
    }).success).toBe(true);
    expect(assistantTaskRequestSchema.safeParse({
      kind: "explain",
      prompt: "Why does this transition work?",
      context: { kind: "next", selectedTrackId: "track-1", intent: "smooth" },
    }).success).toBe(true);

    expect(assistantTaskRequestSchema.safeParse({ kind: "chat", prompt: "Hello" }).success).toBe(false);
    expect(assistantTaskRequestSchema.safeParse({ kind: "search", prompt: "x", path: "/Music" }).success).toBe(false);
    expect(assistantTaskRequestSchema.safeParse({ kind: "revise", prompt: "Rename it", draftId: "draft-1" }).success).toBe(false);
    expect(assistantTaskRequestSchema.safeParse({
      kind: "explain",
      prompt: "Explain",
      context: { kind: "draft", draftId: "draft-1" },
    }).success).toBe(false);
    expect(assistantTaskRequestSchema.safeParse({ kind: "search", prompt: "x".repeat(2_001) }).success).toBe(false);
  });

  it("requires a sanitized existing-ChatGPT status", () => {
    expect(assistantAuthStatusSchema.parse({
      state: "ready",
      auth: "chatgpt",
      message: "Codex is ready.",
      sdkVersion: "0.147.0",
    }).state).toBe("ready");
    expect(assistantAuthStatusSchema.safeParse({
      state: "ready",
      auth: "other",
      message: "API key sk-secret",
      sdkVersion: "0.147.0",
    }).success).toBe(false);
    expect(assistantAuthStatusSchema.safeParse({
      state: "signed_out",
      auth: "none",
      message: "Sign in with ChatGPT.",
      sdkVersion: null,
      rawOutput: "secret",
    }).success).toBe(false);
  });

  it("builds public proposals only from existing filter, plan, and mutation schemas", () => {
    expect(assistantProposalSchema.safeParse({
      kind: "plan",
      proposalId: "proposal-1",
      summary: "A compact one-hour build.",
      title: "Sunset build",
      plan,
      source: { kind: "generated", seedTrackId: "track-1", maxTracks: 20 },
      expiresAt: "2026-08-11T12:00:00.000Z",
    }).success).toBe(true);
    expect(assistantProposalSchema.safeParse({
      kind: "revision",
      proposalId: "proposal-2",
      summary: "Move the closer to position four.",
      draftId: "draft-1",
      expectedRevision: 3,
      mutation: { type: "move_entry", entryId: "entry-1", toIndex: 3 },
      evidenceTrackIds: ["track-1"],
      expiresAt: "2026-08-11T12:00:00.000Z",
    }).success).toBe(true);
    expect(assistantProposalSchema.safeParse({
      kind: "revision",
      proposalId: "proposal-3",
      summary: "Run a command.",
      draftId: "draft-1",
      expectedRevision: 3,
      mutation: { type: "shell", command: "open /Music" },
      evidenceTrackIds: [],
      expiresAt: "2026-08-11T12:00:00.000Z",
    }).success).toBe(false);
    expect(assistantProposalSchema.safeParse({
      kind: "plan",
      proposalId: "proposal-4",
      summary: "Bad source.",
      title: "Bad",
      plan,
      source: { kind: "tracks", trackIds: ["invented-id"] },
      expiresAt: "2026-08-11T12:00:00.000Z",
    }).success).toBe(false);
  });

  it("bounds ordered polling events and never exposes raw provider activity", () => {
    const events = [
      { sequence: 1, type: "activity", activity: "interpreting" },
      { sequence: 2, type: "text_snapshot", text: "This transition keeps the energy steady." },
      { sequence: 3, type: "completed", evidenceTrackIds: ["track-1", "track-2"] },
    ];
    expect(assistantPollResultSchema.parse({ events, nextSequence: 3, terminal: true })).toEqual({
      events,
      nextSequence: 3,
      terminal: true,
    });
    expect(assistantEventSchema.safeParse({
      sequence: 1,
      type: "activity",
      activity: "command_execution",
      command: "cat ~/.codex/auth.json",
    }).success).toBe(false);
    expect(assistantEventSchema.safeParse({
      sequence: 1,
      type: "text_snapshot",
      text: "x".repeat(8_001),
    }).success).toBe(false);
    expect(assistantPollResultSchema.safeParse({
      events: Array.from({ length: 51 }, (_, index) => ({
        sequence: index + 1,
        type: "activity",
        activity: "interpreting",
      })),
      nextSequence: 51,
      terminal: false,
    }).success).toBe(false);
  });

  it("uses strict current snapshot results for confirmed writes", () => {
    expect(assistantConfirmResultSchema.safeParse({
      status: "created",
      snapshot: {
        draftId: "draft-1",
        currentRevision: 1,
        contentRevision: 1,
        title: "Sunset build",
        plan,
        entries: [],
        bans: [],
        knownDurationMs: 0,
        unknownDurationCount: 0,
        unmetConstraints: [],
        canUndo: false,
        canRedo: false,
        versions: [],
        viewingVersion: null,
      },
    }).success).toBe(true);
    expect(assistantConfirmResultSchema.safeParse({ status: "conflict", currentRevision: 4 }).success).toBe(true);
    expect(assistantConfirmResultSchema.safeParse({
      status: "blocked",
      code: "expired",
      message: "This proposal expired. Ask Copilot again.",
    }).success).toBe(true);
    expect(assistantConfirmResultSchema.safeParse({
      status: "blocked",
      code: "arbitrary_shell",
      message: "No.",
    }).success).toBe(false);
  });

  it("keeps assistant orchestration out of the Python core protocol", () => {
    expect(coreRequestSchema.safeParse({
      version: 1,
      id: "request-1",
      command: "assistant_run",
      payload: { prompt: "Find house" },
    }).success).toBe(false);
  });
});
