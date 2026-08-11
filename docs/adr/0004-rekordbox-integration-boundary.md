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

## Consequences if accepted

XML-only mode is a permanent supported fallback. Export uses temporary write, independent reparse, ID/location validation, and atomic finalize with explicit overwrite confirmation.
