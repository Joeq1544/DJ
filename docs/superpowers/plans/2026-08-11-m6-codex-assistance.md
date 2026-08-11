# M6 Codex Assistance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` and `superpowers:test-driven-development`. Work only in assigned files, do not use Git or project-memory files, preserve other agents' edits, and return focused red/green evidence to the primary agent.

**Goal:** Let Joe use the official Codex SDK and his existing ChatGPT/Codex login to search the local library in natural language, preview and confirm generated set plans or one draft revision, and receive grounded explanations without weakening any local workflow.

**Architecture:** Electron main owns one `AIProvider`, a bounded in-memory coordinator, and the official TypeScript Codex SDK. Codex interprets or explains only bounded path-free app evidence; the existing Python core remains the sole owner of search, ranking, sets, SQLite, and durable mutations. M6 starts with zero MCP tools because every required workflow is simpler through the existing fixed core commands. Renderer polling carries bounded progress/text snapshots and avoids a generic event bridge.

**Tech stack:** `@openai/codex-sdk@0.147.0` with its exact packaged runtime, Electron 43.3.0, React 19.2.8, TypeScript 7.0.2, Zod 4.4.3, Vitest 4.1.10, Playwright 1.62.1, and the existing Python core.

## Scope monitor and current official evidence

The single M6 scope monitor found that all required flows can use bounded main-owned context plus existing core commands. The approved design makes MCP optional. Do not port the Phase 0 wrapper, bridge, canaries, process telemetry, ambient-config proof, or containment machinery.

Current official evidence inspected on 2026-08-11:

- the official Codex SDK guide documents server-side Node 18+, start/continue/resume, and the normal `new Codex()` path;
- the official authentication guide documents cached ChatGPT login reuse and `codex login status`;
- npm `latest` is exactly `@openai/codex-sdk@0.147.0`, Apache-2.0, with exact `@openai/codex@0.147.0` and Darwin arm64 runtime packages;
- the 0.147.0 TypeScript declaration and JavaScript wrapper are byte-identical to the reviewed local 0.146.0 wrapper; the matching CLI/runtime changed;
- streaming emits lifecycle and complete item snapshots rather than token deltas; `outputSchema` is passed to the CLI but final text still requires application parsing and validation; `AbortSignal` cancels the direct helper;
- the current OpenAI resolver names `gpt-5.6-sol`, but M6 intentionally does not pin a model or build a picker. It lets the signed-in Codex installation choose a supported default, then evaluates the actual workflow. An explicit model is added only after a measured need.

## Stop conditions and explicit scope

- M6 is complete only when status/login recovery, natural-language filters/Similar/Next, set-plan preview/confirmation, one-operation draft revision preview/confirmation, grounded explanation, streaming snapshots, and cancellation work through the production desktop boundary.
- Deterministic automated tests use `MockAIProvider`. One explicit opt-in real Electron smoke must use `CodexProvider` 0.147.0, existing ChatGPT auth, generated metadata, and no API key.
- Visual QA, screenshots, and native appearance checks remain deferred under D-045.
- Raw audio, decoded samples, source paths, XML paths, credentials, notes, logs, and unrestricted library dumps never enter provider context.
- M6 adds no app-database schema, transcript/history store, model picker/router, API-key provider, local model, generic settings framework, multi-agent behavior, web search, or MCP server.
- At most one provider request is active. At most one draft mutation is proposed per request. A later multi-edit transaction requires a real-use need.
- Local library, analysis, discovery, set editing, personalization, and export initialize no Codex process unless Joe explicitly uses Copilot or requests status/login.
- The primary owns shared schemas, integration, project memory, staging, commits, and pushes. Delegated ownership is disjoint.

## Frozen M6 contracts

### Provider and runtime

`AIProvider` exposes:

```text
getStatus() -> ready | signed_out | unsupported_auth | unavailable
beginLogin(signal) -> sanitized status
runStructured(task, outputSchema, signal, onEvent) -> text + optional thread ID
runText(task, signal, onEvent) -> text + optional thread ID
```

`CodexProvider` lazy-imports the ESM SDK from Electron main. The dependency stays external to the CJS main bundle so its native package resolution remains intact. It uses an app-owned empty working directory, `skipGitRepoCheck`, read-only sandbox, approval `never`, disabled web search, no additional directories, and no API-key/base-URL option. A complete inherited environment copy may be supplied only after removing API-key/access-token override variables; do not pass a partial environment.

The matching packaged CLI wrapper performs status/login. Status accepts only sanitized categories and never returns raw helper output. A ready state requires existing ChatGPT authentication; API-key or other auth is unsupported by this product. M7 keeps the full Darwin arm64 Codex target tree outside ASAR and signs every nested executable.

The provider consumes `runStreamed()` itself. It requires `thread.started`, rejects top-level/turn failures, accepts only bounded completed `agent_message` text, records the opaque thread ID, clears deadlines after settlement, and ignores late events after abort. Structured calls use strict JSON Schema, `JSON.parse`, Zod parsing, known-ID checks, and at most one corrective turn on the same thread before safe failure. No partial text can become a proposal.

### Public request union

Every prompt is trimmed Unicode text of 1–2,000 characters.

```text
search
  prompt
  selectedTrackId?          current stable app ID only

plan
  prompt
  selectedTrackId?          current stable app ID only

revise
  prompt
  draftId
  expectedRevision

explain
  prompt
  subject = selected_track | next | draft
  selectedTrackId? / intent? / draftId? / expectedRevision?
```

Main resolves every referenced current track/draft through existing core commands before invoking Codex. It builds compact immutable context from existing path-free DTOs. Draft context is capped at 100 entries; recommendation/explanation evidence is capped at 20 tracks; provider text is capped at 8,000 characters.

### Strict provider proposals

Search output is exactly one of:

```text
filters { summary, filters: existing TrackFilters }
similar { summary, useSelectedTrack: true }
next { summary, useSelectedTrack: true, intent: existing eight-value intent }
unsupported { reason }
```

Codex never emits a seed ID. Main substitutes the already-validated selected track, then executes existing `list_tracks`, `find_similar_tracks`, or `recommend_next_tracks`. Returned cards/evidence come only from that local response.

Plan output is exactly:

```text
create_draft {
  summary,
  title,
  plan: existing SetDraftPlan,
  maxTracks: 1..50,
  useSelectedTrackAsSeed: boolean
}
unsupported { reason }
```

Main maps it to the existing generated `SetDraftCreateRequest`. Codex emits no track ID. The proposal is read-only until confirmation.

Revision output is one existing action or `unsupported`:

- rename;
- replace one entry with the best current deterministic local replacement;
- move one known entry;
- pin/unpin one known entry or position;
- remove or ban one known entry;
- update one entry role/energy goal;
- replace the draft plan;
- optimize.

Entry IDs must be from the supplied snapshot. `replace_with_best` is resolved by `find_set_replacements` and mapped to the top current candidate before preview. Core pin, ban, current-ID, bounds, and optimistic-revision rules remain authoritative.

Explanation is natural text so complete `agent_message` snapshots can be shown while running. References use `[track:<stable-id>]`; every reference must belong to the supplied bounded context. Unknown references, altered numeric evidence, oversized text, or embedded action JSON fail safely and never mutate state.

### Coordinator, polling, and confirmation

Fixed preload methods:

```text
assistant.getStatus()
assistant.beginLogin()
assistant.start(request) -> requestId
assistant.poll(requestId, afterSequence) -> bounded ordered events
assistant.cancel(requestId)
assistant.confirm(requestId, proposalId)
```

Events are strict and ordered: `activity`, `text_snapshot`, `search_result`, `proposal`, `completed`, `cancelled`, or `failed`. Activity is an allowlisted label, never raw SDK/MCP/command output. Poll returns at most 50 events and exact terminal state. Request/event state is in memory, capped, and expires after ten minutes.

One active request prevents accidental duplicate turns. Cancel aborts it and produces exactly one terminal cancellation; late provider events/results are discarded. Local provider errors are reduced to stable categories such as `signed_out`, `timeout`, `cancelled`, `invalid_response`, `unavailable`, or `unknown`.

Plan/revision proposals receive one opaque ten-minute ID. Confirmation is single-use and bound to the originating request plus normalized proposal; revision confirmation is also bound to draft ID and expected revision. Plan confirmation calls existing create only after consumption. Revision confirmation calls existing mutation only after current validation; conflicts return current revision instead of overwriting. Cancelled, expired, mismatched, replayed, invalid, or failed proposals write nothing.

### Renderer behavior

Add one inline **Copilot** region to the current Library screen rather than a router/window system.

- Status shows checking, ChatGPT ready, signed out, unsupported auth, and unavailable states with refresh/recovery. There is never an API-key field.
- Tabs/modes cover Search, Plan set, Revise draft, and Explain. Missing selected-track/draft context disables only the affected mode and explains why.
- Submitting starts one request, polls while active, shows allowlisted activity and text snapshots, and exposes Cancel.
- Search results display exact local track/evidence cards and their interpreted filter/intent summary.
- Plan/revision output is visually and semantically separated as a proposal. Confirm and discard are explicit; confirmation success opens/selects the resulting current draft. No prose click or partial stream writes state.
- Explanations render plain text and known track citations; scores remain app-supplied and unchanged.
- Loading, empty, unsupported, auth, timeout, cancellation, invalid-response, stale-revision, and last-good-result behavior receive renderer tests. Focus returns after cancel/discard/confirm.

## Implementation tasks

### Task 1: Freeze shared schemas and dependency composition

**Owner:** primary

**Files:** `app/desktop/src/shared/contracts.ts`, `app/desktop/package.json`, `pnpm-lock.yaml`, `app/desktop/scripts/build-main.mjs`, focused contract/build tests.

- [ ] Write strict red tests for every request/proposal/event/status/poll/confirm shape, bounds, unknown fields, and DesktopApi method.
- [ ] Pin `@openai/codex-sdk@0.147.0`; run install/typecheck. Add a compatible direct `@modelcontextprotocol/sdk` dependency only if the published declaration actually fails resolution.
- [ ] Prove the main bundle can lazy-import the externalized ESM SDK and preserve native dependency resolution.
- [ ] Commit/push the shared contract only when focused tests, typecheck, and production build are green.

### Task 2: Production and mock providers

**Owner:** codex-mcp specialist

**Files:** new `app/desktop/src/main/assistant/*` provider/runtime modules and focused provider tests only.

- [ ] Write red tests for exact status classification, no API-key options/environment, 0.147.0 configuration, structured schema parsing, known-ID validation hooks, complete streaming snapshots, new/resumed thread ID, timeout, cancellation, no late events, one corrective retry, and safe errors.
- [ ] Implement `AIProvider`, deterministic `MockAIProvider`, matching-helper auth runner, and lazy production `CodexProvider` without MCP or shell/file tools.
- [ ] Run focused provider tests, typecheck, and main build.

Task 2 begins after Task 1 freezes types. It must not edit shared schemas, IPC/preload, renderer, or project memory.

### Task 3: Main coordinator and trusted desktop boundary

**Owner:** desktop boundary implementer

**Files:** new coordinator/context/prompt modules, `app/desktop/src/main/ipc.ts`, `app/desktop/src/main/main.ts`, `app/desktop/src/preload/index.ts`, shutdown integration, focused main/preload tests.

- [ ] Write red tests for bounded context, exact local command routing, no provider call from local workflows, search execution, proposal-without-write, confirm-only write, single-use/expiry/mismatch/stale/conflict behavior, polling order/caps, cancellation, shutdown, and response validation.
- [ ] Implement concise versioned prompts from current official guidance: outcome, success criteria, evidence/ID constraints, no metadata instructions, output schema, and stop rule.
- [ ] Use only current path-free core DTOs/commands. Add no Python command or MCP bridge unless a failing required workflow proves it necessary and the plan is amended.
- [ ] Run focused boundary tests, desktop aggregate, typecheck, and build.

Task 3 begins after Task 1; it may run alongside Task 2 on disjoint provider files.

### Task 4: Inline Copilot UI

**Owner:** macOS UI specialist

**Files:** new renderer `features/assistant/*`, minimal `LibraryScreen.tsx`/set-selection integration, styles, focused renderer tests.

- [ ] Write behavior tests first for status/recovery, all four modes, disabled context, polling snapshots, cancel, exact local search evidence, proposal separation/confirm/discard, conflicts/errors/last-good state, citations, and focus return.
- [ ] Implement within existing semantic/tokens/components. No screenshots or visual QA.
- [ ] Run focused renderer tests, renderer aggregate, typecheck, and production build.

Task 4 begins after Task 1's public API is stable and may run alongside Tasks 2–3 on disjoint files.

### Task 5: Mock Electron flow and real existing-auth smoke

**Owner:** primary

- [ ] Add one generated nonvisual Electron flow using `MockAIProvider`: import, status, filters/Similar/Next, plan preview/no-write/confirm, one revision preview/no-write/confirm, grounded explanation, cancellation, local-workflow preservation, restart, source hashes, and runtime cleanup.
- [ ] Add an explicit opt-in real Electron smoke using the production 0.147.0 provider and current ChatGPT login. Use generated IDs/metadata only. Prove status, streamed event consumption, strict natural-language search, strict small set plan, exact thread ID/resume, and actual AbortSignal cancellation. Redact response text and record only bounded booleans/categories/counts.
- [ ] Add `pnpm verify:m6`: prerequisites/residue, complete core/desktop suites, strict typecheck/build, all mock Electron flows, and diff checks. Real smoke remains a separate explicit command but must run successfully once before M6 closes.
- [ ] Perform one concise read-only normal-workflow review, fix concrete High/Medium findings with focused regressions, synchronize docs/evidence, inspect staged payload, commit, and push.

## M6 completion gate

M6 closes only when:

- current ChatGPT auth works through the exact production provider and unsupported auth never becomes an API-key setup path;
- natural-language search executes current local commands and returns only current locally supplied evidence;
- set planning and one-operation revision remain previews until valid single-use confirmation, with stale/conflict/no-op behavior honest;
- explanations stream bounded snapshots, cite only supplied IDs, preserve app scores, and cannot mutate;
- timeout/cancel/auth/schema/provider failures preserve every local workflow and current draft;
- mock Electron flow, aggregate checks, and one redacted real existing-auth smoke pass with no known High/Medium normal-workflow defect;
- no raw audio/path/credential/private-log data enters provider context or Git;
- visual/manual appearance remains explicitly deferred rather than passed;
- project memory matches actual evidence and `main` equals `origin/main` at the green checkpoint.
