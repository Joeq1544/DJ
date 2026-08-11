# Privacy and Local Data Boundaries

Status: Local behavior, bounded Codex data flow, and packaged diagnostics/recovery implemented through M7
Last updated: 2026-08-11

## Stays local

- Raw audio, decoded samples, and source media.
- Rekordbox databases and source XML.
- App-owned SQLite, analysis caches, embeddings, model output, drafts, tags, notes, preferences, and backups unless Joe explicitly exports selected app data.
- Full filesystem paths by default.
- Credentials; DJ Copilot never reads, copies, or stores raw Codex credentials.

## May be sent to Codex for an explicit AI action

Only the smallest bounded context needed for the chosen task: validated app track IDs, selected display metadata, derived feature summaries with provenance/confidence, candidate/transition evidence, Joe's request, and relevant draft constraints. Raw audio and decoded samples are prohibited. Full paths are omitted or redacted by default.

## User control

- Local workflows remain usable without Codex.
- A Codex request begins from an explicit user action and failures preserve local state.
- Durable app changes and XML exports are previewed and confirmed in the trusted UI.
- Diagnostics exports use an allowlist and exclude audio, credentials, unrestricted personal files, and avoidable private metadata.
- Preferences support inspection, export, and reset.

M4 set creation, ranking, inspection, organization advice, history, and XML export are entirely local and initialize no Codex request. M5 ratings, tags, notes, saved filters, feedback, profiles, and comparisons are also local. The renderer receives stable app IDs and display/derived evidence, never imported media paths, the imported XML path, or a chosen export path. Electron main owns export destinations and confirmation. Preference JSON contains only bounded counts, opaque current IDs, and numeric affinities—no paths, titles, artists, tags, notes, raw event history, audio, credentials, or logs.

ADR-0009's explicit-action-only M6 flow is implemented. Merely opening the Library performs no Codex status or helper call; status, sign-in, and tasks begin only after their named user actions. Natural-language search sends the request and filter vocabulary, not a library dump. Plan parsing sends the request and optional selected-track context; the local core chooses tracks. Revision/explanation send only the bounded path-free draft/recommendation/inspection DTOs needed for that request. Provider context excludes source/XML paths, raw or decoded audio, notes, credentials, logs, and unrestricted metadata. Search/explanation do not write; set creation/revision remain main-owned single-use proposals until trusted-UI confirmation. The mock and redacted real smoke evidence is recorded in `docs/evidence/m6-codex-assistance.md`.

M7 database backups remain local at the destination Joe explicitly selects. **Show data folder** is an explicit action; the renderer never receives the path. **Export redacted diagnostics** writes an allowlisted snapshot containing bounded versions, architecture/release mode, resource availability, schema/integrity, and analysis capability only. It excludes audio, decoded samples, source/XML/data paths, library metadata, tags, notes, preferences, credentials, Codex auth state, logs, and response text. The packaged real-Codex smoke stores only redacted pass/fail booleans. Package manifests and inventories contain resource-relative build paths/hashes and dependency metadata, not personal library data.

## Trust assumption

The ordinary same-user Codex trust model is an accepted product assumption. DJ Copilot validates what it uses and what it writes, but it does not build a separate OS security perimeter around Codex on a Mac where Joe already grants Codex access. Revisit this assumption before sharing the app or adding remote/multi-user features.
