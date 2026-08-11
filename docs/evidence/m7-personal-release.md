# M7 Personal arm64 Release Evidence

Date: 2026-08-11

Scope: exact target-Mac personal package, recovery/diagnostics, nonvisual product workflows, and packaged existing-auth Codex smoke

Implementation checkpoints: `e1b9107`, `61eac56`

Artifact: `out/DJ Copilot-darwin-arm64/DJ Copilot.app` (generated locally and ignored by Git)

## Environment and inputs

- macOS 26.5.1 (25F80), arm64.
- Node.js 25.8.1 and pnpm 11.16.0.
- Electron 43.3.0 and `@electron/packager` 20.0.0.
- CPython 3.14.3, NumPy 2.4.4, and PyInstaller 6.21.0.
- Official FFmpeg 8.1.2 source archive SHA-256 `464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c`.
- Official `@openai/codex-sdk`, generic CLI, and Darwin-arm64 runtime 0.147.0.
- Generated/non-copyrighted XML, PCM/audio, and marker fixtures only. No personal XML/audio/database, credential, path, log, or Codex response text entered Git or this report.

The FFmpeg build disabled GPL, nonfree, network, devices, documentation/debug, shared libraries, autodetection, FFplay, and external codecs. Both static arm64 executables have only macOS system dynamic dependencies. Input executable hashes before package signing were:

```text
ffmpeg              5e4b6a8af1f4af8b089c2d01676691134c3f85c8e2bca64dc41902560e8e2a92
ffprobe             8dcd2dbb5c6fefc3e6cf0a41b7fe6b57663e33f23d5a56bb82ef6f7f8ca662d1
dj-copilot-core     97ca8d9ba78c88333962418275c445373df9d7b82faf5d15f7e44bc52b7698f5
```

## Recovery and packaged boundary

Focused RED/GREEN coverage added exact decoder-token matching; selected current-track analysis rebuild; online SQLite backup; integrity/schema validation; mode-`0600` temporary output; atomic replacement; cancellation/failure cleanup; packaged-only fixed resource paths; diagnostics redaction; strict IPC/preload results; renderer confirmation/focus behavior; and no ambient packaged fallback.

The final source aggregates passed:

- Python core: 161/161.
- Desktop Vitest: 248/248.
- Strict TypeScript typecheck: exit 0.
- Electron main/preload and Vite renderer production builds: exit 0.

Database backup remains an online sole-writer core operation. Restore is deliberately offline and documented in `docs/RECOVERY.md`. Selected rebuild changes only app-owned jobs/features; all source XML/audio hashes remain unchanged.

## Package composition and inspection

`pnpm build:release:ffmpeg`, `pnpm build:release:core`, and `bash scripts/release/compose-personal-arm64.sh` produced one 630 MB, non-ASAR, ad-hoc-signed arm64 app with this fixed resource layout:

```text
Contents/Resources/
  app/                         production Electron app and production packages
  core/dj-copilot-core/       PyInstaller one-directory core
  bin/ffmpeg
  bin/ffprobe
  release/RESOURCE_MANIFEST.json
  release/sbom.cdx.json
  release/THIRD_PARTY_NOTICES.txt
```

Composition removes only generated dangling/self links, preserves the exact pnpm Codex target topology, then normalizes every retained link to a contained relative target. It rejects dangling/escaped links, wrong versions, non-arm64 executables, unexpected Codex package topology, and non-system FFmpeg dependencies before signing.

`bash scripts/release/verify-personal-arm64.sh "out/DJ Copilot-darwin-arm64/DJ Copilot.app"` passed:

- exact packaged SDK 0.147.0, generic CLI 0.147.0, canonical Darwin-arm64 package `0.147.0-darwin-arm64`, and native helper;
- executable permission and arm64 architecture for core, ffmpeg, and ffprobe;
- complete resource-manifest hashes and contained symlinks;
- generated CycloneDX component inventory and third-party inventory;
- deep strict ad-hoc code-signature verification;
- absence of source/test trees from the production app.

The inventories are build evidence for this personal artifact, not a public-redistribution legal sign-off.

## Nonvisual packaged workflows

`bash scripts/verify-m7.sh` launched each Electron spec in a fresh process and passed nine tests across eight spec files, followed by exact package verification. No screenshot or visual assertion was run.

The M7 packaged flow launched the explicit `.app` executable from a path containing spaces with a temporary user-data folder and minimal system `PATH`. It proved:

- generated XML import of four tracks;
- local analysis with three successes and one isolated corrupt-file failure;
- discovery, personalization persistence, and confirmed mock-Copilot proposal;
- generated set workflow and Rekordbox XML export;
- redacted diagnostics export and integrity-checked database backup;
- quit/relaunch persistence;
- exact source hashes and runtime/temp cleanup.

A cloned-package degradation flow removed only bundled ffprobe and supplied the untouched original as an ambient override. Core/library browsing stayed usable, diagnostics and analysis reported the bundled prerequisite unavailable, the ambient override was ignored, the source package remained unchanged, and runtime/temp cleanup passed.

## Packaged real Codex smoke

`bash scripts/release/smoke-real-codex.sh` launched the exact packaged executable with a minimal `PATH`, a space-containing temporary user-data directory, and Joe's existing ChatGPT/Codex authentication. It passed one bounded real smoke:

```text
M7_RELEASE_REAL_CODEX_SMOKE packaged=true auth=chatgpt sdk=0.147.0 bounded=true secondRequest=true planTerminal=true cancelled=true cleaned=true
```

The run exercised a successful search, a second bounded plan request reaching an honest terminal proposal/no-change state on the generated/empty context, UI cancellation, and cleanup. It retained no model response text, credential, private path, or personal-library content.

## Final bounded review

Read-only reviewer `/root/m7_final_review` returned READY with no concrete High or Medium M7 normal-workflow, packaging, recovery, or documentation defect. It independently passed package verification (630 MB, resource manifest, arm64 helpers, and deep signature), 5/5 core recovery tests, and 14/14 diagnostics/runtime/preload tests. It inspected the aggregate, actual packaged flow, missing-helper flow, packaged real smoke, evidence, offline restore, licensing, privacy, testing, phase status, and deferred hands-on claims. The reviewer did not repeat the already-green long aggregate or authenticated smoke and changed no file or Git state.

## Limitations and deferred checks

- All visual QA, screenshot review, and native-picker appearance checks were skipped at Joe's explicit request.
- No private Rekordbox 7.2.14 XML/audio library or subjective tempo/key/energy/recommendation/set-quality judgment was used.
- The artifact is target-Mac arm64 only, ad-hoc signed, not notarized, not universal, and not approved for public distribution or other-Mac compatibility.
- Optional structure/embedding/semantic providers remain unavailable by design; the transparent FFmpeg/NumPy baseline is the packaged analysis provider.

These limitations are post-build hands-on or future-distribution work. They are not represented as passing evidence and do not invalidate the completed generated nonvisual personal-workflow gate.
