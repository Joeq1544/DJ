# Recovery Guide

Status: M1 implementation checkpoint green; milestone verification in progress
Last updated: 2026-08-10

## M0 green checkpoint

The first pushed project baseline is `1f1157054a59` on `main` (`chore: establish personal DJ Copilot baseline`). It contains the approved personal scope, project memory, historical research, generated fixtures, and the restored deterministic spike baseline. Use this hash as the comparison point for M1 work.

Inspect the checkpoint summary with `git show --stat 1f1157054a59`. Compare a later task-ledger change without touching the worktree with `git diff 1f1157054a59 -- TASKS.md`.

Before recovery, run `git status --short --branch` and identify tracked, project-created, and unrelated user-owned changes. Never infer that an untracked file is disposable.

## M1 implementation checkpoint

Checkpoint `16512c2` on `main` contains the exact workspace lock, production XML/SQLite core, supervised Electron boundary, preload API, and accessible library renderer. It passed 22 core tests, 36 desktop tests, strict TypeScript, and the production build before being pushed to `origin/main`. The final M1 Electron/evidence checkpoint follows separately.

## Safe Git recovery

- Do not use `git reset --hard`, broad checkout/restore commands, forced pushes, or recursive deletion against a dirty workspace.
- Use `git diff`, `git diff --cached`, `git show`, and path-scoped comparisons first.
- Back out a project-created change with a targeted inverse patch after confirming ownership.
- Preserve historical evidence even when its gate has been superseded.
- Green pushed hashes in `TASKS.md` are comparison/recovery points, not permission to erase later work.

## App and worker recovery

The M1 core database is `dj-copilot.sqlite3` under the path Electron reports as `app.getPath("userData")`; the exact packaged application directory is not selected until M7. A failed XML import is transactional and retains the prior revision. One unexpected worker exit in 30 seconds triggers a restart; a second leaves the UI degraded until the app is restarted. Temporary socket state is disposable, but the SQLite file is durable app-owned data and must not be deleted as a generic troubleshooting step.

M2 adds persisted analysis pause/resume/retry recovery. Before changing or removing any app database, close DJ Copilot, identify its exact user-data path, and make a copy outside the repository.

## Database and export recovery requirements

Before app migrations ship, document the Application Support location, pre-migration backup, integrity check, restore path, and forward migration result. Never operate on Rekordbox databases. Before export ships, document temporary-file reparse and safe destination replacement.

## Reproduce M0

1. Read the approved personal MVP design and current `TASKS.md`.
2. Run the focused commands in the M0 plan.
3. Run `scripts/verify-phase0.sh` only for the recorded M0 aggregate baseline or after shared spike-contract changes.
4. Compare exact outcomes with `docs/evidence/phase-0/verification.md` and checkpoint `1f1157054a59`.
