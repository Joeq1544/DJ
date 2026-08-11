# Recovery Guide

Status: M0–M7 personal implementation and package checkpoints recorded
Last updated: 2026-08-11

## M0 green checkpoint

The first pushed project baseline is `1f1157054a59` on `main` (`chore: establish personal DJ Copilot baseline`). It contains the approved personal scope, project memory, historical research, generated fixtures, and the restored deterministic spike baseline. Use this hash as the comparison point for M1 work.

Inspect the checkpoint summary with `git show --stat 1f1157054a59`. Compare a later task-ledger change without touching the worktree with `git diff 1f1157054a59 -- TASKS.md`.

Before recovery, run `git status --short --branch` and identify tracked, project-created, and unrelated user-owned changes. Never infer that an untracked file is disposable.

## M1 implementation checkpoint

Checkpoint `16512c2` on `main` contains the exact workspace lock, production XML/SQLite core, supervised Electron boundary, preload API, and accessible library renderer. Final M1 checkpoint `dec0698` adds direct-file Electron coverage, restart/reload persistence, dialog cancel/select integration, cursor pagination, live status, graceful worker/runtime cleanup, documentation, and the aggregate gate. It passed 23 core tests, 47 desktop tests, strict TypeScript, production builds, and two Electron flows before being pushed to `origin/main`. Visual QA remains explicitly deferred to the completed app under D-045.

## M2 implementation checkpoint

Checkpoints `b700d7d`, `d1dad4b`, and `da730ba` add the versioned FFmpeg/NumPy provider, schema-v2 durable queue, strict desktop boundary, and analysis workstation. Checkpoint `e803c1d` adds the generated-audio restart/recovery gate and setup scripts; `5920c4b` corrects strict E2E tuple typing. Post-review checkpoint `a66e0d6` rejects stale/orphan completion across reimport and keeps the core/library usable when NumPy is absent. The post-review `pnpm verify:m2` run passed 56 core tests, 62 desktop tests, strict TypeScript, production builds, and three Electron flows. Exact results and fixture hashes are in `evidence/m2-local-analysis.md`.

## M3 and M4 implementation checkpoints

M3 checkpoints `5a5d59d`, `bb85aaa`, and `1e9d347` add and close deterministic discovery. M4 checkpoints `3f87261`, `abad8c3`, `82bbf94`, and `dd741d6` add official XML compatibility/export, schema-v3 drafts, the desktop workspace, and the complete import-to-export flow. After review corrections, `pnpm verify:m4` passed 119 core tests, 116 desktop tests, strict TypeScript, production builds, and all five Electron flows; reviewer READY and correction checkpoint `10d2511` close M4.

## M5 implementation checkpoints

Checkpoints `3ada231` and `035e1ba` add the deterministic preference scorer and complete trusted desktop/UI slice. Checkpoint `b5cbee6` adds schema-v4 persistence, strict services, atomic set feedback, and the generated personalization flow. After the reviewer-found stale-comparison correction, `pnpm verify:m5` passes 151 core tests, 137 desktop tests, strict TypeScript/build, and all six Electron flows. Opening schema v3 creates the first free `dj-copilot.pre-m5.sqlite3` sibling before v4 DDL; reopening v4 creates no new migration backup.

M6 closure checkpoint `fd0984e` adds the official Codex-assisted slice without changing the SQLite schema or recovery format. Copilot requests, events, opaque thread IDs, and proposals are intentionally memory-only and expire; restarting the app discards them without affecting the library or drafts. A provider/auth/schema/cancellation failure performs no hidden write, and a draft proposal must be requested again after restart. Final M6 verification passes 151 core tests, 219 desktop tests, seven generated Electron flows, and a separate redacted real existing-auth smoke.

## M7 personal release checkpoints

Checkpoint `e1b9107` adds exact decoder validation, selected-analysis rebuild, online SQLite backup, packaged-only resource resolution, and the diagnostics/recovery UI. Checkpoint `61eac56` composes and verifies the personal arm64 app at `out/DJ Copilot-darwin-arm64/DJ Copilot.app`. `bash scripts/verify-m7.sh` passes 161 core tests, 248 desktop tests, strict typecheck/build, nine tests across eight isolated nonvisual Electron spec invocations, and package architecture/version/hash/symlink/license/signature checks. A separate packaged existing-auth Codex smoke passes without retaining response text. The generated release directory is ignored by Git; the pushed source/checkpoints are the reproducible recovery points.

## Safe Git recovery

- Do not use `git reset --hard`, broad checkout/restore commands, forced pushes, or recursive deletion against a dirty workspace.
- Use `git diff`, `git diff --cached`, `git show`, and path-scoped comparisons first.
- Back out a project-created change with a targeted inverse patch after confirming ownership.
- Preserve historical evidence even when its gate has been superseded.
- Green pushed hashes in `TASKS.md` are comparison/recovery points, not permission to erase later work.

## App and worker recovery

The core database is `dj-copilot.sqlite3` under Electron's app-owned user-data folder. Use **Diagnostics and recovery → Show data folder** to reveal the exact folder before quitting; the renderer and diagnostics export never receive that path. A failed XML import is transactional and retains the prior revision. One unexpected worker exit in 30 seconds triggers a restart; a second leaves the UI degraded until the app is restarted. Temporary socket state is disposable, but the SQLite file is durable app-owned data and must not be deleted as a generic troubleshooting step.

Opening an M1 database with M2 creates the first free sibling backup named from `dj-copilot.pre-m2.sqlite3` (then `dj-copilot.pre-m2-2.sqlite3`, and so on) before any schema-v2 DDL. Running analysis work requeues on orderly stop or restart; an explicitly paused queue stays paused. Successful current results and stable per-track failures remain in SQLite and reload with the library. A later import keeps them only when the stable track's normalized source path and availability are unchanged; a changed/unavailable source clears that track's analysis so an old worker result cannot be attached. Retry a failed or invalidated row after fixing its local source/prerequisite; do not delete the database to clear one job. Before changing or removing app state, close DJ Copilot, identify its exact user-data path, and copy both the database and any pre-M2 backup outside the repository.

Opening a schema-v2 database with M4 creates the first free `dj-copilot.pre-m4.sqlite3` sibling (then `dj-copilot.pre-m4-2.sqlite3`, and so on) before schema-v3 DDL. Draft heads, revision history, and saved versions are app-owned SQLite data; quitting and reopening reloads them. An optimistic-revision conflict reloads the current head rather than overwriting another edit. Undo/redo and version restore append or move through recorded app history and never change Rekordbox. If an older/directly seeded library has no remembered selected XML source, reimport through **Import Rekordbox XML** before exporting.

Opening schema v3 with M5 creates the first free `dj-copilot.pre-m5.sqlite3` sibling before schema-v4 DDL. Ratings, tags, notes, saved filters, and feedback live in the same app database. Reimport keeps metadata for retained stable IDs and removes metadata for tracks no longer present. **Reset preferences** deletes feedback and clears ratings only; tags, notes, saved filters, drafts, analysis, and the library remain. Preference JSON and redacted diagnostics exports are for inspection, not database restore.

## M7 recovery actions

- **Refresh diagnostics** reports database integrity, schema, packaged resources, and analysis availability without exposing private paths or checking Codex auth.
- **Back up database** asks for a destination, uses SQLite's online backup API while the core remains the sole live writer, validates the backup's integrity/schema, syncs a mode-`0600` temporary sibling, and atomically replaces only the selected destination. Cancellation makes no change. Keep at least one backup outside the app-data folder before experiments or manual restore.
- **Rebuild selected analysis** requires a second confirmation, removes only app-owned analysis for the currently selected tracks, and queues fresh local analysis. It never edits source audio or Rekordbox data. Use it for stale/corrupt derived results, not for an unavailable source file.
- **Export redacted diagnostics** is useful for inspection/support but cannot restore the library. **Show data folder** opens app-owned storage and should not be treated as permission to delete it.

## Offline database restore

DJ Copilot intentionally does not replace its live database. To restore an app-created `.sqlite3` backup:

1. While the current app still opens, choose **Show data folder** and note the revealed folder. Make a fresh **Back up database** copy if the current state may still be useful.
2. Quit DJ Copilot completely with Command-Q and wait for its window/process to close. Never replace `dj-copilot.sqlite3` while the app is running.
3. In the revealed data folder, rename the current `dj-copilot.sqlite3` to a dated safety name such as `dj-copilot.before-restore.sqlite3`. Do not overwrite migration backups or your selected external backup.
4. Copy the chosen app-created backup into that folder and name the copy exactly `dj-copilot.sqlite3`. Keep the original backup untouched elsewhere.
5. Reopen DJ Copilot. Refresh diagnostics, confirm database integrity is `OK`, then inspect the library, a draft, and preferences. An older supported schema may create its normal pre-migration sibling before opening.
6. If startup or data inspection fails, quit again, move the failed restored copy aside, rename the dated safety copy back to `dj-copilot.sqlite3`, and reopen. Preserve both files until the desired state is confirmed.

This procedure restores app-owned SQLite state only. It cannot restore source audio, Rekordbox data, prior XML/export destinations, in-memory Copilot requests, or files removed outside DJ Copilot.

## Uninstall or reinstall

Quit DJ Copilot first. Removing or replacing `DJ Copilot.app` does not intentionally remove the app-owned user-data folder, so a rebuilt app can reopen the existing library. Back up the database before reinstalling. To intentionally wipe DJ Copilot, first use **Show data folder**, quit completely, preserve any wanted backup/export, then move only that exact revealed DJ Copilot data folder to Trash. Never remove a parent Application Support directory or a Rekordbox/music folder.

## Export recovery

Export never edits the imported XML or a Rekordbox database. Preparation rejects stale/unavailable entries, a source alias, symlinks/non-regular destinations, and changed absent/regular-file state. Confirmation writes a mode-`0600` temporary sibling beside the chosen `.xml`, syncs and reparses it, compares exact collection/playlist order, rechecks destination state, and only then uses atomic replacement. Failures before replacement report the destination unchanged and remove the temporary sibling; a replacement/transport failure is reported as unknown rather than falsely claiming preservation. Inspect the destination before retrying an unknown outcome. A confirmed overwrite is intentionally not recoverable from DJ Copilot, so choose a new destination or keep your own copy when the prior file matters.

## Reproduce M0

1. Read the approved personal MVP design and current `TASKS.md`.
2. Run the focused commands in the M0 plan.
3. Run `scripts/verify-phase0.sh` only for the recorded M0 aggregate baseline or after shared spike-contract changes.
4. Compare exact outcomes with `docs/evidence/phase-0/verification.md` and checkpoint `1f1157054a59`.
