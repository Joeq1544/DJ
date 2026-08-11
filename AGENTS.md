# DJ Copilot Repository Guidance

## Authority and scope

- The personal full-feature MVP design at `docs/superpowers/specs/2026-08-10-personal-full-feature-mvp-design.md` governs MVP execution.
- `dj-copilot-codex-master-prompt.md` remains the detailed product source and historical plan; its 2026-08-10 amendment resolves conflicts.
- Direct user instructions and platform safety rules take precedence over repository guidance.
- Rekordbox remains the source of truth. Never write Rekordbox-owned databases or source audio.
- Use only the official Codex SDK with existing Codex/ChatGPT authentication. Never add an `OPENAI_API_KEY` flow.
- Raw audio remains local and is never sent to Codex.

## Project memory

- `TASKS.md` is the work-status source of truth. A task is `done` only when its acceptance criteria and evidence are linked.
- Record settled choices in `DECISIONS.md` and `docs/adr/`; do not reopen them without new evidence.
- Record reproducible defects in `KNOWN_ISSUES.md`, including regression-test status.
- Keep architecture, research, licensing, evaluation, test, privacy, recovery, and user documentation current with the code.

## Delivery workflow

1. Work within the current M0–M7 milestone and follow its approved bounded plan.
2. Prefer a usable vertical slice and direct implementation over speculative abstractions.
3. Use focused tests, one relevant typecheck, and an integrated fixture/manual flow. Expand only after a failure or material shared-boundary change.
4. Use one concise scope/quality review at a milestone boundary; repeated security or reviewer loops are not default gates.
5. Update `TASKS.md`, decisions, known issues, evidence, and user documentation with actual outcomes.
6. Inspect status and diff, commit a green checkpoint, and push substantial slices and completed milestones to `origin`.

## Ownership and safety

- The primary agent owns shared contracts, project-memory files, integration, staging, commits, and pushes.
- Delegate only disjoint bounded work with explicit file ownership; subagents do not stage, commit, switch branches, or edit shared/generated files.
- Keep personal library data, audio, app databases, credentials, private logs, and generated analysis out of Git.
- Standard schema validation, renderer isolation, path checks, source immutability, migration backups, and explicit confirmation for consequential writes remain required.
- Do not block this personal MVP on hostile same-user process containment, exhaustive Codex capability denial, public-distribution hardening, or theoretical edge cases that do not affect normal use.

## Verification principles

- UI presence is not feature completion. Require an automated exercise or documented manual result for the integrated behavior.
- Deterministic checks use generated/non-copyrighted fixtures and `MockAIProvider`; real Codex and personal-library checks are explicit manual or opt-in flows.
- Do not hide unavailable dependencies or external prerequisites by skipping tests or returning empty success.
- Run broader suites only when a shared contract changes, a focused failure suggests wider risk, or the milestone plan calls for a baseline/release check.
