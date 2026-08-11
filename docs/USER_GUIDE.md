# DJ Copilot User Guide

Status: M4 development app runnable; personalization, Codex assistance, and personal release packaging remain in progress
Roadmap: M0–M7 personal MVP

DJ Copilot is a personal companion to Rekordbox, not a replacement performance platform. M4 launches a desktop app, imports selected Rekordbox XML, browses and filters the app-owned library projection, analyzes selected local tracks, produces deterministic similar/next-track suggestions, builds persistent set drafts, inspects playlists/sets, and exports a self-contained Rekordbox XML without uploading or modifying audio.

## Run the M4 development app

1. Install external FFmpeg and ffprobe 8.1.2, then from the repository run `pnpm setup` once and `pnpm dev`.
2. Wait for the window to report **Library service ready**.
3. Choose **Import Rekordbox XML** and select a Rekordbox XML export. Cancelling the picker makes no change.
4. After a successful import, use **All Tracks** or a playlist in the left-hand tree to change the table selection. Click a folder to collapse or expand it; choose **Load more tracks** when another page is available.
5. A warning marks a missing path; this is informational and that row cannot be selected for analysis.
6. Use a row checkbox or **Select all analyzable tracks**, then choose **Analyze N selected**. At most 200 tracks can be selected at once.
7. Use **Pause analysis** and **Resume analysis** as needed. Failed rows keep a stable reason and can be selected and queued again without hiding successful results.
8. Successful rows keep imported BPM/key separate from local heuristic BPM/key and show codec, duration, confidence, loudness/energy, rhythm/timbre proxies, provider/pipeline, limitations, and a sixteen-part energy profile. **Not enough evidence** is an honest unknown, not an error.
9. In **Library filters**, combine search text with optional BPM, key, genre, energy, analysis-state, and availability constraints. Filters apply within the selected playlist; **Clear filters** returns to ordinary playlist browsing. Search terms all match across title, artist, album, or genre.
10. Choose **Explore** on a track. **Similar** shows deterministic feature/metadata neighbors. **Next** lets you choose Smooth, Build, Peak, Reset, Genre shift, Adventurous, Singalong continuation, or Closer. Open a candidate's details to inspect score evidence labeled Bonus, Penalty, Neutral, or Missing evidence. Missing evidence lowers confidence; it is not treated as a negative musical judgment.
11. In **Set drafts**, enter a title, one of the same eight intents, and optional target duration/artist-repeat cap. Create an empty draft, use checked tracks, use the selected playlist (including repeated positions), or generate up to twelve tracks from the current Explore seed or library evidence. **Inspect selected playlist** analyzes the imported order without changing it.
12. In a draft, use the named Move up/down controls; track and position pins; ban/remove/unban; insert and replacement controls; per-slot role and target-energy goals; intent/duration/artist constraints; and **Optimize order**. Track and position pins are separate: a position pin also keeps that slot's current track fixed until unpinned.
13. Use **Undo**, **Redo**, or Command-Z/Command-Shift-Z. **Save version** records the current revision; choose it under **Saved versions** to view it read-only, return to the current draft, or restore it as a new current revision. Drafts persist after restart.
14. **Inspect set** shows text-backed BPM/energy progression, adjacent transition evidence, warnings, and organization advice. Organization output is advisory only—nothing is written to Rekordbox.
15. **Prepare Rekordbox XML export** opens the native save dialog. Cancellation changes nothing. Review the destination name, warnings, and whether the operation creates or replaces a file, then choose **Confirm export**. Export requires current available tracks and a remembered selected source XML; it writes one self-contained collection and one ordered playlist. Import the resulting XML through Rekordbox yourself.

An invalid or unsupported XML reports the problem while retaining the prior usable library. Analysis jobs/results are app-owned and persistent; an interrupted running job is queued after restart while a user-paused queue remains paused. Reimport keeps analysis for an unchanged local source, but changing its path/availability clears that track's old result so it can be analyzed again safely. One bad/corrupt file fails only its own row. Missing NumPy/FFmpeg disables analysis without disabling library browsing. If the local core stops once, the app attempts one restart and reuses SQLite state. If the service reaches the degraded state, quit and reopen DJ Copilot before trying again.

The deterministic demo input is `fixtures/rekordbox/phase0-library.xml`; it contains four generated metadata records, nested playlists, duplicate display names, Unicode, encoded paths, and intentionally unavailable audio paths. Its paths are unavailable, so it demonstrates browsing but cannot produce a successful M4 export. The automated M4 flow creates temporary available marker files and official numeric-KeyType XML outside the repository. Do not add a personal XML export, app database, or audio to Git.

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

Rekordbox databases, imported source XML, and source audio are never modified. Raw audio stays local. The app never asks for an OpenAI API key. M4 uses a project virtual environment/host Python plus external FFmpeg in development; the self-contained personal build and distributable decoder arrive in M7. Discovery/set scans cap ordinary catalogs at 25,000 tracks, drafts at 100 positions, generated drafts at 50, and inspection at 100 positions with explicit truncation. Ranking is deliberately deterministic; personal-library tuning, saved filters, and learned preferences arrive through later use/M5. The current Homebrew GPL-configured FFmpeg is a personal development prerequisite, not a bundled app artifact.
