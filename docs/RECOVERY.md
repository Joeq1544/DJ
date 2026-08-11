# Recovery Guide

Status: M0 green baseline; M1 not started
Last updated: 2026-08-10

## M0 green checkpoint

The first pushed project baseline is `1f1157054a59` on `main` (`chore: establish personal DJ Copilot baseline`). It contains the approved personal scope, project memory, historical research, generated fixtures, and the restored deterministic spike baseline. Use this hash as the comparison point for M1 work.

Inspect the checkpoint summary with `git show --stat 1f1157054a59`. Compare a later task-ledger change without touching the worktree with `git diff 1f1157054a59 -- TASKS.md`.

Before recovery, run `git status --short --branch` and identify tracked, project-created, and unrelated user-owned changes. Never infer that an untracked file is disposable.

## Safe Git recovery

- Do not use `git reset --hard`, broad checkout/restore commands, forced pushes, or recursive deletion against a dirty workspace.
- Use `git diff`, `git diff --cached`, `git show`, and path-scoped comparisons first.
- Back out a project-created change with a targeted inverse patch after confirming ownership.
- Preserve historical evidence even when its gate has been superseded.
- Green pushed hashes in `TASKS.md` are comparison/recovery points, not permission to erase later work.

## App and worker recovery

No app process, worker, app database, migration, or analysis queue exists yet. M1 adds exact launch/health/restart behavior. M2 adds persisted analysis pause/resume/retry recovery.

## Database and export recovery requirements

Before app migrations ship, document the Application Support location, pre-migration backup, integrity check, restore path, and forward migration result. Never operate on Rekordbox databases. Before export ships, document temporary-file reparse and safe destination replacement.

## Reproduce M0

1. Read the approved personal MVP design and current `TASKS.md`.
2. Run the focused commands in the M0 plan.
3. Run `scripts/verify-phase0.sh` only for the recorded M0 aggregate baseline or after shared spike-contract changes.
4. Compare exact outcomes with `docs/evidence/phase-0/verification.md` and checkpoint `1f1157054a59`.
