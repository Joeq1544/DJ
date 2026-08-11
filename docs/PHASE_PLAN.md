# DJ Copilot Personal MVP Milestones

Status: Approved 2026-08-10
Authoritative design: `superpowers/specs/2026-08-10-personal-full-feature-mvp-design.md`

Each milestone receives a separate bounded implementation plan. A milestone closes when Joe's normal workflow works, focused checks are green, in-scope defects are resolved or honestly recorded, project memory is current, and the green checkpoint is pushed.

Delivery note (2026-08-11): Joe explicitly deferred all visual QA until the full M1–M7 feature set is implemented. Intermediate milestones close on focused automated and non-visual integration evidence; deferred visual and native-interaction checks remain recorded for the final hands-on pass.

| Milestone | Integrated outcome | Completion evidence |
| --- | --- | --- |
| M0 — Scope reset and green foundation | Approved personal scope, historical evidence preserved, interrupted P0-016 removed, green baseline pushed | Direct documentation/ignore checks, Codex/MCP 52-test package, one aggregate baseline run, clean pushed checkpoint |
| M1 — App shell and real library slice | Electron/React + Python/SQLite launch; XML fixture and selected library browse in UI | Focused contracts and fixture desktop flow; native-picker visual check deferred under D-045 |
| M2 — Local analysis slice | Resumable selected-track analysis with progress, results, and isolated failures | Generated-audio desktop pause/restart/resume flow; visual check deferred under D-045 |
| M3 — Discovery and recommendation slice | Text/structured search, similarity, next-track ranking, reasons, and filters | Deterministic ranking tests and representative-library manual tuning |
| M4 — Set workflow slice | Editable/versioned drafts, pins/bans, analyzer, organization suggestions, and valid XML export | Complete desktop import-to-export fixture flow |
| M5 — Personalization slice | Feedback changes visible recommendation preferences with export/reset | Baseline-versus-adjusted fixture test and reset check |
| M6 — Codex-assisted slice | Existing-auth natural-language search, set planning/revision, explanations, and only necessary MCP tools | Mock integration plus one real existing-auth smoke flow |
| M7 — Personal release polish | Recovery, migrations, setup/limitations, accessibility pass, and runnable personal macOS build | Clean setup/build/manual workflow on Joe's Mac |

## M1 scaffold contract

M1 creates this minimal layout:

```text
package.json                  root pnpm dev/test/typecheck orchestration
pnpm-workspace.yaml           desktop package workspace declaration
app/desktop/                  Electron main, preload, and React renderer
core/dj_copilot/              Python service, SQLite ownership, and XML domain code
fixtures/                     generated/non-copyrighted integration inputs
```

The future root development command is `pnpm dev`, which launches the Electron desktop and supervised Python core. M0 documents this contract only; M1 creates and verifies it.
