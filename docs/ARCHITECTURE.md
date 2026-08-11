# DJ Copilot Architecture

Status: Approved personal full-feature MVP architecture
Last updated: 2026-08-11

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

## Implemented M1–M2 slices

Electron 43.3.0 starts a sandboxed React 19 renderer and supervises a Python core over a mode-`0600` Unix socket in a mode-`0700` temporary runtime directory. The main process owns the XML picker. M1 exposed service status, selected-XML import, playlist tree, and paged tracks; M2 adds only queue, selected-status, pause, and resume analysis operations. Requests and responses use strict runtime schemas and one JSON line capped at 1 MiB. Ordinary calls time out after five seconds; the bounded XML import has an explicit 120-second budget.

The development core runs with the selected `DJ_COPILOT_PYTHON` executable or `python3`, owns `dj-copilot.sqlite3` under Electron's user-data directory, and parses the XML completely before beginning its replacement transaction. Reimport preserves app IDs where the Rekordbox IDs/structural playlist keys match. Analysis is retained only for an unchanged normalized source path and availability; changed source identity invalidates its job/features, and transactional completion requires the existing track's matching running fingerprint so a late worker cannot attach stale or orphan evidence. A failed import rolls back and leaves the previous revision browsable. One unexpected core exit in a 30-second window is restarted; a second produces a visible degraded state through the renderer's two-second status refresh. The client is looked up per IPC operation so recovery uses the replacement connection. Graceful quit waits for the worker and removes only the supervisor-created runtime directory.

M2 upgrades an existing M1 database to schema version 2 only after creating a unique sibling `*.pre-m2.sqlite3` backup. Private normalized media paths remain core-only. One daemon analysis worker processes deterministic queued order, stores bounded progress and stable per-track failures, pauses cooperatively, requeues interrupted running work after stop/restart, and reuses results only when source fingerprint plus provider/version/pipeline match. The baseline provider invokes external FFmpeg/ffprobe 8.1.2, streams mono `f32le` PCM into pinned NumPy 2.4.4, writes no decoded PCM, and stores transparent heuristic evidence with confidence and limitations. Structure and embeddings remain explicit unavailable capabilities.

The renderer polls analysis once per second without overlap and requests at most 200 visible/selected track IDs while retaining global queue counts. Imported and local BPM/key remain distinct. Feature evidence includes codec/duration, loudness/energy, rhythm/timbre proxies, provenance, and a semantic sixteen-bucket energy profile. Missing NumPy, FFmpeg, or ffprobe disables analysis without disabling core health or library browsing.

The production build currently bundles the Electron main, isolated preload, and renderer only. A bundled CPython 3.12 runtime and packaged resource discovery remain M7 work; development success is not packaging evidence.

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
