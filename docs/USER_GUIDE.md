# DJ Copilot User Guide

Status: M0–M7 personal arm64 app runnable; visual/private-library hands-on checks deferred
Roadmap: M0–M7 personal MVP

DJ Copilot is a personal companion to Rekordbox, not a replacement performance platform. The completed personal app imports selected Rekordbox XML, browses and filters the app-owned library projection, analyzes selected local tracks, produces deterministic similar/next-track suggestions, builds persistent set drafts, learns bounded visible preferences, adds optional natural-language Copilot search/planning/revision/explanation through the official Codex SDK, and includes local diagnostics/recovery without uploading or modifying audio.

## Run the personal app

Open `out/DJ Copilot-darwin-arm64/DJ Copilot.app` in Finder on the target Apple-silicon Mac. The app includes its own CPython/NumPy core, LGPL FFmpeg/ffprobe, Electron runtime, and exact Codex helper; normal packaged use does not require the repository, system Python, or Homebrew FFmpeg. It is ad-hoc signed for Joe's local use, not Developer-ID signed or notarized for public distribution.

## Run the development app

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
16. Choose **Details** on a track to set a 1–5 rating, comma-separated tags, and a note, or record a Like/Dislike. Search text includes tags/notes; **Minimum rating** and **Exact tag** compose with every existing filter. Rekordbox reimport keeps this metadata when the stable app track ID remains.
17. In **Saved filters**, name the current complete view, then load or delete it later. A saved view that names a removed playlist reports the problem and leaves the current view unchanged.
18. Next-track cards offer Accept, Reject, and Skip. The **Preference profile** stays in learning mode for fewer than five effective signals and cannot change rank; once active, personalized order is primary and each candidate shows its baseline rank/delta. Successful direct set edits also contribute visible evidence.
19. **Prepare preference export** creates or replaces a bounded JSON summary only after confirmation. **Reset preferences** clearly discloses that it clears feedback and ratings while preserving tags, notes, saved filters, sets, analysis, and the imported library.
20. The **Copilot** region begins with **Copilot status not checked** and launches no Codex helper merely because the app opened. Choose **Refresh Copilot status**, **Sign in with ChatGPT**, or submit a request when you want to use it. DJ Copilot reuses existing ChatGPT/Codex authentication and never asks for an API key.
21. **Search** translates natural language into local filters, Similar, or Next; the resulting tracks and scores come from the local core. **Plan set** returns a generated-set proposal. **Revise draft** proposes one current-draft change. **Explain** streams text grounded in the selected track, recommendation, or draft and cites known local track IDs.
22. A plan or revision labeled **Proposal — not applied** has not changed the database. Review it, then choose **Confirm proposal** or **Discard proposal**. Confirmation is single-use and rejects stale drafts; an already-satisfied change reports that no draft change was needed. Search and explanation never write. **Cancel** stops an active request without changing local state.
23. In **Diagnostics and recovery**, choose **Refresh diagnostics** for bounded database/resource/analysis status. **Back up database** creates an integrity-checked local SQLite backup at a selected destination. **Export redacted diagnostics** creates a path-free support snapshot, and **Show data folder** reveals app-owned storage without exposing its path to the renderer. To replace stale derived evidence, select available tracks, choose **Rebuild selected analysis**, review the warning, then **Confirm rebuild**; source audio and Rekordbox remain unchanged.

An invalid or unsupported XML reports the problem while retaining the prior usable library. Analysis jobs/results are app-owned and persistent; an interrupted running job is queued after restart while a user-paused queue remains paused. Reimport keeps analysis for an unchanged local source, but changing its path/availability clears that track's old result so it can be analyzed again safely. One bad/corrupt file fails only its own row. A missing development or bundled helper disables the affected analysis/Codex capability honestly without disabling unaffected local browsing; packaged mode never falls back to ambient helpers. If the local core stops once, the app attempts one restart and reuses SQLite state. If the service reaches the degraded state, quit and reopen DJ Copilot before trying again.

The deterministic demo input is `fixtures/rekordbox/phase0-library.xml`; it contains four generated metadata records, nested playlists, duplicate display names, Unicode, encoded paths, and intentionally unavailable audio paths. Its paths are unavailable, so it demonstrates browsing but cannot produce a successful Rekordbox export. Automated M4/M5 flows create temporary available marker files and XML outside the repository. Do not add a personal XML export, app database, preference export, or audio to Git.

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
10. Refresh diagnostics and keep a current database backup before larger experiments or manual recovery.

Rekordbox databases, imported source XML, and source audio are never modified. Raw audio stays local and is never sent to Codex. The app never asks for an OpenAI API key. Development may use a project/host Python and external FFmpeg; the personal app instead bundles CPython 3.14.3/NumPy 2.4.4 and separately source-built LGPL FFmpeg/ffprobe 8.1.2. Discovery/set scans cap ordinary catalogs at 25,000 tracks, drafts at 100 positions, generated drafts at 50, and inspection at 100 positions with explicit truncation. Ranking and learned preference effects are deliberately deterministic, bounded, inspectable, and resettable. The unrelated Homebrew GPL-configured FFmpeg remains development-only and is not copied into the app.

## Deferred post-build hands-on checklist

These checks are intentionally not passed yet. When ready, Joe can:

1. Open the exact `.app` from Finder and judge overall layout, readability, resizing, keyboard/focus behavior, and the native open/save pickers.
2. Import a private Rekordbox 7.2.14 XML export, browse representative playlists/repeats/Unicode, and keep the input outside Git.
3. Analyze a small representative audio sample and judge tempo/key/energy usefulness, heat/noise, progress, pause/restart, and one bad-file failure.
4. Judge Similar/Next recommendations, generated and edited set order, explanations, organization suggestions, and learned preferences against real DJ expectations.
5. Use existing ChatGPT auth for Copilot search/plan/revise/explain, confirm only an intended proposal, and confirm ordinary local work remains usable without Codex.
6. Export a new Rekordbox XML, import it into Rekordbox, verify exact playlist order/repeats, then exercise diagnostics, database backup, app relaunch, and the offline restore instructions in `docs/RECOVERY.md` if desired.

Record only what was actually observed; visual appearance, native-picker appearance, private-library compatibility, and subjective music quality are not implied by the automated M7 gate.
