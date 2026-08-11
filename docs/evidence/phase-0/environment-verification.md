# Phase 0 Environment Verification

Date: 2026-08-09
Task: P0-005
Host summary: macOS 26.5.1, Apple Silicon arm64

## Commands and outcomes

| Command | Outcome |
| --- | --- |
| `python3 -m unittest discover -s scripts/tests -v` | Exit 0; 10 tests passed after mandatory Codex/MCP source coverage was added |
| `sh scripts/collect-phase0-environment.sh docs/evidence/phase-0/environment.md` | Exit 0; redacted report atomically written |
| `codex features list` from repository root | Exit 0 after the config compatibility fix; `multi_agent` is stable and available |
| `codex login status` from repository root | Exit 0; only success/failure was recorded, not output or credential material |
| `/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' <Rekordbox bundle plist>` | Exit 0; version `7.2.14.0323`; path is not persisted in the generated environment report |

## Reproduced defects and corrections

1. The installed Codex CLI 0.144.1 rejected the current manual's `agents.max_concurrent_threads_per_session` project key as an agent-role value. Direct CLI/source comparison established a version/schema mismatch. The project uses the installed runtime's verified `agents.max_threads = 4` legacy alias and has an integration regression that loads the configuration.
2. The collector originally treated Codex's sandbox PATH-alias warning as its version because it selected the first combined output line. It now selects the first non-warning version line; a fake CLI regression preserves the behavior.
3. Spotlight `mdls` failed for the installed Rekordbox bundle even though the bundle and plist were readable. The collector now reads `CFBundleShortVersionString` from `Info.plist`; a temporary synthetic bundle regression proves path redaction and version extraction.

## Observed capabilities

- Existing Codex CLI authentication status is available. This does not establish TypeScript SDK auth reuse, threads, streaming, cancellation, sandboxing, working-directory, structured-output, or MCP behavior; P0-006/P0-007 remain open.
- Rekordbox 7.2.14.0323 is installed. No Rekordbox database or user library was accessed.
- Node.js 25.8.1 and Python 3.14.3 are installed, but neither is a selected production runtime. Compatibility research must choose supported versions before production scaffolding.
- `pnpm` 11.16.0 and FFmpeg/ffprobe 8.1.2 are available. `uv` is not installed; installation is deferred until a researched Python version/dependency plan is accepted.

## Privacy review

The report contains no credential output, environment dump, home-directory path, source media, Rekordbox database access, or raw authentication material. Tests exercise absence of the known sensitive variable names and local home path.
