# ADR-0005: Audio Analysis Providers and License Strategy

- Status: Accepted
- Date: 2026-08-09
- Owners: primary, audio-MIR specialist, security/license reviewer

## Context

The app needs local metadata, tempo/key/loudness/energy/rhythm/timbre and optional structure/semantic/embedding evidence on Apple Silicon. Native dependencies, model assets, runtime compatibility, quality, thermal cost, and code-versus-weight licenses differ materially.

## Decision

Build a local-only, versioned stage pipeline whose stages can fail, retry, cache,
and degrade independently. The mandatory product fallback is imported metadata
plus bounded basic features and metadata/feature similarity; it must remain
usable when every optional MIR or model-backed provider is absent. The Phase 0
standard-library PCM spike proves only that boundary and does not select a
production decoder, metadata library, DSP stack, codec set, or packaging tool.

Essentia code and its model catalog are excluded from the default distribution
under the current license evidence. No optional structure, classification, or
embedding provider/model is approved. A future provider requires separately
verified source and model/data terms, Apple Silicon behavior, quality,
performance/thermal cost, and packaging evidence. Model assets must be declared,
versioned, immutable application capabilities with expected size/hash/format;
load only integrity-verified non-executable formats or a reviewed weight-only
loader, and reject arbitrary paths, implicit downloads, and pickle-like
executable deserialization.

## Alternatives

- One monolithic MIR stack: simpler interface but a single license/native/runtime failure disables all analysis.
- Cloud analysis: rejected because raw audio must remain local.
- Training a custom model: first-release non-goal.

## Phase 0 decision evidence

Mandatory MIR repositories, exact revisions/releases, code licenses, model-card/data/redistribution terms, Python/macOS/arm64 claims, activity, tests and unsafe-loader behavior are recorded in `../REPO_RESEARCH.md` and `../LICENSING.md`. This evidence rejects Essentia and its model catalog from the default build, keeps all-in-one/CLAP/PANNs and the MLX port unapproved, and guarantees a metadata/basic-feature fallback when no safe distributable embedding model qualifies.

The standard-library generated-audio spike in `../../spikes/audio_analysis/` provides the bounded fixture proof only. Seven focused tests passed twice on Python 3.14.3/macOS arm64. They verify chunked deterministic generation and analysis, sample-derived duration/peak/RMS/section-energy/interval/BPM measurements, lower confidence for irregular onset intervals, silence with no tempo claim, immutable hashes, corrupt/startup-timeout/analysis-timeout per-file isolation and worker cleanup, plus rejection of outside-root/symlink model paths, unknown hashes and pickle-like formats without loading a model. A fresh task review found and resolved startup-dependent timeout flakiness; primary review also corrected full-signal generation and count-only confidence. Scoped re-review approved the final corrections. Exact measurements and limitations are in `../evidence/phase-0/audio-analysis.md`.

Independent architecture review found no high issue and accepted this narrowed
provider architecture after removing any implication that NumPy, SciPy,
librosa, soundfile, or an optional model had been selected. Phase 3 has an
explicit selection gate: before a production analysis dependency is added, lock
and verify the exact decoder/metadata/DSP versions on the accepted CPython line,
common-codec behavior, transitive/native licenses, install/package size, Apple
Silicon performance/thermal behavior, corrupt-file isolation, and packaged
artifacts. Failure to find a qualifying stack preserves the guaranteed
metadata/basic-feature fallback; it does not reopen Essentia or authorize an
unsafe model. Real-music quality remains later, user-authorized evidence.

## Later implementation verification

Phase 3 proves resumable staged jobs, supported codecs, concurrency/thermal behavior, provider degradation, cache invalidation and per-track crashes. Phase 9 proves packaged native libraries/assets, integrity inventory, SBOM/notices and clean-machine behavior.

## M2 development selection

On 2026-08-11 M2 selected an external FFmpeg/ffprobe 8.1.2 executable plus `numpy==2.4.4` for the first production baseline. FFprobe supplies bounded machine-readable container/audio-stream metadata; FFmpeg decodes one local audio stream to chunked mono PCM; NumPy implements transparent feature calculations without a model or downloaded dataset. Tempo/beat and key/mode are heuristic evidence with confidence and explicit limitations, not accuracy claims. Structure, classifier, and embedding stages remain unavailable capabilities.

The measured `/opt/homebrew/bin/ffmpeg` build enables GPL components and reports GPL terms. It may be invoked as Joe's external development prerequisite but is not copied or bundled. M7 later selected and verified a separately source-built LGPL FFmpeg configuration with exact source/configuration/inventory evidence. Exact M2 sources, local versions, wheel metadata, and historical packaging requirements are recorded in `../evidence/m2-dependency-selection.md`.

## M2 implementation verification

Post-review green checkpoint `a66e0d6` implements `ffmpeg-numpy-basic` / `baseline-v1` with streamed mono `f32le` decode, exact result provenance, heuristic confidence, no decoded-media artifact, and explicit unavailable structure/embedding stages. The final aggregate run passed 56 core tests, 62 desktop tests, strict TypeScript, production builds, and three Electron flows. The integrated generated-audio flow proved 120-BPM click evidence, C-major harmonic evidence, honest silence unknowns, isolated corrupt-file failure, pause across core restart, reload persistence, unchanged source hashes, and cleanup. Missing NumPy now degrades the provider rather than core/library startup, and reimport cannot attach stale or orphan analysis. These are engineering/plumbing results only; exact evidence and limitations are in `../evidence/m2-local-analysis.md`.

## M7 package verification

M7 builds FFmpeg/ffprobe 8.1.2 from the official source archive SHA-256 `464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c` with GPL, nonfree, network, devices, autodetection, external codecs, and shared libraries disabled. Both arm64 executables have only macOS system dynamic dependencies. The personal app bundles those tools with CPython 3.14.3/NumPy 2.4.4, validates exact versions/hashes/signatures, passes generated good/corrupt analysis from the packaged executable, and degrades only analysis when a copied package lacks ffprobe. Exact evidence and retained subjective/codec limitations are in `../evidence/m7-personal-release.md`.

## Consequences

Every feature stores provider/model/pipeline version, confidence, and provenance. Stages retry/cache independently and never overwrite source audio or explicit Rekordbox/user evidence.
