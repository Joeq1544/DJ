# Changelog

All notable project changes are recorded here. The repository now produces one local personal build; no public release has been published.

## Unreleased

### 2026-08-11 — M7 personal arm64 release

- Added selected-analysis rebuild, exact FFmpeg version-token validation, path-free diagnostics, app-data-folder access, and an online SQLite backup that validates integrity/schema and atomically replaces only the chosen destination.
- Added packaged-only resource resolution for the PyInstaller core, FFmpeg/ffprobe, and Codex runtime. Packaged mode fails honestly when a bundled helper is missing and never falls back to host Python, `PATH` FFmpeg, a development virtual environment, or a cwd-discovered SDK.
- Added the compact **Diagnostics & recovery** region through strict IPC/preload contracts while preserving source XML/audio immutability, renderer isolation, local operation without Codex, and explicit user actions.
- Built a self-contained 630 MB Apple-silicon `.app` with Electron 43.3.0, CPython 3.14.3, NumPy 2.4.4, PyInstaller 6.21.0, source-built LGPL FFmpeg/ffprobe 8.1.2, and the complete official Codex 0.147.0 target tree.
- Preserved the pnpm Codex target topology as contained relative links, generated a resource hash manifest, CycloneDX component inventory, and third-party notices from the composed package, then ad-hoc signed and verified the nested arm64 executables and final bundle.
- Added a packaged generated workflow covering import, good/corrupt analysis isolation, discovery, personalization, mock Copilot confirmation, set export, diagnostics/backup, relaunch persistence, immutable sources, and cleanup; a copied-package test separately proves missing-helper degradation without ambient fallback.
- Final `bash scripts/verify-m7.sh` passes 161 core tests, 248 desktop tests, strict typecheck/build, all eight isolated nonvisual Electron spec files, and exact package verification. A separate packaged existing-ChatGPT-auth smoke passes search, a second bounded plan request, cancellation, and cleanup without recording response text.
- The one bounded final reviewer independently passed package verification, 5/5 recovery checks, and 14/14 diagnostics/runtime/preload checks and found no blocking High/Medium normal-workflow, packaging, recovery, or documentation defect.
- Visual appearance, native-picker appearance, personal Rekordbox/audio compatibility, and subjective MIR/recommendation/set quality remain explicitly deferred at Joe's request. The build is ad-hoc signed for personal use, not Developer-ID signed, notarized, universal, or public-distribution-ready.

### 2026-08-11 — M6 Codex assistance planning

- Selected exact official `@openai/codex-sdk@0.147.0` for Electron main with the user's existing ChatGPT/Codex login, no API-key provider, no pinned model, and deterministic `MockAIProvider` tests.
- Accepted ADR-0009 and a bounded M6 plan for natural-language filters/Similar/Next, confirmed generated set plans, one confirmed draft revision, grounded explanations, polling snapshots, and cancellation.
- Chose zero production MCP tools: Codex interprets bounded path-free evidence while the existing Python core remains the only search, ranking, set, and durable-state owner.
- Retired Phase 0 wrapper/bridge/containment machinery stays historical. M6 requires focused contracts, one generated mock Electron flow, one redacted real existing-auth Electron smoke, and no visual QA.
- Added exact-helper existing-ChatGPT status/login, lazy official SDK orchestration, strict structured schemas, complete streamed snapshot handling, same-thread correction, deadlines/cancellation, stable errors, and a deterministic mock provider.
- Added bounded main-owned context, search/Similar/Next routing, grounded explanations, generated-plan and one-revision proposals, polling, cancellation, and single-use confirmation without a production MCP server or Python protocol change.
- Added the inline Copilot region with four modes, explicit status/sign-in actions, local evidence, proposal separation, conflicts/errors, last-good state, citations, cancellation, and focus restoration. Merely launching the Library now performs no Codex helper call.
- The real smoke first exposed strict-output incompatibility in the generated draft-07 schema. The corrected root-object/required/nullable/typed-constant adapter now passes real structured search and same-thread set planning through exact SDK 0.147.0, plus real cancellation and production Electron-main behavior.
- The one bounded review found and closed implicit mount status, mislabeled valid no-op confirmation, and numeric-title grounding defects. Final `pnpm verify:m6` passes 151 core tests, 219 desktop tests, strict typecheck/build, and seven generated Electron flows; the separate corrected real existing-auth smoke passes 1/1, and the reviewer returned READY. Visual QA remains deferred under D-045.

### 2026-08-11 — M5 personalization and library metadata planning

- Accepted ADR-0008 and a bounded three-table M5 plan for ratings/tags/notes, saved filters, explicit feedback, deterministic visible preference effects, baseline comparison, confirmed export, and reset.
- Kept the slice on the existing SQLite/ranking/Library-screen architecture with no ML service, embeddings, FTS, background learner, event framework, or visual QA gate.
- Added and pushed deterministic `preference-linear-v1`, metadata-aware filtering, the existing scorer's optional preference component, and exact schema-v3/v4 draft-filter compatibility at `3ada231`; its focused pure aggregate passes 47/47.
- Added and pushed strict desktop contracts, fixed trusted IPC/preload operations, bounded revision-bound atomic JSON export, and accessible inline metadata/filter/feedback/comparison/profile/reset controls at `035e1ba`.
- The desktop implementation passes 34/34 focused boundary tests, the post-review 42/42 renderer aggregate, the complete 137/137 desktop aggregate, strict typecheck, and the production build. Visual QA remains skipped under D-045.
- Added schema-v4 backup/migration, metadata and saved-filter persistence, strict feedback/profile/comparison/reset/export services, active recommendation/set evidence, and atomic successful-draft signals at `b5cbee6`.
- Added `pnpm verify:m5` and a seven-track generated Electron flow. The final gate passes 151 core tests, 137 desktop tests, strict typecheck/build, and all six Electron flows, including retained metadata, a visible active rank change, bounded preference export, exact reset, restart preservation, immutable sources, and cleanup.
- The single bounded reviewer found that resetting preferences could leave an open Next panel visibly stale. A RED/GREEN renderer regression now invalidates the old comparison immediately and refetches the baseline in place; no High finding or other Medium finding remained, so M5 is closed.

### 2026-08-11 — M4 set workflow and Rekordbox export slice

- Added schema-v3 persistent set drafts with immutable snapshots, optimistic revisions, branch-aware undo/redo, saved-version view/restore, repeats, track/position pins, bans, roles, energy goals, constraints, and restart persistence.
- Added deterministic generated sets, replacement alternatives, bounded pin-safe optimization, playlist/draft progression and transition inspection, warnings, and advisory organization suggestions by reusing M3 evidence.
- Added official numeric-KeyType Rekordbox playlist compatibility and a deterministic self-contained XML writer with current-ID/path resolution, mode-0600 sibling writes, fsync, production-parser semantic reparse, race checks, and atomic finalize.
- Added six strict set and two confirmed-export desktop operations plus the inline accessible set workspace; Electron main owns the native destination and renderer responses remain path-free.
- Added the generated official-XML Electron flow covering repeats, edits/history/versions, playlist/draft inspection, cancel/new/overwrite export, exact reparse order, reload persistence, immutable source hashes, and cleanup.
- Corrected invalid launcher intents and saved-head version identity during integration, then fixed review findings around historical read-only state, identical restores, stale-revision ordering, and repeated-playlist analysis IDs. The post-review `pnpm verify:m4` gate passes 119 core, 116 desktop, strict typecheck/build, and all five Electron flows. Visual/native Rekordbox QA remains deferred under D-045.
- Closed M4 at pushed checkpoint `10d2511` after the original reviewer returned READY with no unresolved High/Medium normal-workflow issue.

### 2026-08-11 — M3 discovery and recommendations slice

- Added bounded path-free library filters, deterministic feature similarity, all eight transition intents, confidence, component evidence, missing-evidence handling, and stable tie behavior without adding embeddings or a vector database.
- Added strict core/desktop discovery operations and accessible Library search, Similar, Next, intent, and explanation controls.
- Added a generated eight-track Electron flow for playlist-aware search, exact Similar/genre-shift ranking, explanations, reload persistence, source hashes, and cleanup.
- Corrected repeated playlist-position collapse during the single bounded review and closed M3 at pushed checkpoint `1e9d347`; the final aggregate passed 81 core, 104 desktop, strict typecheck/build, and four Electron flows.

### 2026-08-11 — M2 local analysis slice

- Added a transparent `ffmpeg-numpy-basic` local provider with exact provenance, streamed in-memory decode, bounded metadata/basic features, heuristic tempo/key confidence, honest silence unknowns, and stable per-file errors.
- Added schema-v2 analysis jobs/results with pre-DDL M1 backup, deterministic single-worker ordering, pause/resume, restart requeue, exact cache invalidation, reimport retention, and path-free renderer records.
- Added four strict analysis operations across the Python service, Electron main, isolated preload, and React renderer while preserving library use when the provider is unavailable.
- Added capped track selection, queue/retry controls, progress and failure counts, imported-versus-local evidence, limitations, provenance, and a sixteen-part energy profile.
- Added exact setup/verification scripts and a generated-audio desktop flow proving pause across a forced core restart, three successes plus one isolated corrupt-file failure, reload persistence, immutable source hashes, and runtime cleanup.
- Fixed the final-review findings: reimport now invalidates changed source identities and rejects stale/orphan completion; missing NumPy degrades only analysis while health/library remain usable; recovery names the exact pre-M2 backup.
- Closed M2 at pushed post-review implementation checkpoint `a66e0d6` after the independent reviewer returned READY with no unresolved High/Medium finding. Visual QA remains deferred under D-045.

### 2026-08-10 — M1 app shell and library slice

- Added the exact pnpm/Electron/React/TypeScript workspace and production main, preload, and renderer builds.
- Added a bounded UTF-8 Rekordbox XML importer, stable app IDs, ordered playlist projection, atomic SQLite replacement, and a private local core service.
- Added Electron-owned XML selection, guarded IPC, a sandboxed fixed preload API, one bounded core restart, and replacement-client recovery.
- Added the accessible cue-sheet library workstation with empty, loading, live ready/degraded, success, retained-error, paged tracks, mouse/keyboard nested-tree, and missing-track states.
- Added graceful worker/runtime cleanup, a practical long-import timeout, and service survival when a requesting client disconnects.
- Added focused core/desktop verification and the generated-fixture Electron gate; personal XML validation remains opt-in and local.
- Closed M1 at pushed checkpoint `dec0698`; visual QA is explicitly deferred to the completed M1–M7 app rather than inferred from automation.

### 2026-08-10 — Personal full-feature MVP scope

- Approved M0–M7 delivery while retaining every user-facing feature: Rekordbox interchange, local analysis, library UI, search/similarity/ranking, recommendations, set building/analysis/export, organization, personalization, Codex assistance, recovery, accessibility, diagnostics, and a personal macOS build.
- Replaced commercial-style security, repeated-review, exhaustive-test, and public-release gates with practical safeguards and focused personal-workflow evidence.
- Stopped P0-016 before completion; its missing MCP process-observability evidence remains historical rather than being relabeled as a pass.
- Removed the four unfinished P0-016 control-channel files and restored direct `python_mcp/server.py` registration; the Codex/MCP package is back to 52 passing tests plus a clean typecheck.
- Accepted the official TypeScript Codex SDK under ordinary same-user trust while retaining structured validation, known-ID enforcement, renderer isolation, local raw audio, and confirmed consequential writes.
- Adopted frequent green GitHub checkpoints after substantial self-contained slices and completed milestones.
- Preserved all completed Phase 0 research and verification reports as historical evidence.
- Revalidated the M0 foundation with 11/11 focused project-script tests, 52/52 Codex/MCP tests, a clean package typecheck, and the 186-test aggregate gate with all three TypeScript typechecks.
- Completed M0 at green checkpoint `1f1157054a59`, pushed it to `origin/main`, and left M1 unstarted pending its separate implementation plan.

### Historical Phase 0 — superseded gate

- Established persistent project management, architecture, research, test, security, privacy, recovery, licensing, evaluation, and user-documentation skeletons.
- Recorded non-negotiable data, Rekordbox, Codex-authentication, and verification boundaries from the authoritative specification.
- Added tested project-scoped Codex agent profiles and a locally compatible four-thread configuration without pinning model names.
- Added a redacted, read-only environment inventory with regression coverage for missing tools, Codex startup warnings, config loading, and Rekordbox bundle-version detection.
- Completed the mandatory Codex/MCP and Rekordbox/MIR primary-source research matrices with exact releases/commits, separate code/model-data licensing dispositions, and machine-checked source coverage.
- Recorded isolated Phase 0 pins for Codex SDK 0.146.0 and Python MCP SDK 2.0.0 while keeping production ADRs blocked on authentication/config isolation, negative-capability, lifecycle, and packaging evidence.
- Added an independently reviewed, standard-library Rekordbox XML feasibility parser and synthetic fixture with deterministic hashes, hierarchy/order/Unicode coverage, bounded hostile-input handling, path/symlink checks, and explicit UTF-8-only scope.
- Added an independently reviewed generated-PCM analysis spike with bounded generation/measurement, sample-derived tempo/energy evidence, regularity-sensitive confidence, per-file process timeouts/cleanup, and validation-only model path/hash/format guards.
- Added an independently reviewed 38-test private Unix-socket process-topology and approval-contract spike with distinct role capabilities, one enforced SQLite owner, cooperative socket ownership, strict bounded framing/lifecycle, absolute drip-resistant exchange deadlines, durable idempotency/rollback, and restart-bound single-use trusted-main approval.
- Added a 15-test TypeScript/Python differential/local private-codec suite and corrected the shared wire contract to signed-64 integers only, Unicode-code-point key ordering, exact integer protocol versions, bounded integer-millisecond durations/expiries, schema-named scaled fractional fields, and fail-closed sparse/accessor arrays; float, boolean-version, and sparse-array incompatibilities were reproduced before correction. The reviewed topology, MCP, broker comparison, and codec evidence accept ADR-0003 as an architectural choice while retaining application composition and packaged capability delivery as later gates.
- Added an independently reviewed 13-test portable embedding-storage spike with exact normalized little-endian float32 metadata, true-cosine/stale-model behavior, bounded deterministic top-k search, strict versioned SQLite schema validation, transactional migration rollback, backup preservation, and an explicitly non-benchmark 10k payload estimate; accepted ADR-0006 without approving a model or ANN backend.
- Added an exact-version Codex SDK/MCP feasibility package with a matching packaged helper, narrow isolation-wrapper candidate, redacted auth classification, deterministic lifecycle/timeout/workspace/schema tests, synthetic negative-capability setup, and local-only contract coverage. Its reviewed one-server/one-tool registration, coherent MCP-call state, strict duplicate/malformed handling, bounded scoped shim/helper-group extinction, fail-closed unknown/MCP/cleanup categories, exact prospective lifecycle values, and reasonless-rejection safety now have a 52-test local suite. An approved real run exposed an SDK-flattened custom-profile parse failure. Independent review then rejected both built-in `:read-only` (root-wide reads) and custom `:minimal` (broad system/shared-temp reads and shared-temp writes). The current strict inline profile omits `:minimal`; exact-helper preflight proves configuration and strict unknown-key rejection, then requires sandboxed model-command startup to fail closed with exact pinned exit 134, no output, and no synthetic markers. Phase 0 remains blocked on direct built-in-tool negative-capability proof, actual MCP evidence, different-process-group containment, and ambient isolation.
- A first post-permission authenticated rerun entered the MCP stage but terminated without a redacted result when timeout cleanup aborted an already-settled SDK child signal. Success and rejection regressions now prove settled operations are not aborted; only the deadline aborts, while scoped cleanup always runs. The corrected local Codex suite is 47/47 plus typecheck. No lifecycle or MCP gate credit is inferred from the crashed run.
- A corrected authenticated rerun returned a sanitized `stage=mcp_echo_tool` failure. Independent control-flow review credits existing-ChatGPT-auth new/resume streamed turns, exact thread-ID reuse, stream exhaustion, and application-validated structured outputs because the stage is assigned only after those checks return. It credits no specific completion event, MCP behavior, sentinel, cancellation, ambient isolation, or escaped-descendant cleanup. The reported `service` category was the old generic fallback and is recorded as exact cause unknown; another identical run is barred until the diagnostic, runtime, or containment design changes materially.
- Tagged 0.146.0 source inspection shows local stdio MCP servers are direct orchestrator children in their own process group, with upstream group termination attempted on transport close/drop. The model-command exit-134 preflight is therefore not MCP startup evidence in either direction, and the shim's inherited-group audit cannot establish MCP extinction.
- Corrected three independent review findings in the redacted runner: cleanup rejection now preserves whether it followed success/error/timeout instead of masquerading as an SDK failure; new/resumed lifecycle output must match exact expected IDs prospectively; and a JavaScript rejection with no reason cannot resolve as success or falsely mark MCP observed. Historical authenticated evidence remains limited to two bounded known-ID results because it predates the exact-value correction.
- Added an independently reviewed Python MCP 2.0 low-level stdio transport candidate. Its 9/9 warning-strict tests and direct probes establish exact schemas/annotations, strict bounded validation/results, hostile-input failure, protocol-only stdout, local-only transport avoidance, exact environment inventory, and direct-server-PID cancellation cleanup. The current TypeScript package physically matches the complete published Python listing and one smoke payload; neither establishes a real Codex call, complete MCP behavior, packaged composition, or escaped-descendant containment.
- Added a 12-task deterministic Codex DJ-suitability evaluation harness with category-specific complete fixture/response/tool validation, a mock-only default, explicit real-provider opt-in, unknown-ID accounting, incrementally bounded fail-closed data-property-only ID and injection scanning that never invokes object/ID-array accessors, coherent SetPlan checks, authoritative-tool-evidence requirements, cooperative cancellation/deadline scoring, redacted reports, a tested silent command, and exclusive symlink-resistant output files. Its current 30-test result passed independent final review with no High or Medium findings; this is still not a real Codex or DJ-quality result.
- Completed the independent whole-Phase-0 audit after correcting its one Medium evidence-sync contradiction. The audit task is closed with no unrecorded High or Medium finding, while Phase 0, P0-011, ADR-0002, and the product gate remain open/red on the recorded Codex/MCP/sentinel/containment blockers.
