# DJ Copilot Test Strategy

Status: Personal full-feature MVP
Last updated: 2026-08-11

## Completion evidence

Code or UI presence is not completion. A feature is complete when its integrated user-visible behavior is exercised by a focused automated test or a documented manual flow with actual results.

Project reports distinguish automated pass, manual pass, external prerequisite, accepted limitation, deferred/non-goal, and known defect. Generated, non-copyrighted XML/audio fixtures and `MockAIProvider` are the deterministic default.

## Focused milestone verification

Each milestone normally uses:

- focused unit tests for deterministic domain rules;
- an integration test for the main success path and realistic failures;
- the relevant TypeScript typecheck and Python syntax/test check;
- one generated-fixture desktop flow once the app shell exists;
- manual verification for a real Rekordbox XML, installed codecs, existing Codex auth, and personal macOS packaging where relevant.

Bug fixes reproduce the defect first and keep the smallest meaningful regression test. Human documentation is inspected directly rather than protected by brittle tests that assert exact prose.

## When to broaden testing

Broaden beyond the focused checks when:

- a renderer/main/core or other shared contract changes;
- a database migration, backup, or XML export can affect durable data;
- a focused failure suggests wider impact;
- real library use exposes a performance problem;
- a milestone plan explicitly calls for an aggregate or packaging check.

Exhaustive fuzz/property matrices, cross-language parity for unused representations, repeated independent reviewers, process-containment forensics, and public-release validation are not default personal-MVP gates.

## Current executable gates

- `pnpm test:core` exercises the production XML parser, atomic SQLite projection, cursor behavior, and local service protocol.
- `pnpm test:desktop` exercises runtime schemas, socket client/supervision, guarded IPC/preload, renderer behavior, accessibility, and keyboard navigation.
- `pnpm typecheck` checks the strict TypeScript desktop workspace.
- `pnpm build` emits the Electron main/preload and Vite renderer bundles.
- `pnpm verify:m1` composes those checks with the Playwright Electron fixture import, playlist browse, and one-core-restart recovery flow.
- `pnpm verify:m2` adds exact NumPy/FFmpeg prerequisite checks; missing-NumPy library degradation and reimport/late-completion regressions; and the generated-audio selection, pause, forced-core-restart, persisted-resume, success/failure isolation, feature-evidence, source-hash, reload, and runtime-cleanup flow.
- `pnpm verify:m3` adds deterministic filters/similarity/all-intent ranking, the schema-v2 joined discovery projection, strict Python/Zod/IPC/preload discovery boundaries, renderer search/explanation behavior, and the generated eight-track playlist/filter/Similar/Next/reload/source-hash flow. It also reruns every M1/M2 Electron flow.
- `pnpm verify:m4` adds schema-v3 migration/history, deterministic set-domain and XML-export regressions, strict set/export desktop boundaries, renderer set behaviors, and a generated official numeric-KeyType import-to-export flow. The post-review gate reruns all 119 core and 116 desktop tests, strict typecheck/build, and all five M1–M4 Electron flows, including repeats, edits/pins/bans/replacement/goals/optimization, undo/redo, save/view/restore, playlist/draft inspection, cancel/new/overwrite export, production-parser reparse, persistence, source hashes, and cleanup.
- `pnpm verify:m5` adds schema-v4 migration/backup, metadata/saved-filter/feedback persistence, deterministic preference and scorer behavior, strict preference export, accessible renderer controls, and a generated seven-track personalization flow. The final gate passes 151 core and 137 desktop tests, strict typecheck/build, and all six M1–M5 Electron flows; the M5 flow covers retained metadata after reimport, composed filters, saved-view lifecycle, explicit and atomic set evidence, a real active rank change, cancel/new/overwrite export, exact reset, restart preservation, source hashes, and cleanup. A renderer regression separately proves reset invalidates and refetches an already-open personalized comparison.
- `pnpm verify:m6` passes 151 core tests, 219 desktop tests, strict typecheck/build, and seven generated Electron flows. Its `MockAIProvider` flow covers explicit status, natural-language filters/Similar/Next, set-plan/revision preview-confirm, grounded explanation, polling, cancellation, persistence, hashes, and cleanup. The separate explicit real Electron smoke passed exact SDK 0.147.0 with existing ChatGPT auth, structured search/plan on one resumed thread, real cancellation, and explicit renderer status while recording only redacted booleans. No API-key or visual gate is permitted.

The socket-bearing suites need permission to create temporary local Unix sockets. That is an execution-environment prerequisite, not a network dependency.

## Manual checks

Joe has explicitly deferred visual QA until every M1–M7 feature is implemented. During implementation, milestones still require focused automated behavior and non-visual integration coverage; automated gates do not capture screenshots. Deferred native UI and visual checks remain documented rather than inferred or marked passed. The final hands-on period records the target Mac/app build, input provenance without private contents, steps, outcomes, and limitations.

Personal XML/audio never enters Git. Real Codex checks are explicit, use existing auth, and record redacted outcomes without claiming behavior not observed.

## Historical Phase 0 suite

`scripts/verify-phase0.sh` preserves the aggregate research/spike baseline. M0 runs it once after removing the interrupted P0-016 work. It remains useful after a shared spike contract changes, but it is not required after every small product slice. Later milestones introduce root `pnpm` commands around the runnable app.
