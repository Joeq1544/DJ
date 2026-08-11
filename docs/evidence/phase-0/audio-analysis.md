# Generated-audio analysis evidence

Date: 2026-08-09. This evidence is an isolated feasibility spike for ADR-0005, not a production MIR/provider decision.

## Fixture and method

`scripts/generate-audio-fixtures.py` uses only Python `wave`, `struct`, and `math` to create non-copyrighted fixtures. Its click and silence iterators yield bounded PCM chunks instead of materializing their complete signals. The main fixture is a 16-second, 48 kHz, mono signed-16-bit PCM WAV with 32 ten-millisecond square clicks at sample `12,000 + 24,000*n` (`0.25 + 0.5*n` seconds). The first 16 clicks use amplitude 0.25; the last 16 use amplitude 0.50. It also creates a two-second silence WAV and a seven-byte deliberately corrupt WAV.

`spikes/audio_analysis/analyze.py` reads PCM frames in bounded chunks, with no audio upload or source mutation. It measures WAV format, duration, peak, RMS, half-energy, click-boundary positions, median interval, and transparent BPM/confidence. Confidence is `min(1, interval_count / 8) * max(0, 1 - mean(abs(interval - median)) / median)`, exposing count and regularity components in the result. A batch starts one worker process per input sequentially. A separate bounded `ready` handshake covers worker startup; only after readiness does the per-file analysis/delay timeout begin. Missing readiness, worker error, normal result, and timeout are all reported per file, while `finally` terminates/joins/closes process and queue resources. It also includes a validation-only model-asset guard: assets must resolve within an application-owned model root, match a known SHA-256, and not use `.pickle`, `.pkl`, `.pt`, or `.pth`. No model is loaded.

## Focused verification

```sh
python3 -m unittest discover -s spikes/audio_analysis/tests -v
```

Initial red run before implementation: 5 errors, all from the missing `scripts/generate-audio-fixtures.py` subprocess (exit 2). This proved the desired synthetic-fixture contract was not yet present. Fix-round red run added three regressions and produced 2 errors (missing chunk iterator and `startup_delay_seconds`) plus 1 expected failure (irregular timing still had confidence 1.0). It also demonstrated that the prior worker cap began before process readiness.

Final implementer fix-round green runs on Python 3.14.3 / macOS 26.5.1 arm64: 7 tests passed, exit 0, in 2.969 s and 2.967 s. The primary agent independently ran the same suite twice after review; both runs passed 7 tests in 3.021 s and 3.018 s. The suite confirms fixture format, deterministic positions/amplitudes and bytes, bounded generator iterators, source-hash preservation, streaming measurement, silence behavior, regularity-sensitive confidence, startup-ready and analysis-timeout separation, corrupt-file error isolation, per-file cleanup, and path/hash/format model-asset rejection.

The main test's numerical tolerances are derived from sample precision rather than subjective audio quality: duration ±`1/48000` seconds, peak ±`1/32768`, median interval ±`1/48000` seconds, BPM ±0.05, and energy ratio ±0.001. The exact section-energy ratio is `(0.50**2)/(0.25**2) = 4`; the tolerance covers signed-16-bit rounding only.

## Deterministic measurement

Generated `clicks.wav` SHA-256: `836f499bdd1c829a55eb0838023eba10f9a884f623a891c6999bffe132f84774` (1,536,044 bytes).

- Sample rate/channels: 48,000 / 1
- Duration: 16.0 s
- Peak: 0.500015259254738
- RMS: 0.05590340547403875
- First/second half energy: 515,396,075,520 / 2,061,584,302,080
- Second/first ratio: 4.0
- Onset positions: 12,000 through 756,000 at 24,000-frame spacing (32 positions)
- Median interval / BPM: 0.5 s / 120.0 BPM
- Confidence: 1.0 for this repeated synthetic signal

`silence.wav` SHA-256: `e294409b36a8ac1893b23336eeab5202d3e84ce4f66c7572aa1589c43d43c1ff`; `corrupt.wav` SHA-256: `e6d5b2896c0050728e8ee0f7a85ce25819a7151ec88c0dafcd6e758b751562f2`.

## Review evidence

A fresh read-only task reviewer found one Important issue: the first per-file timeout included fresh Python `spawn` startup, so a valid item could fail under ordinary host load. Fix round 1 added a separate bounded ready handshake and post-ready timeout with cleanup in `finally`. Primary integration review also found that generation still materialized the full signal and confidence used onset count without interval regularity; the same fix round added bounded iterators and an irregular-onset confidence regression. Scoped read-only re-review approved all three corrections with no remaining finding.

The primary agent regenerated the fixtures in a temporary directory after the streaming refactor and independently reproduced the click hash and all listed format, duration, peak, RMS, energy-ratio, interval, BPM and confidence values. No generated WAV is committed.

## Limitations

The confidence is only a transparent count-and-interval-regularity score for synthetic threshold crossings. This does not measure musical tempo/key/structure/timbre/loudness, decoding compatibility, quality on music, thermal behavior, or production failure behavior. It must not be promoted to production MIR without the later provider, license, runtime, packaging, and real authorized-audio evaluation gates specified by ADR-0005.
