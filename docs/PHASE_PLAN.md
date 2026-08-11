# DJ Copilot Personal MVP Milestones

Status: Approved 2026-08-10
Authoritative design: `superpowers/specs/2026-08-10-personal-full-feature-mvp-design.md`

Each milestone receives a separate bounded implementation plan. A milestone closes when Joe's normal workflow works, focused checks are green, in-scope defects are resolved or honestly recorded, project memory is current, and the green checkpoint is pushed.

Delivery note (2026-08-11): Joe explicitly deferred all visual QA through implementation and then asked to skip it until after the complete app is handed over. Milestones close on focused automated and nonvisual integration evidence; deferred visual and native-interaction checks remain recorded for a later hands-on pass and are not marked as passed.

| Milestone | Integrated outcome | Completion evidence |
| --- | --- | --- |
| M0 — Scope reset and green foundation | Approved personal scope, historical evidence preserved, interrupted P0-016 removed, green baseline pushed | Direct documentation/ignore checks, Codex/MCP 52-test package, one aggregate baseline run, clean pushed checkpoint |
| M1 — App shell and real library slice | Electron/React + Python/SQLite launch; XML fixture and selected library browse in UI | Focused contracts and fixture desktop flow; native-picker visual check deferred under D-045 |
| M2 — Local analysis slice | Resumable selected-track analysis with progress, results, and isolated failures | Generated-audio desktop pause/restart/resume flow; visual check deferred under D-045 |
| M3 — Discovery and recommendation slice | Text/structured search, similarity, next-track ranking, reasons, and filters | Deterministic core/boundary/renderer tests plus generated-fixture desktop flow; subjective and visual tuning deferred under D-045 |
| M4 — Set workflow slice | Editable/versioned drafts, pins/bans, analyzer, organization suggestions, and valid XML export | Complete desktop import-to-export fixture flow |
| M5 — Personalization slice | Feedback changes visible recommendation preferences with export/reset | Baseline-versus-adjusted fixture test and reset check |
| M6 — Codex-assisted slice | Existing-auth natural-language search, set planning/revision, explanations, and only necessary MCP tools | Mock integration plus one real existing-auth smoke flow |
| M7 — Personal release polish | Recovery, migrations, setup/limitations, accessibility semantics, and runnable personal macOS build | Exact package composition/inspection, generated packaged workflow, missing-helper degradation, redacted packaged real-Codex smoke, and deferred visual/private-library checklist |

Progress on 2026-08-11: M0–M7 are complete. M7 implementation/package work is green and pushed through `61eac56`; the final nonvisual gate passed 161 core tests, 248 desktop tests, strict typecheck/build, nine tests across eight isolated Electron spec invocations, exact verification of the 630 MB arm64 app, and one separate packaged existing-auth Codex smoke. Project memory is synchronized, and the bounded final reviewer found no blocking High/Medium normal-workflow defect. Visual/native-picker appearance, real Rekordbox 7.2.14 import, personal-library relevance, and subjective audio/set checks stay deferred under D-045/KI-079.

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
