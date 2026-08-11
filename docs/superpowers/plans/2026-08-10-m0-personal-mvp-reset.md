# M0 Personal MVP Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blocked commercial-style Phase 0 gate with the approved personal-use MVP scope, restore the last green Codex/MCP spike baseline, and push the first coherent project checkpoint to GitHub.

**Architecture:** Keep the selected Electron main + isolated React renderer + single Python core architecture and preserve all completed research as historical evidence. Remove only the unfinished P0-016 observability layer, accept ordinary same-user Codex trust for this personal tool, and make the M0 documentation/test records the source of truth for subsequent milestone plans.

**Tech Stack:** Markdown project records, Python 3 `unittest`, TypeScript 5.9, Node.js, pnpm 11, official `@openai/codex-sdk@0.146.0` feasibility spike, Git, GitHub SSH remote `origin`.

## Global Constraints

- Keep every user-facing feature in the approved personal MVP design; this milestone changes delivery rigor, not product scope.
- Rekordbox-owned databases and source audio are never modified.
- Raw audio stays local and is never sent to Codex.
- Production AI uses the official Codex SDK with existing Codex/ChatGPT authentication; never add an `OPENAI_API_KEY` flow.
- Preserve completed Phase 0 research and honest blocked evidence; do not relabel unproved behavior as passed.
- Retire P0-016, process-tree forensics, exhaustive negative-capability sentinels, and repeated phase reviewers as MVP gates.
- Use focused tests for each task and run the existing aggregate Phase 0 script once to establish the first green project baseline.
- Do not stage personal Rekordbox files, source audio, app databases, credentials, private logs, dependency folders, or generated analysis data.
- Do not commit or push until the interrupted P0-016 changes are removed and the repository is green.
- After the first green checkpoint, commit and push every substantial self-contained slice and every completed milestone.
- The primary agent owns shared records, Git staging, commits, and pushes.

## File Responsibility Map

| Area | Files | Responsibility |
| --- | --- | --- |
| Approved authority | `dj-copilot-codex-master-prompt.md`, `docs/superpowers/specs/2026-08-10-personal-full-feature-mvp-design.md`, `AGENTS.md` | State which scope governs and how agents execute it |
| Git hygiene | `.gitignore` | Keep personal/generated data out of Git and verify ignore behavior directly |
| Product execution | `docs/PRODUCT_SPEC.md`, `docs/PHASE_PLAN.md`, `TASKS.md` | Define the complete product and current M0–M7 delivery ledger |
| Decisions and limitations | `DECISIONS.md`, `KNOWN_ISSUES.md`, `docs/adr/0002-codex-sdk-language.md`, `docs/adr/README.md`, `CHANGELOG.md` | Record the accepted personal trust boundary without erasing historical findings |
| Supporting contracts | `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, `docs/PRIVACY.md`, `docs/TEST_STRATEGY.md`, `docs/RECOVERY.md`, `docs/USER_GUIDE.md` | Align architecture, risk, testing, recovery, and user expectations with the approved scope |
| Historical evidence | `docs/evidence/README.md`, `docs/evidence/phase-0/verification.md` | Preserve the 2026-08-09 evidence and distinguish its superseded gate from current status |
| P0-016 rollback | `spikes/codex-mcp/src/provider-spike.ts`, `spikes/codex-mcp/src/codex-isolation-shim.mjs`, `spikes/codex-mcp/tests/codex-mcp-registration.test.ts`, `spikes/codex-mcp/tests/provider-spike.test.ts` | Restore direct registration of the reviewed `python_mcp/server.py` fixture |
| P0-016-only files | `spikes/codex-mcp/src/mcp-control.ts`, `spikes/codex-mcp/python_mcp/control_supervisor.py`, `spikes/codex-mcp/tests/mcp-control.test.ts`, `spikes/codex-mcp/tests/fixtures/mcp-control-client.mjs` | Delete incomplete observability code that was never part of a green checkpoint |

---

### Task 1: Establish the Approved Scope and Git Hygiene

**Files:**
- Modify: `dj-copilot-codex-master-prompt.md`
- Modify: `docs/superpowers/specs/2026-08-10-personal-full-feature-mvp-design.md`
- Modify: `AGENTS.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Joe's approval of `docs/superpowers/specs/2026-08-10-personal-full-feature-mvp-design.md` on 2026-08-10.
- Produces: one unambiguous authority chain and Git ignore behavior that excludes personal data without hiding the generated XML fixture.

- [ ] **Step 1: Verify the current ignore rules do not yet protect personal DJ data**

Run:

```bash
git check-ignore --no-index personal-data/library.xml scratch.sqlite3 local-track.mp3
```

Expected: no paths printed and exit status 1.

- [ ] **Step 2: Mark the design approved and add the master-prompt amendment**

Change the design status to exactly:

```text
Status: approved by Joe on 2026-08-10
```

Insert this block before the existing first heading in `dj-copilot-codex-master-prompt.md`, leaving the entire original prompt below it:

```markdown
> [!IMPORTANT]
> ## Personal-use MVP scope amendment (2026-08-10)
>
> The approved design in `docs/superpowers/specs/2026-08-10-personal-full-feature-mvp-design.md` governs MVP execution when it conflicts with the commercial-grade phase gates below. All user-facing features remain in scope. The app uses an ordinary same-user trust model, focused verification, milestone-sized plans, and frequent green GitHub checkpoints. Completed Phase 0 research remains historical evidence; P0-016 and the forensic Codex containment gates are stopped rather than passed. The original prompt is retained below for product detail and decision history.
```

- [ ] **Step 3: Replace the strict project section of `AGENTS.md`**

Keep the existing personal Codex guidance and replace the `DJ Copilot Repository Guidance` section with instructions containing these exact rules:

```markdown
# DJ Copilot Repository Guidance

## Authority and scope

- The personal full-feature MVP design at `docs/superpowers/specs/2026-08-10-personal-full-feature-mvp-design.md` governs MVP execution.
- `dj-copilot-codex-master-prompt.md` remains the detailed product source and historical plan; its 2026-08-10 amendment resolves conflicts.
- Rekordbox remains the source of truth. Never write Rekordbox-owned databases or source audio.
- Use only the official Codex SDK with existing Codex/ChatGPT authentication. Never add an `OPENAI_API_KEY` flow.
- Raw audio remains local and is never sent to Codex.

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
```

- [ ] **Step 4: Extend `.gitignore` for personal DJ data**

Append these patterns, retaining the existing dependency/cache rules:

```gitignore
# Personal DJ inputs and app-owned state
personal-data/
local-data/
*.sqlite
*.sqlite3
*.db
*.db-wal
*.db-shm

# Copyrighted source audio must not enter Git; generated fixtures may opt in
*.mp3
*.m4a
*.aac
*.flac
*.aif
*.aiff
*.wav
!fixtures/**/*.wav
```

- [ ] **Step 5: Verify ignore behavior and the fixture exception**

Run:

```bash
git check-ignore --no-index personal-data/library.xml scratch.sqlite3 local-track.mp3
```

Expected: all three paths print and the command exits 0.

Run:

```bash
git check-ignore --no-index fixtures/rekordbox/phase0-library.xml
```

Expected: no path prints and the command exits 1 because the generated XML fixture remains trackable.

- [ ] **Step 6: Leave changes uncommitted until the code baseline is green**

Run:

```bash
git status --short
```

Expected: the M0 files remain modified/untracked and no personal data or ignored dependency output appears as a candidate for commit. Do not stage, commit, or push in this task because the Codex/MCP typecheck is still known red.

---

### Task 2: Reconcile Product Plans, Decisions, and Known Limitations

**Files:**
- Modify: `docs/PRODUCT_SPEC.md`
- Modify: `docs/PHASE_PLAN.md`
- Modify: `TASKS.md`
- Modify: `DECISIONS.md`
- Modify: `KNOWN_ISSUES.md`
- Modify: `docs/adr/0002-codex-sdk-language.md`
- Modify: `docs/adr/README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the approved authority chain from Task 1.
- Produces: the M0–M7 current ledger, accepted personal-use Codex decision, non-blocking historical security findings, and the active M0 rollback defect KI-053.

- [ ] **Step 1: Capture the current conflicting status markers**

Run:

```bash
rg -n "Current phase: Phase 0|ADR-0002 remains Proposed|open, blocking|Phase 0 cannot close" TASKS.md docs/PRODUCT_SPEC.md docs/PHASE_PLAN.md docs/adr/0002-codex-sdk-language.md docs/adr/README.md KNOWN_ISSUES.md
```

Expected: the old Phase 0, proposed ADR, and blocking issue language is present before reconciliation.

- [ ] **Step 2: Rewrite the concise product specification**

Replace `docs/PRODUCT_SPEC.md` with a concise summary of the approved design using these exact sections:

```markdown
# DJ Copilot Product Specification

Status: Personal full-feature MVP approved 2026-08-10
Authoritative MVP design: `superpowers/specs/2026-08-10-personal-full-feature-mvp-design.md`
Detailed product source: `../dj-copilot-codex-master-prompt.md`

## Mission
## Personal full-feature MVP
## Product invariants
## User-visible scope
## Deferred commercial work
## Completion rule
```

The content must explicitly retain Rekordbox import/export, local analysis, library UI, search, similarity, recommendations, set building/editing/export, set analysis, organization, personalization, Codex assistance, recovery, diagnostics, accessibility, and a personal macOS build. State that only public-distribution hardening, hostile same-user containment, exhaustive matrices, and broad platform support are deferred.

- [ ] **Step 3: Replace the phase plan with the approved milestone map**

Replace `docs/PHASE_PLAN.md` with this current table and a note that each milestone gets a separate plan:

```markdown
| Milestone | Integrated outcome | Completion evidence |
| --- | --- | --- |
| M0 — Scope reset and green foundation | Approved personal scope, historical evidence preserved, interrupted P0-016 removed, green baseline pushed | Focused scope tests, Codex/MCP 52-test package, one aggregate baseline run, clean pushed checkpoint |
| M1 — App shell and real library slice | Electron/React + Python/SQLite launch; XML fixture and selected library browse in UI | Focused contracts, fixture desktop flow, selected-XML manual check |
| M2 — Local analysis slice | Resumable selected-track analysis with progress, results, and isolated failures | Generated audio integration, restart/resume manual flow |
| M3 — Discovery and recommendation slice | Text/structured search, similarity, next-track ranking, reasons and filters | Deterministic ranking tests and representative-library manual tuning |
| M4 — Set workflow slice | Editable/versioned drafts, pins/bans, analyzer, organization suggestions, valid XML export | Complete desktop import-to-export fixture flow |
| M5 — Personalization slice | Feedback changes visible recommendation preferences with export/reset | Baseline-versus-adjusted fixture test and reset check |
| M6 — Codex-assisted slice | Existing-auth natural-language search, set planning/revision, explanations and only necessary MCP tools | Mock integration plus one real existing-auth smoke flow |
| M7 — Personal release polish | Recovery, migrations, setup/limitations, accessibility pass and runnable personal macOS build | Clean setup/build/manual workflow on Joe's Mac |
```

State that a milestone closes when the normal personal workflow works, focused checks are green, in-scope defects are resolved or honestly recorded, and the green checkpoint is pushed.

Add an `M1 scaffold contract` section that fixes the next slice's minimal layout before code is created:

```text
package.json                  root pnpm dev/test/typecheck orchestration
pnpm-workspace.yaml           desktop package workspace declaration
app/desktop/                  Electron main, preload, and React renderer
core/dj_copilot/              Python service, SQLite ownership, and XML domain code
fixtures/                     generated/non-copyrighted integration inputs
```

Specify `pnpm dev` as the future root development command that launches the Electron desktop and supervised Python core. M0 documents this contract only; M1 creates and verifies it.

- [ ] **Step 4: Convert `TASKS.md` into a current-plus-historical ledger**

At the top, set `Last updated: 2026-08-10`, `Current milestone: M0 — Scope reset and green foundation`, and reference the approved design. Add current rows M0-001 through M0-006 for: authority/hygiene, record reconciliation, supporting-doc reconciliation, P0-016 rollback, baseline verification/first push, and checkpoint evidence/final push.

Rename the old section to `## Historical Phase 0 ledger (frozen 2026-08-09)`. Keep historical rows and evidence intact, but change P0-016 to status `stopped` with a note that the 2026-08-10 personal-use amendment superseded it before completion. Rename the old checkbox section to `## Historical Phase 0 gate (superseded)` and state that unchecked boxes remain honest historical failures but no longer block M1. Replace the old P1–P9 table with the M0–M7 table from `docs/PHASE_PLAN.md`.

- [ ] **Step 5: Record the three approved decisions**

Append these decisions to `DECISIONS.md`:

```markdown
| D-040 | 2026-08-10 | accepted; supersedes commercial Phase 0 stop rule | Build every user-facing feature as a personal full-feature MVP using milestone-sized vertical slices, focused verification, and fixes driven by Joe's real use | Approved personal MVP design |
| D-041 | 2026-08-10 | accepted for personal MVP; accepts ADR-0002 | Use the official TypeScript Codex SDK in Electron main under ordinary same-user trust; retain schema validation, ID checks, renderer isolation, and confirmed writes without requiring P0-016 or exhaustive capability-denial proof | Joe already trusts and regularly authorizes Codex on this Mac; historical KI-022/KI-045/KI-049 remain documented limitations |
| D-042 | 2026-08-10 | accepted workflow | Push substantial self-contained green slices and every completed milestone to `origin`; never push broken code merely for cadence or include personal library/audio/app data | Approved design GitHub checkpoint cadence |
```

- [ ] **Step 6: Reclassify the historical Codex blockers and record the current defect**

For KI-022, KI-045, and KI-049, replace the status cell with `accepted personal-use limitation; non-blocking`. Preserve reproduction/cause/evidence, and change each disposition to state that the finding remains historical evidence and is revisited only for public distribution, observed breakage, or a future stronger trust boundary.

Append KI-053 with these fields:

```markdown
| KI-053 | open, M0 blocker | medium, build integrity | Run `pnpm typecheck` in `spikes/codex-mcp` after the interrupted P0-016 rewrite | Ten TypeScript errors remain because `mcp-control.test.ts` targets an abandoned supervisor API and production registration references missing `observed_server.py` | Revert only P0-016 control-channel code to direct reviewed `server.py` registration, retain historical evidence, and rerun the 52-test package plus typecheck | primary | Exact 10-error output captured 2026-08-10; regression expectations added in M0 Task 4 |
```

- [ ] **Step 7: Accept ADR-0002 for the personal trust model**

Change ADR-0002 status to `Accepted`. Insert a `Personal-use acceptance — 2026-08-10` section after Context that states:

- Official TypeScript Codex SDK in Electron main is the selected production path.
- Existing Codex/ChatGPT auth is required and API-key flows are forbidden.
- The app assumes the same logged-in user and normal Codex capabilities are trusted.
- Strict structured outputs, validated library IDs, bounded app tools, renderer isolation, and trusted-UI confirmation remain required.
- P0-016, perfect ambient-config isolation, complete descendant tracking, and exhaustive sentinel proof are not acceptance conditions for this personal MVP.
- The long Phase 0 section remains historical evidence and must not be read as a current stop rule.

Change ADR-0002 to `Accepted` in `docs/adr/README.md`, and replace the statement that Phase 0 cannot close with a note that the personal-use acceptance basis differs from the original commercial evidence gate.

- [ ] **Step 8: Update the changelog**

Under `Unreleased`, add a `2026-08-10 — Personal full-feature MVP scope` section recording:

- approved M0–M7 delivery;
- all user-facing features retained;
- commercial security/review/release gates reduced to practical personal safeguards;
- P0-016 stopped, not completed;
- frequent green GitHub pushes adopted;
- existing Phase 0 research preserved as historical evidence.

- [ ] **Step 9: Inspect the reconciled current records**

Run:

```bash
rg -n "Personal full-feature MVP|Current milestone: M0|D-040|Status: Accepted|accepted personal-use limitation; non-blocking|KI-053" docs/PRODUCT_SPEC.md docs/PHASE_PLAN.md TASKS.md DECISIONS.md KNOWN_ISSUES.md docs/adr/0002-codex-sdk-language.md docs/adr/README.md CHANGELOG.md
```

Expected: every current scope/decision marker is present. Old blocked claims may remain only inside clearly labeled historical evidence sections.

---

### Task 3: Align Architecture, Risk, Testing, Privacy, and Recovery Records

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/THREAT_MODEL.md`
- Modify: `docs/PRIVACY.md`
- Modify: `docs/TEST_STRATEGY.md`
- Modify: `docs/RECOVERY.md`
- Modify: `docs/USER_GUIDE.md`
- Modify: `docs/evidence/README.md`
- Modify: `docs/evidence/phase-0/verification.md`

**Interfaces:**
- Consumes: D-040 through D-042 and accepted ADR-0002 from Task 2.
- Produces: concise current operational documents that agree on same-user trust, focused verification, local audio, source immutability, and historical evidence status.

- [ ] **Step 1: Capture current supporting-document contradictions**

Run:

```bash
rg -n "Phase 0 cannot close|must prove Codex negative capabilities|Phase 0 draft|Phase gates must" docs/ARCHITECTURE.md docs/THREAT_MODEL.md docs/PRIVACY.md docs/TEST_STRATEGY.md docs/RECOVERY.md
```

Expected: superseded commercial-style gate language is present before reconciliation.

- [ ] **Step 2: Rewrite `docs/ARCHITECTURE.md` as the current concise architecture**

Keep the three-process diagram and data ownership, but replace the forensic Phase 0 prose with these sections:

```markdown
# DJ Copilot Architecture
Status: Approved personal full-feature MVP architecture

## System context
## Process responsibilities
## Data ownership and source immutability
## Main data flow
## Same-user trust boundary
## Failure and recovery behavior
## Historical Phase 0 evidence
```

The same-user section must state that Electron uses ordinary isolation and typed IPC, the Python core is the sole SQLite owner, Codex receives structured metadata/features rather than audio, consequential writes are confirmed, and the product does not attempt OS-level containment from the already trusted logged-in user. The history section must link the Phase 0 evidence without making its old blockers current.

- [ ] **Step 3: Rewrite `docs/THREAT_MODEL.md` for realistic personal risks**

Use these sections:

```markdown
# DJ Copilot Threat Model
Status: Personal-use MVP

## Personal-use threat model
## Assets worth protecting
## Required practical safeguards
## Accepted risks
## Escalation triggers
```

Required safeguards are: no Rekordbox/source-audio writes, raw audio local, validated XML/paths/IDs/schemas, isolated renderer, app-owned database backups, confirmed exports and durable changes, no credentials in logs, and honest missing-confidence states. Accepted risks are: malicious same-user processes, complete Codex process-tree/tool containment, exhaustive prompt-injection resistance when no write/ID validation bypass exists, public supply-chain hardening, and untested Rekordbox/codec variants. Escalation triggers are a real data-loss/privacy defect, sharing the app, or adding remote/multi-user access.

- [ ] **Step 4: Rewrite `docs/TEST_STRATEGY.md` around focused milestone evidence**

Use these sections and rules:

```markdown
# DJ Copilot Test Strategy
Status: Personal full-feature MVP

## Completion evidence
## Focused milestone verification
## When to broaden testing
## Manual checks
## Historical Phase 0 suite
```

Require focused unit tests for deterministic rules, milestone integration happy path plus realistic failures, relevant type/syntax checks, one generated-fixture desktop flow, and manual tests for personal library/Codex/packaging behavior. Broaden only for shared contracts, migrations/export safety, a focused failure, or an observed performance problem. Keep `scripts/verify-phase0.sh` as a one-time M0 baseline and historical regression tool, not a mandatory command after every small feature.

- [ ] **Step 5: Align privacy, recovery, and user guide**

Update `docs/PRIVACY.md` to retain local audio, app data, path redaction, bounded structured Codex context, local-only behavior, and confirmed writes. Add that ordinary same-user Codex trust is an accepted product assumption rather than a separate hardened perimeter.

Update `docs/RECOVERY.md` to identify commit `c85d4ac` as the pre-project tracked base until Task 5 creates the M0 green checkpoint, describe targeted non-destructive Git recovery, and state that Task 6 will replace the temporary base with the pushed M0 hash. Do not claim an app database or worker exists yet.

Update `docs/USER_GUIDE.md` to say the app is not runnable yet, the M0–M7 personal MVP retains the complete intended workflow, and M1 is the first runnable library slice.

- [ ] **Step 6: Mark Phase 0 evidence historical without rewriting its outcomes**

Add this banner near the top of `docs/evidence/phase-0/verification.md`:

```markdown
Historical gate status: superseded on 2026-08-10

The 2026-08-09 deterministic results and blocked commercial-style product gate below remain exact historical evidence. The approved personal-use MVP accepts the recorded Codex limitations and does not reinterpret missing MCP/sentinel/containment evidence as a pass. Current execution status lives in `TASKS.md` and the M0 plan.
```

Add `Historical Phase 0 evidence` to `docs/evidence/README.md` with the same distinction. Keep old counts and blocked claims unchanged until Task 5 appends the fresh M0 baseline result.

- [ ] **Step 7: Inspect the current supporting-document contract**

Run:

```bash
rg -n "Same-user trust boundary|Personal-use threat model|ordinary same-user Codex trust|Focused milestone verification|M0 green checkpoint|M0–M7 personal MVP|Historical Phase 0 evidence|Historical gate status: superseded" docs/ARCHITECTURE.md docs/THREAT_MODEL.md docs/PRIVACY.md docs/TEST_STRATEGY.md docs/RECOVERY.md docs/USER_GUIDE.md docs/evidence/README.md docs/evidence/phase-0/verification.md
```

Expected: each current marker appears in its intended document. Verify `Phase 0 cannot close` does not appear in `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, or `docs/TEST_STRATEGY.md`.

---

### Task 4: Revert the Incomplete P0-016 Layer and Restore the 52-Test Package

**Files:**
- Modify: `spikes/codex-mcp/tests/codex-mcp-registration.test.ts`
- Modify: `spikes/codex-mcp/tests/provider-spike.test.ts`
- Modify: `spikes/codex-mcp/src/provider-spike.ts`
- Modify: `spikes/codex-mcp/src/codex-isolation-shim.mjs`
- Delete: `spikes/codex-mcp/src/mcp-control.ts`
- Delete: `spikes/codex-mcp/python_mcp/control_supervisor.py`
- Delete: `spikes/codex-mcp/tests/mcp-control.test.ts`
- Delete: `spikes/codex-mcp/tests/fixtures/mcp-control-client.mjs`
- Modify after verification: `KNOWN_ISSUES.md`

**Interfaces:**
- Consumes: the reviewed local Python MCP entrypoint `spikes/codex-mcp/python_mcp/server.py` and existing `McpRegistrationPaths` shape `{ pythonExecutable, serverScript, workingDirectory }`.
- Produces: exact direct `server.py` registration with no P0-016 control environment, 52 passing TypeScript tests, and a green TypeScript typecheck.

- [ ] **Step 1: Change tests to require the last green direct server registration**

In both TypeScript test files, replace every `observed_server.py` fixture path with `server.py`.

In `codex-mcp-registration.test.ts`, remove the `MCP_CONTROL_ENV_KEYS` import and remove this expected `buildCodexOptions` property:

```ts
[`mcp_servers.${MCP_SERVER_NAME}.env_vars`]: [...MCP_CONTROL_ENV_KEYS],
```

Also remove this entry from `expectedMcpConfig`:

```ts
`mcp_servers.${MCP_SERVER_NAME}.env_vars=["DJ_CODEX_MCP_CONTROL_SOCKET", "DJ_CODEX_MCP_CONTROL_RUN_ID", "DJ_CODEX_MCP_CONTROL_TOKEN"]`,
```

Keep the hostile `env_vars=["OPENAI_API_KEY"]` mutation case because the shim must still reject an injected environment inheritance configuration.

In `provider-spike.test.ts`, remove the expected transformed `env_vars` line and change `createExecutableMcpFixture()` to create `server.py`.

- [ ] **Step 2: Run the targeted tests and verify they fail against the current implementation**

Run:

```bash
node --import tsx --test tests/codex-mcp-registration.test.ts tests/provider-spike.test.ts
```

Working directory: `spikes/codex-mcp`

Expected: failure with `invalid local MCP registration paths` or an exact-argv mismatch because production code still requires `observed_server.py` and the control environment.

- [ ] **Step 3: Restore direct registration in `provider-spike.ts`**

Apply these exact changes:

- remove `import { MCP_CONTROL_ENV_KEYS } from "./mcp-control.js";`
- remove the `mcp_servers.<name>.env_vars` entry from `buildExactConfig()`;
- require `join(paths.workingDirectory, "server.py")` in `validateMcpRegistrationPaths()`;
- keep `transport.env_vars` in the inspected runtime object but require it to equal an empty array:

```ts
&& JSON.stringify(transport.env_vars) === JSON.stringify([]);
```

Do not change the SDK version, allowed server name, allowed tool name, timeouts, strict schemas, application ID validation, local-only behavior, or existing shim/helper cleanup evidence.

- [ ] **Step 4: Restore direct registration in the isolation shim**

In `codex-isolation-shim.mjs`:

- delete the `MCP_CONTROL_ENV_KEYS` constant;
- delete the generated `mcp_servers.<name>.env_vars` config line;
- change `validateMcpRegistrationShape()` to require `join(value.workingDirectory, "server.py")`.

Keep strict ordered argv validation, `--ignore-user-config`, `--ignore-rules`, the exact one-server/one-tool configuration, and rejection of injected unknown configuration.

- [ ] **Step 5: Delete only the unfinished P0-016 files**

Use `apply_patch` file deletions for exactly these paths:

```text
spikes/codex-mcp/src/mcp-control.ts
spikes/codex-mcp/python_mcp/control_supervisor.py
spikes/codex-mcp/tests/mcp-control.test.ts
spikes/codex-mcp/tests/fixtures/mcp-control-client.mjs
```

Do not delete the older supervisor-control and process-group logic in `provider-spike.ts`; that code belongs to the prior reviewed 52-test baseline.

- [ ] **Step 6: Confirm no P0-016 runtime references remain**

Run:

```bash
rg -n "mcp-control|MCP_CONTROL_ENV_KEYS|DJ_CODEX_MCP_CONTROL|observed_server.py|control_supervisor.py" spikes/codex-mcp
```

Expected: no matches and exit status 1.

- [ ] **Step 7: Run the targeted tests**

Run:

```bash
node --import tsx --test tests/codex-mcp-registration.test.ts tests/provider-spike.test.ts
```

Working directory: `spikes/codex-mcp`

Expected: 46 tests pass, 0 fail.

- [ ] **Step 8: Run the complete TypeScript package and typecheck**

Run:

```bash
pnpm test
```

Working directory: `spikes/codex-mcp`

Expected: 52 tests pass, 0 fail.

Run:

```bash
pnpm typecheck
```

Working directory: `spikes/codex-mcp`

Expected: exit 0 with no TypeScript diagnostics.

- [ ] **Step 9: Resolve KI-053 honestly**

Change KI-053 status to `resolved in M0`. Record that direct `server.py` registration was restored, the four unfinished P0-016 files were removed, no control references remain, 52 tests pass, and typecheck passes. Do not change the non-blocking accepted status of KI-022, KI-045, or KI-049.

---

### Task 5: Run the M0 Baseline, Create the Initial Project Commit, and Push

**Files:**
- Modify: `TASKS.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/evidence/phase-0/verification.md`
- Stage: all intended project files listed by `git ls-files --others --exclude-standard` plus the tracked master-prompt amendment

**Interfaces:**
- Consumes: Tasks 1–4 with reconciled project records, verified ignore behavior, and the restored 52-test Codex/MCP package.
- Produces: a complete green project commit on `main` and a matching `origin/main` checkpoint.

- [ ] **Step 1: Run focused M0 checks once more**

Run:

```bash
python3 -B -m unittest discover -s scripts/tests -v
```

Expected: the existing 11 script/environment/structure tests pass.

Run:

```bash
pnpm --dir spikes/codex-mcp test
```

Expected: 52 tests pass.

Run:

```bash
pnpm --dir spikes/codex-mcp typecheck
```

Expected: exit 0.

- [ ] **Step 2: Run the one-time aggregate baseline**

Run:

```bash
scripts/verify-phase0.sh
```

Expected: every historical deterministic suite passes: 186 tests across the Python/TypeScript suites with all three TypeScript typechecks green. If the count differs, calculate and record the actual per-suite totals instead of copying 186.

- [ ] **Step 3: Record the fresh result before staging**

Append an `M0 baseline revalidation — 2026-08-10` section to `docs/evidence/phase-0/verification.md` containing the exact commands, per-suite counts, and outcomes from Steps 1–2. State that this validates the retained local evidence and scope consistency only; it does not retroactively prove real MCP, sentinels, or containment.

Update the current M0 rows in `TASKS.md` so M0-001 through M0-004 are `done`, M0-005 is `review`, and M0-006 remains `not-started`. Update `CHANGELOG.md` with the P0-016 rollback and restored green baseline.

- [ ] **Step 4: Inventory every candidate file before staging**

Run:

```bash
git ls-files --others --exclude-standard
```

Expected: only source, generated non-copyrighted fixtures, research/evidence, configuration, tests, plans, and documentation appear. Stop if any personal XML, source audio, app database, credential, private log, or dependency folder appears.

Run:

```bash
git status --short --branch
```

Expected: `main` remains aligned with `origin/main`; project files are modified/untracked and ignored local dependencies are absent.

- [ ] **Step 5: Stage the intentional initial project checkpoint**

Run:

```bash
git add .codex .gitignore AGENTS.md CHANGELOG.md DECISIONS.md KNOWN_ISSUES.md TASKS.md docs fixtures scripts spikes dj-copilot-codex-master-prompt.md
```

Do not use `git add -A` for this first mixed-worktree checkpoint.

- [ ] **Step 6: Inspect the staged snapshot for secrets, personal media, and formatting errors**

Run:

```bash
git diff --cached --check
```

Expected: exit 0.

Run:

```bash
git diff --cached --name-only
```

Expected: no personal XML path, source-audio extension, SQLite/app database, dependency directory, cache, or private log.

Run:

```bash
git grep --cached -n -I -E "OPENAI_API_KEY=|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|sk-[A-Za-z0-9]{20,}"
```

Expected: no matches and exit status 1. Documentation may mention the literal name `OPENAI_API_KEY`, but no assignment or secret-like value may be staged.

- [ ] **Step 7: Inspect the staged diff and commit**

Run:

```bash
git diff --cached --stat
```

Then inspect the staged diff by file, paying particular attention to the master-prompt amendment, `.gitignore`, P0-016 deletions, accepted ADR-0002, task/issue statuses, and historical evidence banner.

Run:

```bash
git commit -m "chore: establish personal DJ Copilot baseline"
```

Expected: commit succeeds on `main` and includes only the reviewed project baseline.

- [ ] **Step 8: Push the first green checkpoint**

Run:

```bash
git push origin main
```

Expected: push succeeds. If GitHub rejects the update, stop and report the exact rejection; do not force-push.

---

### Task 6: Record the Green Hash, Close M0, and Push the Evidence Commit

**Files:**
- Modify: `TASKS.md`
- Modify: `docs/RECOVERY.md`
- Modify: `docs/evidence/phase-0/verification.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the pushed green implementation/documentation commit from Task 5.
- Produces: durable recovery/checkpoint records, a closed M0 ledger, a second pushed documentation commit, and a clean synchronized worktree.

- [ ] **Step 1: Capture the exact green checkpoint**

Run:

```bash
git rev-parse --short=12 HEAD
```

Record the returned 12-character hash as the M0 green baseline in the files below. Never invent or precompute the hash.

- [ ] **Step 2: Finalize task, recovery, evidence, and changelog records**

In `TASKS.md`, set M0-005 and M0-006 to `done`, place the captured hash and `origin/main` in their checkpoint/evidence cells, and set the current state to `M0 complete; M1 planning next`.

In `docs/RECOVERY.md`, replace the temporary `c85d4ac` recovery point with the captured M0 hash. Add one `git show --stat` example and one path-scoped `git diff` example using the captured 12-character hash literally. The checked-in document must not use a symbolic hash token.

In `docs/evidence/phase-0/verification.md`, record the green hash, first push success, and the distinction between historical Phase 0 evidence and current M0 completion. In `CHANGELOG.md`, mark M0 scope reset and green foundation complete.

- [ ] **Step 3: Run the focused documentation/scope check**

Run:

```bash
python3 -B -m unittest discover -s scripts/tests -v
```

Expected: the existing 11 script/environment/structure tests pass.

Run:

```bash
git diff --check
```

Expected: exit 0.

- [ ] **Step 4: Commit the checkpoint records**

Run:

```bash
git add TASKS.md CHANGELOG.md docs/RECOVERY.md docs/evidence/phase-0/verification.md
```

Run:

```bash
git diff --cached --check
```

Expected: exit 0.

Run:

```bash
git commit -m "docs: record M0 green checkpoint"
```

Expected: documentation-only commit succeeds.

- [ ] **Step 5: Push the final M0 record**

Run:

```bash
git push origin main
```

Expected: push succeeds without force.

- [ ] **Step 6: Verify local and GitHub state agree**

Run:

```bash
git rev-list --left-right --count origin/main...main
```

Expected: `0 0`.

Run:

```bash
git status --short --branch
```

Expected: clean `main` tracking `origin/main` with no ahead/behind count.

- [ ] **Step 7: Stop at the M0 boundary**

Report the two pushed commit hashes, focused and aggregate verification outcomes, retained historical limitations, and that M1 is not yet implemented. Write and approve the separate M1 app-shell/library implementation plan before creating application code.
