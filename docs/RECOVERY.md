# Recovery Guide

Status: M2 complete at pushed post-review implementation checkpoint `a66e0d6`; independent reviewer READY
Last updated: 2026-08-11

## M0 green checkpoint

The first pushed project baseline is `1f1157054a59` on `main` (`chore: establish personal DJ Copilot baseline`). It contains the approved personal scope, project memory, historical research, generated fixtures, and the restored deterministic spike baseline. Use this hash as the comparison point for M1 work.

Inspect the checkpoint summary with `git show --stat 1f1157054a59`. Compare a later task-ledger change without touching the worktree with `git diff 1f1157054a59 -- TASKS.md`.

Before recovery, run `git status --short --branch` and identify tracked, project-created, and unrelated user-owned changes. Never infer that an untracked file is disposable.

## M1 implementation checkpoint

Checkpoint `16512c2` on `main` contains the exact workspace lock, production XML/SQLite core, supervised Electron boundary, preload API, and accessible library renderer. Final M1 checkpoint `dec0698` adds direct-file Electron coverage, restart/reload persistence, dialog cancel/select integration, cursor pagination, live status, graceful worker/runtime cleanup, documentation, and the aggregate gate. It passed 23 core tests, 47 desktop tests, strict TypeScript, production builds, and two Electron flows before being pushed to `origin/main`. Visual QA remains explicitly deferred to the completed app under D-045.

## M2 implementation checkpoint

Checkpoints `b700d7d`, `d1dad4b`, and `da730ba` add the versioned FFmpeg/NumPy provider, schema-v2 durable queue, strict desktop boundary, and analysis workstation. Checkpoint `e803c1d` adds the generated-audio restart/recovery gate and setup scripts; `5920c4b` corrects strict E2E tuple typing. Post-review checkpoint `a66e0d6` rejects stale/orphan completion across reimport and keeps the core/library usable when NumPy is absent. The post-review `pnpm verify:m2` run passed 56 core tests, 62 desktop tests, strict TypeScript, production builds, and three Electron flows. Exact results and fixture hashes are in `evidence/m2-local-analysis.md`.

## Safe Git recovery

- Do not use `git reset --hard`, broad checkout/restore commands, forced pushes, or recursive deletion against a dirty workspace.
- Use `git diff`, `git diff --cached`, `git show`, and path-scoped comparisons first.
- Back out a project-created change with a targeted inverse patch after confirming ownership.
- Preserve historical evidence even when its gate has been superseded.
- Green pushed hashes in `TASKS.md` are comparison/recovery points, not permission to erase later work.

## App and worker recovery

The core database is `dj-copilot.sqlite3` under the path Electron reports as `app.getPath("userData")`; the exact packaged application directory is not selected until M7. A failed XML import is transactional and retains the prior revision. One unexpected worker exit in 30 seconds triggers a restart; a second leaves the UI degraded until the app is restarted. Temporary socket state is disposable, but the SQLite file is durable app-owned data and must not be deleted as a generic troubleshooting step.

Opening an M1 database with M2 creates the first free sibling backup named from `dj-copilot.pre-m2.sqlite3` (then `dj-copilot.pre-m2-2.sqlite3`, and so on) before any schema-v2 DDL. Running analysis work requeues on orderly stop or restart; an explicitly paused queue stays paused. Successful current results and stable per-track failures remain in SQLite and reload with the library. A later import keeps them only when the stable track's normalized source path and availability are unchanged; a changed/unavailable source clears that track's analysis so an old worker result cannot be attached. Retry a failed or invalidated row after fixing its local source/prerequisite; do not delete the database to clear one job. Before changing or removing app state, close DJ Copilot, identify its exact user-data path, and copy both the database and any pre-M2 backup outside the repository.

## Database and export recovery requirements

Before app migrations ship, document the Application Support location, pre-migration backup, integrity check, restore path, and forward migration result. Never operate on Rekordbox databases. Before export ships, document temporary-file reparse and safe destination replacement.

## Reproduce M0

1. Read the approved personal MVP design and current `TASKS.md`.
2. Run the focused commands in the M0 plan.
3. Run `scripts/verify-phase0.sh` only for the recorded M0 aggregate baseline or after shared spike-contract changes.
4. Compare exact outcomes with `docs/evidence/phase-0/verification.md` and checkpoint `1f1157054a59`.
