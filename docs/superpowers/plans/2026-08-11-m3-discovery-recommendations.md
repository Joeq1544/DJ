# M3 Discovery and Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` and `superpowers:test-driven-development`. Work only in the files assigned to the task, do not use Git, and return focused verification evidence to the primary agent.

**Goal:** Let Joe search and filter the imported library, choose any real track as a seed, find musically similar tracks, and get deterministic next-track candidates with understandable bonuses, penalties, confidence, and missing-evidence explanations.

**Architecture:** Python remains authoritative for library evidence, filters, key/tempo normalization, similarity, and transition ranking. M3 reads the current schema-v2 track, playlist, job, and feature rows in one bounded projection and scores them in ordinary Python. Electron exposes two new fixed discovery operations and extends the existing track-list query; the current Library screen gains one compact filter form and one inline discovery panel.

**Tech Stack:** CPython 3.12+ standard library, SQLite, Electron 43.3.0, React 19.2.8, TypeScript 7.0.2, Zod 4.4.3, Vitest 4.1.10, Playwright 1.62.1.

## Stop conditions and explicit scope

- M3 is complete only when text/structured search, seed similarity, all eight next-track intents, score explanations, useful filters, strict desktop boundaries, and one generated-fixture Electron flow work together.
- Keep SQLite at schema version 2. Do not add FTS, fuzzy search, embeddings, an embedding model, ANN, a vector database, or a mandatory 10,000-track benchmark. Casefolded token search and bounded brute force are the approved personal-library baseline.
- Read only current imported metadata and successful M2 features. Do not invent tags, ratings, history, vocal content, phrase timing, structure, embeddings, or preferences.
- Missing evidence is not a negative musical judgment. It reduces coverage/confidence and is displayed as missing; available components are renormalized for the musical score.
- Rekordbox-owned files and source audio remain read-only. Discovery requests contain stable app IDs and filters, never paths or audio.
- Natural-language search and Codex explanations are M6. Draft editing/optimization/export are M4. Feedback and visible preference weights are M5.
- Saved filters are assigned to M5 alongside other app-owned preferences; they are not silently dropped. A routed full inspector, virtualization changes, and richer imported tags/notes remain later-slice work.
- Visual QA, screenshots, native-picker appearance checks, and subjective listening/tuning are deferred under D-045 until all M1–M7 functionality is implemented. M3 still requires accessible semantics, renderer behavior tests, and a nonvisual Electron flow.
- The primary agent owns shared contracts, repository/service integration, project memory, staging, commits, and pushes. Subagents own only the disjoint files explicitly assigned below.

## Frozen M3 contracts

### Filters and paging

Extend `list_tracks` / `library.listTracks` with the following optional strict fields while retaining `playlistId`, opaque `cursor`, and `limit`:

```text
text                    1..200 characters; every casefolded whitespace token must match
bpmMinMilli/bpmMaxMilli 30,000..400,000; min <= max
musicalKey              1..64 characters
keyRelation             exact | compatible (requires musicalKey)
genre                   1..200 characters; casefolded substring
energyMinPpm/MaxPpm     0..1,000,000; min <= max
analysisState           any | analyzed | not_analyzed | failed
availability            any | available | missing | unreadable
```

Text covers title, artist, album, and genre. Playlist membership and every supplied filter are AND constraints. Collection results retain normalized title/artist/ID order; playlist results retain playlist position/ID order. Cursor semantics remain stable after filtering. The query reads at most 25,000 tracks, returns at most 200 per page, and reports `truncated: true` if the personal-library scan cap was reached. An empty filter object preserves the M1/M2 browsing behavior.

Effective evidence is fixed as follows:

- tempo: successful local BPM with confidence at least 500,000, otherwise imported BPM;
- key: successful local key/mode with confidence at least 500,000, otherwise imported key;
- energy and timbre: successful local analysis only;
- genre and availability: current imported metadata.

`analysisState=analyzed` means a succeeded job with one valid feature row; `failed` means a failed job; `not_analyzed` means anything without valid succeeded features, including failed, queued, running, paused, and never queued; `any` adds no constraint. Search availability `any` adds no constraint and the three concrete values match exactly.

### Discovery operations

Expose exactly:

```text
discovery.findSimilar({ seedTrackId, filters?, limit? })
discovery.recommendNext({ seedTrackId, intent, filters?, limit? })
```

`seedTrackId` is 1..128 characters, `limit` defaults to 10 and is 1..20, and `filters` uses the same bounded shape without cursor/limit. Discovery always excludes the seed and always ANDs candidate availability with `available`. Thus `availability=any` and `availability=available` both search available candidates, while an explicit `missing` or `unreadable` constraint produces an honest empty result. A seed itself may be any current track because metadata-only comparison remains useful. An unknown or removed seed returns `not_found`, never an empty success.

The fixed intent enum is:

```text
smooth
build
peak
reset
genre_shift
adventurous
singalong_continuation
closer
```

The exact path-free discovery track is `{ id, title, artist, album, genre, bpmMilli, musicalKey, durationMs, availability }`, using the existing public track field bounds but omitting analysis details and every private path. The exact responses are:

```text
SimilarityResponse {
  seed: DiscoveryTrack
  algorithmVersion: "feature-similarity-v1"
  scannedCount: integer 0..25,000
  truncated: boolean
  items: DiscoveryCandidate[0..20]
}

RecommendationResponse {
  seed: DiscoveryTrack
  intent: DiscoveryIntent
  algorithmVersion: "transition-v1"
  scannedCount: integer 0..25,000
  truncated: boolean
  items: DiscoveryCandidate[0..20]
}

DiscoveryCandidate {
  track: DiscoveryTrack
  scorePpm: integer 0..1,000,000
  confidencePpm: integer 0..1,000,000
  reasons: string[1..3], each 1..200 characters
  components: ScoreComponent[1..8]
}

ScoreComponent {
  name: tempo | key | energy | style | timbre | vocal | structure | preference
  scorePpm: integer 0..1,000,000 | null
  weightPpm: integer 0..1,000,000
  contributionSignedPpm: integer -1,000,000..1,000,000
  effect: bonus | penalty | neutral | missing
  reason: string 1..200 characters
}
```

`TrackPage` becomes exactly `{ items, nextCursor, truncated }`; `truncated` is required and false for an uncapped scan, including every legacy unfiltered page. Unknown properties fail validation at both Python and TypeScript boundaries. One literal Python response fixture must be accepted unchanged by the exact Zod response schemas.

### Deterministic evidence and scoring v1

Normalize common Camelot values (`1A`..`12B`) and note names with sharps/flats plus optional major/minor. Exact wheels score 1,000,000; adjacent numbers with the same letter score 900,000; same number with the other letter scores 800,000; known incompatible keys score 0. Unparseable or absent keys are missing.

Tempo compatibility compares the candidate BPM, half-time, and double-time rational variants against the seed. For each candidate variant `numerator/denominator`, compute `differencePpm = roundHalfUp(abs(numerator - seed * denominator) * 1,000,000 / (seed * denominator))`, take the minimum, then compute `score = max(0, 1,000,000 - roundHalfUp(differencePpm * 1,000,000 / 120,000))`. Equality is 1,000,000 and differences of at least 12% are 0.

Similarity v1 uses fixed weights:

| Component | Weight |
| --- | ---: |
| tempo | 250,000 |
| key | 250,000 |
| energy closeness | 200,000 |
| genre/style continuity | 150,000 |
| timbre closeness | 150,000 |

Transition v1 uses the same primitive scores but fixed per-intent direction and weights:

| Intent | tempo | key | energy | style | timbre | explicitly missing evidence |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| smooth | 300,000 | 250,000 | 200,000 close | 150,000 same | 100,000 close | none |
| build | 200,000 | 150,000 | 350,000 higher | 150,000 same | 150,000 close | none |
| peak | 150,000 | 150,000 | 400,000 high/not lower | 100,000 same | 200,000 energetic contrast | none |
| reset | 150,000 | 150,000 | 400,000 lower | 150,000 same | 150,000 close | none |
| genre_shift | 150,000 | 150,000 | 150,000 close | 350,000 different | 200,000 bridge | none |
| adventurous | 150,000 | 100,000 | 200,000 contrast | 250,000 different | 300,000 contrast | none |
| singalong_continuation | 200,000 | 150,000 | 200,000 close | 150,000 same | 100,000 close | vocal 200,000 |
| closer | 150,000 | 200,000 | 300,000 lower/moderate | 150,000 same | 100,000 close | structure 100,000 |

Use these exact primitive scores, all clipped to 0..1,000,000:

- energy closeness: `1,000,000 - abs(candidate - seed)`;
- energy contrast: `abs(candidate - seed)`;
- target ramp: `1,000,000 - min(1,000,000, roundHalfUp(abs(candidate - target) * 1,000,000 / tolerance))`;
- build target/tolerance: `min(1,000,000, seed + 150,000)` / `300,000`;
- reset target/tolerance: `max(0, seed - 200,000)` / `400,000`;
- peak target/tolerance: `max(seed, 850,000)` / `300,000`;
- closer target/tolerance: `clamp(seed - 200,000, 250,000, 550,000)` / `400,000`;
- genre continuity: 1,000,000 only when trimmed casefolded genres are equal, otherwise 0; missing genre is missing;
- genre shift/adventurous style: `1,000,000 - continuity` when both genres exist;
- timbre closeness: the rounded mean of brightness closeness, beat-strength closeness, relative onset-rate closeness, and relative spectral-centroid closeness when the respective pair exists. Bounded PPM closeness is `1,000,000 - abs(a-b)`; relative closeness is `1,000,000 - min(1,000,000, roundHalfUp(abs(a-b) * 1,000,000 / max(a,b,1)))`. At least the first three pairs exist for two successful M2 feature rows. Peak and adventurous use `1,000,000 - timbreCloseness`; every other intent, including genre shift's bridge, uses closeness.

`roundHalfUp` is integer half-up for nonnegative values. `roundHalfAwayFromZero` applies the same magnitude rule and restores the sign. For every available component, `contributionSignedPpm = roundHalfAwayFromZero(weightPpm * (2 * scorePpm - 1,000,000) / 1,000,000)`. Scores at least 600,000 are bonuses, below 400,000 are penalties, and the remainder is neutral. Missing components have null score, zero contribution, `missing`, and an exact limitation reason.

The candidate musical score is `roundHalfUp(sum(weight * score) / sum(availableWeight))`; if every component is missing, it is 0. Component evidence quality combines both tracks: local tempo/key uses its stored confidence, imported tempo/key and genre use 600,000, and successful local energy/timbre use 700,000; a pair uses the lesser source quality. Confidence is `roundHalfUp(sum(weight * pairedEvidenceQuality) / 1,000,000)`, with missing components contributing zero. This simultaneously captures source quality and full-weight coverage without calling missing evidence a penalty.

Main reasons are the two available components with greatest absolute signed contribution (component enum order breaks ties), followed by the first intent-required missing component when one exists, capped at three. If no component is available, use up to three missing reasons. Sort candidates by score descending, confidence descending, normalized title, normalized artist, then stable app ID. Algorithm versions are `feature-similarity-v1` and `transition-v1`. Hand-calculated tests cover every target endpoint, mixed local/imported quality, exact rounding ties, and an all-missing candidate.

---

### Task 1: Pure discovery domain and deterministic fixture

**Owner:** ranking specialist

**Files:**
- Create: `core/dj_copilot/discovery.py`
- Create: `core/tests/test_discovery.py`
- Create: `fixtures/discovery/m3-library.json`

**Boundary supplied by primary:** Implement immutable pure Python input/output records inside `discovery.py`; do not import the database or service. Accept a tuple of `TrackEvidence` records containing a `StoredTrack`, optional successful `AnalysisFeatures`, and optional playlist IDs.

- [x] **Step 1: Write red tests first**

Use a generated/non-copyrighted eight-track fixture: seed, smooth match, compatible-key tie, higher-energy build, lower-energy reset, half/double-tempo match, Unicode/different-genre bridge, and sparse/unavailable evidence. Cover casefolded token search, combined filters, exact/compatible key, local-over-imported evidence, half/double tempo, every intent and target endpoint, mixed provenance confidence, exact rounding ties, an all-missing candidate, seed exclusion, unavailable exclusion, missing versus penalty, bounded reasons, stable ties, unknown seed, and result caps.

Run:

```bash
python3 -B -m unittest core.tests.test_discovery -v
```

Expected red: the production discovery module does not exist.

- [x] **Step 2: Implement only the frozen v1 rules and rerun green**

Keep formulas integer-only on the wire, side-effect-free, and deterministic. Do not add plugin interfaces, learned weights, embeddings, or speculative abstraction. Validate IDs, bounds, contradictory ranges, and fixed enums at the domain entry points as a second line of defense.

---

### Task 2: Batched schema-v2 repository projection and Python service

**Owner:** primary

**Files:**
- Modify: `core/dj_copilot/models.py`
- Modify: `core/dj_copilot/database.py`
- Modify: `core/dj_copilot/service.py`
- Modify: `core/tests/test_database.py`
- Create or modify: `core/tests/test_service.py`
- Create: `core/tests/test_discovery_service.py`

- [x] **Step 1: Add red repository and service tests**

Prove one bounded query/projection supplies track, analysis JSON, analysis status, and playlist membership without calling `analysis_summary` per candidate. Test collection and playlist cursor order after filtering, scan truncation, Unicode text, every exposed numeric range, exhaustive availability and analysis-state mapping, unknown playlist/seed, invalid/extra payload fields, response caps, path omission, and stable service error codes.

Run:

```bash
python3 -B -m unittest core.tests.test_database core.tests.test_service core.tests.test_discovery_service -v
```

- [x] **Step 2: Implement the projection and commands**

Add a repository method that returns at most 25,001 joined rows ordered once, decodes each feature JSON through the existing validator, and maps successful feature evidence without exposing `source_path`. Extend `list_tracks` with filters and use pure discovery predicates before paging. Add `find_similar_tracks` and `recommend_next_tracks` dispatch. Keep ordinary request work bounded to the existing desktop timeout; do not change schema or migration behavior.

- [x] **Step 3: Run the complete core suite**

```bash
python3 -B -m unittest discover -s core/tests -v
```

Expected: all historical and M3 core tests pass with no database, cache, or personal data left in the repository.

---

### Task 3: Strict TypeScript, IPC, and preload boundary

**Owner:** desktop boundary implementer

**Files:**
- Modify: `app/desktop/src/shared/contracts.ts`
- Modify: `app/desktop/src/main/ipc.ts`
- Modify: `app/desktop/src/preload/index.ts`
- Modify: `app/desktop/tests/contracts.test.ts`
- Modify: `app/desktop/tests/main-security.test.ts`
- Modify: `app/desktop/tests/preload-contract.test.ts`
- Create: `app/desktop/tests/discovery-contracts.test.ts`

- [x] **Step 1: Add red strict-boundary tests**

Cover every bound and cross-field relation, all eight intents, nullable missing component scores, `contributionSignedPpm`, maximum arrays, required TrackPage truncation, one literal Python-wire response, unknown-field rejection, result path omission, trusted sender checks, core-response validation, and that preload exposes exactly the two fixed discovery methods without a generic invoke surface.

- [x] **Step 2: Implement the contracts and adapters**

Use Zod strict objects and discriminated enums. Add only `discovery:findSimilar` and `discovery:recommendNext`, both mapped to fixed core commands. Preserve the existing 1 MiB JSON-line cap and current ordinary timeout.

- [x] **Step 3: Run focused boundary checks**

```bash
pnpm --dir app/desktop test discovery-contracts contracts main-security preload-contract
pnpm typecheck
```

---

### Task 4: Accessible inline discovery workflow

**Owner:** macOS UI specialist

**Files:**
- Create: `app/desktop/src/renderer/src/features/discovery/DiscoveryFilters.tsx`
- Create: `app/desktop/src/renderer/src/features/discovery/DiscoveryPanel.tsx`
- Modify: `app/desktop/src/renderer/src/features/library/LibraryScreen.tsx`
- Modify: `app/desktop/src/renderer/src/features/library/TrackTable.tsx`
- Modify: `app/desktop/src/renderer/src/styles.css`
- Create: `app/desktop/tests/discovery-screen.test.tsx`

**Boundary supplied by Task 3:** Consume only `DesktopApi`, `TrackFilters`, `DiscoveryIntent`, and discovery response types from shared contracts. Do not edit shared contracts, IPC, preload, project memory, E2E, or package files.

- [x] **Step 1: Write renderer behavior tests first**

Cover labeled text/BPM/key/genre/energy/analysis/availability controls; submit by button and Enter; Clear; selected-playlist composition; loading, empty, partial-error, and stale-response suppression; preserving the last successful discovery results on failure; accessible `Explore {title}` seed selection; Similar/Next tabs; all intent choices; ordered candidates; score/confidence; main reasons; and native `<details>` with bonus, penalty, neutral, and missing evidence.

- [x] **Step 2: Implement the single-screen workflow**

Active filters replace the server-backed track page and remain active for load-more and discovery. Clear restores ordinary playlist browsing. One Explore button per row sets the seed and opens the inline panel. Do not add a route, drag/drop, charts, a full inspector, generated visual assets, or M4/M5/M6 controls.

- [x] **Step 3: Run renderer tests and production build**

```bash
pnpm --dir app/desktop test discovery-screen library-screen analysis-screen
pnpm typecheck
pnpm --dir app/desktop build
```

No screenshot or visual QA step is run in M3.

---

### Task 5: Generated-fixture integration, aggregate gate, and project memory

**Owner:** primary

**Files:**
- Create: `app/desktop/e2e/discovery-flow.spec.ts`
- Create: `scripts/verify-m3.sh`
- Modify: `package.json`
- Modify: `app/desktop/package.json`
- Create: `docs/evidence/m3-discovery-recommendations.md`
- Modify: `TASKS.md`
- Modify: `DECISIONS.md`
- Modify: `KNOWN_ISSUES.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/EVALUATION.md`
- Modify: `docs/PHASE_PLAN.md`
- Modify: `docs/TEST_STRATEGY.md`
- Modify: `docs/USER_GUIDE.md`
- Modify: `docs/adr/0006-embedding-storage-and-search.md`

- [x] **Step 1: Write the Electron flow before considering M3 complete**

Create a temporary XML/library from the M3 fixture and inject deterministic feature rows through an explicit test-only setup path before app launch. Through production UI/IPC/core behavior, import, combine text+BPM+playlist filters, assert exact ordered results, explore a seed, assert a similar candidate, change recommendation intent, and assert deterministic candidate order plus visible bonus, penalty, and missing-evidence reasons. Reload and repeat one query. Hash all source fixtures before/after and remove temporary user data. Do not capture screenshots.

- [x] **Step 2: Add and run the aggregate gate**

`scripts/verify-m3.sh` runs the complete core suite, complete desktop unit suite, strict typecheck, production build, M1/M2/M3 Electron flows, shell syntax validation, and repository residue checks. Expose it as `pnpm verify:m3`.

```bash
pnpm verify:m3
git diff --check
git status --short
```

- [x] **Step 3: Perform one concise read-only milestone review**

One independent reviewer checks only normal-workflow correctness, evidence integrity, unexplained scope growth, source immutability/private-path leakage, and whether any High/Medium defect blocks closure. Fix concrete findings with focused regressions; do not create repeated review loops.

- [x] **Step 4: Record actual evidence, commit, and push**

Update every listed project-memory file with commands, counts, outcomes, limitations, and any reproducible defect. Record subjective personal-library tuning and visual QA as deferred—not passed. Inspect the staged diff for audio, XML exports, databases, credentials, private logs, and generated caches. Commit a green M3 checkpoint and push `main` to `origin` before beginning the separate M4 plan.

## M3 completion gate

M3 closes only when:

- text and structured filters work on collection and selected-playlist results;
- similar and next-track requests use real current-library IDs, hard constraints, stable order, and all eight intents;
- candidate explanations distinguish bonuses, penalties, neutral evidence, and missing evidence without timing/structure claims;
- strict Python/Zod/IPC/preload tests and the complete generated-fixture Electron flow pass;
- no known High/Medium defect blocks Joe's normal discovery workflow;
- visual and personal-library subjective checks remain explicitly deferred under D-045;
- `TASKS.md`, decisions, known issues, ADR-0006, architecture/evaluation/test/user docs, and M3 evidence match reality;
- the green checkpoint is pushed and `main` agrees with `origin/main`.
