# DJ Copilot User Guide

Status: M1 development app runnable; later personal-MVP workflows remain in progress
Roadmap: M0–M7 personal MVP

DJ Copilot is a personal companion to Rekordbox, not a replacement performance platform. M1 launches a desktop app, imports selected Rekordbox XML, and browses the app-owned library projection.

## Run the M1 development app

1. From the repository, run `pnpm setup` once and then `pnpm dev`.
2. Wait for the window to report **Library service ready**.
3. Choose **Import Rekordbox XML** and select a Rekordbox XML export. Cancelling the picker makes no change.
4. After a successful import, use **All Tracks** or a playlist in the left-hand tree to change the table selection. Click a folder to collapse or expand it; choose **Load more tracks** when another page is available.
5. A warning marks a missing path; this is informational and does not open or modify the audio file.

An invalid or unsupported XML reports the problem while retaining the prior usable library. If the local core stops once, the app attempts one restart and reuses the app-owned SQLite state. If the polled status reaches the degraded state, quit and reopen DJ Copilot before trying again.

The deterministic demo input is `fixtures/rekordbox/phase0-library.xml`; it contains four generated metadata records, nested playlists, duplicate display names, Unicode, encoded paths, and intentionally unavailable audio paths. Do not add a personal XML export or audio to the repository.

## Intended complete workflow

1. Launch DJ Copilot, review what stays local, and see Codex status.
2. Select/import Rekordbox XML and approve optional music roots for local analysis.
3. Browse tracks and playlists; inspect missing-file, provenance, confidence, and analysis state.
4. Analyze selected tracks with visible progress and recoverable per-file failures.
5. Search/filter, find similar tracks, and request explainable next-track recommendations.
6. Create or request a set, then reorder, pin, ban, replace, version, analyze, and save it.
7. Review organization suggestions and record feedback that adjusts visible preferences.
8. Use Codex for natural-language search, planning, revision, and explanation when available.
9. Confirm export to a new Rekordbox-compatible XML destination and import it through Rekordbox.

Rekordbox databases and source audio are never modified. Raw audio stays local. The app never asks for an OpenAI API key. M1 uses the host Python runtime in development; the self-contained personal build arrives in M7.
