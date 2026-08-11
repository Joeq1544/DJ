import type {
  DiscoveryCandidate,
  DiscoveryTrack,
  RecommendationResponse,
  SetDraftInspectResult,
  SetDraftSnapshot,
  SimilarityResponse,
} from "../../shared/contracts";

export const ASSISTANT_EVIDENCE_TRACK_LIMIT = 20;
export const ASSISTANT_DRAFT_ENTRY_LIMIT = 100;
export const ASSISTANT_CONTEXT_BYTE_LIMIT = 131_072;

const CONTEXT_TEXT_BYTE_LIMIT = 80;

function compactText(value: string | null): string | null {
  if (value === null) return null;
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > CONTEXT_TEXT_BYTE_LIMIT) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function deepFreeze<Value>(value: Value): Readonly<Value> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export interface AssistantTrackContext {
  trackId: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  bpmMilli: number | null;
  musicalKey: string | null;
  durationMs: number | null;
  availability: DiscoveryTrack["availability"];
}

export function buildTrackContext(track: DiscoveryTrack): Readonly<AssistantTrackContext> {
  return deepFreeze({
    trackId: track.id,
    title: compactText(track.title),
    artist: compactText(track.artist),
    album: compactText(track.album),
    genre: compactText(track.genre),
    bpmMilli: track.bpmMilli,
    musicalKey: compactText(track.musicalKey),
    durationMs: track.durationMs,
    availability: track.availability,
  });
}

function compactCandidate(candidate: DiscoveryCandidate) {
  return {
    track: buildTrackContext(candidate.track),
    scorePpm: candidate.scorePpm,
    confidencePpm: candidate.confidencePpm,
    reasons: candidate.reasons.map((reason) => compactText(reason) ?? ""),
    components: candidate.components.map((component) => ({
      name: component.name,
      scorePpm: component.scorePpm,
      weightPpm: component.weightPpm,
      contributionSignedPpm: component.contributionSignedPpm,
      effect: component.effect,
      reason: compactText(component.reason) ?? "",
    })),
  };
}

export function buildSelectedTrackContext(response: SimilarityResponse) {
  return deepFreeze({ selectedTrack: buildTrackContext(response.seed) });
}

export function buildDiscoveryContext(response: SimilarityResponse | RecommendationResponse) {
  const candidateLimit = ASSISTANT_EVIDENCE_TRACK_LIMIT - 1;
  return deepFreeze({
    seed: buildTrackContext(response.seed),
    ...(response.algorithmVersion.startsWith("transition-") && "intent" in response
      ? { intent: response.intent }
      : {}),
    algorithmVersion: response.algorithmVersion,
    scannedCount: response.scannedCount,
    truncated: response.truncated,
    candidates: response.items.slice(0, candidateLimit).map(compactCandidate),
    candidatesTruncated: response.items.length > candidateLimit,
  });
}

export function buildDraftContext(snapshot: SetDraftSnapshot) {
  const entries = snapshot.entries.slice(0, ASSISTANT_DRAFT_ENTRY_LIMIT).map((entry) => ({
    entryId: entry.id,
    trackId: entry.trackId,
    track: entry.track === null ? null : buildTrackContext(entry.track),
    resolution: entry.resolution,
    bpmMilli: entry.bpmMilli,
    musicalKey: compactText(entry.musicalKey),
    energyPpm: entry.energyPpm,
    trackPinned: entry.trackPinned,
    positionPinned: entry.positionPinned,
    role: entry.role,
    targetEnergyPpm: entry.targetEnergyPpm,
  }));
  return deepFreeze({
    draftId: snapshot.draftId,
    currentRevision: snapshot.currentRevision,
    contentRevision: snapshot.contentRevision,
    title: compactText(snapshot.title) ?? "",
    plan: {
      intent: snapshot.plan.intent,
      targetDurationMs: snapshot.plan.targetDurationMs,
      maxArtistRepeats: snapshot.plan.maxArtistRepeats,
      candidateFilters: { ...snapshot.plan.candidateFilters },
    },
    entries,
    entriesTruncated: snapshot.entries.length > ASSISTANT_DRAFT_ENTRY_LIMIT,
    bannedTrackIds: snapshot.bans.slice(0, ASSISTANT_DRAFT_ENTRY_LIMIT),
    bansTruncated: snapshot.bans.length > ASSISTANT_DRAFT_ENTRY_LIMIT,
    knownDurationMs: snapshot.knownDurationMs,
    unknownDurationCount: snapshot.unknownDurationCount,
    unmetConstraintCodes: snapshot.unmetConstraints.slice(0, 20).map(({ code }) => code),
    canUndo: snapshot.canUndo,
    canRedo: snapshot.canRedo,
  });
}

export function buildDraftExplanationContext(snapshot: SetDraftSnapshot, inspection: SetDraftInspectResult) {
  const draft = buildDraftContext({
    ...snapshot,
    entries: snapshot.entries.slice(0, ASSISTANT_EVIDENCE_TRACK_LIMIT),
  });
  return deepFreeze({
    draft,
    inspection: {
      sourcePositionCount: inspection.sourcePositionCount,
      inspectedPositionCount: Math.min(inspection.inspectedPositionCount, ASSISTANT_EVIDENCE_TRACK_LIMIT),
      inputTruncated: inspection.inputTruncated || inspection.points.length > ASSISTANT_EVIDENCE_TRACK_LIMIT,
      knownDurationMs: inspection.knownDurationMs,
      unknownDurationCount: inspection.unknownDurationCount,
      points: inspection.points.slice(0, ASSISTANT_EVIDENCE_TRACK_LIMIT).map((point) => ({
        position: point.position,
        entryId: point.entryId,
        trackId: point.trackId,
        track: point.track === null ? null : buildTrackContext(point.track),
        resolution: point.resolution,
        bpmMilli: point.bpmMilli,
        musicalKey: compactText(point.musicalKey),
        energyPpm: point.energyPpm,
        energyDirection: point.energyDirection,
        bpmDirection: point.bpmDirection,
      })),
      transitions: inspection.transitions.slice(0, ASSISTANT_EVIDENCE_TRACK_LIMIT).map((transition) => ({
        fromPosition: transition.fromPosition,
        toPosition: transition.toPosition,
        scorePpm: transition.scorePpm,
        confidencePpm: transition.confidencePpm,
        utilitySignedPpm: transition.utilitySignedPpm,
        reasons: transition.reasons.map((reason) => compactText(reason) ?? ""),
        components: transition.components.map((component) => ({
          name: component.name,
          scorePpm: component.scorePpm,
          weightPpm: component.weightPpm,
          contributionSignedPpm: component.contributionSignedPpm,
          effect: component.effect,
          reason: compactText(component.reason) ?? "",
        })),
      })),
      warningCodes: inspection.warnings.slice(0, 20).map(({ code }) => code),
    },
  });
}

export function serializeAssistantContext(context: unknown): string {
  const serialized = JSON.stringify(context);
  if (Buffer.byteLength(serialized, "utf8") > ASSISTANT_CONTEXT_BYTE_LIMIT) {
    throw new Error("Assistant context exceeds its safe bound");
  }
  return serialized;
}

export function collectContextTrackIds(context: unknown): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if ((key === "trackId" || key === "seedTrackId" || key === "replacementTrackId") && typeof child === "string") {
        ids.add(child);
      }
      visit(child);
    }
  };
  visit(context);
  return [...ids].slice(0, ASSISTANT_EVIDENCE_TRACK_LIMIT + ASSISTANT_DRAFT_ENTRY_LIMIT);
}

export function collectContextNumbers(context: unknown): ReadonlySet<string> {
  const numbers = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "number" && Number.isFinite(value)) {
      numbers.add(String(value));
      return;
    }
    if (typeof value === "string") {
      const numericPattern = /(?<![\p{L}\p{N}_-])-?\d[\d,]*(?:\.\d+)?(?![\p{L}\p{N}_])/gu;
      for (const match of value.matchAll(numericPattern)) {
        numbers.add(match[0].replaceAll(",", ""));
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const child of Object.values(value)) visit(child);
  };
  visit(context);
  return numbers;
}
