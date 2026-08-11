# ADR-0004: Rekordbox Integration Boundary

- Status: Accepted
- Date: 2026-08-09
- Owners: primary, Rekordbox specialist

## Context

DJ Copilot needs reliable collection/playlist interchange while Rekordbox remains authoritative. Reverse-engineered database and ANLZ formats can be version-sensitive and must never risk the user's production library.

## Decision

Ship user-selected official Rekordbox XML import/export as the fully supported baseline. Never write `master.db`. Keep `pyrekordbox`, database, and ANLZ support as optional, version-detected adapters that fail closed and are excluded until fixture plus backed-up test-profile evidence exists. Optional reverse-engineered reads operate only on an immutable app-owned snapshot made with Rekordbox closed or on an explicitly supplied backup/test profile; they never open a live production database for mutation.

## Alternatives

- Direct database integration: richer data but unacceptable baseline compatibility and mutation risk.
- Playlist-only formats: simpler but insufficient for required collection metadata and hierarchy.

## Phase 0 decision evidence

Official Rekordbox XML documentation and `pyrekordbox` release/source behavior were inspected at the exact references recorded in `../REPO_RESEARCH.md`. The official XML format is the accepted boundary; `pyrekordbox` remains reference-only because its database API is mutation-capable and its tested Rekordbox ceiling trails the locally installed version.

The standard-library synthetic spike in `../../spikes/rekordbox_xml/` parses collection tracks, nested playlist order, duplicate metadata with distinct IDs, missing files, Unicode, spaces, percent encoding, ampersands, apostrophes, emoji, non-ASCII and external-volume paths without changing the source. Its deliberately narrow input contract accepts only UTF-8/UTF-8-BOM. Eleven focused tests passed twice and cover DTD/entity denial, demonstrated BOM and no-BOM UTF-16 entity-expansion bypasses, malformed/root/version/count errors, excessive bytes/nodes/text/depth/tracks/playlists, duplicate IDs, unresolved references, non-local/NUL/traversal paths, and symlink escape. Source and canonical-result hashes matched the durable evidence in `../evidence/phase-0/rekordbox-xml.md`.

A fresh task review found and resolved an incorrect playlist-limit counter and clarified the spike's immutability claim. Primary security review then reproduced two encoding bypasses; both were fixed and scoped re-review approved the final contract. The proof is synthetic only and does not claim compatibility with a user-authorized Rekordbox 7.2.14 export or production parser completion.

## Later implementation verification

Phase 2 proves reconciliation, round-trip, source-hash immutability, independent export reparse, point-of-use IDs, same-volume temporary sibling/atomic finalize, explicit overwrite rules, and validated cross-volume copy-to-destination-temp behavior. Real user-selected XML and optional backed-up profile verification remain manual evidence where unavailable.

## Personal-MVP M4 implementation amendment (2026-08-11)

M4 implements the baseline as one deterministic, self-contained XML document containing the current validated draft tracks and one playlist. It does not merge an imported document, write Rekordbox databases, or add an optional reverse-engineered adapter. The production importer is extended narrowly to accept both official node-level numeric playlist references (`KeyType="0"` for TrackID and `KeyType="1"` for Location) and the existing synthetic child-level textual form; mixed, conflicting, or unknown forms fail closed.

Electron main owns the native destination picker and a short-lived single-use confirmation bound to the exact draft revision and canonical destination. The renderer receives a display name, never a filesystem path. The Python core resolves current stable IDs to private external IDs and paths, blocks unresolved/unavailable/non-numeric entries and source aliases, writes a mode-0600 temporary destination sibling, flushes and syncs it, independently reparses it with the production importer, compares exact collection and playlist order, then atomically replaces the confirmed destination. M4 needs no cross-volume fallback because the temporary file is created beside the destination.

This is the personal-use implementation of the trusted-write boundary. It retains source immutability, schema validation, path hiding, point-of-use checks, explicit overwrite confirmation, and failure integrity without reviving the superseded Phase 0 approval broker or speculative XML/database machinery. Real Rekordbox import behavior and native picker appearance remain deferred under D-045 rather than recorded as passed.

Implementation checkpoints `3f87261` and `dd741d6` provide the focused parser/writer and integrated desktop evidence. The pre-review `pnpm verify:m4` gate passed 117 core tests, 115 desktop tests, strict typecheck/build, and five Electron flows. The M4 flow exercised cancel, new-file, and confirmed-overwrite states; reparsed the finalized output with the production importer; preserved exact repeated order and all generated source hashes; and removed temporary/runtime artifacts. This is engineering compatibility evidence only, not a real Rekordbox 7.2.14 Bridge import or visual/native-dialog pass.

## Consequences if accepted

XML-only mode is a permanent supported fallback. Export uses temporary write, independent reparse, ID/location validation, and atomic finalize with explicit overwrite confirmation.
