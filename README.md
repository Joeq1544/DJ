# DJ Copilot

DJ Copilot is a local-first macOS companion for Rekordbox. The completed personal MVP imports a user-selected Rekordbox XML export into app-owned SQLite; browses and analyzes the local collection; searches, recommends, builds, inspects, versions, and exports sets; learns bounded visible preferences; offers optional existing-auth Codex assistance; and includes diagnostics, selected-analysis rebuild, and database backup. Rekordbox files and source audio are never modified, and raw audio is never sent to Codex.

M0–M7 are implemented as one self-contained, ad-hoc-signed arm64 personal `.app`. It is not notarized, universal, or intended for public distribution. Visual/native-picker, private-library compatibility, and subjective music-quality checks are intentionally deferred to Joe's post-build hands-on period and are not reported as passes.

## Run the personal app

The verified local artifact is:

```text
out/DJ Copilot-darwin-arm64/DJ Copilot.app
```

Open it in Finder on the target Apple-silicon Mac. It carries its own CPython/NumPy core, LGPL FFmpeg/ffprobe, Electron runtime, and exact Codex helper; it does not rely on system Python or Homebrew FFmpeg. Generated release output is intentionally ignored by Git.

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

Run the complete nonvisual personal-release gate:

```bash
bash scripts/verify-m7.sh
```

It runs 161 Python-core tests, 248 desktop tests, strict TypeScript and production builds, every generated nonvisual Electron flow, missing-helper degradation, and exact package architecture/version/hash/symlink/license/signature checks. The separate `bash scripts/release/smoke-real-codex.sh` exercises the packaged official SDK with existing ChatGPT authentication and records only redacted booleans, never response text.

To rebuild the ignored local artifact on macOS arm64, run `pnpm build:release:ffmpeg`, `pnpm build:release:core`, then `bash scripts/release/compose-personal-arm64.sh`. These exact release-dependency builds require network access the first time. Personal Rekordbox XML, audio, app databases, credentials, caches, backups, diagnostics, and generated release output must remain outside Git.

See `docs/USER_GUIDE.md` for the full workflow and deferred hands-on checklist, and `docs/RECOVERY.md` for database backup/offline restore and safe checkpoints.
