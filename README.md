# DJ Copilot

DJ Copilot is a local-first macOS companion for Rekordbox. The current M6 development app imports a user-selected Rekordbox XML export into app-owned SQLite; browses and analyzes the local collection; searches, recommends, builds, inspects, versions, and exports sets; learns bounded visible preferences; and offers optional existing-auth Codex assistance. Rekordbox files and source audio are never modified, and raw audio is never sent to Codex.

The complete personal MVP is being delivered through M0–M7. M0–M6 are implemented; self-contained personal packaging, recovery/diagnostics polish, and the final deferred hands-on test period remain in M7 as tracked in `TASKS.md`.

## Development setup

Requirements:

- macOS on Apple silicon;
- Node.js 24 or 25;
- pnpm 11.16.0;
- Python 3.12 or newer for development;
- external FFmpeg and ffprobe 8.1.2 for development analysis;
- an existing ChatGPT/Codex login only when using the optional M6 Copilot features.

Install the exact JavaScript dependencies and Electron binary:

```bash
pnpm setup
```

Launch the development app:

```bash
pnpm dev
```

Use **Import Rekordbox XML** and select an XML file exported by Rekordbox. The app reads it, stores only its own projection under Electron's user-data directory, and marks audio paths as available, missing, or unreadable. Select available rows to analyze them; use local filters, Similar/Next, set drafts, inspection, export, metadata, and preferences; or explicitly check/sign in/run the inline **Copilot** for natural-language search, planning, one revision, and grounded explanation. Decoded PCM is streamed in memory and never retained or sent to Codex.

## Verification

Run the complete current development gate:

```bash
pnpm verify:m6
```

The gate checks exact development prerequisites, runs the Python core and desktop suites, strict TypeScript, production build, and every generated-fixture Electron flow through M6. The opt-in `pnpm smoke:m6:real` separately exercises the official SDK with existing ChatGPT authentication and records no response text. Personal Rekordbox XML, audio, app databases, credentials, caches, and reports must remain outside Git. The runnable self-contained `.app` is an M7 deliverable; `pnpm build` alone is not packaging evidence.

See `docs/USER_GUIDE.md` for the current workflow and `docs/RECOVERY.md` for safe checkpoints and app-state recovery.
