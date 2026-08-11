#!/usr/bin/env python3
"""Create only the deterministic, non-copyrighted WAV fixtures for Task 9."""

import argparse
import math
from pathlib import Path
import struct
import wave


SAMPLE_RATE = 48_000
DURATION_SECONDS = 16
CLICK_START_SECONDS = 0.25
CLICK_INTERVAL_SECONDS = 0.5
CLICK_DURATION_SECONDS = 0.01
CLICK_COUNT = 32
HARMONIC_FREQUENCIES = (
    261.625565,
    293.664768,
    329.627557,
    349.228231,
    391.995436,
    440.0,
    493.883301,
)
HARMONIC_AMPLITUDES = (0.09, 0.04, 0.07, 0.05, 0.08, 0.05, 0.04)


def write_pcm(path, chunks):
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        for samples in chunks:
            output.writeframes(struct.pack("<%dh" % len(samples), *samples))


def iter_click_chunks(*, chunk_frames=4096):
    """Yield bounded PCM chunks; never materialize the complete 16-second signal."""
    click_frames = int(CLICK_DURATION_SECONDS * SAMPLE_RATE)
    unit = math.sin(math.pi / 2)  # A deterministic full-scale pulse value.
    click_start = int(CLICK_START_SECONDS * SAMPLE_RATE)
    click_interval = int(CLICK_INTERVAL_SECONDS * SAMPLE_RATE)
    for start in range(0, SAMPLE_RATE * DURATION_SECONDS, chunk_frames):
        samples = []
        for frame in range(start, min(start + chunk_frames, SAMPLE_RATE * DURATION_SECONDS)):
            relative = frame - click_start
            click_number = relative // click_interval if relative >= 0 else -1
            if 0 <= click_number < CLICK_COUNT and relative % click_interval < click_frames:
                amplitude = 0.25 if click_number < CLICK_COUNT // 2 else 0.50
                samples.append(round(32_767 * amplitude * unit))
            else:
                samples.append(0)
        yield samples


def iter_silence_chunks(seconds, *, chunk_frames=4096):
    """Yield bounded zero-valued PCM chunks for the requested synthetic duration."""
    frames = int(seconds * SAMPLE_RATE)
    for start in range(0, frames, chunk_frames):
        yield [0] * min(chunk_frames, frames - start)


def iter_harmonic_chunks(*, chunk_frames=4096):
    """Yield a bounded C-major, 120-BPM signal with a quieter first half."""
    total_frames = SAMPLE_RATE * DURATION_SECONDS
    click_start = int(CLICK_START_SECONDS * SAMPLE_RATE)
    click_interval = int(CLICK_INTERVAL_SECONDS * SAMPLE_RATE)
    click_frames = int(CLICK_DURATION_SECONDS * SAMPLE_RATE)
    for start in range(0, total_frames, chunk_frames):
        samples = []
        for frame in range(start, min(start + chunk_frames, total_frames)):
            gain = 0.45 if frame < total_frames // 2 else 0.85
            value = gain * sum(
                amplitude * math.sin(2.0 * math.pi * frequency * frame / SAMPLE_RATE)
                for frequency, amplitude in zip(HARMONIC_FREQUENCIES, HARMONIC_AMPLITUDES)
            )
            relative = frame - click_start
            if relative >= 0 and relative // click_interval < CLICK_COUNT:
                click_frame = relative % click_interval
                if click_frame < click_frames:
                    pulse_gain = 0.18 if frame < total_frames // 2 else 0.28
                    envelope = math.exp(-click_frame / (0.002 * SAMPLE_RATE))
                    value += pulse_gain * envelope * math.sin(
                        2.0 * math.pi * 4_000.0 * click_frame / SAMPLE_RATE
                    )
            samples.append(max(-32_768, min(32_767, round(32_767 * value))))
        yield samples


def generate(output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    write_pcm(output / "clicks.wav", iter_click_chunks())
    write_pcm(output / "harmonic.wav", iter_harmonic_chunks())
    write_pcm(output / "silence.wav", iter_silence_chunks(2))
    (output / "corrupt.wav").write_bytes(b"RIFF\x00\x00\x00")
    return [output / name for name in ("clicks.wav", "harmonic.wav", "silence.wav", "corrupt.wav")]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("fixtures/audio-generated"))
    args = parser.parse_args()
    for path in generate(args.output):
        print(path)


if __name__ == "__main__":
    main()
