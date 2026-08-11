# ADR-0009: Bounded Codex Assistance Without Production MCP

- Status: Accepted and implemented in M6
- Date: 2026-08-11
- Owners: primary, codex-mcp specialist, desktop and UI implementers

## Context

M6 must provide existing-auth natural-language library search, set planning/revision, explanations, streaming, cancellation, and confirmed durable changes. M1–M5 already expose strict path-free search, recommendation, set, inspection, and mutation commands through Electron main. The approved personal-use design makes MCP optional and explicitly retires the earlier containment/forensics gates.

The current official TypeScript SDK is `@openai/codex-sdk@0.147.0`. It is Apache-2.0, ESM-only, requires Node 18+, bundles the matching 0.147.0 CLI/runtime dependency, starts/resumes local threads, streams structured lifecycle/item events, accepts output JSON Schema, and accepts `AbortSignal`. The SDK still returns text that the application must parse and validate. Its public wrapper has no in-process tool callback API.

## Decision

Pin exactly `@openai/codex-sdk@0.147.0` behind `AIProvider` in Electron main. Production uses `CodexProvider` with the existing cached ChatGPT/Codex login; automated tests use `MockAIProvider`. Do not add an OpenAI API provider or key field. Leave the model unset so the signed-in Codex installation selects an entitled supported default; add no picker/router until measured use requires one.

M6 uses zero production MCP tools. Electron main gives Codex a bounded path-free request/context and validates one strict search, plan, or revision proposal. It executes all retrieval, ranking, replacement selection, inspection, and mutations through existing deterministic core commands. Natural-language explanation receives immutable app evidence and may cite only supplied current IDs.

Use a bounded in-memory main coordinator with fixed status/login/start/poll/cancel/confirm IPC. Polling carries complete text snapshots and allowlisted activity. It owns one active request, an application deadline, cancellation, capped/expiring event state, and single-use plan/revision confirmation bound to the originating request and current draft revision. No transcript database or schema migration is added.

Run Codex from an app-owned empty workspace with no audio/library roots, read-only sandbox, approval `never`, disabled web search, and no additional directories. Ordinary same-user Codex configuration/capabilities remain an accepted trust assumption. Do not port the Phase 0 wrapper, private MCP bridge, canaries, ambient isolation, process telemetry, or descendant-forensics machinery.

The SDK and complete Darwin arm64 target tree remain external to the CJS main bundle and outside ASAR so native lookup/spawn works. M7 verifies the exact package tree, notices/SBOM, nested signatures, and packaged launch.

## Consequences

Codex remains an interpreter/explainer, never the search engine, optimizer, database owner, or export writer. Unknown IDs and malformed proposals fail before use. Search/explanation are read-only; set creation/revision require trusted-UI confirmation. Local workflows do not initialize Codex and continue through auth/network/provider failure.

This design intentionally gives up autonomous tool loops and persistent AI chat history for M6. If real use shows that one read-only MCP tool materially improves a required workflow, add that exact tool in a superseding focused decision and exercise it through the real provider. Write MCP tools remain unnecessary because trusted main/core confirmation already owns durable actions.

## Implementation evidence

The final post-review gate passes 151 core tests, 219 desktop tests, strict TypeScript, the production build, and seven generated Electron flows. A separate redacted real existing-auth smoke passes exact SDK 0.147.0 status, structured search and plan on one resumed thread, AbortSignal cancellation, and production Electron-main behavior. Status is lazy and explicit, proposals remain single-use, valid no-ops return `unchanged`, and strict grounding accepts only supplied IDs/numbers including numbers copied from bounded metadata. The milestone reviewer returned READY with no unresolved High/Medium normal-workflow defect. Full packaged target-tree verification remains M7 work.
