# DJ Copilot User Guide

Status: M3 development app runnable; set-building and later personal-MVP workflows remain in progress
Roadmap: M0–M7 personal MVP

DJ Copilot is a personal companion to Rekordbox, not a replacement performance platform. M3 launches a desktop app, imports selected Rekordbox XML, browses and filters the app-owned library projection, analyzes selected local tracks, and produces deterministic similar/next-track suggestions without uploading or modifying audio.

## Run the M3 development app

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

An invalid or unsupported XML reports the problem while retaining the prior usable library. Analysis jobs/results are app-owned and persistent; an interrupted running job is queued after restart while a user-paused queue remains paused. Reimport keeps analysis for an unchanged local source, but changing its path/availability clears that track's old result so it can be analyzed again safely. One bad/corrupt file fails only its own row. Missing NumPy/FFmpeg disables analysis without disabling library browsing. If the local core stops once, the app attempts one restart and reuses SQLite state. If the service reaches the degraded state, quit and reopen DJ Copilot before trying again.

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

Rekordbox databases and source audio are never modified. Raw audio stays local. The app never asks for an OpenAI API key. M3 uses a project virtual environment/host Python plus external FFmpeg in development; the self-contained personal build and distributable decoder arrive in M7. Discovery scans at most 25,000 current-library tracks and deliberately uses simple deterministic ranking; personal-library tuning, saved filters, and learned preferences arrive through later use/M5. The current Homebrew GPL-configured FFmpeg is a personal development prerequisite, not a bundled app artifact.
