# DJ Copilot Design

Status: approved by the user's authoritative master prompt on 2026-08-09
Source of truth: `../../../dj-copilot-codex-master-prompt.md`

## Scope and decomposition

The product is too large for a single safe implementation batch. It is decomposed into the ten independently gated phases in `../../PHASE_PLAN.md`. Each phase produces a runnable/testable vertical slice or, for Phase 0, executable feasibility evidence. Later phase plans are written only after the preceding contracts and gate are green, avoiding speculative detail that research or measured constraints could invalidate.

## Architecture

The default design has three authority levels. The React renderer is presentation-only and isolated from Node. Electron main mediates fixed typed IPC, supervises the worker, and hosts the one production `CodexProvider`. The Python DJ core owns the app database, Rekordbox interchange, local audio analysis, search, ranking, drafts, personalization, diagnostics, and bounded DJ MCP services.

Rekordbox remains authoritative through XML interchange. Stable app UUIDs are distinct from external IDs. Local deterministic logic retrieves and ranks only known tracks; Codex translates language into validated intent/plan structures and explains bounded supplied evidence. User-authored metadata and draft controls have highest authority.

## Data flow

User-selected XML and approved media roots enter the Python boundary as untrusted data. Safe import/reconciliation creates versioned app-owned records. A persistent stage queue produces local feature evidence and embeddings. Search and ranking return bounded real IDs and component scores. Optional Codex calls operate from a dedicated non-music workspace through strict MCP tools. Confirmed exports use a temporary file, independent reparse/validation, then atomic finalization.

## Failure handling

The renderer never blocks on local analysis. Worker crashes produce health degradation, supervised restart, and persisted job resume. File failures are per-track. Unsupported providers are explicit capabilities, not silent success. Codex auth/network/schema/tool errors disable only AI-dependent behavior and allow one structured-output correction at most. Invalid IDs, paths, XML, unconfirmed writes, and oversized tool payloads fail closed with stable redacted errors.

## Security and privacy

Raw audio never goes to Codex. Rekordbox databases and source audio are never written. Every privileged boundary validates schemas and size limits. The renderer has isolation/CSP/navigation controls; Codex has no arbitrary shell/SQL/filesystem primitive; metadata is untrusted data; write tools require action-scoped confirmation; paths resolve inside approved roots; XML disables external entities; diagnostics and prompts redact secrets and paths.

## Verification design

Generated XML/audio and synthetic 10,000-track fixtures provide deterministic CI. Tests span unit, property/fuzz, cross-language contracts, integration, UI/E2E, performance, recovery, security, migration, and packaging. `MockAIProvider` covers CI; real Codex, real Rekordbox, and personal-library quality checks are opt-in with redacted evidence. A phase closes only after focused/root gates and independent review.

## Self-review result

- No unresolved placeholder is used as a production decision; proposed ADRs enumerate their evidence gates.
- The architecture and product invariants match the authoritative prompt.
- Scope is decomposed by independently testable phase.
- "Complete" consistently means verified behavior, never implementation or UI presence alone.
