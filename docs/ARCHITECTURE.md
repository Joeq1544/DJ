# DJ Copilot Architecture

Status: Approved personal full-feature MVP architecture
Last updated: 2026-08-10

## System context

```text
Rekordbox XML + user-selected local audio
                    |
                    v
          Python DJ core + SQLite
             ^               ^
             |               | narrow app commands / optional MCP
             |               |
Electron main + preload -----+----- official Codex SDK
             ^
             | fixed typed IPC
             |
        React renderer
```

DJ Copilot is a local-first companion. Rekordbox remains authoritative, while the app owns its derived database, analysis, preferences, drafts, and exports. Local functionality works without Codex.

## Process responsibilities

| Unit | Owns | Does not own |
| --- | --- | --- |
| React renderer | Presentation, interaction state, accessible views | Node, filesystem, database, shell, Codex credentials |
| Preload/Electron main | Windows, dialogs, lifecycle, typed IPC, worker supervision, official Codex SDK | Music analysis, ranking truth, app database writes |
| Python core | Sole app SQLite connection, XML reconciliation, audio jobs, features, search, ranking, drafts, preferences | Rekordbox database writes, source-audio writes, Codex auth |
| Narrow MCP adapter when needed | Validated app commands over bounded schemas | Direct SQLite, arbitrary SQL, shell, unrestricted filesystem or audio bytes |

Use Electron's ordinary renderer sandbox and context isolation. The preload exposes fixed named operations rather than general message forwarding. The Python core remains the sole app-database owner; later milestones introduce only the protocol messages they actually use.

## Data ownership and source immutability

- Rekordbox XML and audio are user-selected read-only inputs.
- Rekordbox databases and source audio are never written or migrated.
- Stable app track IDs are distinct from external Rekordbox identifiers.
- Analysis values store provider/version, provenance, confidence, and time.
- Explicit user edits, pins, bans, tags, notes, and ratings outrank predictions.
- SQLite, caches, drafts, and preferences live in app-owned storage.
- Exports target a user-selected new file or confirmed destination, use a temporary file, and are reparsed before replacement.

## Main data flow

1. The user selects Rekordbox XML and optional media roots.
2. The Python core validates, parses, and reconciles library records into app-owned SQLite.
3. Resumable local jobs read selected audio and store versioned derived features without modifying the files.
4. Deterministic code searches, filters, scores transitions, builds candidates, optimizes sequences, and applies preferences.
5. Electron main sends Codex only the bounded metadata/features/IDs/draft context needed for an explicit request.
6. Returned intents and IDs are schema-checked against the current library before use.
7. Consequential state changes and exports are previewed and confirmed in the trusted UI.

## Same-user trust boundary

This personal tool assumes Joe, his logged-in macOS account, and the normal Codex capabilities he already grants are trusted. It does not attempt OS-level containment of every Codex/MCP descendant or proof that Codex cannot read anything the same user can read.

Practical safeguards remain: renderer isolation, fixed IPC, bounded schemas, validated IDs/paths, no generic shell/SQL app tools, local raw audio, source immutability, migration backups, and explicit confirmation for consequential writes. Codex output and imported metadata are untrusted inputs to these checks, not authorities.

## Failure and recovery behavior

- Failed imports preserve the previous usable library state.
- A bad audio file fails only its own job; queues persist and resume.
- Worker crashes produce a visible degraded state and bounded restart attempt.
- Codex auth/network/schema failures preserve local workflows and current drafts.
- Unknown/stale IDs fail before recommendation, mutation, or export.
- Migrations back up app-owned data first; export replacement follows successful reparse.
- Errors are useful to Joe while credentials and unnecessary private data stay out of logs.

## Historical Phase 0 evidence

The detailed research, process-protocol proofs, hostile XML/audio fixtures, Codex experiments, and old commercial gate remain under `docs/evidence/phase-0/` and the ADRs. That evidence informs implementation but no longer blocks feature work on P0-016, exhaustive sentinels, ambient-configuration perfection, or complete process-tree containment. Missing historical evidence remains missing; it is not relabeled as passed.
