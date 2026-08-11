# Phase 0 Research and Feasibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce evidence-backed architecture decisions and executable Codex/MCP, Rekordbox XML, generated-audio, and DJ-reasoning feasibility results without committing production dependency versions prematurely.

**Architecture:** Phase 0 keeps research lanes read-only and gives the primary agent sole ownership of synthesis, spikes, project memory, and Git. Spikes are isolated under `spikes/`, deterministic fixtures under `fixtures/`, and redacted outcomes under `docs/evidence/phase-0/`; no spike is production architecture by implication.

**Tech Stack:** Current local macOS tools recorded by the environment inventory; official Codex SDK/MCP packages at exact researched versions for their isolated spikes; Python standard library for the first XML/generated-WAV proof unless research justifies a narrowly pinned spike dependency.

## Global Constraints

- Do not use the normal OpenAI API and do not require `OPENAI_API_KEY`.
- Reuse existing Codex/ChatGPT authentication only; never read or persist raw credentials.
- Never send audio bytes to Codex and never place music paths in the Codex working directory.
- Never write to Rekordbox `master.db`, source XML, or source audio.
- Do not select production versions from README claims; use primary documentation, source inspection, and local measurements.
- Keep code and model/data license decisions separate.
- A task is `done` only when acceptance criteria and durable evidence exist in `TASKS.md`.

---

### Task 1: Repository inventory and persistent skeleton

**Files:**
- Create: `AGENTS.md`, `TASKS.md`, `DECISIONS.md`, `KNOWN_ISSUES.md`, `CHANGELOG.md`
- Create: `docs/PRODUCT_SPEC.md`, `docs/PHASE_PLAN.md`, `docs/ARCHITECTURE.md`, `docs/REPO_RESEARCH.md`, `docs/TEST_STRATEGY.md`, `docs/THREAT_MODEL.md`, `docs/LICENSING.md`, `docs/EVALUATION.md`, `docs/RECOVERY.md`, `docs/USER_GUIDE.md`, `docs/PRIVACY.md`
- Create: `docs/adr/0001-*.md` through `docs/adr/0007-*.md`

**Interfaces:**
- Consumes: authoritative master prompt and read-only Git inventory.
- Produces: persistent task/status, decision, architecture, security, research, and evidence locations used by every later task.

- [x] Inspect `git status --short --branch`, `git log --oneline --decorate -n 12`, and `rg --files -uu -g '!.git/**'`; record user-owned/untracked files without changing them.
- [x] Add the skeleton with proposed—not accepted—research-dependent ADRs.
- [x] Verify every required document and ADR path exists with `python3 -m unittest discover -s scripts/tests -v` after Task 2 adds the structural validator tests.
- [x] Update P0-001 evidence/status in `TASKS.md` without staging or committing before the Phase 0 gate.

### Task 2: Structural validator and agent configuration

**Files:**
- Create: `scripts/validate_phase0_structure.py`, `scripts/tests/test_phase0_structure.py`
- Create: `.codex/config.toml`
- Create: `.codex/agents/repo-researcher.toml`, `.codex/agents/architect.toml`, `.codex/agents/rekordbox-specialist.toml`, `.codex/agents/audio-mir-specialist.toml`, `.codex/agents/ranking-specialist.toml`, `.codex/agents/codex-mcp-specialist.toml`, `.codex/agents/mac-ui-specialist.toml`, `.codex/agents/qa-reviewer.toml`, `.codex/agents/security-reviewer.toml`, `.codex/agents/release-reviewer.toml`

**Interfaces:**
- Consumes: current official Codex configuration/agent schema from P0-002 research.
- Produces: a conservative four-thread project setting, scoped custom-agent profiles, and a deterministic documentation gate.

- [x] Write failing standard-library unittests that execute the structural validator and reject missing project config, missing required artifacts/agents, incomplete agent instructions, excess write authority for read-only roles, stale model pins, and locally unsupported config keys.
- [x] Run `python3 -m unittest scripts.tests.test_phase0_structure -v` and confirm each new behavior fails for the intended missing/invalid boundary.
- [x] Add config/agent TOML using only current verified fields; profiles inherit the current/default model and make read-only reviewer/research intent explicit.
- [x] Run `python3 -m unittest scripts.tests.test_phase0_structure -v` and require pass, including an installed-CLI config-load integration when the CLI is present.

### Task 3: Parallel primary-source research

**Files:**
- Modify: `docs/REPO_RESEARCH.md`, `docs/LICENSING.md`, `TASKS.md`
- Create: `docs/evidence/phase-0/research-sources.md`

**Interfaces:**
- Consumes: three bounded read-only handoffs: Codex/MCP; Rekordbox/MIR repositories; architecture/security/license review.
- Produces: one normalized comparison row per required source with exact URL/revision/date/license/runtime/maintenance/test/risk/decision/rationale fields.

- [x] Dispatch all three independent agents concurrently with no file or Git mutation authority and explicit source coverage/output contracts.
- [x] Wait for every handoff; reject or follow up on any claim lacking an exact official/source reference or distinguishing code and asset licenses.
- [x] Synthesize concise rows and preserve rejected options; save the source/revision ledger.
- [x] Validate every URL from the mandatory list has exactly one disposition using the Phase 0 structural/research validator after extending it with the required URL set.

### Task 4: Local environment inventory

**Files:**
- Create: `scripts/collect-phase0-environment.sh`
- Create: `scripts/tests/test_environment_script.py`
- Create: `docs/evidence/phase-0/environment.md`
- Modify: `TASKS.md`

**Interfaces:**
- Consumes: local command availability and macOS application metadata only.
- Produces: redacted OS/architecture/Node/pnpm/Python/uv/ffmpeg/Codex/Rekordbox capability and version report.

- [x] Write a failing test that executes the collector with a temporary output path and asserts required labels, no home-directory expansion, no environment-variable dump, and a zero exit status when optional tools are absent.
- [x] Implement a read-only collector that uses explicit `--version` commands and application bundle metadata; it must never read databases, credentials, shell history, or media roots.
- [x] Run the focused environment-collector test and then `sh scripts/collect-phase0-environment.sh docs/evidence/phase-0/environment.md`.
- [x] Inspect and redact the report before linking it from P0-005.

### Task 5: Codex SDK lifecycle and MCP spike

**Files:**
- Create: `spikes/codex-mcp/package.json`, `spikes/codex-mcp/tsconfig.json`, `spikes/codex-mcp/src/provider-spike.ts`, `spikes/codex-mcp/src/mcp-spike.ts`
- Create: `spikes/codex-mcp/tests/provider-spike.test.ts`, `spikes/codex-mcp/tests/mcp-spike.test.ts`
- Create: `spikes/codex-mcp/README.md`, `docs/evidence/phase-0/codex-mcp.md`
- Modify: `TASKS.md`, ADR-0002, ADR-0003

**Interfaces:**
- Consumes: exact official SDK/MCP versions and lifecycle APIs established by Task 3; a fixture-only `echo_library_ids` MCP tool accepting `{ ids: string[] }` with a strict maximum.
- Produces: measured auth status, new/resumed thread, structured-output, stream, timeout/cancel, sandbox/workdir, safe MCP call, invalid-input, output-cap, redacted-error evidence, and negative-capability counterevidence.

- [x] Write failing provider and MCP tests using fakes/local transport; assert no API-key path, unknown IDs rejection, strict maximum, read-only annotation, redaction, and local-only mode with no provider/MCP/network initialization.
- [x] Run `pnpm --dir spikes/codex-mcp test` and confirm failures are the unimplemented lifecycle/tool boundaries.
- [x] Implement the smallest isolated spike against the exact researched APIs and keep real-auth execution behind `pnpm --dir spikes/codex-mcp test:real`.
- [x] Add generated sentinels outside the dedicated AI workspace (regular, symlink, and audio-shaped) and a shell/process marker target; attempt reads, music-root working-directory change, marker creation, and undeclared filesystem/network tools under the exact intended SDK configuration.
- [x] Run the deterministic test command, then the opt-in real command only when existing auth is reported available; save exact outcomes, sandbox/workdir configuration, counterevidence, child cleanup, and limitations. The pre-correction real run failed before sentinels, so this execution step is complete but its acceptance gate is not; any successful forbidden capability still blocks ADR-0002.

### Task 6: Core topology and trusted approval contract spike

**Files:**
- Create: `spikes/process_topology/core.py`, `spikes/process_topology/mcp_bridge.py`, `spikes/process_topology/protocol.py`
- Create: `spikes/process_topology/tests/test_topology.py`, `spikes/process_topology/tests/test_protocol.py`, `spikes/process_topology/tests/test_approval.py`
- Create: `spikes/process_topology/README.md`, `docs/evidence/phase-0/process-topology.md`
- Modify: `TASKS.md`, ADR-0003, `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`

**Interfaces:**
- Consumes: researched SDK MCP topology options and the proposed canonical RPC/approval contracts.
- Produces: a bounded proof with Electron-main stand-in and MCP-bridge stand-in using distinct client sessions, exactly one SQLite opener, and server-side write-proposal approval that is never model-visible.

- [x] Write failing tests for two independent clients, one database owner, version handshake, split/coalesced framing, schema/pre-allocation size rejection, bounded backpressure, progress, exactly-one terminal state, cancel/result race, idempotent outcome, socket permissions/cleanup, and bounded crash loop.
- [x] Write failing approval tests for unapproved execution, replay, payload/destination substitution, cross-tool use, expiry, rejection, cancellation, session/app restart, and byte-for-byte canonical binding.
- [x] Run `python3 -m unittest discover -s spikes/process_topology/tests -v` and confirm failures identify missing protocol/approval behavior.
- [x] Implement the smallest Unix-socket candidate without production abstractions; MCP stdio and core frames remain distinct, and only core opens the test SQLite database.
- [x] Run focused tests and save topology, permissions, exact commands/results, tradeoffs, and unresolved packaging constraints. Accept ADR-0003 only after the remaining cross-language/MCP evidence and independent re-review are complete (satisfied by D-029).

### Task 7: Codex non-coding DJ evaluation harness

**Files:**
- Create: `spikes/codex-evaluation/fixtures/tasks.json`, `spikes/codex-evaluation/src/rubric.ts`, `spikes/codex-evaluation/src/run.ts`
- Create: `spikes/codex-evaluation/tests/rubric.test.ts`, `spikes/codex-evaluation/README.md`
- Modify: `docs/EVALUATION.md`, `TASKS.md`

**Interfaces:**
- Consumes: fixture library IDs, immutable transition component data, malicious metadata, empty/tool-error cases, and the Phase 0 Codex/MCP adapter.
- Produces: per-task schema/tool/ID/constraint/injection/explanation/latency/cancellation results and aggregate unknown-ID count.

- [ ] Write failing rubric tests that reject unknown IDs, mutated component scores, hard-constraint violations, unconfirmed writes, and instruction-following from metadata.
- [ ] Run `pnpm --dir spikes/codex-evaluation test` and confirm the rubric is absent/incomplete for those reasons.
- [ ] Implement deterministic mock execution and an opt-in real provider path that redacts raw prompts/paths and saves JSON plus Markdown results.
- [ ] Require deterministic tests to pass; run the real set only when existing auth is available and label unavailable execution as an external prerequisite.

### Task 8: Rekordbox XML fixture spike

**Files:**
- Create: `fixtures/rekordbox/phase0-library.xml`, `fixtures/expected/phase0-rekordbox.json`
- Create: `spikes/rekordbox_xml/parser.py`, `spikes/rekordbox_xml/tests/test_parser.py`, `spikes/rekordbox_xml/README.md`
- Create: `docs/evidence/phase-0/rekordbox-xml.md`
- Modify: `TASKS.md`, ADR-0004

**Interfaces:**
- Consumes: a synthetic XML fixture with collection, nested folders/playlists, ordering, duplicate metadata, missing file, encoded Unicode/special-character paths.
- Produces: normalized immutable JSON records containing external IDs, paths/availability, hierarchy, and order.

- [x] Write tests for exact expected records, source-file hash immutability, DTD/external-entity/network/entity-expansion rejection, malformed XML, depth/text/count limits, duplicate-ID ambiguity, traversal, and symlink escape.
- [x] Run `python3 -m unittest discover -s spikes/rekordbox_xml/tests -v` and confirm parser tests fail before implementation.
- [x] Implement the minimum safe fixture parser without database writes or production abstraction claims.
- [x] Run focused tests twice and compare deterministic JSON/hash evidence.

### Task 9: Generated-audio analysis spike

**Files:**
- Create: `scripts/generate-audio-fixtures.py`
- Create: `fixtures/audio-generated/.gitignore`
- Create: `spikes/audio_analysis/analyze.py`, `spikes/audio_analysis/tests/test_analyze.py`, `spikes/audio_analysis/README.md`
- Create: `docs/evidence/phase-0/audio-analysis.md`
- Modify: `TASKS.md`, ADR-0005

**Interfaces:**
- Consumes: generated mono PCM WAV clicks with known BPM and amplitude sections; silence/corrupt fixtures.
- Produces: duration, sample rate/channels, RMS/peak/section energy, estimated click interval/BPM with confidence/limitations, and explicit per-file errors.

- [x] Write failing tests with temporary generated fixtures and tolerances derived from sample positions, not subjective audio quality; include corrupt/slow/timeout/cleanup isolation and rejection of unknown hashes, arbitrary model paths, and unsafe executable model formats.
- [x] Run `python3 -m unittest discover -s spikes/audio_analysis/tests -v` and confirm expected failures.
- [x] Implement streaming/chunked standard-library generation/measurement and the smallest transparent tempo estimate; do not claim production MIR accuracy.
- [x] Run focused tests and save exact environment, command, measurements, tolerances, and limitations.

### Task 10: Synthesis and accepted ADRs

**Files:**
- Modify: `docs/ARCHITECTURE.md`, `docs/REPO_RESEARCH.md`, `docs/LICENSING.md`, `docs/EVALUATION.md`, `docs/THREAT_MODEL.md`, `docs/RECOVERY.md`, `docs/PHASE_PLAN.md`, `DECISIONS.md`, ADR-0001 through ADR-0007, `TASKS.md`

**Interfaces:**
- Consumes: all research handoffs and executable spike reports.
- Produces: accepted/rejected decisions with exact evidence, known blockers, implementation contracts, and measurable Phase 1 acceptance criteria.

- [ ] Reconcile source claims against local results; mark unsupported README claims as unverified/rejected rather than smoothing over conflicts.
- [ ] For each ADR, evaluate only its bounded Phase 0 decision evidence; keep later implementation verification assigned to its future phase rather than making Phase 0 impossible to close.
- [ ] Accept or reject every proposed ADR and update the index/decision log consistently.
- [ ] Refresh the threat model to distinguish implemented spike controls from future controls and update its repository/version footer.
- [ ] Extend documentation tests to reject a remaining `Proposed` Phase 0 ADR or unassessed mandatory source.

### Task 11: Phase 0 verification and checkpoint

**Files:**
- Create: `scripts/verify-phase0.sh`, `docs/evidence/phase-0/verification.md`, `docs/evidence/phase-0/qa-review.md`, `docs/evidence/phase-0/security-review.md`
- Modify: `TASKS.md`, `KNOWN_ISSUES.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: every deterministic Phase 0 test/report and accepted ADR.
- Produces: one non-silent gate, independent QA/security findings, resolved project memory, and a green Git checkpoint.

- [ ] Implement `scripts/verify-phase0.sh` to run documentation, environment, process/approval, hostile XML, audio/model-safety, Codex/MCP negative-capability, local-only, and evaluation deterministic suites and fail when any required suite/fixture is absent.
- [ ] Run `sh scripts/verify-phase0.sh`; record exact exit statuses and report paths.
- [ ] Dispatch fresh read-only QA and security reviewers; resolve every high/medium finding or record a genuine external blocker, then rerun the gate.
- [ ] Inspect `git status --short`, `git diff --check`, and the complete diff; update all task/evidence/checkpoint fields, commit a meaningful Phase 0 green checkpoint, and report automated/manual/external/deferred/defect categories separately.

### Task 12: Blocking Codex/MCP observability correction

**Files:**
- Create: `spikes/codex-mcp/src/mcp-control.ts`, `spikes/codex-mcp/python_mcp/observed_server.py`
- Create or modify: focused TypeScript and Python tests under `spikes/codex-mcp/tests/` and `spikes/codex-mcp/python_mcp/tests/`
- Modify: `spikes/codex-mcp/src/provider-spike.ts`, `spikes/codex-mcp/src/real-probe.ts`, exact registration/shim tests, Phase 0 project records and evidence

**Interfaces:**
- Consumes: D-035's directly observed distinct MCP process boundary and KI-049's unknown authenticated MCP-stage failure.
- Produces: a bounded supervisor-owned private Unix-socket channel outside the model workspace; exact startup/inventory/call-start/call-result events; cooperative shutdown; verified process-group extinction; and a stable redacted audit summary that can distinguish where a future synthetic authenticated run stopped.

- [ ] Write failing tests for exact configuration, secure control-directory/socket creation, bounded and ordered event parsing, unknown/duplicate/oversized/forged input rejection, multiple MCP invocations, call/result correlation, cooperative shutdown, timeout, and process-group extinction.
- [ ] Run only the focused tests and confirm failure is caused by the absent control boundary and observed entrypoint.
- [ ] Implement the smallest observed Python entrypoint and Node supervisor; do not expose raw fixture IDs, prompts, paths, environment, stderr, or arbitrary error text in telemetry or redacted output.
- [ ] Run the Codex package tests/typecheck and full Phase 0 deterministic verifier; obtain one independent correction review and resolve all High/Medium findings.
- [ ] Only if the material diagnostic change is green and reviewed, request explicit informed approval for one external run containing synthetic fixture IDs/paths/sentinels only. Do not repeat the prior probe unchanged.
- [ ] Keep Phase 0, P0-011, ADR-0002, and the checkpoint red unless direct MCP, negative-capability, ambient-isolation, and complete containment gates are all actually satisfied.

## Self-review result

- Coverage: every Phase 0 deliverable and gate maps to Tasks 1–11.
- Placeholder scan: no unresolved instruction is delegated as “implement later”; research-dependent versions are explicit upstream outputs, not guessed values.
- Interface consistency: task IDs, artifact paths, commands, and owner boundaries match `TASKS.md` and the documentation skeleton.
