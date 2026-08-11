# Privacy and Local Data Boundaries

Status: Required personal-MVP behavior; implementation evidence follows by milestone
Last updated: 2026-08-10

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

## Trust assumption

The ordinary same-user Codex trust model is an accepted product assumption. DJ Copilot validates what it uses and what it writes, but it does not build a separate OS security perimeter around Codex on a Mac where Joe already grants Codex access. Revisit this assumption before sharing the app or adding remote/multi-user features.
