# ADR-0008: Interpretable Personalization and User Metadata

- Status: Accepted
- Date: 2026-08-11
- Owners: primary, ranking specialist, desktop and UI implementers

## Context

M5 must make explicit feedback measurably influence later recommendations while also delivering saved filters and app-owned ratings, tags, and notes. The existing M3 scorer is deterministic, already reserves a `preference` component, and is reused by M4 set generation and optimization. This personal tool does not need a model service, embeddings, background training, or a second ranking stack.

Schema-v3 draft snapshots persist the exact M3 filter shape, and ordinary Rekordbox reimport deletes and recreates projected track rows while retaining stable app IDs. M5 therefore needs a compatible snapshot decoder and metadata storage that survives retained-track reimport.

## Decision

Upgrade app-owned SQLite to schema version 4 after creating the first free `*.pre-m5.sqlite3` sibling backup for an existing schema-v3 database. Add exactly three tables:

- `track_user_metadata`: one stable track ID, nullable rating, nullable note, normalized/deduplicated tags JSON, and update timestamp;
- `saved_filters`: stable ID, case-insensitively unique bounded name, validated current `TrackFilters` JSON, and timestamps;
- `user_feedback`: strict event type plus only the track, related-track, seed, intent, draft, and index fields needed for explicit recommendation and successful draft-edit evidence.

These app-owned tables do not use cascading foreign keys to the replace-on-import `tracks` projection. Metadata for retained stable IDs survives reimport; metadata for tracks no longer in the current library is cleaned. Preference calculations ignore stale feedback references and never return a non-current candidate.

Use one pure deterministic `preference-linear-v1` model. Fixed signed signals cover likes/dislikes, accepted/rejected/skipped recommendations, successful manual replacement/reorder/pin/remove/ban edits, and current 1–5 ratings. Track and normalized-genre affinities produce the already-reserved preference component. Tags and notes remain searchable explicit metadata and are not silently interpreted as sentiment.

The preference component has zero weight until five effective signals exist, then ramps predictably and caps at `150_000 ppm`. Existing M3 component rules stay unchanged. The profile exposes baseline/learning/active status, total and effective evidence counts, the minimum threshold, current weight, bounded event counts, and bounded track/genre affinities. Standard recommendations and M4 set scoring use the active profile; one comparison operation scores the same bounded baseline candidate universe with and without the preference component and returns both rankings.

Reset deletes learned feedback and clears ratings so ordinary recommendations exactly reproduce baseline behavior. It preserves tags, notes, saved filters, drafts, analysis, and imported library data. The UI must disclose this scope before confirmation.

Preference export is an inspectable bounded JSON snapshot, not a model artifact or database backup. Electron main owns the native save picker, single-use confirmation, destination checks, and atomic mode-`0600` JSON write; the renderer receives only status and basename. The export contains profile/evidence summaries and no paths, audio, credentials, notes, or private logs.

Extend `TrackFilters` only with `ratingMin` and one exact normalized `tag`. Text search also checks user tags and notes. Persisted draft decoding accepts either the exact schema-v3 filter keys or the exact schema-v4 keys; new snapshots emit only schema v4.

## Consequences

Personalization remains transparent, bounded, local, deterministic, and immediately resettable. It influences real recommendation/set paths without introducing asynchronous learning or opaque state. A tiny feedback set is labeled learning and cannot alter ranking. Ratings are intentionally part of resettable preference evidence, while tags and notes remain durable user-authored metadata.

M5 must prove migration backup, retained-track metadata, old-draft compatibility, atomic successful-edit feedback, same-universe baseline comparison, exact reset restoration, and confirmed export. Visual QA remains deferred under D-045.

## Implementation evidence

Implemented through checkpoint `b5cbee6` and the reviewed closure correction. The final `pnpm verify:m5` gate passes 151 core tests, 137 desktop tests, strict typecheck/build, and all six generated Electron flows. The single bounded review found one visible stale-comparison defect after reset; its failing renderer reproduction now passes by invalidating and refetching an open Next comparison against the reset profile. No High or other Medium normal-workflow finding remained.
