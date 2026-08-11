"""Durable, single-worker orchestration for local audio analysis."""

from __future__ import annotations

from pathlib import Path
import threading

from .provider import (
    AnalysisFeatures,
    AnalysisInterrupted,
    AnalysisProvider,
    AnalysisProviderError,
    ProviderCapabilities,
)
from ..database import LibraryDatabase
from ..models import AnalysisQueueStatus, AnalysisSummary


_STABLE_ERROR_MESSAGES = {
    "missing_file": "Source audio file is unavailable.",
    "unsupported_audio": "The source audio format is unsupported.",
    "decode_failed": "The source audio could not be decoded.",
    "analysis_timeout": "Local audio analysis timed out.",
    "provider_unavailable": "The local audio analysis provider is unavailable.",
    "analysis_failed": "Local audio analysis failed.",
}


class AnalysisManager:
    """Process durable jobs sequentially without sending raw audio off-device."""

    def __init__(self, database: LibraryDatabase, provider: AnalysisProvider):
        self._database = database
        self._provider = provider
        self._capabilities = provider.capabilities()
        self._condition = threading.Condition()
        self._interrupt = threading.Event()
        self._thread: threading.Thread | None = None
        self._current_track_id: str | None = None
        self._stop_requested = False

    def start(self) -> None:
        with self._condition:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop_requested = False
            self._interrupt.clear()
            self._thread = threading.Thread(
                target=self._run,
                name="dj-copilot-analysis",
                daemon=True,
            )
            self._thread.start()

    def stop(self) -> None:
        with self._condition:
            thread = self._thread
            self._stop_requested = True
            self._interrupt.set()
            self._condition.notify_all()
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=5.0)
        self._database.requeue_running_analysis()
        with self._condition:
            if self._thread is not None and not self._thread.is_alive():
                self._thread = None
                self._current_track_id = None

    def queue_tracks(self, track_ids: tuple[str, ...]) -> AnalysisQueueStatus:
        requested = _validate_track_ids(track_ids)
        with self._condition:
            try:
                self._database.queue_analysis_tracks(
                    requested,
                    provider=self._capabilities.provider,
                    provider_version=self._capabilities.provider_version,
                    pipeline_version=self._capabilities.pipeline_version,
                )
            except KeyError as error:
                raise ValueError("analysis track IDs must refer to known library tracks") from error
            self._condition.notify_all()
        return self.status(requested)

    def pause(self) -> AnalysisQueueStatus:
        with self._condition:
            self._database.pause_analysis()
            self._interrupt.set()
            self._condition.notify_all()
        return self.status()

    def resume(self) -> AnalysisQueueStatus:
        with self._condition:
            self._database.resume_analysis()
            self._interrupt.clear()
            self._condition.notify_all()
        return self.status()

    def status(self, track_ids: tuple[str, ...] | None = None) -> AnalysisQueueStatus:
        requested = None if track_ids is None else _validate_track_ids(track_ids)
        try:
            paused, counts, progress_ppm, items = self._database.analysis_snapshot(requested)
        except KeyError as error:
            raise ValueError("analysis track IDs must refer to known library tracks") from error
        queued, running, paused_count, succeeded, failed = counts
        if paused:
            state = "paused"
        elif running or queued:
            state = "running"
        else:
            state = "idle"
        return AnalysisQueueStatus(
            state=state,
            queued=queued,
            running=running,
            paused=paused_count,
            succeeded=succeeded,
            failed=failed,
            progress_ppm=max(0, min(1_000_000, int(progress_ppm))),
            capabilities=self._capabilities,
            items=items,
        )

    def _run(self) -> None:
        while True:
            with self._condition:
                while True:
                    if self._stop_requested:
                        self._condition.notify_all()
                        return
                    claimed = self._database.claim_next_analysis_job()
                    if claimed is not None:
                        track_id, source_path = claimed
                        self._current_track_id = track_id
                        self._interrupt.clear()
                        break
                    self._condition.wait()
            self._process(track_id, source_path)
            with self._condition:
                self._current_track_id = None
                self._condition.notify_all()

    def _process(self, track_id: str, source_path: Path) -> None:
        try:
            if not self._capabilities.available or self._capabilities.provider_version is None:
                raise AnalysisProviderError(
                    "provider_unavailable",
                    self._capabilities.unavailable_reason or "Provider unavailable",
                )
            fingerprint, _file_size, _mtime_ns = self._provider.fingerprint(source_path)
            self._database.record_analysis_fingerprint(track_id, fingerprint)
            cached = self._database.cached_track_features(
                track_id,
                fingerprint=fingerprint,
                provider=self._capabilities.provider,
                provider_version=self._capabilities.provider_version,
                pipeline_version=self._capabilities.pipeline_version,
            )
            if cached is not None:
                if self._interrupt.is_set():
                    raise AnalysisInterrupted()
                self._database.finish_analysis_cached(track_id, cached)
                return
            features_value = self._provider.analyze(
                source_path,
                progress=lambda value: self._progress(track_id, value),
                should_stop=self._interrupt.is_set,
            )
            if self._interrupt.is_set():
                raise AnalysisInterrupted()
            self._validate_result(fingerprint, features_value)
            self._database.finish_analysis_success(track_id, features_value)
        except AnalysisInterrupted:
            with self._condition:
                stopping = self._stop_requested
            paused = False
            if not stopping:
                paused, _counts, _progress, _items = self._database.analysis_snapshot(None)
            self._database.interrupt_analysis(track_id, paused=paused and not stopping)
        except AnalysisProviderError as error:
            code = _stable_error_code(error.code)
            self._database.finish_analysis_failure(
                track_id,
                code=code,
                message=_STABLE_ERROR_MESSAGES[code],
            )
        except (FileNotFoundError, NotADirectoryError):
            self._database.finish_analysis_failure(
                track_id,
                code="missing_file",
                message=_STABLE_ERROR_MESSAGES["missing_file"],
            )
        except Exception:
            self._database.finish_analysis_failure(
                track_id,
                code="analysis_failed",
                message=_STABLE_ERROR_MESSAGES["analysis_failed"],
            )

    def _progress(self, track_id: str, value: int) -> None:
        if not self._interrupt.is_set():
            self._database.update_analysis_progress(track_id, value)

    def _validate_result(self, fingerprint: str, features_value: AnalysisFeatures) -> None:
        if (
            not isinstance(features_value, AnalysisFeatures)
            or features_value.fingerprint != fingerprint
            or features_value.provider != self._capabilities.provider
            or features_value.provider_version != self._capabilities.provider_version
            or features_value.pipeline_version != self._capabilities.pipeline_version
        ):
            raise AnalysisProviderError("analysis_failed", "Provider returned inconsistent provenance")


def _validate_track_ids(track_ids: tuple[str, ...]) -> tuple[str, ...]:
    if not isinstance(track_ids, tuple) or not 1 <= len(track_ids) <= 200:
        raise ValueError("analysis track IDs must be a tuple containing 1 to 200 IDs")
    if any(not isinstance(track_id, str) or not track_id for track_id in track_ids):
        raise ValueError("analysis track IDs must be non-empty strings")
    if len(set(track_ids)) != len(track_ids):
        raise ValueError("analysis track IDs must be unique")
    return track_ids


def _stable_error_code(provider_code: str) -> str:
    if provider_code == "missing_file":
        return "missing_file"
    if provider_code in {
        "unsupported_audio",
        "invalid_media",
        "no_audio",
        "unsupported_audio_streams",
        "duration_limit",
    }:
        return "unsupported_audio"
    if provider_code in {"decode_failed", "decode_output_limit", "probe_output_limit"}:
        return "decode_failed"
    if provider_code in {"analysis_timeout", "probe_timeout"}:
        return "analysis_timeout"
    if provider_code == "provider_unavailable":
        return "provider_unavailable"
    return "analysis_failed"


__all__ = ("AnalysisManager", "AnalysisQueueStatus", "AnalysisSummary")
