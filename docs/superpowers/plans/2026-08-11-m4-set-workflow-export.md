# M4 Set Workflow and Rekordbox Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` and `superpowers:test-driven-development`. Work only in the files assigned to the task, do not use Git, and return focused verification evidence to the primary agent.

**Goal:** Let Joe create a local set from selected tracks, a playlist, a seed, or structured constraints; edit, reorder, pin, ban, replace, undo/redo, optimize, version, and analyze it; inspect advisory organization ideas; and export the current validated set as a new Rekordbox XML file.

**Architecture:** Python remains authoritative for draft state, history, current-library ID resolution, deterministic generation/scoring/optimization, analysis, organization suggestions, and XML serialization. Schema v3 stores append-only, strictly validated JSON snapshots in three ordinary SQLite tables rather than adding an event framework or many speculative relational projections. Electron exposes a small fixed sets API; Electron main owns the native save picker and a short-lived export-confirmation token so paths never reach the renderer. The existing Library screen opens one inline Set workspace.

**Tech Stack:** CPython 3.12+ standard library, SQLite JSON text validated in Python, Electron 43.3.0, React 19.2.8, TypeScript 7.0.2, Zod 4.4.3, Vitest 4.1.10, Playwright 1.62.1.

## Research inputs and settled simplifications

Read-only agents `/root/m4_set_domain_research`, `/root/m4_export_research`, and `/root/m4_ui_research` inspected the current implementation and approved design. Their reports support these choices:

- reuse M3 `transition-v1` evidence directly; add no second scoring framework, cache, embedding, preference weight, or AI dependency;
- store complete bounded draft snapshots as strict JSON plus parent/version pointers; do not add event sourcing, JSON Patch, or five normalized history tables merely for future queries;
- use visible Move up/down controls and macOS undo shortcuts for reorder; do not add a drag/drop dependency or block M4 on pointer-drag visual QA;
- build one self-contained XML containing the draft tracks and one playlist; do not merge an existing XML, access Rekordbox databases, or implement multi-playlist collision machinery;
- extend the importer narrowly for the official numeric playlist `KeyType` form before using it for independent export validation;
- expose organization results as suggestions only. M4 does not apply tags/playlists or change Rekordbox.

One bounded pre-code architecture monitor then identified four Medium ambiguities and no High issue. This plan resolves them directly by enforcing the artist-repeat generation cap, separating current/content revisions for historical views, bounding inspection and suggestion output with truncation metadata, and freezing the private export destination/race contract. No additional framework or review loop was added.

## Stop conditions and explicit scope

- M4 is complete only when create/edit/version/undo/redo/pin/ban/reorder/replace/optimize, draft and imported-playlist inspection, advisory organization suggestions, and confirmed XML export work together in one generated desktop flow.
- Natural-language set requests, Codex refinement/explanations, and `SetPlan` parsing are M6. M4 accepts only structured local controls.
- Learned preferences and feedback are M5. M4 uses no hidden preference score.
- M2 has no vocal, structure, mood, era, or play-history evidence. M4 must label those unavailable and must not fabricate vocal-density, phrase, forgotten-track, or popularity claims.
- Drafts contain at most 100 ordered entries, 200 bans, and 100 saved version pointers. Generated drafts add at most 50 tracks. Imported playlists may repeat a track; draft entry IDs remain unique and repeated track IDs are preserved and warned about rather than silently collapsed.
- Search/replacement/organization scans retain M3's 25,000-track cap. No performance framework, background job API, or progress protocol is added without a measured failure of the five-second local operation budget. XML finalize uses a separate 30-second budget.
- Rekordbox XML/audio remain read-only. Export writes only a user-selected destination after preview/confirmation, never the imported source or `master.db`.
- Visual QA and screenshots remain deferred under D-045. M4 still requires semantics, keyboard behavior, strict renderer tests, and a nonvisual Electron import-to-export flow.
- The primary agent owns shared contracts, project memory, integration, staging, commits, and pushes. Subagents own only disjoint files explicitly assigned below.

## Frozen M4 contracts

### Schema v3 and draft persistence

M4 adds `library_state.source_path TEXT` (nullable and core-private) and exactly three draft tables:

```sql
set_drafts(
  id TEXT PRIMARY KEY,
  current_revision INTEGER NOT NULL,
  redo_tip_revision INTEGER,
  next_revision INTEGER NOT NULL,
  next_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

set_draft_revisions(
  draft_id TEXT NOT NULL REFERENCES set_drafts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  parent_revision INTEGER,
  operation TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(draft_id, revision),
  FOREIGN KEY(draft_id, parent_revision)
    REFERENCES set_draft_revisions(draft_id, revision)
)

set_draft_versions(
  draft_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(draft_id, version),
  FOREIGN KEY(draft_id, revision)
    REFERENCES set_draft_revisions(draft_id, revision)
)
```

Every decoded snapshot is validated as this exact shape before use:

```text
DraftState {
  title: string 1..200
  plan: {
    intent: existing DiscoveryIntent
    targetDurationMs: integer 900,000..28,800,000 | null
    maxArtistRepeats: integer 1..20 | null
    candidateFilters: existing TrackFilters without cursor/limit
  }
  entries: DraftEntry[0..100]
  bans: stable app track ID[0..200], unique and sorted
}

DraftEntry {
  id: server-generated UUID identifying the current slot
  trackId: stable app track ID
  trackPinned: boolean
  positionPinned: boolean
  role: warmup | groove | build | peak | singalong | reset | bridge | closer | null
  targetEnergyPpm: integer 0..1,000,000 | null
}
```

Entry IDs are unique. Each entry is a slot record: `role`, `targetEnergyPpm`, `positionPinned`, and the slot ID stay at the same numeric slot during reorder/optimization, while the track assignment and its `trackPinned` flag move together. This makes slot-energy goals affect ordering instead of becoming an invariant property of a moving track. Insert creates a new null-goal slot and remove deletes a slot; either may shift unpinned later slots. Track IDs may repeat so imported playlist intent/order is not lost. A banned track cannot appear in current entries; banning one occurrence removes every current occurrence of that track. Newly supplied track IDs must exist in the current library. Historical snapshots retain stale IDs across reimport; reads resolve each to a current track or `resolution: "missing"`, and analysis/optimization/export report or reject unresolved state instead of fabricating metadata.

Migration behavior:

- a new empty database creates schema v3 without a backup;
- an existing v2 database gets the first free sibling `dj-copilot.pre-m4.sqlite3`, then numbered siblings, before any v3 DDL;
- an existing M1 database retains the already-tested pre-M2 backup-before-DDL path and upgrades transactionally to v3 without redundant backups of the same pre-upgrade state;
- versions above 3 fail before mutation;
- failed backup or DDL leaves the v2 database usable;
- import through a real selected path stores its canonical XML path privately; legacy/direct-fixture state with no source path remains browsable but export says reimport is required.

### Create, edit, history, and version semantics

Create accepts one strict source variant:

```text
empty
tracks     ordered unique trackIds[1..100]
playlist   playlistId; preserve every position including repeats
generated  optional seedTrackId, candidateFilters, intent,
           targetDurationMs nullable, maxTracks 1..50
```

All variants include a title and plan. A generated draft uses only available current tracks matching its candidate filters. An explicit seed is included first and must be a current available track. Without a seed, choose the candidate with known energy closest to 350,000, then normalized title/artist/ID; missing energy sorts after known. Repeatedly append the best `recommend_next_tracks` candidate for the selected intent, excluding current IDs, bans, and any candidate whose nonempty trimmed/casefolded artist would exceed `maxArtistRepeats`, until `maxTracks` or known duration reaches the target. Unknown artists do not count as one shared artist. The artist cap is a hard generation constraint, including for an explicit seed; if the target duration or requested count cannot be reached without violating it, return the usable partial draft plus a stable unmet constraint rather than relaxing the cap.

One `sets.mutate` method accepts this closed discriminated union:

```text
rename              title
set_plan            complete DraftPlan
insert_track        trackId, toIndex
move_entry          entryId, toIndex
set_track_pin       entryId, pinned
set_position_pin    entryId, pinned
remove_entry        entryId
ban_entry           entryId
unban_track         trackId
replace_entry       entryId, replacementTrackId
set_entry_goal      entryId, role, targetEnergyPpm
optimize            no extra fields
undo                no extra fields
redo                no extra fields
save_version        label 1..100
restore_version     version integer
```

Every mutation requires `expectedRevision`; a mismatch returns `conflict` without writing. A no-op returns the existing snapshot. A track pin travels with its track assignment and preserves inclusion, so that track occurrence cannot be removed, banned, or replaced but may be manually reordered. A position pin preserves the exact slot and its current assigned track: it blocks any insert, move, remove, ban, or replacement that would change or shift that slot. Setting a position pin also sets the current assignment's track pin; clearing it leaves the track pin unchanged. Optimization may move track-pinned assignments but never changes or shifts a position-pinned slot. Manual reorder and optimization move track assignments between slot records, leaving each numeric slot's role/energy goal in place. These two direct booleans implement the approved track-versus-position behavior without a segment model.

Every state-changing edit appends a complete validated snapshot whose parent is the current revision. Undo moves to the parent and records the prior head as `redo_tip_revision`; redo walks one step from the current revision toward that tip. A new edit after undo clears redo but does not delete history. Saving adds an immutable numbered pointer without changing revision/undo state. Restoring a saved version appends a new current child, so restore itself is undoable. Viewing a historical version is read-only.

The path-free `DraftSnapshot` returned after create/get/mutate includes draft ID, `currentRevision` (the mutable head), `contentRevision` (the snapshot being displayed), plan, resolved ordered entries, sorted bans, known duration, unknown-duration count, unmet constraints, `canUndo`, `canRedo`, at most 100 version summaries, and `viewingVersion`. For the live draft, the two revisions are equal. A historical get keeps the current head in `currentRevision`, places the selected immutable revision in `contentRevision`, and is read-only except for `restore_version`; that restore still requires `expectedRevision=currentRevision` and appends a new child. A concurrent head edit therefore conflicts instead of restoring over newer work. Each resolved entry includes current bounded display metadata plus effective BPM/key, local energy or null, resolution state, role/goal, and both pin states. It never contains a source path or Rekordbox external ID.

### Alternatives, optimizer, analyzer, and organization v1

Expose a public `score_transition(fromEvidence, toEvidence, intent)` wrapper in `discovery.py` that reuses the exact M3 scorer and component output. M3 algorithms and wire values do not change.

Replacement alternatives:

- scan current available candidates once; exclude every banned/current track ID;
- score previous→candidate and candidate→next affected edges using the draft intent;
- when an entry has `targetEnergyPpm`, add the integer energy-closeness term `1,000,000 - abs(candidateEnergy - target)` when local energy exists; missing stays explicit and is not negative evidence;
- rank by the rounded mean of available affected-edge/energy scores, mean confidence, normalized title, artist, then app ID;
- return at most ten candidates, scan truncation, and unchanged edge component evidence.

`set-order-v1` is four deterministic left-to-right adjacent-swap passes. It never adds/removes/replaces track assignments or changes bans/goals. Skip a swap when either slot is position-pinned; a track pin preserves inclusion but does not freeze order. Swap the track ID and track-pin flag only, leaving slot IDs, roles, target energies, and position pins fixed. The objective is the rounded mean of all adjacent transition scores plus every available slot-energy closeness term; confidence is the second comparison key. Accept only a strict lexicographic score/confidence improvement, making the result non-worsening and idempotent at a local optimum. Return before/after objectives and edge evidence. This is intentionally a bounded local optimizer, not a global solver.

`sets.inspect` accepts either `{ kind: "draft", draftId, revision? }` or `{ kind: "playlist", playlistId }`, inspects the first 100 ordered positions, and returns `sourcePositionCount`, `inspectedPositionCount`, and `inputTruncated` before the following bounded details:

- known duration plus unknown count;
- per-position effective BPM/key and local energy/missing state;
- energy direction using ±75,000 PPM and BPM direction using ±3,000 milli-BPM;
- every adjacent `transition-v1` edge with score, confidence, signed utility, reasons, and components;
- `weak_transition` only when score <400,000 and confidence ≥400,000;
- `limited_transition_evidence` when confidence <400,000;
- unavailable, unresolved, missing-analysis, duplicate-track, adjacent-same-artist, target-duration, max-artist-repeat, and missing-goal-evidence warnings in stable order.

`organization-v1` suggestions are returned with inspection and never mutate state:

- low/mid/high local-energy groups: 0..399,999, 400,000..699,999, 700,000..1,000,000;
- exact trimmed/casefolded genre groups;
- current collection tracks in no imported playlist.

Require at least two tracks per energy/genre group, cap all suggestions at twenty, and cap each suggestion's stable ordered `trackIds` at 100. Every suggestion also returns `matchedTrackCount` and `trackIdsTruncated`; the inspection result returns the existing catalog `scannedCount`/`scanTruncated` metadata for organization scans. Include only current stable track IDs and an evidence sentence, and label the section `Suggestions only—nothing has changed in Rekordbox.`

### Official Rekordbox XML export

The importer must accept both:

- official node-level `KeyType="0"` (TrackID) or `KeyType="1"` (Location), where children contain only `Key`; and
- the existing generated-fixture form with per-child `KeyType="TrackID"` or `"Location"`.

Unknown numeric/text values, node/child conflicts, mixed styles, and unresolved references fail closed. Do not alter the Phase 0 XML fixture or its hash.

Export serializes the confirmed current draft revision into one deterministic UTF-8 XML document:

```xml
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="DJ Copilot" Version="0.1.0"/>
  <COLLECTION Entries="...">...</COLLECTION>
  <PLAYLISTS>
    <NODE Type="0" Name="ROOT" Count="1">
      <NODE Type="1" Name="..." KeyType="0" Entries="...">
        <TRACK Key="..."/>
      </NODE>
    </NODE>
  </PLAYLISTS>
</DJ_PLAYLISTS>
```

Resolve every entry to the current track, numeric external TrackID, absolute source path, availability, and stored metadata inside the core. Collection rows are unique in first-appearance order; playlist references preserve every draft occurrence. Unknown/unresolved IDs, nonnumeric external IDs, missing/unreadable sources, invalid paths, or an imported-source alias block export without omitting a track.

Use the standard-library XML builder and `Path.as_uri()`-equivalent percent encoding, preserve Unicode, add no timestamp, and emit identical bytes for identical snapshots. The one-leaf document has no sibling-name collision; preserve the validated draft title.

Destination policy is exact: the destination must be an absolute `.xml` path beneath an existing canonical directory. `lstat` rejects a destination symlink and every existing non-regular file. An existing regular destination is allowed only after the native save panel's overwrite confirmation; an absent destination is allowed only while it remains absent. For an existing destination, source alias detection uses `samefile`; for an absent destination, compare the resolved candidate path under its canonical parent with the resolved imported source. Preview records only `absent` or `regular_file`; any change between those states before finalize blocks the write. Replacing one regular file with another regular file at the already confirmed path is within the personal-use overwrite confirmation and needs no inode-binding protocol.

For a confirmed export:

1. validate the exact destination policy, imported-source non-alias, and expected `absent`/`regular_file` state;
2. create a random mode-0600 temporary sibling;
3. write, flush, `fsync`, and close;
4. independently call production `parse_rekordbox_xml` on the file;
5. compare collection IDs/locations, ROOT/leaf name, counts, and exact playlist reference order to the snapshot;
6. recheck the expected destination state and source-alias conditions immediately before `os.replace`;
7. finalize atomically and clean the sibling in `finally`.

An `EXDEV` or any serialization/reparse/finalize error fails closed; no cross-volume fallback is needed because the temporary file is a destination sibling. A known pre-`os.replace` failure returns `destinationState: "unchanged"`; an `os.replace` exception or transport disconnect returns `"unknown"`, never a false unchanged claim.

### Fixed core, IPC, preload, and export-confirmation surface

Core adds exactly:

```text
list_set_drafts
create_set_draft
get_set_draft
mutate_set_draft
find_set_replacements
analyze_set
preview_set_export
export_set_draft
```

The two path-bearing commands are private main-to-core contracts, never preload contracts:

```text
preview_set_export {
  draftId, expectedRevision,
  destinationPath,
  expectedDestinationState: absent | regular_file
}
-> ready {
     draftId, revision, playlistName, trackCount,
     knownDurationMs, unknownDurationCount, warnings,
     expectedDestinationState
   }
 | blocked { reasons, destinationState: unchanged }

export_set_draft {
  draftId, expectedRevision,
  destinationPath,
  expectedDestinationState: absent | regular_file
}
-> exported {
     draftId, revision, playlistName, trackCount,
     overwritten, format: rekordbox_xml_1_0_0,
     destinationState: replaced
   }
 | blocked {
     reasons,
     destinationState: unchanged | unknown
   }
```

Both commands reject unknown fields, re-resolve the current draft and private library data, require the exact current revision, and return no path. Preview never writes. Export repeats every validation and expected-state check; `unchanged` is used only when failure is known to precede `os.replace`.

The preload exposes exactly:

```text
sets.list()
sets.create(request)
sets.get(request)
sets.mutate(request)
sets.findReplacements(request)
sets.inspect(request)
exports.prepare({ draftId, expectedRevision })
exports.confirm({ confirmationId })
```

All set payloads and responses are strict Zod objects. Set operations use a 30-second core-client timeout only where generation/optimization/inspection requires it; simple reads/edits retain the ordinary five-second budget. No generic invoke, SQL, filesystem, path, or format selector is exposed.

`exports.prepare` validates the sender and IDs, opens the native save dialog, derives `expectedDestinationState` with `lstat`, calls private preview, and returns `cancelled`, `blocked { reasons }`, or path-free `ready { confirmationId, playlistName, trackCount, knownDurationMs, unknownDurationCount, destinationDisplay, willReplaceExisting, warnings }`. Main keeps a random single-use token bound to draft/revision, canonical picker path, expected destination state, and a ten-minute expiry. The renderer cannot supply or recover the path. `exports.confirm` consumes the token and calls the private export command with those exact values; a draft revision change, absent-to-existing or existing-to-absent race, symlink/non-regular destination, reuse, expiry, or payload substitution fails. A known core block preserves its `destinationState`; a core timeout/disconnect is mapped to `unknown`. This is a practical trusted-main confirmation boundary for Joe's personal app, not the superseded Phase 0 approval protocol.

## Implementation tasks

### Task 1: Pure set domain and generated fixture

**Owner:** ranking specialist

**Files:**
- Modify: `core/dj_copilot/discovery.py`
- Create: `core/dj_copilot/set_workflow.py`
- Modify: `core/tests/test_discovery.py`
- Create: `core/tests/test_set_workflow.py`
- Create: `fixtures/sets/m4-set.json`

- [x] Write red tests for strict snapshot validation, generated creation including a duration/count request reachable only by violating the artist cap, all edit/track-pin/position-pin/ban/goal operations, repeated tracks, unknown/missing evidence, alternative ranking, exact M3 score reuse, optimizer pin-safety/non-worsening/idempotence, analyzer thresholds/warnings, organization groups, per-suggestion IDs, and input/output truncation metadata.
- [x] Implement immutable pure records/functions only. Do not import SQLite, service, Electron, filesystem, XML, Codex, or preferences.
- [x] Run `python3 -B -m unittest core.tests.test_discovery core.tests.test_set_workflow -v` (32/32 passed).

### Task 2: Official parser compatibility and deterministic XML writer

**Owner:** Rekordbox specialist

**Files:**
- Modify: `core/dj_copilot/rekordbox_xml.py`
- Create: `core/dj_copilot/rekordbox_export.py`
- Modify: `core/tests/test_rekordbox_xml.py`
- Create: `core/tests/test_rekordbox_export.py`

- [x] First reproduce the official numeric-KeyType failure and write red writer/finalization tests.
- [x] Add only the frozen numeric/text compatibility and one-leaf deterministic writer/independent semantic reparse/finalize path. Accept already-resolved private export snapshots; do not edit the database/service or read personal files.
- [x] Cover Unicode/escaping/URI round-trip, repeated playlist entries, byte determinism, source alias, overwrite, symlink, stale/unavailable entries, injected failures, temp cleanup, and unchanged source/destination hashes.
- [x] Run `python3 -B -m unittest core.tests.test_rekordbox_xml core.tests.test_rekordbox_export -v` (19/19 passed).

Tasks 1 and 2 are independent and may run in parallel.

### Task 3: Schema-v3 repository and strict Python service

**Owner:** primary + bounded core implementer

**Files:**
- Modify: `core/dj_copilot/database.py`
- Modify: `core/dj_copilot/service.py`
- Create: `core/tests/test_set_database.py`
- Create: `core/tests/test_set_service.py`
- Modify: relevant migration/service regression tests

- [x] Write red tests for backup-before-DDL, v1/v2/v3 startup paths, source-path persistence, atomic revisions/conflicts, undo/redo branching, live/current versus historical/content revisions, view-concurrent-edit-restore conflict, version restore, reimport stale resolution, create variants, all strict commands, path-free responses, private export snapshots, and failure preservation.
- [x] Implement the three tables and eight fixed commands using Task 1/2 pure functions. Keep the Python core the sole SQLite owner; transactions append/advance state atomically.
- [x] Run focused migration/repository/service suites, then `python3 -B -m unittest discover -s core/tests -v` outside the outer sandbox when Unix sockets require permission (post-review repository/service 13/13 and complete core 119/119 passed).

### Task 4: Strict desktop boundary and confirmation state

**Owner:** desktop boundary implementer

**Files:**
- Modify: `app/desktop/src/shared/contracts.ts`
- Modify: `app/desktop/src/main/core-client.ts`
- Modify: `app/desktop/src/main/ipc.ts`
- Modify: `app/desktop/src/preload/index.ts`
- Create: `app/desktop/tests/set-contracts.test.ts`
- Modify: `app/desktop/tests/main-security.test.ts`
- Modify: `app/desktop/tests/preload-contract.test.ts`
- Modify: `app/desktop/tests/core-client.test.ts` only if the bounded timeout needs coverage

- [x] Write red strict schemas and IPC tests for every enum/bound/union, unknown-field rejection, path/external-ID omission, trusted sender, native picker cancel/new/overwrite, absent-file race, symlink/non-regular rejection, source alias, token binding/reuse/expiry/revision substitution, known core errors, and unknown destination state on replace/transport uncertainty.
- [x] Add only the fixed six sets and two export methods. Keep pending confirmations in Electron main memory and clear them on use/expiry/shutdown.
- [x] Run `pnpm --dir app/desktop test set-contracts main-security preload-contract core-client` and `pnpm typecheck` (32/32 focused; 114/114 complete desktop; typecheck passed).

Tasks 3 and 4 begin only after Task 1/2 domain/wire shapes are stable. Their file ownership is disjoint and they may then run in parallel; the primary integrates their shared assumptions.

### Task 5: Accessible inline Set workspace

**Owner:** macOS UI specialist

**Files:**
- Create: `app/desktop/src/renderer/src/features/sets/SetDraftLauncher.tsx`
- Create: `app/desktop/src/renderer/src/features/sets/SetWorkspace.tsx`
- Create: `app/desktop/src/renderer/src/features/sets/DraftTrackList.tsx`
- Create: `app/desktop/src/renderer/src/features/sets/SetInspectionPanel.tsx`
- Create: `app/desktop/src/renderer/src/features/sets/ExportPanel.tsx`
- Modify: `app/desktop/src/renderer/src/features/library/LibraryScreen.tsx`
- Modify: `app/desktop/src/renderer/src/features/library/TrackTable.tsx`
- Modify: `app/desktop/src/renderer/src/features/discovery/DiscoveryPanel.tsx`
- Modify: `app/desktop/src/renderer/src/styles.css`
- Create: `app/desktop/tests/set-workspace.test.tsx`
- Modify: historical renderer mocks/tests for the required DesktopApi surface

- [x] Write behavior tests first for selected/playlist/seed/constraint creation; saved-set loading; ordered move controls; track pin, position pin, ban/remove, insert, replace, role/energy goal, plan edits, optimize, undo/redo plus macOS shortcuts, version save/view/restore, stale-response suppression, focus/live announcements, analyzer/progression/transition details, advisory organization, and every export state.
- [x] Implement one inline workspace without a router, pointer-drag dependency, chart package, renderer scoring, or filesystem access. Use native ordered lists, buttons, inputs, tables/figures with text equivalents, details, and inline confirmation. Preserve the Library screen's state when returning.
- [x] Keep editor state usable after inspection/export failures and preserve the last good snapshot/inspection while refreshing.
- [x] Run `pnpm --dir app/desktop test set-workspace discovery-screen library-screen analysis-screen`, `pnpm typecheck`, and `pnpm --dir app/desktop build` (34/34 focused; 114/114 complete desktop; typecheck and build passed). No screenshots.

### Task 6: Generated import-to-export flow, aggregate, review, and project memory

**Owner:** primary

**Files:**
- Create: `app/desktop/e2e/set-flow.spec.ts`
- Create: `scripts/verify-m4.sh`
- Modify: root/desktop package scripts
- Create: `docs/evidence/m4-set-workflow-export.md`
- Modify: `TASKS.md`, `DECISIONS.md`, `KNOWN_ISSUES.md`
- Modify: architecture, evaluation, phase, test, recovery, privacy, user-guide, licensing, and ADR-0004 records where actual behavior changes them
- Mark this plan's steps with actual evidence

- [x] Through production UI/IPC/core behavior, generate/import a temporary official numeric-KeyType library, inspect its playlist, create a draft, reorder, exercise both track and position pins, ban, replace, edit goals, optimize, undo/redo, save/view/restore a version, inspect progression/warnings/organization, prepare/cancel export, confirm new and overwrite exports, reload, and independently import/reparse the exported XML.
- [x] Assert exact track/playlist order including one repeat, current-library IDs only, source XML/media/sentinel hashes, validated overwrite behavior, no temporary sibling, and runtime/user-data cleanup. No screenshots were captured.
- [x] Post-review `pnpm verify:m4` passed with exact dependencies, 119/119 core tests, 116/116 desktop tests, strict typecheck, production build, all five M1–M4 Electron flows, shell/tracked-residue/diff checks.
- [x] Perform one concise read-only milestone review of normal-workflow correctness/evidence only. The original reviewer returned READY after focused corrections, 13/13 history/service tests, 12/12 renderer correction tests, and the synchronized post-review aggregate; no repeated review loop was created.
- [ ] Record actual evidence, inspect the staged payload for personal data/audio/databases/credentials/logs/caches, commit green checkpoints, and push `main` to `origin`.

## M4 completion gate

M4 closes only when:

- every required local draft edit/history/version/analysis/organization behavior works on current-library IDs with honest missing evidence;
- pins, bans, repeats, stale IDs, revision conflicts, undo/redo, and saved versions have executable coverage;
- official numeric playlist references parse and the new self-contained XML export independently reparses with exact order before atomic finalize;
- renderer paths remain hidden, export requires trusted-UI preview/confirmation, and failure outcomes do not falsely claim an unchanged destination after transport uncertainty;
- the generated desktop import-to-export flow and complete aggregate pass with no known High/Medium normal-workflow defect;
- visual/native appearance and real Rekordbox 7.2.14 Bridge import remain explicitly deferred, not passed;
- project memory and M4 evidence match the code; the green checkpoint is pushed and `main` agrees with `origin/main`.
