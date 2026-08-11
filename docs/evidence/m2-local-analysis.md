# M2 Local Analysis Evidence

- Date: 2026-08-11
- Status: complete; post-review aggregate green and independent reviewer READY with no unresolved High/Medium finding
- Plan: `docs/superpowers/plans/2026-08-11-m2-local-analysis.md`
- Post-review green implementation checkpoint: `a66e0d6` (pushed to `origin/main`)

## Scope exercised

M2 composes the imported-library projection, schema-v2 analysis storage, one resumable local worker, the external FFmpeg/NumPy baseline provider, strict Python/Electron/preload contracts, and the renderer analysis workstation. The integrated flow uses only generated WAV/corrupt fixtures in an OS temporary directory. It sends no audio to Codex, writes no decoded PCM, changes no source fixture, and stores no personal path in a renderer response or Git.

## Automated evidence

| Check | Actual result |
| --- | --- |
| `python3 -B -m unittest core.tests.test_analysis_provider -v` | 10/10 passed, including exact provider versions, generated features, silence unknowns, stable failures, cooperative interruption, and the production-disabled test delay |
| `pnpm --dir app/desktop test:e2e:m2` | 1/1 passed independently in 14.0 seconds; measured analysis 11,075 ms |
| `bash -n scripts/setup-python.sh scripts/verify-m2.sh` | Passed; both scripts are mode `0755`; setup was not run because the exact dependencies were already present |
| First `pnpm verify:m2` | Correctly stopped after 51/51 core and 62/62 desktop tests when strict TypeScript found an E2E fixture tuple inferred as possibly undefined |
| `pnpm typecheck` after the tuple correction | Passed; immutable tuple typing removed the unsafe inference without changing runtime behavior |
| Pre-review corrected `pnpm verify:m2` | Passed in 27.2 seconds: 51 core, 62 desktop, strict TypeScript, production main/preload/renderer build, and 3 Electron flows |
| Post-review `pnpm verify:m2` | Passed in 28.7 seconds: 56 core, 62 desktop, strict TypeScript, production main/preload/renderer build, and 3 Electron flows; measured generated analysis 11,358 ms |
| `git diff --check` | Passed for the implementation and documentation worktrees |

The exercised development environment was Node 25.8.1, pnpm 11.16.0, Electron 43.3.0, CPython 3.14.3, NumPy 2.4.4, and external FFmpeg/ffprobe 8.1.2 on macOS arm64. `scripts/setup-python.sh` validates the decoder versions before creating `.venv`; `scripts/verify-m2.sh` prefers that project interpreter and otherwise uses `python3`.

## Generated-audio result

The built app imported a generated four-track XML through the production picker/IPC path with a main-process dialog stub, selected all four analyzable rows, observed nonzero progress, paused the queue, forced the supervised core to exit, and observed the replacement core remain paused. After a 1.25-second hold with unchanged progress it resumed to exactly three complete and one failed item. Reload preserved the same result and failure evidence.

| Fixture | SHA-256 | Integrated result |
| --- | --- | --- |
| `clicks.wav` | `836f499bdd1c829a55eb0838023eba10f9a884f623a891c6999bffe132f84774` | Complete; local tempo displayed as 120 BPM |
| `harmonic.wav` | `81d862856e8303bb7adb42efda2654329f417dd3e113d5130bc554e62ab7453d` | Complete; local key displayed as C major with tempo/key confidence and exact provenance |
| `silence.wav` | `e294409b36a8ac1893b23336eeab5202d3e84ce4f66c7572aa1589c43d43c1ff` | Complete; tempo and key both displayed as **Not enough evidence** |
| `corrupt.wav` | `e6d5b2896c0050728e8ee0f7a85ce25819a7151ec88c0dafcd6e758b751562f2` | Failed in isolation with the stable unsupported-format message |

The hashes were identical before and after analysis. The UI showed provider `ffmpeg-numpy-basic`, pipeline `baseline-v1`, and `ffmpeg 8.1.2; ffprobe 8.1.2; numpy 2.4.4`. App quit removed the supervisor runtime directory, and the test's `finally` block removed its generated XML, audio, database, and user-data root. No screenshot was created.

## Storage, queue, and boundary evidence

- Schema-v2 migration tests create the first free sibling pre-M2 backup before DDL; a new empty database does not create a meaningless backup.
- Reimport retains current analysis only when stable ID, normalized source path, and availability are unchanged. A path/availability change invalidates that track's job/features; a removed track rejects late completion. Success requires an existing track plus a running job with the exact recorded fingerprint, preventing stale or orphan features.
- One worker processes requested order. Pause cooperatively interrupts current work, explicit pause survives restart, running work requeues on shutdown, and one sanitized failure does not stop later work.
- Analysis status returns global counts plus only 1–200 explicitly requested item IDs. Renderer-facing records contain no source path.
- Four fixed analysis operations cross strict Python, Zod, IPC, and preload schemas. Missing FFmpeg, ffprobe, or NumPy disables only analysis. A real `python -S` service restart against an already-populated database proves health, tracks, and unavailable capabilities remain usable with no NumPy import.
- Renderer tests cover capped accessible selection, queue/retry, pause/resume, non-overlapping polling, progress, per-ID merging, imported-versus-local evidence, explicit limitations, and the semantic sixteen-bucket energy profile.

## Final review corrections

The single read-only M2 reviewer found two Medium normal-workflow defects and one recovery-document contradiction before closure:

- Reimport could race a claimed worker and attach old-source features to a changed stable track or recreate a feature orphan after track removal. Three regressions first failed, then passed after source-identity invalidation and transactional completion eligibility were added.
- NumPy was imported unconditionally before service startup, so a missing package crashed the core instead of degrading only analysis. Two subprocess regressions first failed at module import, then passed with guarded dependency loading and capability detection. Provider plus analysis-service suites passed 16/16 twice.
- Recovery named the pre-M2 backup incorrectly. The documented names now match the implementation and migration test: `dj-copilot.pre-m2.sqlite3`, then numbered siblings.

The post-correction full core suite increased from 51 to 56 tests. The same reviewer accepted both code corrections in focused rechecks and returned READY after the evidence reconciliation.

## Independent review

Read-only reviewer `/root/m2_final_review` returned READY for M2 closure with no unresolved High or Medium finding. It independently passed the 9-test analysis repository suite, 7-test queue-manager suite, 10-test provider suite, both missing-NumPy subprocess regressions, shell syntax, and diff hygiene, then inspected the recorded post-review aggregate and documentation reconciliation.

Two low notes are non-blocking and recorded in `KNOWN_ISSUES.md`: renderer DTO `mtimeNs` uses a JavaScript number even though the renderer does not use it for cache identity, and FFmpeg's development version check uses a prefix that could theoretically accept a longer patch token. Neither changes the measured exact 8.1.2 result or the core-authoritative fingerprint.

## Current limitations

- The tempo/key implementation is transparent heuristic evidence, not a Rekordbox beat grid or real-music accuracy claim. Joe's personal music and codec mix remain untested until the final hands-on period.
- Structure, semantic classification, and embeddings are explicit unavailable stages in M2.
- The installed Homebrew FFmpeg is GPL-configured and is an external personal-development prerequisite only. It is not bundled; M7 must select and verify a distributable decoder/runtime composition.
- Visual, light/dark, narrow-layout, and native-picker QA remain unperformed under D-045. Automation does not relabel them as passed.
