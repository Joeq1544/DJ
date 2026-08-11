# DJ Copilot

DJ Copilot is a local-first macOS companion for Rekordbox. The current M2 app launches an Electron desktop window, imports a user-selected Rekordbox XML export into app-owned SQLite, browses the collection and ordered playlist hierarchy, and runs resumable local analysis on selected tracks. Rekordbox files and source audio are never modified.

The complete personal MVP is being delivered through M0–M7. Discovery/ranking, set workflows, personalization, Codex assistance, and personal packaging arrive in the later milestones tracked in `TASKS.md`.

## Development setup

Requirements:

- macOS on Apple silicon;
- Node.js 24 or 25;
- pnpm 11.16.0;
- Python 3.12 or newer for development;
- external FFmpeg and ffprobe 8.1.2 for M2 local analysis.

Install the exact JavaScript dependencies and Electron binary:

```bash
pnpm setup
```

Launch the development app:

```bash
pnpm dev
```

Use **Import Rekordbox XML** and select an XML file exported by Rekordbox. The app reads it, stores only its own projection under Electron's user-data directory, and marks audio paths as available, missing, or unreadable. Select available rows to analyze them, pause/resume the durable queue, retry isolated failures, and inspect local heuristic features with confidence/provenance. Decoded PCM is streamed in memory and never retained or sent to Codex.

## Verification

Run the complete current local-analysis gate:

```bash
pnpm verify:m2
```

The gate checks exact local analysis prerequisites, runs the Python core suite, desktop tests, strict TypeScript, production build, and all generated-fixture Electron flows. It uses only generated/repository-owned synthetic data and exercises pause, forced core restart, persisted resume, valid/corrupt isolation, evidence reload, source immutability, and runtime cleanup. Personal Rekordbox XML, audio, app databases, credentials, caches, and reports must remain outside Git.

See `docs/USER_GUIDE.md` for the current workflow and `docs/RECOVERY.md` for safe checkpoints and app-state recovery.
