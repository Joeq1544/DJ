# ADR-0010: Personal arm64 Release Composition

- Status: Accepted for M7 implementation
- Date: 2026-08-11
- Owners: primary, packaging, audio/core, desktop, and UI implementers
- Supersedes: ADR-0007's Developer ID/public-release gate and ADR-0001's unimplemented CPython 3.12 package target for the personal MVP only

## Context

Joe needs one runnable local `.app`, not a public distribution pipeline. M1–M6 are green on the target arm64 Mac with Electron 43.3.0, CPython 3.14.3, NumPy 2.4.4, external FFmpeg 8.1.2, and official Codex 0.147.0. The existing production web/main build is not self-contained: Python and FFmpeg can fall back to ambient tools, and the full Codex target tree has not been composed into an application bundle.

## Decision

Package exactly one arm64, non-ASAR app with `@electron/packager@20.0.0`. Bundle a PyInstaller 6.21.0 one-directory core built from the tested arm64 CPython 3.14.3/NumPy 2.4.4 environment; an exact locally source-built LGPL FFmpeg/ffprobe 8.1.2 pair; and the full production pnpm tree containing Codex SDK/runtime 0.147.0. Packaged main uses fixed `process.resourcesPath` locations and never falls back to host helpers.

Generate a resource hash manifest, CycloneDX component inventory, and third-party notices from the actual package inputs. Apply local ad-hoc signing only after composition, then verify and launch the final copy. Call it an arm64 personal build, not Developer-ID-signed, notarized, or publicly distributable.

Add compact diagnostics, selected-analysis rebuild, an online SQLite backup through the core, path-free diagnostics export, and an explicit data-folder action. Restore stays an offline documented operation because replacing the live sole-writer database adds risk without improving the normal personal workflow.

## Consequences

The fastest package uses the exact runtime already tested rather than building the historical CPython 3.12 target. The app is larger because Electron, Codex, Python/NumPy, and FFmpeg are intentionally self-contained and inspectable. ASAR, installers, auto-update, Developer ID, notarization, universal binaries, public redistribution, and multi-Mac assurance remain deferred.

M7 evidence must come from the packaged executable with ambient helper paths removed. Development success, a generated directory, or UI presence alone is insufficient.
