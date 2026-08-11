# M2 Audio Dependency Selection

- Date: 2026-08-11
- Status: implemented and verified for the M2 development runtime; distribution evidence pending M7
- Decision: D-046; ADR-0005

## Selected baseline

M2 uses the external development executables `/opt/homebrew/bin/ffmpeg` and `/opt/homebrew/bin/ffprobe` at 8.1.2 plus pinned `numpy==2.4.4`. The app records the actual executable/provider/pipeline version on each result and reports the provider unavailable when the exact development capability is absent. No model, model weights, dataset, implicit download, or executable deserialization is part of this provider.

The provider is sufficient to implement bounded file/container/stream metadata, chunked local PCM decode, RMS/peak/energy/dynamics, heuristic onset/tempo/beat evidence, heuristic chroma-template key/mode evidence, and transparent rhythm/timbre proxies. Generated fixtures can prove deterministic plumbing and known synthetic measurements. They cannot establish accuracy on real music; low-information or ambiguous signals must return unknown or low confidence.

## Primary sources

- [FFmpeg official downloads and stable releases](https://ffmpeg.org/download.html), including [8.1.2 source](https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz) and [tagged 8.1.2 source](https://github.com/FFmpeg/FFmpeg/tree/n8.1.2).
- [FFprobe machine-readable output documentation](https://ffmpeg.org/ffprobe.html).
- [FFmpeg format documentation](https://ffmpeg.org/ffmpeg-formats.html) for raw PCM pipes and [filter documentation](https://ffmpeg.org/ffmpeg-filters.html) for measured local capabilities.
- [FFmpeg legal and license guidance](https://www.ffmpeg.org/legal.html), plus tagged [GPLv3](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n8.1.2/COPYING.GPLv3) and [LGPL-2.1](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n8.1.2/COPYING.LGPLv2.1) texts.
- [NumPy 2.4.4 package metadata and arm64 wheels](https://pypi.org/project/numpy/2.4.4/), [2.4.4 release notes](https://numpy.org/doc/stable/release/2.4.4-notes.html), and [versioned license](https://raw.githubusercontent.com/numpy/numpy/v2.4.4/LICENSE.txt).

NumPy 2.4.4 declares Python `>=3.11`, documents support through Python 3.14, and publishes native macOS arm64 wheels for CPython 3.12 and 3.14. Its declared SPDX expression is `BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0`; M7 still includes its complete notice inventory.

## Local measurements

Measured on macOS 26.5.1 arm64 with CPython 3.14.3:

```text
ffmpeg 8.1.2 / ffprobe 8.1.2
numpy 2.4.4
f32le and s16le raw formats available
astats and ebur128 filters available
installed NumPy payload approximately 31.4 MB across 1,295 files
```

The FFmpeg build configuration includes `--enable-gpl`, `libx264`, and `libx265`; `ffmpeg -L` reports GPL. Invoking Joe's already-installed executable is accepted for this personal development slice. The binary is not a redistributable M7 artifact by default, and subprocess separation is not treated as a licensing conclusion.

## M2 implementation result

Post-review checkpoint `a66e0d6` and `docs/evidence/m2-local-analysis.md` verify the selected versions through the real Python provider and built Electron app. The final aggregate passed 56 core tests, 62 desktop tests, strict TypeScript, production builds, and three generated-fixture Electron flows. A real no-site-packages subprocess also proves missing NumPy degrades only analysis while the core/library stay usable. Decode stayed local and streamed; the four source hashes remained exact; no decoded PCM or dependency binary was committed. This closes the development selection only and does not convert the installed GPL-configured FFmpeg into a release candidate.

## M7 packaging work retained

- Select/build a reproducible arm64 decoder with exact source/hash/configuration and complete external-library inventory.
- Exclude GPL/nonfree components unless Joe explicitly chooses and satisfies that distribution path; otherwise fulfill FFmpeg's LGPL checklist and notices.
- Prove bundled CPython 3.12 plus NumPy resource discovery, signing, launch, codec behavior, and clean setup.
- Measure actual codec coverage, corrupt-file isolation, performance, thermal cost, and real-music quality during Joe's final test period.
