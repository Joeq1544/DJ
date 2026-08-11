"""Bounded local FFmpeg/NumPy baseline audio analysis."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import time
from typing import Callable, Protocol

try:
    import numpy as np
except ImportError:
    np = None


PROVIDER = "ffmpeg-numpy-basic"
PIPELINE_VERSION = "baseline-v1"
REQUIRED_NUMPY_VERSION = "2.4.4"
REQUIRED_FFMPEG_PREFIX = "ffmpeg version 8.1.2"
REQUIRED_FFPROBE_PREFIX = "ffprobe version 8.1.2"
PROVIDER_VERSION = "ffmpeg 8.1.2; ffprobe 8.1.2; numpy 2.4.4"
AVAILABLE_STAGES = ("metadata", "basic_features")
UNAVAILABLE_STAGES = ("structure", "embeddings")
DECODE_SAMPLE_RATE = 22_050
FRAME_SIZE = 2_048
HOP_SIZE = 512
MAX_DURATION_SECONDS = 7_200.0
LIMITATIONS = (
    "Heuristic tempo and beat evidence; not a Rekordbox beat grid.",
    "Heuristic key/mode evidence; verify low-confidence results by ear.",
)
if np is None:
    MAJOR_PROFILE = None
    MINOR_PROFILE = None
else:
    MAJOR_PROFILE = np.asarray(
        (6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88),
        dtype=np.float64,
    )
    MINOR_PROFILE = np.asarray(
        (6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17),
        dtype=np.float64,
    )
KEY_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


@dataclass(frozen=True)
class ProviderCapabilities:
    available: bool
    provider: str
    provider_version: str | None
    pipeline_version: str
    available_stages: tuple[str, ...]
    unavailable_stages: tuple[str, ...]
    unavailable_reason: str | None


@dataclass(frozen=True)
class AnalysisFeatures:
    fingerprint: str
    file_size: int
    mtime_ns: int
    codec: str
    container: str
    duration_ms: int
    sample_rate_hz: int
    channels: int
    bpm_milli: int | None
    tempo_confidence_ppm: int
    tempo_candidates_milli: tuple[int, ...]
    onset_count: int
    beat_strength_ppm: int
    musical_key: str | None
    mode: str | None
    key_confidence_ppm: int
    rms_milli_dbfs: int | None
    peak_milli_dbfs: int | None
    crest_factor_milli_db: int | None
    energy_ppm: int
    dynamic_range_milli_db: int | None
    onset_rate_milli_hz: int
    spectral_centroid_hz: int | None
    brightness_ppm: int
    energy_curve_ppm: tuple[int, ...]
    provider: str
    provider_version: str
    pipeline_version: str
    limitations: tuple[str, ...]


class AnalysisProvider(Protocol):
    def capabilities(self) -> ProviderCapabilities: ...

    def fingerprint(self, path: Path) -> tuple[str, int, int]: ...

    def analyze(
        self,
        path: Path,
        *,
        progress: Callable[[int], None],
        should_stop: Callable[[], bool],
    ) -> AnalysisFeatures: ...


class AnalysisProviderError(Exception):
    """A stable per-track provider failure suitable for queue persistence."""

    def __init__(self, code: str, message: str):
        self.code = str(code)
        super().__init__(str(message))


class AnalysisInterrupted(AnalysisProviderError):
    def __init__(self):
        super().__init__("interrupted", "Analysis was interrupted")


class _OutputLimitExceeded(Exception):
    pass


class _Accumulator:
    def __init__(self, expected_samples: int):
        self.expected_samples = max(1, int(expected_samples))
        self.sample_count = 0
        self.sum_squares = 0.0
        self.peak = 0.0
        self.zero_crossings = 0
        self.last_sample = 0.0
        self.bucket_squares = np.zeros(16, dtype=np.float64)
        self.bucket_counts = np.zeros(16, dtype=np.int64)
        self.frame_buffer = np.empty(0, dtype=np.float32)
        self.window = np.hanning(FRAME_SIZE).astype(np.float32)
        self.frequencies = np.fft.rfftfreq(FRAME_SIZE, 1.0 / DECODE_SAMPLE_RATE)
        valid = (self.frequencies >= 55.0) & (self.frequencies <= 5_000.0)
        self.chroma_valid = valid
        midi = np.rint(69.0 + 12.0 * np.log2(self.frequencies[valid] / 440.0)).astype(np.int64)
        self.pitch_classes = np.mod(midi, 12)
        self.chroma = np.zeros(12, dtype=np.float64)
        self.previous_spectrum: np.ndarray | None = None
        self.flux: list[float] = []
        self.frame_rms: list[float] = []
        self.centroid_sum = 0.0
        self.centroid_frames = 0
        self.brightness_numerator = 0.0
        self.brightness_denominator = 0.0

    def consume(self, samples: np.ndarray) -> None:
        if samples.size == 0:
            return
        values = np.asarray(samples, dtype=np.float32)
        squares = np.square(values, dtype=np.float64)
        self.sum_squares += float(np.sum(squares, dtype=np.float64))
        self.peak = max(self.peak, float(np.max(np.abs(values))))
        signs = values >= 0.0
        previous_sign = self.last_sample >= 0.0
        self.zero_crossings += int(signs[0] != previous_sign)
        if values.size > 1:
            self.zero_crossings += int(np.count_nonzero(signs[1:] != signs[:-1]))
        self.last_sample = float(values[-1])

        start = self.sample_count
        end = start + int(values.size)
        cursor = start
        while cursor < end:
            bucket = min(15, (cursor * 16) // self.expected_samples)
            bucket_end = (
                end
                if bucket == 15
                else min(end, ((bucket + 1) * self.expected_samples + 15) // 16)
            )
            local_start = cursor - start
            local_end = bucket_end - start
            self.bucket_squares[bucket] += float(np.sum(squares[local_start:local_end], dtype=np.float64))
            self.bucket_counts[bucket] += local_end - local_start
            cursor = bucket_end
        self.sample_count = end

        self.frame_buffer = np.concatenate((self.frame_buffer, values))
        frame_offset = 0
        while self.frame_buffer.size - frame_offset >= FRAME_SIZE:
            self._consume_frame(self.frame_buffer[frame_offset : frame_offset + FRAME_SIZE])
            frame_offset += HOP_SIZE
        if frame_offset:
            self.frame_buffer = self.frame_buffer[frame_offset:].copy()

    def _consume_frame(self, frame: np.ndarray) -> None:
        windowed = frame * self.window
        spectrum = np.abs(np.fft.rfft(windowed)).astype(np.float64)
        spectrum_sum = float(np.sum(spectrum, dtype=np.float64))
        normalized = spectrum / max(spectrum_sum, 1e-15)
        if self.previous_spectrum is None:
            flux = 0.0
        else:
            flux = float(np.sum(np.maximum(normalized - self.previous_spectrum, 0.0)))
        self.previous_spectrum = normalized
        self.flux.append(flux)

        power = np.square(spectrum, dtype=np.float64)
        power_sum = float(np.sum(power, dtype=np.float64))
        self.frame_rms.append(float(np.sqrt(np.mean(np.square(frame, dtype=np.float64)))))
        if power_sum <= 1e-18:
            return
        self.centroid_sum += float(np.dot(self.frequencies, power) / power_sum)
        self.centroid_frames += 1
        self.brightness_numerator += float(np.sum(power[self.frequencies >= 3_500.0]))
        self.brightness_denominator += power_sum
        np.add.at(self.chroma, self.pitch_classes, power[self.chroma_valid])


class FfmpegNumpyProvider:
    def __init__(self, *, ffmpeg_path: str | Path | None = None, ffprobe_path: str | Path | None = None):
        self.ffmpeg_path = self._resolve_executable(ffmpeg_path, "DJ_COPILOT_FFMPEG", "ffmpeg")
        self.ffprobe_path = self._resolve_executable(ffprobe_path, "DJ_COPILOT_FFPROBE", "ffprobe")
        self._analysis_test_delay_seconds = _analysis_test_delay_seconds()

    @staticmethod
    def _resolve_executable(value: str | Path | None, env_name: str, command: str) -> str | None:
        candidate = str(value) if value is not None else os.environ.get(env_name)
        if candidate:
            return candidate
        return shutil.which(command)

    def capabilities(self) -> ProviderCapabilities:
        reason: str | None = None
        try:
            if np is None:
                reason = f"requires numpy {REQUIRED_NUMPY_VERSION}; numpy is unavailable"
            elif np.__version__ != REQUIRED_NUMPY_VERSION:
                reason = f"requires numpy {REQUIRED_NUMPY_VERSION}; found {np.__version__}"
            elif not self.ffmpeg_path:
                reason = "ffmpeg executable not found"
            elif not self.ffprobe_path:
                reason = "ffprobe executable not found"
            else:
                ffmpeg_line = self._version_line(self.ffmpeg_path)
                ffprobe_line = self._version_line(self.ffprobe_path)
                if not ffmpeg_line.startswith(REQUIRED_FFMPEG_PREFIX):
                    reason = f"requires {REQUIRED_FFMPEG_PREFIX}; found {ffmpeg_line or 'no version'}"
                elif not ffprobe_line.startswith(REQUIRED_FFPROBE_PREFIX):
                    reason = f"requires {REQUIRED_FFPROBE_PREFIX}; found {ffprobe_line or 'no version'}"
        except (OSError, subprocess.SubprocessError, _OutputLimitExceeded) as error:
            reason = f"provider prerequisite check failed: {error}"
        return ProviderCapabilities(
            available=reason is None,
            provider=PROVIDER,
            provider_version=PROVIDER_VERSION if reason is None else None,
            pipeline_version=PIPELINE_VERSION,
            available_stages=AVAILABLE_STAGES,
            unavailable_stages=UNAVAILABLE_STAGES,
            unavailable_reason=reason,
        )

    def _version_line(self, executable: str) -> str:
        stdout, _stderr, returncode = _bounded_capture(
            [executable, "-version"],
            timeout_seconds=5.0,
            max_stdout=16 * 1024,
            max_stderr=16 * 1024,
        )
        if returncode != 0:
            raise subprocess.SubprocessError(f"{executable} -version exited {returncode}")
        return stdout.decode("utf-8", "replace").splitlines()[0] if stdout else ""

    def fingerprint(self, path: Path) -> tuple[str, int, int]:
        source = Path(path)
        try:
            stat = source.stat()
        except (FileNotFoundError, NotADirectoryError) as error:
            raise AnalysisProviderError("missing_file", "Source audio file does not exist") from error
        if not source.is_file():
            raise AnalysisProviderError("missing_file", "Source audio path is not a regular file")
        digest = hashlib.sha256()
        digest.update(b"dj-copilot-fast-fingerprint-v1\x00")
        digest.update(int(stat.st_size).to_bytes(8, "big", signed=False))
        digest.update(int(stat.st_mtime_ns).to_bytes(16, "big", signed=False))
        with source.open("rb") as handle:
            digest.update(handle.read(65_536))
            if stat.st_size > 65_536:
                handle.seek(max(0, stat.st_size - 65_536))
                digest.update(handle.read(65_536))
        return digest.hexdigest(), int(stat.st_size), int(stat.st_mtime_ns)

    def analyze(
        self,
        path: Path,
        *,
        progress: Callable[[int], None],
        should_stop: Callable[[], bool],
    ) -> AnalysisFeatures:
        source = Path(path)
        last_progress = -1

        def report(value: int) -> None:
            nonlocal last_progress
            bounded = max(0, min(1_000_000, int(value)))
            if bounded >= last_progress:
                progress(bounded)
                last_progress = bounded

        report(0)
        if should_stop():
            raise AnalysisInterrupted()
        fingerprint, file_size, mtime_ns = self.fingerprint(source)
        capabilities = self.capabilities()
        if not capabilities.available:
            raise AnalysisProviderError("provider_unavailable", capabilities.unavailable_reason or "Provider unavailable")
        metadata = self._probe(source, should_stop)
        report(75_000)
        accumulator = _Accumulator(round(metadata["duration_seconds"] * DECODE_SAMPLE_RATE))
        self._decode(source, accumulator, metadata["duration_seconds"], report, should_stop)
        if accumulator.sample_count == 0:
            raise AnalysisProviderError("decode_failed", "Decoder returned no audio samples")
        report(950_000)
        features = self._features(
            accumulator,
            metadata,
            fingerprint=fingerprint,
            file_size=file_size,
            mtime_ns=mtime_ns,
        )
        if should_stop():
            raise AnalysisInterrupted()
        report(1_000_000)
        return features

    def _probe(self, path: Path, should_stop: Callable[[], bool]) -> dict[str, object]:
        assert self.ffprobe_path is not None
        try:
            stdout, stderr, returncode = _bounded_capture(
                [
                    self.ffprobe_path,
                    "-v",
                    "error",
                    "-of",
                    "json",
                    "-show_format",
                    "-show_streams",
                    "--",
                    str(path),
                ],
                timeout_seconds=15.0,
                max_stdout=1_048_576,
                max_stderr=1_048_576,
                should_stop=should_stop,
            )
        except AnalysisInterrupted:
            raise
        except subprocess.TimeoutExpired as error:
            raise AnalysisProviderError("probe_timeout", "ffprobe exceeded 15 seconds") from error
        except _OutputLimitExceeded as error:
            raise AnalysisProviderError("probe_output_limit", "ffprobe output exceeded 1 MiB") from error
        if returncode != 0:
            detail = stderr.decode("utf-8", "replace").strip()
            raise AnalysisProviderError("invalid_media", detail or "ffprobe rejected the media")
        try:
            payload = json.loads(stdout)
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError) as error:
            raise AnalysisProviderError("invalid_media", "ffprobe returned invalid JSON") from error
        streams = payload.get("streams") if isinstance(payload, dict) else None
        if not isinstance(streams, list):
            raise AnalysisProviderError("invalid_media", "ffprobe returned no stream list")
        audio_streams = [stream for stream in streams if isinstance(stream, dict) and stream.get("codec_type") == "audio"]
        if not audio_streams:
            raise AnalysisProviderError("no_audio", "Media contains no audio stream")
        if len(audio_streams) != 1:
            raise AnalysisProviderError("unsupported_audio_streams", "Media must contain exactly one audio stream")
        stream = audio_streams[0]
        format_info = payload.get("format")
        if not isinstance(format_info, dict):
            raise AnalysisProviderError("invalid_media", "ffprobe returned no format metadata")
        duration_value = format_info.get("duration", stream.get("duration"))
        try:
            duration_seconds = float(duration_value)
            sample_rate = int(stream["sample_rate"])
            channels = int(stream["channels"])
        except (KeyError, TypeError, ValueError, OverflowError) as error:
            raise AnalysisProviderError("unsupported_audio", "Audio stream lacks usable duration or channel metadata") from error
        if not math.isfinite(duration_seconds) or duration_seconds <= 0.0:
            raise AnalysisProviderError("unsupported_audio", "Audio duration must be positive and finite")
        if duration_seconds > MAX_DURATION_SECONDS:
            raise AnalysisProviderError("duration_limit", "Audio duration exceeds 7,200 seconds")
        codec = stream.get("codec_name")
        container = format_info.get("format_name")
        if not isinstance(codec, str) or not codec or not isinstance(container, str) or not container:
            raise AnalysisProviderError("unsupported_audio", "Audio codec or container metadata is unavailable")
        return {
            "codec": codec,
            "container": container.split(",", 1)[0],
            "duration_seconds": duration_seconds,
            "sample_rate": sample_rate,
            "channels": channels,
        }

    def _decode(
        self,
        path: Path,
        accumulator: _Accumulator,
        duration_seconds: float,
        report: Callable[[int], None],
        should_stop: Callable[[], bool],
    ) -> None:
        assert self.ffmpeg_path is not None
        command = [
            self.ffmpeg_path,
            "-v",
            "error",
            "-nostdin",
            "-i",
            str(path),
            "-map",
            "0:a:0",
            "-ac",
            "1",
            "-ar",
            str(DECODE_SAMPLE_RATE),
            "-f",
            "f32le",
            "pipe:1",
        ]
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert process.stdout is not None and process.stderr is not None
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ, "stdout")
        selector.register(process.stderr, selectors.EVENT_READ, "stderr")
        started = time.monotonic()
        stderr = bytearray()
        remainder = b""
        try:
            while selector.get_map():
                if should_stop():
                    raise AnalysisInterrupted()
                if time.monotonic() - started > 600.0:
                    raise AnalysisProviderError("analysis_timeout", "FFmpeg analysis exceeded 600 seconds")
                for key, _mask in selector.select(timeout=0.1):
                    if key.data == "stdout":
                        chunk_size = 262_144
                    else:
                        chunk_size = min(16_384, 65_537 - len(stderr))
                    chunk = os.read(key.fileobj.fileno(), chunk_size)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    if key.data == "stderr":
                        if len(stderr) + len(chunk) > 65_536:
                            raise AnalysisProviderError("decode_output_limit", "FFmpeg stderr exceeded 64 KiB")
                        stderr.extend(chunk)
                        continue
                    data = remainder + chunk
                    aligned = len(data) - (len(data) % 4)
                    if aligned:
                        accumulator.consume(np.frombuffer(data[:aligned], dtype="<f4"))
                    remainder = data[aligned:]
                    decoded_fraction = accumulator.sample_count / max(1.0, duration_seconds * DECODE_SAMPLE_RATE)
                    report(75_000 + round(min(1.0, decoded_fraction) * 850_000))
                    if self._analysis_test_delay_seconds > 0.0:
                        _sleep_for_analysis_test_delay(self._analysis_test_delay_seconds)
            returncode = process.wait(timeout=1.0)
        except BaseException:
            _terminate(process)
            raise
        finally:
            selector.close()
            process.stdout.close()
            process.stderr.close()
        if returncode != 0:
            detail = bytes(stderr).decode("utf-8", "replace").strip()
            raise AnalysisProviderError("decode_failed", detail or f"FFmpeg exited {returncode}")
        if remainder:
            raise AnalysisProviderError("decode_failed", "FFmpeg returned an incomplete float sample")

    def _features(
        self,
        accumulator: _Accumulator,
        metadata: dict[str, object],
        *,
        fingerprint: str,
        file_size: int,
        mtime_ns: int,
    ) -> AnalysisFeatures:
        rms = math.sqrt(accumulator.sum_squares / accumulator.sample_count)
        rms_db = _dbfs(rms)
        peak_db = _dbfs(accumulator.peak)
        bpm_milli, tempo_confidence, candidates, onset_count, beat_strength = _tempo(accumulator.flux)
        musical_key, mode, key_confidence = _key(accumulator.chroma, rms, len(accumulator.flux))
        bucket_rms = np.zeros(16, dtype=np.float64)
        covered = accumulator.bucket_counts > 0
        bucket_rms[covered] = np.sqrt(accumulator.bucket_squares[covered] / accumulator.bucket_counts[covered])
        maximum_bucket = float(np.max(bucket_rms))
        energy_curve = tuple(
            _ppm(float(value / maximum_bucket)) if maximum_bucket > 0.0 else 0 for value in bucket_rms
        )
        positive_frame_rms = np.asarray([value for value in accumulator.frame_rms if value > 1e-12], dtype=np.float64)
        if positive_frame_rms.size >= 2:
            frame_db = 20.0 * np.log10(positive_frame_rms)
            dynamic_range = max(0, round((float(np.percentile(frame_db, 95)) - float(np.percentile(frame_db, 10))) * 1_000))
        else:
            dynamic_range = None
        centroid = (
            max(0, round(accumulator.centroid_sum / accumulator.centroid_frames))
            if accumulator.centroid_frames
            else None
        )
        brightness = (
            _ppm(accumulator.brightness_numerator / accumulator.brightness_denominator)
            if accumulator.brightness_denominator > 0.0
            else 0
        )
        duration_seconds = float(metadata["duration_seconds"])
        return AnalysisFeatures(
            fingerprint=str(fingerprint),
            file_size=max(0, int(file_size)),
            mtime_ns=max(0, int(mtime_ns)),
            codec=str(metadata["codec"]),
            container=str(metadata["container"]),
            duration_ms=max(0, round(duration_seconds * 1_000)),
            sample_rate_hz=max(1, int(metadata["sample_rate"])),
            channels=max(1, int(metadata["channels"])),
            bpm_milli=bpm_milli,
            tempo_confidence_ppm=tempo_confidence,
            tempo_candidates_milli=candidates,
            onset_count=onset_count,
            beat_strength_ppm=beat_strength,
            musical_key=musical_key,
            mode=mode,
            key_confidence_ppm=key_confidence,
            rms_milli_dbfs=rms_db,
            peak_milli_dbfs=peak_db,
            crest_factor_milli_db=(peak_db - rms_db) if peak_db is not None and rms_db is not None else None,
            energy_ppm=_ppm(rms),
            dynamic_range_milli_db=dynamic_range,
            onset_rate_milli_hz=max(0, round(onset_count * 1_000 / duration_seconds)),
            spectral_centroid_hz=centroid,
            brightness_ppm=brightness,
            energy_curve_ppm=energy_curve,
            provider=PROVIDER,
            provider_version=PROVIDER_VERSION,
            pipeline_version=PIPELINE_VERSION,
            limitations=LIMITATIONS,
        )


def _analysis_test_delay_seconds() -> float:
    if os.environ.get("DJ_COPILOT_TEST_MODE") != "1":
        return 0.0
    raw_value = os.environ.get("DJ_COPILOT_ANALYSIS_TEST_DELAY_MS")
    if not raw_value or any(character not in "0123456789" for character in raw_value):
        return 0.0
    delay_ms = int(raw_value)
    if raw_value != str(delay_ms) or not 0 <= delay_ms <= 250:
        return 0.0
    return delay_ms / 1_000.0


def _sleep_for_analysis_test_delay(delay_seconds: float) -> None:
    time.sleep(delay_seconds)


def _bounded_capture(
    command: list[str],
    *,
    timeout_seconds: float,
    max_stdout: int,
    max_stderr: int,
    should_stop: Callable[[], bool] | None = None,
) -> tuple[bytes, bytes, int]:
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert process.stdout is not None and process.stderr is not None
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ, "stdout")
    selector.register(process.stderr, selectors.EVENT_READ, "stderr")
    buffers = {"stdout": bytearray(), "stderr": bytearray()}
    limits = {"stdout": int(max_stdout), "stderr": int(max_stderr)}
    started = time.monotonic()
    try:
        while selector.get_map():
            if should_stop is not None and should_stop():
                raise AnalysisInterrupted()
            if time.monotonic() - started > timeout_seconds:
                raise subprocess.TimeoutExpired(command, timeout_seconds)
            for key, _mask in selector.select(timeout=0.1):
                remaining = limits[key.data] - len(buffers[key.data])
                chunk = os.read(key.fileobj.fileno(), min(65_536, remaining + 1))
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                buffers[key.data].extend(chunk)
                if len(buffers[key.data]) > limits[key.data]:
                    raise _OutputLimitExceeded(f"{key.data} exceeded {limits[key.data]} bytes")
        returncode = process.wait(timeout=1.0)
    except BaseException:
        _terminate(process)
        raise
    finally:
        selector.close()
        process.stdout.close()
        process.stderr.close()
    return bytes(buffers["stdout"]), bytes(buffers["stderr"]), int(returncode)


def _terminate(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=1.0)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=1.0)


def _tempo(flux_values: list[float]) -> tuple[int | None, int, tuple[int, ...], int, int]:
    if len(flux_values) < 8:
        return None, 0, (), 0, 0
    envelope = np.asarray(flux_values, dtype=np.float64)
    floor = float(np.median(envelope))
    envelope = np.maximum(envelope - floor, 0.0)
    maximum = float(np.max(envelope))
    if maximum <= 1e-10:
        return None, 0, (), 0, 0
    threshold = max(maximum * 0.15, float(np.mean(envelope) + 0.5 * np.std(envelope)))
    peaks = np.flatnonzero(
        (envelope >= threshold)
        & (envelope >= np.roll(envelope, 1))
        & (envelope > np.roll(envelope, -1))
    )
    peaks = peaks[(peaks > 0) & (peaks < envelope.size - 1)]
    if peaks.size < 4:
        return None, 0, (), int(peaks.size), _ppm(maximum)

    frames_per_second = DECODE_SAMPLE_RATE / HOP_SIZE
    minimum_lag = max(1, math.floor(frames_per_second * 60.0 / 200.0))
    maximum_lag = min(envelope.size - 2, math.ceil(frames_per_second * 60.0 / 60.0))
    correlations: dict[int, float] = {}
    for lag in range(minimum_lag, maximum_lag + 1):
        left = envelope[:-lag]
        right = envelope[lag:]
        denominator = math.sqrt(float(np.dot(left, left)) * float(np.dot(right, right)))
        correlations[lag] = max(0.0, float(np.dot(left, right)) / denominator) if denominator > 0.0 else 0.0

    candidates: list[tuple[float, float]] = []
    for lag in range(minimum_lag + 1, maximum_lag):
        score = correlations[lag]
        if score < correlations[lag - 1] or score < correlations[lag + 1] or score <= 0.0:
            continue
        left = correlations[lag - 1]
        right = correlations[lag + 1]
        denominator = left - 2.0 * score + right
        offset = 0.5 * (left - right) / denominator if abs(denominator) > 1e-12 else 0.0
        refined_lag = lag + max(-0.5, min(0.5, offset))
        doubled_lag = round(2.0 * refined_lag)
        harmonic_support = correlations.get(doubled_lag, 0.0)
        candidates.append((score + 0.75 * harmonic_support, 60.0 * frames_per_second / refined_lag))

    intervals = np.diff(peaks)
    median_interval = float(np.median(intervals))
    regularity = max(0.0, 1.0 - float(np.std(intervals)) / max(median_interval, 1.0))
    evidence_lag = max(minimum_lag, min(maximum_lag, round(median_interval)))
    evidence_score = correlations.get(evidence_lag, 0.0)
    if evidence_score > 0.1:
        candidates.append((max(evidence_score, regularity), 60.0 * frames_per_second / median_interval))
    candidates.sort(key=lambda item: (-item[0], abs(item[1] - 120.0)))
    merged: list[tuple[float, int]] = []
    for score, bpm in candidates:
        bpm_milli = round(bpm) * 1_000
        if not 60_000 <= bpm_milli <= 200_000:
            continue
        if any(abs(bpm_milli - existing_bpm) <= 1_000 for _existing_score, existing_bpm in merged):
            continue
        merged.append((score, bpm_milli))
        if len(merged) == 3:
            break
    if not merged:
        return None, 0, (), int(peaks.size), 0
    confidence = _ppm(max(merged[0][0], regularity))
    return merged[0][1], confidence, tuple(item[1] for item in merged), int(peaks.size), confidence


def _key(chroma: np.ndarray, rms: float, frame_count: int) -> tuple[str | None, str | None, int]:
    if rms < 0.001 or frame_count < 8 or float(np.sum(chroma)) <= 0.0:
        return None, None, 0
    normalized = chroma / np.linalg.norm(chroma)
    scores: list[tuple[float, int, str]] = []
    for mode, profile in (("major", MAJOR_PROFILE), ("minor", MINOR_PROFILE)):
        profile_norm = np.linalg.norm(profile)
        for root in range(12):
            score = float(np.dot(normalized, np.roll(profile, root)) / profile_norm)
            scores.append((score, root, mode))
    scores.sort(reverse=True)
    winner, runner_up = scores[0], scores[1]
    if winner[0] - runner_up[0] < 0.05:
        return None, None, 0
    return KEY_NAMES[winner[1]], winner[2], _ppm(winner[0])


def _dbfs(value: float) -> int | None:
    if value <= 0.0:
        return None
    return max(-240_000, min(0, round(20.0 * math.log10(value) * 1_000)))


def _ppm(value: float) -> int:
    if not math.isfinite(value):
        return 0
    return max(0, min(1_000_000, round(value * 1_000_000)))
