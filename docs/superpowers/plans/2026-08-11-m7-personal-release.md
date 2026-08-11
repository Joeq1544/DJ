# M7 Personal Release Implementation Plan

> **For delegated implementers:** Use test-driven development in the assigned files only. Do not edit project-memory files, shared contracts, package manifests, generated release artifacts, or Git unless the primary explicitly assigns them. Visual QA is deferred.

**Goal:** Produce a self-contained, unsigned arm64 DJ Copilot `.app` for Joe's Mac, add the compact diagnostics/recovery controls still missing from the product, and verify normal workflows from the packaged application without relying on ambient Python or Homebrew FFmpeg.

**Architecture:** Keep the existing renderer/main/Python ownership. Electron Packager composes one inspectable non-ASAR personal app. A PyInstaller one-directory core carries its own CPython/NumPy runtime; a locally built LGPL FFmpeg/ffprobe pair and the complete official Codex target tree live under `Contents/Resources`. Packaged main resolves only those resources. Main owns native backup/diagnostics destinations; Python remains the sole live SQLite owner.

**Exact tools:** Electron 43.3.0, `@electron/packager@20.0.0`, PyInstaller 6.21.0, bundled CPython 3.14.3 arm64, NumPy 2.4.4, source-built FFmpeg/ffprobe 8.1.2, official Codex SDK/runtime 0.147.0, pnpm 11.16.0.

## Why this is the small personal release

The dependency and gap reviews found a viable direct route. M7 does not add Forge makers, DMG/installer generation, auto-update, notarization, Developer ID credentials, universal binaries, a second database, public distribution infrastructure, or a settings router. CPython 3.14.3 replaces the historical unimplemented 3.12 packaging target because it is the exact arm64 runtime already exercising all 151 core tests with NumPy 2.4.4; PyInstaller bundles it so the final app still has no system-Python dependency.

The package is described honestly as an **ad-hoc-signed, unsigned-for-distribution, arm64 personal build**. Ad-hoc signing exists only so the nested local executables launch coherently on Joe's Mac. Visual/native appearance checks remain deferred to Joe's final hands-on period.

## Frozen resource layout

```text
DJ Copilot.app/Contents/Resources/
  app/                         production Electron app + production node_modules
  core/dj-copilot-core/       PyInstaller one-directory runtime and executable
  bin/ffmpeg                   exact locally built 8.1.2 arm64
  bin/ffprobe                  exact locally built 8.1.2 arm64
  release/RESOURCE_MANIFEST.json
  release/sbom.cdx.json
  release/THIRD_PARTY_NOTICES.txt
```

Packaged mode fails closed when a bundled executable or package is absent, wrong-versioned, non-arm64, or outside this layout. It never falls back to `.venv`, `python3`, `PATH` FFmpeg, or a cwd-discovered Codex SDK. Development mode retains the current explicit environment/host fallbacks.

## Compact diagnostics and recovery contract

Extend the fixed preload API only with:

```text
analysis.rebuild(trackIds)
diagnostics.getSnapshot()
diagnostics.backupDatabase()
diagnostics.exportBundle()
diagnostics.showDataFolder()
```

`analysis.rebuild` clears only selected app-owned analysis rows and requeues those current tracks. It never changes audio. `getSnapshot` reports bounded app/core/analysis/package versions and unavailable stages without checking Codex auth or exposing private paths. Backup uses a native save choice and Python `sqlite3.backup`, validates integrity/schema, syncs a mode-0600 temporary sibling, and atomically replaces the selected destination. The diagnostics JSON is path-free and excludes audio, metadata, notes, credentials, auth state, response text, and logs. `showDataFolder` is an explicit main-owned user action. Offline restore and uninstall steps are documented; M7 does not add risky live database replacement.

## Implementation tasks

### Task 1 — Freeze shared release/diagnostics contracts

**Owner:** primary

- [x] Add strict DTOs and preload methods for analysis rebuild and diagnostics/backup results.
- [x] Pin Packager 20.0.0 and exact Python build requirements; add clean `package:mac`, `verify:m7`, and opt-in packaged Codex smoke commands.
- [x] Add ADR-0010 and dependency/license/source evidence, then push this planning/contracts checkpoint.

### Task 2 — Core recovery and rebuild

**Owner:** audio/core implementer

- [x] Add focused RED tests for exact FFmpeg version-token validation, selected-track rebuild, SQLite online backup, integrity validation, atomic replacement, path policy, and failure cleanup.
- [x] Implement strict private core commands for rebuild and backup. Keep source audio/XML immutable and wire results path-free.
- [x] Run focused Python tests and the complete core suite when the database/service boundary is stable.

### Task 3 — Packaged desktop boundary and diagnostics UI

**Owner:** desktop boundary and renderer implementers on disjoint files

- [x] Add RED tests for packaged-only core/FFmpeg/Codex paths, direct PyInstaller launch, no ambient fallback, diagnostics IPC, native cancel/write behavior, and bundle redaction.
- [x] Add one compact **Diagnostics & recovery** region to the existing Library screen: resource/status summary, explicit selected-analysis rebuild, database backup, diagnostics export, data-folder action, privacy/limitations, and actionable errors.
- [x] Preserve fixed IPC, renderer sandboxing, keyboard semantics, focus return, local operation without Codex, and no visual QA.

### Task 4 — Build and compose the personal app

**Owner:** packaging implementer; primary integrates manifests and dependency changes

- [x] Build FFmpeg 8.1.2 from the official source hash with GPL/nonfree/network/devices disabled and no external codecs; retain the exact configuration and license.
- [x] Build the core with PyInstaller 6.21.0 `--onedir --target-arch arm64 --noupx --clean` from exact CPython 3.14.3 and NumPy 2.4.4.
- [x] Create a clean production pnpm stage, package arm64 with ASAR disabled and no makers, copy only fixed resources, generate package-derived hashes/SBOM/notices, and ad-hoc sign the final tree.
- [x] Validate versions, architecture, escaped symlinks, licenses, resource hashes, and actual bundle size. Optimize only if a concrete launch/size problem appears.

### Task 5 — Nonvisual package gate

**Owner:** primary

- [x] Launch the copied `.app` from a temporary path containing spaces with a temporary user-data directory, a minimal system `PATH`, and no Python/FFmpeg override variables.
- [x] Through the packaged production boundary exercise generated XML import; good/corrupt local analysis isolation; discovery; set creation/export; personalization persistence; mock Copilot proposal confirmation; diagnostics export; database backup; quit/relaunch persistence; source hashes; and runtime cleanup.
- [x] Prove the package degrades honestly when a copied test package is missing one bundled helper, without ambient fallback.
- [x] Run one separate redacted packaged real-Codex smoke with existing ChatGPT auth and no response text capture.
- [x] Re-run migration/backup focused checks, strict typecheck/build, and one final aggregate appropriate to changed shared boundaries.

### Task 6 — Close the personal MVP

**Owner:** primary

- [x] Perform one bounded normal-workflow release review. Fix only concrete in-scope High/Medium defects with focused regressions.
- [x] Synchronize `TASKS.md`, decisions, known issues, ADRs, architecture, privacy, recovery, licensing, evaluation, test evidence, README, and user guide.
- [x] Inspect the staged payload, commit, and push the green package checkpoint.
- [x] Hand Joe the `.app` path plus one concise final hands-on checklist. Do not claim the deferred visual/real-library/subjective checks passed.

## M7 completion gate

M7 closes when the personal `.app` launches without ambient Python/FFmpeg, all nine product outcomes are exercised through generated automated flows or the real redacted Codex smoke, database backup and common recovery paths work, packaged resources and licenses are inventoried, no known High/Medium normal-workflow defect remains, documentation matches reality, and the green checkpoint is pushed.

M7 does **not** wait for screenshots, visual QA, native-picker appearance, Joe's private Rekordbox/audio library, subjective recommendation/MIR judgment, Developer ID signing, notarization, a DMG, public redistribution, universal architecture, or other-Mac compatibility. Those are Joe's final hands-on work or explicit future scope.
