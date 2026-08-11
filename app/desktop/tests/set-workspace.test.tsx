import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DesktopApi, SetDraftInspectResult, SetDraftSnapshot } from "../src/shared/contracts";
import { SetDraftLauncher } from "../src/renderer/src/features/sets/SetDraftLauncher";
import { SetWorkspace } from "../src/renderer/src/features/sets/SetWorkspace";

const snapshot = {
  draftId: "draft-1", currentRevision: 3, contentRevision: 3, title: "Friday set",
  plan: { intent: "build", targetDurationMs: 3_600_000, maxArtistRepeats: 2, candidateFilters: {} },
  entries: [
    { id: "entry-1", trackId: "track-1", track: { id: "track-1", title: "First", artist: "A", album: null, genre: "House", bpmMilli: 120_000, musicalKey: "8A", durationMs: 240_000, availability: "available" }, resolution: "resolved", bpmMilli: 120_000, musicalKey: "8A", energyPpm: 300_000, trackPinned: false, positionPinned: false, role: "warmup", targetEnergyPpm: 300_000 },
    { id: "entry-2", trackId: "track-2", track: { id: "track-2", title: "Second", artist: "B", album: null, genre: "House", bpmMilli: 124_000, musicalKey: "9A", durationMs: 240_000, availability: "available" }, resolution: "resolved", bpmMilli: 124_000, musicalKey: "9A", energyPpm: 700_000, trackPinned: true, positionPinned: false, role: "peak", targetEnergyPpm: 700_000 },
  ],
  bans: [], knownDurationMs: 480_000, unknownDurationCount: 0, unmetConstraints: [], canUndo: true, canRedo: true,
  versions: [{ version: 1, revision: 2, label: "Before peak" }], viewingVersion: null,
} as unknown as SetDraftSnapshot;

const inspection = {
  sourcePositionCount: 2, inspectedPositionCount: 2, inputTruncated: false, knownDurationMs: 480_000, unknownDurationCount: 0,
  points: [
    { position: 0, entryId: "entry-1", trackId: "track-1", track: snapshot.entries[0]!.track, resolution: "resolved", bpmMilli: 120_000, musicalKey: "8A", energyPpm: 300_000, energyDirection: "rise", bpmDirection: "rise" },
    { position: 1, entryId: "entry-2", trackId: "track-2", track: snapshot.entries[1]!.track, resolution: "resolved", bpmMilli: 124_000, musicalKey: "9A", energyPpm: 700_000, energyDirection: "rise", bpmDirection: "rise" },
  ],
  transitions: [{ fromPosition: 0, toPosition: 1, scorePpm: 800_000, confidencePpm: 700_000, utilitySignedPpm: 120_000, reasons: ["Energy rises cleanly."], components: [{ name: "energy", scorePpm: 800_000, weightPpm: 1_000_000, contributionSignedPpm: 120_000, effect: "bonus", reason: "Energy evidence." }] }],
  warnings: [], matchedWarningCount: 0, warningsTruncated: false, scannedCount: 2, scanTruncated: false,
  organizationLabel: "Suggestions only—nothing has changed in Rekordbox.", organizationSuggestions: [{ kind: "energy_group", label: "High energy", evidence: "Two tracks have high local energy.", trackIds: ["track-2"], matchedTrackCount: 1, trackIdsTruncated: false }], matchedSuggestionCount: 1, suggestionsTruncated: false,
} as unknown as SetDraftInspectResult;

function api() {
  return {
    sets: {
      list: vi.fn().mockResolvedValue({ items: [{ draftId: "draft-1", currentRevision: 3, title: "Friday set", trackCount: 2, knownDurationMs: 480_000, unknownDurationCount: 0 }] }),
      create: vi.fn().mockResolvedValue(snapshot), get: vi.fn().mockResolvedValue(snapshot),
      mutate: vi.fn().mockResolvedValue({ status: "updated", snapshot }),
      findReplacements: vi.fn().mockResolvedValue({ scannedCount: 2, scanTruncated: false, items: [{ track: snapshot.entries[1]!.track, scorePpm: 800_000, confidencePpm: 700_000, goalScorePpm: 700_000, affectedTransitions: [] }] }),
      inspect: vi.fn().mockResolvedValue(inspection),
    },
    exports: {
      prepare: vi.fn().mockResolvedValue({ status: "ready", confirmationId: "confirm-1", playlistName: "Friday set", trackCount: 2, knownDurationMs: 480_000, unknownDurationCount: 0, destinationDisplay: "Friday set.xml", willReplaceExisting: false, warnings: [] }),
      confirm: vi.fn().mockResolvedValue({ status: "exported", draftId: "draft-1", revision: 3, playlistName: "Friday set", trackCount: 2, overwritten: false, format: "rekordbox_xml_1_0_0", destinationState: "replaced" }),
    },
  } as unknown as DesktopApi;
}

describe("Set workspace", () => {
  it("creates all four supported draft sources and loads a saved set", async () => {
    const user = userEvent.setup(); const desktop = api(); const onOpen = vi.fn();
    render(<SetDraftLauncher api={desktop} selectedTrackIds={["track-1"]} playlistId="playlist-1" seedTrackId="track-2" onOpen={onOpen} />);
    await user.click(screen.getByRole("button", { name: "Create empty set" }));
    expect(desktop.sets.create).toHaveBeenCalledWith(expect.objectContaining({ source: { kind: "empty" } }));
    await user.click(screen.getByRole("button", { name: "Create from selected tracks" }));
    expect(desktop.sets.create).toHaveBeenLastCalledWith(expect.objectContaining({ source: { kind: "tracks", trackIds: ["track-1"] } }));
    await user.click(screen.getByRole("button", { name: "Create from playlist" }));
    expect(desktop.sets.create).toHaveBeenLastCalledWith(expect.objectContaining({ source: { kind: "playlist", playlistId: "playlist-1" } }));
    await user.click(screen.getByRole("button", { name: "Generate from seed" }));
    expect(desktop.sets.create).toHaveBeenLastCalledWith(expect.objectContaining({ source: { kind: "generated", seedTrackId: "track-2", maxTracks: 12 } }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Saved sets" }), "draft-1");
    await user.click(screen.getByRole("button", { name: "Open saved set" }));
    expect(desktop.sets.get).toHaveBeenCalledWith({ draftId: "draft-1" }); expect(onOpen).toHaveBeenCalled();
  });

  it("edits a live draft, inspects it, and completes the path-free export confirmation", async () => {
    const user = userEvent.setup(); const desktop = api(); const onSnapshot = vi.fn();
    render(<SetWorkspace api={desktop} snapshot={snapshot} availableTracks={[snapshot.entries[1]!.track!]} onSnapshot={onSnapshot} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Move First down" }));
    await user.click(screen.getByRole("button", { name: "Pin track First" }));
    await user.click(screen.getByRole("button", { name: "Pin position First" }));
    await user.click(screen.getByRole("button", { name: "Ban First" }));
    await user.click(screen.getByRole("button", { name: "Insert Second" }));
    await user.click(screen.getByRole("button", { name: "Find replacements for First" }));
    await user.click(screen.getByRole("button", { name: "Replace First with Second" }));
    await user.click(screen.getByRole("button", { name: "Optimize order" }));
    await user.click(screen.getByRole("button", { name: "Undo" })); await user.click(screen.getByRole("button", { name: "Redo" }));
    await user.click(screen.getByRole("button", { name: "Inspect set" }));
    expect(await screen.findByRole("figure", { name: "BPM and energy progression" })).toHaveTextContent("120 BPM");
    expect(screen.getByText("Energy rises cleanly.")).toBeVisible(); expect(screen.getByText("Suggestions only—nothing has changed in Rekordbox.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Prepare Rekordbox XML export" }));
    await user.click(await screen.findByRole("button", { name: "Confirm export" }));
    expect(await screen.findByText("Exported Friday set")).toBeVisible();
    expect(desktop.sets.mutate).toHaveBeenCalledWith(expect.objectContaining({ mutation: { type: "optimize" } }));
  });
});
