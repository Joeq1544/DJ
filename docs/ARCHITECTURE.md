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

## Implemented M1–M6 slices

Electron 43.3.0 starts a sandboxed React 19 renderer and supervises a Python core over a mode-`0600` Unix socket in a mode-`0700` temporary runtime directory. The main process owns the XML picker. M1 exposed service status, selected-XML import, playlist tree, and paged tracks; M2 added queue, selected-status, pause, and resume analysis operations; M3 extends track paging with strict filters and adds only fixed find-similar and recommend-next operations. Requests and responses use strict runtime schemas and one JSON line capped at 1 MiB. Ordinary calls time out after five seconds; the bounded XML import has an explicit 120-second budget.

The development core runs with the selected `DJ_COPILOT_PYTHON` executable or `python3`, owns `dj-copilot.sqlite3` under Electron's user-data directory, and parses the XML completely before beginning its replacement transaction. Reimport preserves app IDs where the Rekordbox IDs/structural playlist keys match. Analysis is retained only for an unchanged normalized source path and availability; changed source identity invalidates its job/features, and transactional completion requires the existing track's matching running fingerprint so a late worker cannot attach stale or orphan evidence. A failed import rolls back and leaves the previous revision browsable. One unexpected core exit in a 30-second window is restarted; a second produces a visible degraded state through the renderer's two-second status refresh. The client is looked up per IPC operation so recovery uses the replacement connection. Graceful quit waits for the worker and removes only the supervisor-created runtime directory.

M2 upgrades an existing M1 database to schema version 2 only after creating a unique sibling `*.pre-m2.sqlite3` backup. Private normalized media paths remain core-only. One daemon analysis worker processes deterministic queued order, stores bounded progress and stable per-track failures, pauses cooperatively, requeues interrupted running work after stop/restart, and reuses results only when source fingerprint plus provider/version/pipeline match. The baseline provider invokes external FFmpeg/ffprobe 8.1.2, streams mono `f32le` PCM into pinned NumPy 2.4.4, writes no decoded PCM, and stores transparent heuristic evidence with confidence and limitations. Structure and embeddings remain explicit unavailable capabilities.

The renderer polls analysis once per second without overlap and requests at most 200 visible/selected track IDs while retaining global queue counts. Imported and local BPM/key remain distinct. Feature evidence includes codec/duration, loudness/energy, rhythm/timbre proxies, provenance, and a semantic sixteen-bucket energy profile. Missing NumPy, FFmpeg, or ffprobe disables analysis without disabling core health or library browsing.

M3 keeps SQLite at schema version 2. One joined, path-free projection reads at most 25,000 tracks with current playlist membership, latest analysis state, and successful features. Python applies AND-composed metadata, tempo, key, genre, energy, analysis-state, and availability filters before stable cursor paging. `feature-similarity-v1` and `transition-v1` use integer-only fixed weights, normalized key/half-time tempo evidence, deterministic ties, confidence based on evidence coverage/quality, and explicit bonus, penalty, neutral, or missing components. Candidates are brute-force bounded and available-only; unknown seeds fail rather than becoming empty success. The renderer retains the last successful discovery result on a request failure and never receives source paths or audio.

M4 upgrades schema-v2 databases to schema version 3 only after creating the first free `*.pre-m4.sqlite3` sibling backup. It remembers the selected import XML path privately and adds exactly three draft tables: one draft head, immutable bounded JSON revisions, and named saved-version pointers. Drafts contain at most 100 ordered entries, preserve playlist repeats, use optimistic head revisions, support branch-aware undo/redo and at most 100 saved versions, and keep separately meaningful track and position pins. Generation, replacement, bounded adjacent-swap optimization, transition inspection, warnings, and advisory organization reuse M3 evidence; missing analysis remains explicit.

The M4 desktop boundary adds six fixed set operations and two export operations. The renderer can create from empty/selected/playlist/generated sources, edit constraints and entry goals, move/pin/ban/remove/insert/replace, optimize, undo/redo, save/view/restore versions, inspect a draft or imported playlist, and view advisory organization output. Electron main alone owns the save dialog and a single-use confirmation bound to the draft revision, canonical destination, and expected absent/regular-file state; the renderer sees only the destination basename. The core resolves current IDs and private paths, emits one deterministic official numeric-KeyType XML collection plus playlist, preserves repeated playlist references, writes a mode-`0600` temporary sibling, flushes/fsyncs, reparses with the production importer, compares exact semantics, rechecks the destination, and atomically replaces it. Rekordbox databases and imported XML/audio remain untouched.

The production build currently bundles the Electron main, isolated preload, and renderer only. A bundled CPython 3.12 runtime and packaged resource discovery remain M7 work; development success is not packaging evidence.

M5 upgrades schema-v3 databases to schema version 4 only after creating the first free `*.pre-m5.sqlite3` sibling backup. It adds exactly three app-owned tables for track metadata, saved filters, and strict feedback, without cascading foreign keys to the replace-on-import track projection. Retained stable IDs keep ratings/tags/notes across reimport; removed-track metadata is cleaned. Draft decoding accepts exact schema-v3 or schema-v4 filter shapes, and new drafts emit v4.

The pure deterministic `preference-linear-v1` projection activates only after five effective signals, ramps the existing optional preference component to a maximum 150,000-ppm weight, and exposes bounded track/genre affinities plus event counts. Standard recommendations and M4 set scoring receive the active evidence; comparison rescoring uses one baseline-selected candidate universe. Successful non-no-op replace/move/positive-pin/remove/ban edits append feedback in the same transaction as the draft revision, while conflicts, failures, no-ops, undo, and redo append none. Tags/notes remain searchable authored metadata, not learned sentiment.

The renderer exposes inline ratings/tags/notes, exact tag/rating/text filters, saved views, direct and recommendation feedback, learning/active status, rank deltas, profile inspection, export, and disclosed reset. Reset deletes feedback and clears ratings while preserving tags, notes, saved filters, drafts, analysis, and library data. Electron main owns the preference JSON destination, single-use revision-bound confirmation, mode-`0600` temporary write, strict reparse, destination recheck, and atomic replace; the bounded export contains no paths, authored metadata, display metadata, raw events, audio, or credentials.

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

## M6 selected Codex topology

ADR-0009 keeps AI in Electron main behind `AIProvider`. A bounded in-memory coordinator exposes only status/login/start/poll/cancel/confirm. `CodexProvider` uses exact official SDK 0.147.0 and existing ChatGPT authentication; `MockAIProvider` supplies deterministic tests. Codex receives one concise task plus bounded path-free current DTOs and returns a strict interpreted proposal or grounded explanation.

There is no production MCP server in M6. Main invokes the already-fixed core commands for filters, Similar, Next, set creation, replacement lookup, mutation, and inspection. Search and explanation are read-only. A plan or one draft mutation gets a single-use main-owned confirmation bound to its request and current revision before the core may write; a valid already-satisfied mutation returns an honest unchanged snapshot. Request/event state is capped and expires in memory; no AI transcript schema is added. Status and provider work are lazy explicit actions, so ordinary local app launch initializes no Codex helper. Strict output adapts Zod's draft schema to the live root-object/required/nullable/typed-constant contract, then revalidates every response. The SDK/runtime remains outside the CJS bundle/ASAR for native resolution, with complete packaging verification owned by M7.
