# M5 Personalization and Library Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` and `superpowers:test-driven-development`. Work only in the files assigned to the task, do not use Git, and return focused red/green verification evidence to the primary agent.

**Goal:** Let Joe save useful library views, author ratings/tags/notes, record explicit feedback and successful set edits, see a small preference profile measurably reorder later recommendations, compare it with the non-personal baseline, export it, and reset exactly back to baseline.

**Architecture:** Python remains the sole SQLite and ranking owner. Schema v4 adds three ordinary app-owned tables and one pure `preference-linear-v1` module; it does not add ML infrastructure, embeddings, an event bus, a background learner, or a second scorer. Existing M3 transition scoring gains only its already-reserved optional preference component, so M4 generation/optimization sees the same active profile. Electron exposes fixed metadata/preference methods; Electron main owns confirmed JSON export. The current Library screen receives inline metadata, saved-filter, feedback, comparison, and profile controls without a router or Settings framework.

**Tech Stack:** CPython 3.12+ standard library, SQLite, Electron 43.3.0, React 19.2.8, TypeScript 7.0.2, Zod 4.4.3, Vitest 4.1.10, Playwright 1.62.1.

## Scope monitor and settled simplifications

The single bounded read-only M5 scope monitor inspected the approved design and M1–M4 code. It found no need for FTS, embeddings, ANN, model training, a new runtime, generic settings, or historical protocol machinery. This plan adopts its important corrections:

- schema/filter compatibility is implemented before persistence so schema-v3 draft JSON remains readable;
- metadata tables do not cascade from the replace-on-import track projection, and retained-track reimport is an executable gate;
- successful draft feedback is committed with the draft revision, while conflicts/no-ops/failures/undo/redo emit nothing;
- baseline and personalized rankings are computed in one core request over the same candidate universe;
- reset scope is explicit and tested;
- preference export remains a bounded human-readable snapshot, not a database/model system.

## Stop conditions and explicit scope

- M5 is complete only when tags, notes, ratings, tag/rating/text filters, saved-filter save/load/delete, explicit likes/dislikes and recommendation accepted/rejected/skipped feedback, successful draft-edit evidence, visible bounded preference effects, baseline comparison, confirmed export, and reset work together in one generated nonvisual desktop flow.
- Visual QA and screenshots remain deferred under D-045. Accessibility semantics and renderer behavior tests remain required.
- No raw audio, source path, external Rekordbox ID, note text, credential, or log crosses preference export or the recommendation wire unnecessarily.
- No import of preference exports is required. M7 app-database backup/export is separate.
- No play-history learning is inferred until trustworthy play history exists. Tags and notes are never treated as positive sentiment.
- No natural-language filter, set, or explanation behavior is added here; that is M6.
- Profile output is bounded to 50 track affinities and 50 genre affinities. The feedback table may retain personal history, but normal responses never return an unbounded event log.
- Search stays on the existing 25,000-track in-memory projection. FTS/fuzzy/vector work requires a measured representative-library failure.
- The primary agent owns shared contracts, project memory, integration, staging, commits, and pushes. Delegated file ownership is disjoint.

## Frozen M5 contracts

### Schema v4

An existing schema-v3 database gets the first free sibling backup `dj-copilot.pre-m5.sqlite3`, then numbered siblings. A new database starts at v4 without a backup; reopening v4 never creates another backup.

```sql
track_user_metadata(
  track_id TEXT PRIMARY KEY,
  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  note TEXT,
  tags_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

saved_filters(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  filter_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

user_feedback(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  track_id TEXT NOT NULL,
  related_track_id TEXT,
  seed_track_id TEXT,
  intent TEXT,
  draft_id TEXT,
  old_index INTEGER,
  new_index INTEGER,
  created_at TEXT NOT NULL
)
```

Allowed feedback events are exactly `liked`, `disliked`, `accepted`, `rejected`, `skipped`, `manual_replacement`, `manual_reorder`, `pinned`, `removed`, and `banned`. All referenced track/seed IDs must exist when a new event is recorded. Recommendation events require a seed and intent; direct like/dislike events do not. Draft-derived fields are internal only.

Metadata bounds:

- rating is null or integer 1–5;
- note is null or trimmed text of at most 2,000 characters;
- tags contain at most 20 trimmed Unicode-NFKC values, each 1–40 characters, deduplicated by casefolded normalized value while preserving first display spelling;
- an all-empty update deletes the metadata row;
- saved filters are capped at 50, use a UUID ID and unique trimmed name of 1–80 characters, and contain only a validated `TrackFilters` object.

Reimport retains metadata for a still-present stable app track ID and deletes metadata for tracks absent from the new projection. Saved filters, feedback, drafts, and profile history remain app-owned. Preference projection ignores feedback references that no longer resolve to a current track.

### Filter and snapshot compatibility

`TrackFilters` adds only:

```text
ratingMin?: integer 1..5
tag?: normalized exact user tag, 1..40 characters
```

Text filtering searches imported title/artist/album/genre plus app-owned tags and notes. Tag/rating filters compose with existing filters using AND semantics. Cursor signatures include metadata/filter state so a metadata update invalidates a prior cursor rather than silently mixing pages.

The persisted draft decoder accepts exactly either the old schema-v3 candidate-filter key set or the new schema-v4 key set; missing v4 fields default to null. New draft snapshots emit only the full v4 shape. Unknown keys still fail.

### `preference-linear-v1`

Fixed signal units:

| Evidence | Track signal |
| --- | ---: |
| liked, accepted, pinned | +2 |
| manual reorder | +1 |
| skipped | -1 |
| disliked, rejected, removed, banned | -2 |
| manual replacement | old track -2; replacement track +2 |
| rating | rating minus 3, from -2 through +2 |

One event/rating contribution counts as one effective signal; manual replacement counts as two. Zero-signal rating 3 still counts as explicit evidence. Profile status is `baseline` at zero, `learning` at one through four, and `active` at five or more.

Preference weight is zero until active, then `min(150_000, (effectiveEvidenceCount - 4) * 15_000)` ppm. Thus five signals apply 15,000 ppm and fourteen cap at 150,000 ppm. Existing M3 weights are unchanged; the optional preference component joins the same available-evidence normalization.

For a track or normalized genre with evidence, affinity is `clamp(500_000 + round(meanSignal * 250_000), 0, 1_000_000)`. Candidate preference uses direct track affinity twice and genre affinity once when both exist, or the one available affinity. Preference evidence quality rises with supporting count and remains bounded. Missing affinity remains missing evidence, never a neutral/negative invention.

Profile wire shape includes:

- `algorithmVersion: "preference-linear-v1"`;
- opaque current `revision` hash;
- `status`, `totalPersonalDataCount`, `effectiveEvidenceCount`, `minimumEvidenceCount`, and `preferenceWeightPpm`;
- fixed event counts;
- at most 50 path-free track affinities and 50 genre affinities, each with score and evidence count, plus truncation flags.

Ordinary recommend-next and set scoring use the active profile embedded in repository `TrackEvidence`. The comparison command first selects the existing baseline top-N candidate universe, then returns those exact IDs in baseline and personalized order plus rank deltas/profile. Below five signals, both orders/scores are identical and the UI says learning rather than claiming a personalized improvement.

### Metadata, saved-filter, and preference operations

Fixed core/desktop operations:

- `library.getTrackMetadata(trackId)` / `get_track_metadata`;
- `library.updateTrackMetadata(metadata)` / `update_track_metadata`;
- `library.listSavedFilters()` / `list_saved_filters`;
- `library.saveSavedFilter(record)` / `save_saved_filter`;
- `library.deleteSavedFilter(id)` / `delete_saved_filter`;
- `preferences.getProfile()` / `get_preference_profile`;
- `preferences.recordFeedback(request)` / `record_feedback`;
- `preferences.compareRecommendations(request)` / `compare_recommendations`;
- `preferences.reset()` / `reset_preferences`;
- private `get_preference_export` for Electron-main export preparation.

`update_track_metadata`, `save_saved_filter`, delete, record feedback, and reset are complete transactions. Reset deletes all `user_feedback` and clears every rating, but preserves tags, notes, saved filters, drafts, imported tracks/playlists, analysis, and set history.

Successful non-no-op `replace_entry`, `move_entry`, positive track/position pin, `remove_entry`, and `ban_entry` mutations pass strict feedback rows into the same repository transaction that appends the revision. Conflicts, validation failures, no-ops, unpin/unban, optimize, undo, redo, save, restore, rename, plan/goal changes, and insert emit no automatic feedback.

### Confirmed preference export

The public desktop API is `preferences.prepareExport()` followed by `preferences.confirmExport({confirmationId})`. Electron main:

1. fetches and validates one bounded private preference snapshot;
2. opens a JSON save picker and canonicalizes the selected parent;
3. rejects non-JSON, symlink, and non-regular destinations;
4. returns only basename, overwrite disclosure, evidence count, and a single-use ten-minute confirmation ID;
5. on confirmation, re-fetches the snapshot and blocks if its revision changed;
6. writes a mode-`0600` temporary sibling, flushes it, reparses against the strict export schema, rechecks the destination state, atomically replaces, and cleans temporary files.

The `dj-copilot-preferences-v1` JSON contains only the bounded profile summary and rating/event counts. It contains no paths, raw event stream, notes, tags, titles, artists, audio, credentials, logs, or database bytes.

### Renderer behavior

- `TrackMetadataPanel` opens from an accessible per-track action, loads current metadata, edits rating/tags/note, records like/dislike, keeps the last saved value after failures, and refreshes the visible row/filter results after success.
- `SavedFiltersPanel` saves the current complete filter including playlist/tag/rating, loads it, and deletes it. A stale playlist reference shows an error and preserves the current playlist/results.
- Next-track candidate cards expose Accepted, Rejected, and Skipped. A successful action refreshes comparison/profile; failure keeps the last results.
- `PreferencePanel` shows evidence/status/weight and bounded affinity summaries, supports export prepare/confirm, and requires inline reset confirmation that states ratings/feedback are cleared while tags/notes/filters/sets/library remain.
- The personalized list is primary only when profile status is active. Baseline rank and signed rank delta remain visible; learning state explains that rankings are still baseline.

## Implementation tasks

### Task 1: Pure preference model and scorer compatibility

**Owner:** ranking specialist

**Files:**
- Create `core/dj_copilot/personalization.py`
- Modify `core/dj_copilot/discovery.py`
- Modify `core/dj_copilot/set_workflow.py`
- Create `core/tests/test_personalization.py`
- Modify `core/tests/test_discovery.py`
- Modify `core/tests/test_set_workflow.py`

- [ ] Write red tests for every signal, threshold/ramp/cap, deterministic ties, track/genre affinity, missing evidence, path-free bounded profile, baseline stripping, personalized ranking/set scorer effect, and exact v3/v4 draft-filter decoding.
- [ ] Implement immutable pure records/builders and the optional existing preference component. Do not import SQLite or add a second scoring function.
- [ ] Run `python3 -B -m unittest core.tests.test_personalization core.tests.test_discovery core.tests.test_set_workflow -v`.

### Task 2: Schema-v4 repository, service, and atomic draft feedback

**Owner:** core implementer

**Files:**
- Modify `core/dj_copilot/database.py`
- Modify `core/dj_copilot/service.py`
- Create `core/tests/test_personalization_database.py`
- Create `core/tests/test_personalization_service.py`
- Modify `core/tests/test_set_database.py`
- Modify `core/tests/test_set_service.py`

- [ ] Write red tests for v3 backup-before-DDL/new-v4/reopen/future-version behavior, exact three tables, metadata bounds/restart/reimport preservation/removal cleanup, saved-filter cap and validation, cursor invalidation, profile projection, strict commands, same-universe comparison, reset preservation, private export shape, and atomic exactly-once successful draft feedback.
- [ ] Implement repository transactions and strict service translation on current IDs. Keep all paths private and reuse Task 1 only.
- [ ] Run the focused repository/service suites and complete core suite.

Task 2 begins after Task 1's records are stable.

### Task 3: Shared contracts and desktop boundary

**Owner:** primary for shared schemas; desktop boundary implementer after schemas freeze

**Files:**
- Modify `app/desktop/src/shared/contracts.ts`
- Modify `app/desktop/src/main/ipc.ts`
- Create `app/desktop/src/main/preference-export.ts`
- Modify `app/desktop/src/preload/index.ts`
- Create `app/desktop/tests/personalization-contracts.test.ts`
- Modify `app/desktop/tests/main-security.test.ts`
- Modify `app/desktop/tests/preload-contract.test.ts`

- [ ] Primary writes red strict Zod/CoreRequest schemas for filter compatibility, metadata, saved filters, feedback, profile/comparison, reset, and prepare/confirm export; historical mocks receive the exact API surface.
- [ ] Implement trusted IPC/preload methods and the bounded main-owned atomic JSON writer/confirmation state. Reuse small destination helpers where clear; do not expose a generic file-write channel.
- [ ] Cover unknown fields/enums/bounds, response validation, sender trust, picker cancellation, new/overwrite disclosure, token expiry/reuse, profile-revision race, destination race/type/symlink, mode/temp cleanup/reparse, and unknown write outcome.
- [ ] Run focused desktop boundary tests and `pnpm typecheck`.

Task 3 may run alongside Task 2 only after the primary freezes the exact shared schemas in the working tree.

### Task 4: Inline metadata, saved filters, feedback, and profile UI

**Owner:** macOS UI specialist

**Files:**
- Create `app/desktop/src/renderer/src/features/personalization/TrackMetadataPanel.tsx`
- Create `app/desktop/src/renderer/src/features/personalization/SavedFiltersPanel.tsx`
- Create `app/desktop/src/renderer/src/features/personalization/PreferencePanel.tsx`
- Modify `app/desktop/src/renderer/src/features/library/LibraryScreen.tsx`
- Modify `app/desktop/src/renderer/src/features/library/TrackTable.tsx`
- Modify `app/desktop/src/renderer/src/features/discovery/DiscoveryFilters.tsx`
- Modify `app/desktop/src/renderer/src/features/discovery/DiscoveryPanel.tsx`
- Modify `app/desktop/src/renderer/src/styles.css`
- Create `app/desktop/tests/personalization-screen.test.tsx`
- Modify only renderer test mocks that need the exact DesktopApi surface

- [ ] Write behavior tests first for metadata load/save/errors, tag/rating/text filters, saved-filter save/load/delete/stale-playlist preservation, like/dislike and accepted/rejected/skipped, learning versus active language, baseline rank deltas, profile inspection, confirmed export states, and disclosed reset/preservation.
- [ ] Implement inline accessible controls using the existing Library screen. Keep last-good data on failures and suppress stale async responses.
- [ ] Run focused renderer tests, strict typecheck, and production build. No screenshots.

Task 4 begins after the shared API from Task 3 is stable; it may run in parallel with Task 2/desktop implementation only on disjoint files.

### Task 5: Generated desktop flow, aggregate, review, and memory

**Owner:** primary

**Files:**
- Create `app/desktop/e2e/personalization-flow.spec.ts`
- Create `scripts/verify-m5.sh`
- Modify root/desktop package scripts
- Create `docs/evidence/m5-personalization-library-metadata.md`
- Update `TASKS.md`, `DECISIONS.md`, `KNOWN_ISSUES.md`, `CHANGELOG.md`, ADR-0008, and relevant architecture/evaluation/test/privacy/recovery/user-guide/licensing records

- [ ] In one generated nonvisual Electron flow: import; edit metadata; reimport and prove retained metadata; filter by tag/rating/text; save/load/delete a filter; record direct/recommendation and successful set-edit evidence; cross the five-signal threshold; prove one rank change and visible preference component; export/cancel/new/overwrite; reset; prove exact baseline restoration and preservation of tags/notes/filter/draft/library after restart.
- [ ] Assert source XML/media hashes, path-free IPC/export, current IDs, JSON reparse, destination/temp semantics, profile bounds, and runtime cleanup.
- [ ] Add `pnpm verify:m5` to run prerequisites, complete core/desktop suites, strict typecheck/build, all M1–M5 Electron flows, tracked-residue/diff checks, and no visual QA.
- [ ] Perform one concise read-only milestone review of normal-workflow correctness/evidence. Fix concrete High/Medium findings with focused regressions; no repeated review loop.
- [ ] Inspect the staged payload for personal data/audio/databases/credentials/logs/caches, commit green checkpoints, push `main`, and synchronize project memory with actual hashes/counts.

## M5 completion gate

M5 closes only when:

- user metadata and saved filters persist, validate, survive retained-track reimport, and affect real filter/search behavior;
- tiny evidence is labeled learning and cannot alter ranking; active weight/effects remain deterministic and bounded;
- explicit feedback and successful draft edits are recorded exactly once, with no false evidence from failures/conflicts/no-ops/undo/redo;
- baseline/personalized comparison uses one candidate universe, standard recommendations/set scoring use the active profile, and reset exactly restores baseline;
- confirmed preference export is bounded/path-free and atomically reparses, while cancellation/failure preserves state/destination;
- the generated flow and complete aggregate pass with no known High/Medium normal-workflow defect;
- visual/manual appearance remains explicitly deferred rather than passed;
- evidence/project memory match the code and the green checkpoint is pushed with `main` equal to `origin/main`.
