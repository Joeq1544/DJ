# M1 App Shell and Library Evidence

- Date: 2026-08-11
- Status: complete; automated/integration gate and independent code review green, visual QA explicitly deferred to the completed app
- Plan: `docs/superpowers/plans/2026-08-10-m1-app-shell-library.md`
- Implementation checkpoints: `16512c2` and `dec0698` (pushed to `origin/main`)

## Scope exercised

M1 composes the sandboxed Electron/React window, guarded preload API, supervised Python service, bounded Rekordbox XML parser, app-owned SQLite projection, and accessible library/playlist UI. All deterministic checks use the repository-owned `fixtures/rekordbox/phase0-library.xml`; no personal XML, audio, credentials, database, or cache is copied into Git.

## Automated evidence

| Check | Actual result |
| --- | --- |
| `python3 -B -m unittest discover -s core/tests -v` | 23/23 passed on host CPython 3.14.3; temporary Unix-socket permission was allowed by the outer runner |
| `pnpm --dir app/desktop test` | 47/47 passed: 6 shared contracts, 25 main/preload/supervision, and 16 renderer behavior/accessibility tests |
| `pnpm typecheck` | Passed with TypeScript 7.0.2 |
| `pnpm build` | Passed; emitted Electron main/preload CJS bundles and the Vite renderer |
| `pnpm --dir app/desktop test:e2e` | 2/2 passed against the built renderer loaded directly from an asserted `file:` URL |
| `pnpm verify:m1` | Passed in 8.1 seconds: 23 core, 47 desktop, typecheck, both builds, and 2 Electron flows |
| `git diff --check` | Passed after the complete Task 5 changes |

The fixture parser test verifies four tracks, deterministic source SHA-256 `780618d97cfa005cb34daa5c721e0b1529e1bc4c1a7d6315d4115fa8418ab176`, unchanged source bytes, nested folders/playlists, Unicode and percent-decoded paths, Opening membership order `2,1`, Closer order `4,3`, and missing-file status without opening audio.

## Runtime and recovery evidence

- Exact development dependencies are committed in `pnpm-lock.yaml`. The exercised environment was Node 25.8.1, pnpm 11.16.0, Electron 43.3.0, and Python 3.14.3.
- The development core uses `DJ_COPILOT_PYTHON` or `python3` and is compatible with Python 3.12+. Bundled CPython remains M7 evidence.
- Failed imports retain the prior SQLite revision in database and UI tests. Import requests receive an explicit 120-second client budget while health/browse commands remain at five seconds; a client disconnect after import no longer terminates the service.
- Supervision tests prove one restart, degraded state after a second exit within 30 seconds, clean stop, private runtime permissions, current-client lookup after replacement, stale-socket cleanup, and exact runtime-directory removal. Electron blocks quit until that cleanup settles.
- The primary Electron test creates an isolated temporary user-data directory, removes any ambient development URL, asserts a `file:` renderer, imports four tracks/four playlist nodes, observes retrying then ready after a non-enumerable main-process-only forced exit, reloads, sees the same four tracks, verifies both Opening rows by title, browses through the replacement client, and proves the runtime directory is gone after quit.
- A second Electron flow starts without the fixture-path override and stubs Electron's real `dialog.showOpenDialog` method in the main process to exercise harmless cancel followed by selected-path import through the production IPC handler. It does not claim visual interaction with the native macOS dialog.
- Renderer tests prove two-second live status refresh, accessible cursor pagination beyond the first 100 rows, mouse and keyboard folder expansion, nested visual indentation, exact playlist selection, and supported degraded recovery copy.
- The first aggregate rerun exposed a one-event-loop-tick assumption in the supervisor test after stale-socket cleanup became asynchronous. The test now uses a bounded state wait; the supervisor suite passed 40 consecutive runs (200 tests) before the complete gate passed.

## Development launch and deferred visual QA

`pnpm dev` was launched twice against the normal Electron user-data directory. The first launch exposed Vite's React-refresh preamble being blocked by the CSP; development now permits only the exact inline/loopback Vite needs while the packaged policy retains `script-src 'self'` and `connect-src 'self'`. The second launch kept Vite, the bundle watcher, Electron 43.3.0, the Python service, and a renderer process with `--enable-sandbox` running without the prior console error until intentionally stopped with Ctrl-C. The fixture hash after both launches remained `780618d…176`. A populated direct-file screenshot produced by the Electron flow was visually inspected: the cue-sheet layout, nested playlist indentation, success/status copy, four table rows, and non-color missing markers rendered legibly.

Native picker clicking/cancelling was not visually observed because this runner could not capture the display or obtain a macOS accessibility tree. Dialog ownership/cancel behavior is covered by the guarded-IPC regression, and the real Electron flow covers fixture import through the test-only fixture selector. On 2026-08-11 Joe explicitly deferred all visual QA until the complete M1–M7 app is ready. This check remains deferred and is not recorded as a pass.

## Independent review

Read-only reviewer `/root/m1_final_review` independently reproduced 23/23 core tests, 47/47 desktop tests, typecheck, and diff hygiene, and accepted the direct-file loading, atomic import preservation, restart/current-client behavior, sandboxed IPC, pagination, playlist interaction/order, and runtime cleanup with no High/Medium code defect. Its only completion finding was the unperformed visual native-picker check; D-045 resolves that process finding by deferring it to the final hands-on app pass without relabeling it as passed.

## Personal Rekordbox XML

Not run — personal input not supplied. M1 does not claim compatibility with Joe's exact Rekordbox export until he explicitly selects one. Any future evidence records only redacted counts/hash/outcome, never library metadata or paths.

## Current limitations

- This is a development composition, not the self-contained, signed, or notarized personal app; packaging is M7.
- XML support is intentionally the official Rekordbox `DJ_PLAYLISTS` version `1.0.0` UTF-8/UTF-8-BOM baseline. Unsupported real-world variants fail without replacing the prior library.
- M1 reports file availability from metadata paths but does not open or analyze audio; local analysis begins in M2.
