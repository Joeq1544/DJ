# Rekordbox XML feasibility spike

Status: passed on 2026-08-09 with Python 3.14 standard library only.

The synthetic fixture represents four collection tracks under `DJ_PLAYLISTS Version="1.0.0"`. It includes duplicate title/artist metadata with distinct IDs and locations, percent-encoded Unicode/special-character paths, repeated tempo/cue children, nested folder/playlist order, both `TrackID` and `Location` playlist references, and a missing file. The parser returns canonical JSON-compatible records with external IDs, decoded local paths, `Path.exists()` availability, and playlist hierarchy/order. “Immutable” means it does not modify source XML and it emits deterministic canonical serialized output; its returned JSON-compatible dict/list values are intentionally mutable. It does not open audio.

This synthetic spike accepts only UTF-8 input (with an optional UTF-8 BOM) before parsing, rejecting other encodings. It then rejects DTD/entity declarations case-insensitively in decoded text. Parsing further rejects malformed XML, unsupported root/version, duplicate IDs, unresolved playlist keys, mismatched declared collection/folder/playlist counts, non-local file hosts, NULs, root/traversal escape, and symlink escape. Injectable limits bound input bytes, element nodes, text/attribute data, nesting depth, tracks, and playlist records.

Focused command, run twice:

```sh
python3 -m unittest discover -s spikes/rekordbox_xml/tests -v
```

The initial baseline runs passed 8 tests. After review fixes, the primary agent independently ran the latest 11-test suite twice with `PYTHONDONTWRITEBYTECODE=1`; both runs exited 0, including the BOM-marked and no-BOM UTF-16 declaration/entity regressions. The independently recomputed source SHA-256 is `780618d97cfa005cb34daa5c721e0b1529e1bc4c1a7d6315d4115fa8418ab176`; canonical normalized-result SHA-256 is `72134cd7411302454177c7201613b5bd99bc144472fe8e25e48356a669cf7d82`.

## Review evidence

A fresh read-only task reviewer found one important implementation defect: the initial `max_playlists` check counted tracks with memberships rather than playlist nodes. Fix round 1 added a shared-track/multiple-playlist regression, corrected the counter, and clarified that immutable means source preservation plus deterministic serialization. Scoped re-review approved both corrections.

Primary integration review then reproduced internal-entity expansion through BOM-marked UTF-16 and explicit no-BOM UTF-16LE, bypassing the original ASCII declaration scan. Fix rounds 2 and 3 replaced the scan with a UTF-8/UTF-8-BOM-only decoding boundary plus decoded declaration denial and added both regressions. A second scoped read-only re-review approved the final security/evidence correction with no remaining finding.

This is only a Phase 0 proof using synthetic data, not confirmation against a real user-authorized Rekordbox export or a production import subsystem.
