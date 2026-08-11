# DJ Copilot

DJ Copilot is a local-first macOS companion for Rekordbox. The current M1 app can launch an Electron desktop window, import a user-selected Rekordbox XML export into an app-owned SQLite database, and browse the collection and ordered playlist hierarchy. Rekordbox files and source audio are never modified.

The complete personal MVP is being delivered through M0–M7. Local analysis, discovery/ranking, set workflows, personalization, Codex assistance, and personal packaging arrive in the later milestones tracked in `TASKS.md`.

## Development setup

Requirements:

- macOS on Apple silicon;
- Node.js 24 or 25;
- pnpm 11.16.0;
- Python 3.12 or newer for development.

Install the exact JavaScript dependencies and Electron binary:

```bash
pnpm setup
```

Launch the development app:

```bash
pnpm dev
```

Use **Import Rekordbox XML** and select an XML file exported by Rekordbox. The app reads it, stores only its own projection under Electron's user-data directory, and marks audio paths as available, missing, or unreadable without opening the audio.

## Verification

Run the complete current app-shell/library gate:

```bash
pnpm verify:m1
```

The gate runs the Python core suite, desktop tests, strict TypeScript check, production build, and generated-fixture Electron flow. It uses only repository-owned synthetic data. Personal Rekordbox XML, audio, app databases, credentials, caches, and reports must remain outside Git.

See `docs/USER_GUIDE.md` for the current workflow and `docs/RECOVERY.md` for safe checkpoints and app-state recovery.
