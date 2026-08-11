# DJ Copilot Test Strategy

Status: Personal full-feature MVP
Last updated: 2026-08-10

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

The socket-bearing suites need permission to create temporary local Unix sockets. That is an execution-environment prerequisite, not a network dependency.

## Manual checks

Manual evidence records date, target Mac/app build, input provenance without private contents, steps, outcome, and limitation. Personal XML/audio never enters Git. Real Codex checks are explicit, use existing auth, and record redacted outcomes without claiming behavior not observed.

## Historical Phase 0 suite

`scripts/verify-phase0.sh` preserves the aggregate research/spike baseline. M0 runs it once after removing the interrupted P0-016 work. It remains useful after a shared spike contract changes, but it is not required after every small product slice. Later milestones introduce root `pnpm` commands around the runnable app.
