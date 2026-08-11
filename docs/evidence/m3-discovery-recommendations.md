# M3 Discovery and Recommendations Evidence

- Date: 2026-08-11
- Status: complete; post-review aggregate green and independent reviewer READY with no unresolved High/Medium finding
- Plan: `docs/superpowers/plans/2026-08-11-m3-discovery-recommendations.md`
- Core/boundary checkpoint: `5a5d59d` (pushed to `origin/main`)
- Renderer/integration checkpoint: `bb85aaa` (pushed to `origin/main`)
- Review correction and closure checkpoint: `1e9d347` (pushed to `origin/main`)

## Scope exercised

M3 composes schema-v2 imported metadata, playlist membership, current analysis state, and successful M2 features into text/structured filtering, `feature-similarity-v1`, and all eight `transition-v1` intents. The production desktop boundary exposes fixed find-similar and recommend-next operations. The Library screen adds filter controls, per-row Explore actions, Similar/Next tabs, intent selection, confidence, reasons, and component details without adding a route, embedding model, vector database, or schema migration.

Raw audio is never part of a discovery request. The integrated flow creates only generated marker files, XML, SQLite, and Electron user data under an OS temporary directory. Renderer responses contain stable app IDs and bounded metadata/evidence, not media paths.

## Automated evidence

| Check | Actual result |
| --- | --- |
| `python3 -B -m unittest core.tests.test_discovery -v` | 17/17 passed: casefolded/combined filters, exact and compatible keys, local evidence precedence, half/double tempo, exact rounding, every intent endpoint, confidence, missing evidence, stable ties, exclusions, caps, and validation |
| `python3 -B -m unittest core.tests.test_discovery_service -v` | Post-review 8/8 passed: single bounded projection, playlist/collection paging including repeated positions, unique discovery candidates, scan cap, exhaustive state mapping, strict payloads, path-free literal responses, and unknown seeds |
| Focused strict desktop boundary suite | 58/58 passed with exact Zod, trusted IPC, preload, and required TrackPage truncation contracts; strict TypeScript passed |
| `pnpm --dir app/desktop test discovery-screen library-screen analysis-screen` | 32/32 passed after updating the historical keyboard order for the new semantic controls |
| `pnpm --dir app/desktop test:e2e:m3` | 1/1 passed after the harness startup-order correction recorded as KI-061 |
| Post-review `pnpm verify:m3` | Passed: shell syntax and tracked-residue checks, 81/81 core, 104/104 desktop, strict TypeScript, production build, 4/4 Electron flows covering M1–M3, and diff hygiene |
| `git diff --check` | Passed for the implementation checkpoint and current post-review project-memory worktree |

The first sandboxed desktop-suite attempt timed out only in six tests that bind temporary Unix sockets. The identical suite passed 104/104 with local socket permission. The first focused M3 Electron run exposed KI-061 before discovery assertions; waiting for the first window before polling the main-process test hook fixed the harness, and both the focused and aggregate flows then passed.

## Milestone review correction

The single read-only M3 reviewer reproduced one Medium normal-workflow defect before closure: a playlist with repeated positions `(A, B, A)` became `(A, B)` when the M3 joined evidence projection powered `list_tracks`. Two regressions first failed. The correction preserves repeated rows and cursor position only for list/search, while discovery candidate catalogs remain unique and use the track's first playlist occurrence for deterministic order. The focused discovery/domain suite passed 25/25, the reviewer independently rechecked it, and the fresh post-review aggregate increased the core count from 79 to 81 with every gate green. KI-062 records the exact defect and regression.

## Independent review

Read-only reviewer `/root/m3_final_review` returned READY with no unresolved High or Medium defect. It independently passed the 25-test discovery/domain suite, complete 81-test core suite, affected 24-test renderer suite, and strict typecheck; inspected the fresh final aggregate; and found no tracked audio/database/cache residue, private-path leak, source mutation, or unexplained scope growth. The reviewer classified deferred visual/native interaction and personal-library relevance tuning as explicit limitations under D-045, not passed evidence or code defects.

## Integrated generated-fixture result

The built app imported eight generated metadata tracks and two playlists through the production picker/IPC/core path. A test-only setup script then added deterministic, already-measured-style feature rows to the temporary app database before relaunch; it did not bypass search, ranking, IPC, preload, or renderer behavior.

- Selecting **M3 Main** and combining text `signal` with 115–135 BPM returned exactly **Ascent Signal** then **Descent Signal**.
- Clearing filters, selecting **All Tracks**, and exploring **Neon Harbor** ranked **Double Echo** first under Similar.
- Switching Next to `genre_shift` ranked **Élan Bridge** first.
- Expanded details visibly contained Bonus, Penalty, and Missing evidence labels.
- Reloading the renderer and repeating the playlist/filter query returned the same two ordered tracks.
- The committed fixture hash was `757137fc2520d38ec8e1584cad72f5e10a3096995d572c79ae3251e928d2dee1`; every generated XML/marker hash matched before and after its flow.
- App shutdown removed the supervisor runtime directory; the test removed its temporary media, XML, database, and user-data root.

## Boundary and behavior evidence

- Track filtering AND-composes playlist, casefolded text tokens, BPM, normalized exact/compatible key, genre, local energy, analysis state, and availability. Collection and playlist order remain deterministic after filtering and pagination.
- One joined repository projection scans no more than 25,000 tracks, requires `truncated` in TrackPage, validates stored feature JSON, and omits normalized source paths.
- Discovery excludes the seed and unavailable candidates, rejects an unknown seed, caps output at twenty, and sorts stable ties by score, confidence, normalized metadata, then stable ID.
- Score components distinguish bonus, penalty, neutral, and missing. Missing components have no negative contribution; their absent coverage lowers confidence.
- Renderer tests cover submit/Clear, playlist and paging composition, loading/empty/error/truncation states, stale-response suppression, retaining the last good discovery response after failure, all eight intents, ordered candidates, and keyboard-reachable semantic controls.

## Current limitations

- The eight-track fixture proves deterministic engineering behavior, not subjective DJ usefulness. Joe's personal-library relevance, intent tuning, and transition acceptance remain deferred to the final hands-on period.
- Visual, light/dark, narrow-layout, and native-interaction QA remain unperformed under D-045. No screenshots were captured and automation does not relabel visual behavior as passed.
- Search is deliberate bounded token matching, not fuzzy or semantic search. Ranking uses current metadata and successful local features only; vocal and structure evidence remain explicitly missing where the intent requests them.
- Ordinary brute-force scans are capped at 25,000 current tracks. No representative personal-library latency measurement has yet justified FTS, embeddings, ANN, or a vector database.
