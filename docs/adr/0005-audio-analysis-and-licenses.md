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

## Consequences

Every feature stores provider/model/pipeline version, confidence, and provenance. Stages retry/cache independently and never overwrite source audio or explicit Rekordbox/user evidence.
