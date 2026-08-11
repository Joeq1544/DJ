"""Bounded, standard-library measurement of the generated Phase 0 WAV fixtures."""

from dataclasses import dataclass
import hashlib
import multiprocessing
from pathlib import Path
import queue
import struct
import time
import wave


class AnalysisError(ValueError):
    """The input is outside this PCM WAV feasibility contract."""


class ModelAssetError(ValueError):
    """A model asset path, digest, or format is not safe for this application."""


@dataclass(frozen=True)
class AnalysisJob:
    name: str
    path: Path
    delay_seconds: float = 0.0
    startup_delay_seconds: float = 0.0


def analyze_file(path, *, chunk_frames=4096):
    """Measure mono signed-16-bit PCM WAV by reading bounded frame chunks only."""
    path = Path(path)
    try:
        source = wave.open(str(path), "rb")
    except (EOFError, wave.Error) as exc:
        raise AnalysisError(f"invalid WAV: {exc}") from exc
    with source:
        channels = source.getnchannels()
        width = source.getsampwidth()
        rate = source.getframerate()
        frames = source.getnframes()
        if channels != 1 or width != 2 or rate <= 0:
            raise AnalysisError("only mono signed 16-bit PCM WAV is supported")
        sum_squares = 0
        first_half_squares = 0
        second_half_squares = 0
        peak = 0
        onsets = []
        in_click = False
        frame_index = 0
        threshold = 0.1 * 32_767
        while True:
            raw = source.readframes(chunk_frames)
            if not raw:
                break
            if len(raw) % 2:
                raise AnalysisError("invalid PCM frame alignment")
            for (value,) in struct.iter_unpack("<h", raw):
                absolute = abs(value)
                square = value * value
                sum_squares += square
                peak = max(peak, absolute)
                if frame_index < frames // 2:
                    first_half_squares += square
                else:
                    second_half_squares += square
                active = absolute >= threshold
                if active and not in_click:
                    onsets.append(frame_index)
                in_click = active
                frame_index += 1
    if frame_index != frames:
        raise AnalysisError("truncated PCM data")
    intervals = [(right - left) / rate for left, right in zip(onsets, onsets[1:])]
    median_interval = _median(intervals)
    bpm = 60 / median_interval if median_interval else None
    rms = (sum_squares / frames) ** 0.5 / 32_767 if frames else 0.0
    energy_ratio = second_half_squares / first_half_squares if first_half_squares else None
    evidence_count = min(1.0, len(intervals) / 8) if median_interval else 0.0
    interval_regularity = (
        max(0.0, 1 - sum(abs(interval - median_interval) for interval in intervals) / (len(intervals) * median_interval))
        if median_interval
        else 0.0
    )
    confidence = evidence_count * interval_regularity
    return {
        "source_sha256": _sha256_file(path),
        "sample_rate": rate,
        "channels": channels,
        "duration_seconds": frames / rate,
        "peak": peak / 32_767,
        "rms": rms,
        "first_half_energy": first_half_squares,
        "second_half_energy": second_half_squares,
        "second_to_first_half_energy_ratio": energy_ratio,
        "onset_positions": onsets,
        "median_interval_seconds": median_interval,
        "bpm": bpm,
        "confidence": confidence,
        "confidence_components": {
            "evidence_count": evidence_count,
            "interval_regularity": interval_regularity,
        },
        "limitations": "Synthetic PCM click measurement only; not production MIR accuracy or a tempo detector for music.",
    }


def _median(values):
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    return ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2


def _sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        while chunk := source.read(64 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _worker(path, startup_delay_seconds, delay_seconds, result_queue):
    try:
        if startup_delay_seconds:
            time.sleep(startup_delay_seconds)
        result_queue.put(("ready", None))
        if delay_seconds:
            time.sleep(delay_seconds)
        result_queue.put(("ok", analyze_file(path)))
    except Exception as exc:  # Process boundary must report one bad file, never stop the batch.
        result_queue.put(("error", f"{type(exc).__name__}: {exc}"))


def analyze_batch(jobs, *, timeout_seconds, startup_timeout_seconds=5.0):
    """Analyze jobs with a bounded ready handshake and a separate analysis timeout."""
    if timeout_seconds <= 0 or startup_timeout_seconds <= 0:
        raise ValueError("timeouts must be positive")
    outcomes = {}
    context = multiprocessing.get_context("spawn")
    for job in jobs:
        result_queue = context.Queue(maxsize=1)
        process = context.Process(
            target=_worker,
            args=(str(job.path), job.startup_delay_seconds, job.delay_seconds, result_queue),
        )
        started = False
        try:
            process.start()
            started = True
            try:
                status, payload = result_queue.get(timeout=startup_timeout_seconds)
            except queue.Empty:
                outcomes[job.name] = {
                    "status": "startup_timeout",
                    "error": f"worker did not signal ready within {startup_timeout_seconds:.3f}s",
                }
            else:
                if status != "ready":
                    outcomes[job.name] = {"status": "error", "error": f"worker failed before ready: {payload}"}
                else:
                    try:
                        status, payload = result_queue.get(timeout=timeout_seconds)
                    except queue.Empty:
                        outcomes[job.name] = {"status": "timeout", "error": f"exceeded {timeout_seconds:.3f}s after ready"}
                    else:
                        outcomes[job.name] = (
                            {"status": "ok", "result": payload}
                            if status == "ok"
                            else {"status": "error", "error": payload}
                        )
        except Exception as exc:
            outcomes[job.name] = {"status": "error", "error": f"worker startup failed: {type(exc).__name__}: {exc}"}
        finally:
            if started:
                if process.is_alive():
                    process.terminate()
                process.join()
            process.close()
            result_queue.close()
            result_queue.join_thread()
    return outcomes


def validate_model_asset(path, *, model_root, allowed_hashes):
    """Validate a future model asset without loading or deserializing anything."""
    model_root = Path(model_root).resolve(strict=True)
    candidate = Path(path).resolve(strict=True)
    try:
        candidate.relative_to(model_root)
    except ValueError as exc:
        raise ModelAssetError("model asset is outside the application-owned model root") from exc
    if candidate.suffix.lower() in {".pickle", ".pkl", ".pt", ".pth"}:
        raise ModelAssetError("pickle-like executable model formats are not allowed")
    digest = _sha256_file(candidate)
    if digest not in allowed_hashes:
        raise ModelAssetError("model asset hash is not allowlisted")
    return candidate
