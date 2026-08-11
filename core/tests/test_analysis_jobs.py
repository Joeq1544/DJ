from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dj_copilot.analysis.jobs import AnalysisManager
from dj_copilot.analysis.provider import (
    AnalysisFeatures,
    AnalysisInterrupted,
    AnalysisProviderError,
    ProviderCapabilities,
)
from dj_copilot.database import LibraryDatabase
from dj_copilot.models import ImportedTrack, RekordboxImport


def _features(
    fingerprint: str,
    *,
    provider: str,
    provider_version: str,
    pipeline_version: str,
) -> AnalysisFeatures:
    return AnalysisFeatures(
        fingerprint=fingerprint,
        file_size=8,
        mtime_ns=1,
        codec="fixture",
        container="fixture",
        duration_ms=1_000,
        sample_rate_hz=48_000,
        channels=2,
        bpm_milli=120_000,
        tempo_confidence_ppm=800_000,
        tempo_candidates_milli=(120_000,),
        onset_count=4,
        beat_strength_ppm=700_000,
        musical_key="C",
        mode="major",
        key_confidence_ppm=600_000,
        rms_milli_dbfs=-12_000,
        peak_milli_dbfs=-1_000,
        crest_factor_milli_db=11_000,
        energy_ppm=300_000,
        dynamic_range_milli_db=9_000,
        onset_rate_milli_hz=4_000,
        spectral_centroid_hz=1_500,
        brightness_ppm=250_000,
        energy_curve_ppm=(100_000, 200_000, 300_000),
        provider=provider,
        provider_version=provider_version,
        pipeline_version=pipeline_version,
        limitations=("Generated test evidence only.",),
    )


class ControllableProvider:
    def __init__(
        self,
        *,
        pipeline_version: str = "pipeline-v1",
        block_once: tuple[str, ...] = (),
        failures: dict[str, tuple[str, str]] | None = None,
    ):
        self.provider = "fake-local"
        self.provider_version = "1.2.3"
        self.pipeline_version = pipeline_version
        self.fingerprints: dict[str, str] = {}
        self.block_once = set(block_once)
        self.blocked = set()
        self.failures = failures or {}
        self.analyzed_names: list[str] = []
        self.entered = threading.Event()
        self.interrupted = threading.Event()

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            available=True,
            provider=self.provider,
            provider_version=self.provider_version,
            pipeline_version=self.pipeline_version,
            available_stages=("metadata", "basic_features"),
            unavailable_stages=("structure", "embeddings"),
            unavailable_reason=None,
        )

    def fingerprint(self, path: Path) -> tuple[str, int, int]:
        return self.fingerprints.get(path.name, f"fp-{path.name}"), path.stat().st_size, path.stat().st_mtime_ns

    def analyze(self, path: Path, *, progress, should_stop) -> AnalysisFeatures:
        self.analyzed_names.append(path.name)
        progress(100_000)
        if path.name in self.block_once and path.name not in self.blocked:
            self.blocked.add(path.name)
            self.entered.set()
            while not should_stop():
                time.sleep(0.005)
            self.interrupted.set()
            raise AnalysisInterrupted()
        progress(500_000)
        progress(1_000_000)
        failure = self.failures.get(path.name)
        if failure is not None:
            raise AnalysisProviderError(failure[0], failure[1])
        if should_stop():
            raise AnalysisInterrupted()
        fingerprint, _size, _mtime_ns = self.fingerprint(path)
        return _features(
            fingerprint,
            provider=self.provider,
            provider_version=self.provider_version,
            pipeline_version=self.pipeline_version,
        )


class AnalysisManagerTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.database = LibraryDatabase(self.root / "library.sqlite3")
        tracks = []
        for name in ("one.wav", "two.wav", "three.wav"):
            source = self.root / name
            source.write_bytes(name.encode("ascii"))
            tracks.append(
                ImportedTrack(
                    external_id=name,
                    title=name,
                    artist="Fixture Artist",
                    album=None,
                    genre=None,
                    bpm_milli=None,
                    musical_key=None,
                    duration_ms=1_000,
                    path=str(source),
                    availability="available",
                )
            )
        self.database.import_library(
            RekordboxImport(source_sha256="b" * 64, tracks=tuple(tracks), playlists=())
        )
        self.ids = {
            track.external_id: track.id
            for track in self.database.list_tracks(limit=10).items
        }
        self.manager: AnalysisManager | None = None

    def tearDown(self):
        if self.manager is not None:
            self.manager.stop()
        self.database.close()
        self.temporary_directory.cleanup()

    def _start(self, provider: ControllableProvider) -> AnalysisManager:
        self.manager = AnalysisManager(self.database, provider)
        self.manager.start()
        return self.manager

    def _wait_for(self, predicate, *, timeout: float = 3.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            value = predicate()
            if value:
                return value
            time.sleep(0.01)
        self.fail("timed out waiting for analysis state")

    def test_queue_processes_tracks_in_requested_order(self):
        """Selecting queued work by unstable UUID order must fail."""
        provider = ControllableProvider()
        manager = self._start(provider)

        manager.queue_tracks((self.ids["two.wav"], self.ids["one.wav"], self.ids["three.wav"]))
        self._wait_for(lambda: manager.status().succeeded == 3)

        self.assertEqual(provider.analyzed_names, ["two.wav", "one.wav", "three.wav"])

    def test_queue_rejects_duplicate_track_ids(self):
        """Silently collapsing duplicate queue input must fail."""
        manager = self._start(ControllableProvider())

        with self.assertRaises(ValueError):
            manager.queue_tracks((self.ids["one.wav"], self.ids["one.wav"]))

        self.assertEqual(manager.status().queued, 0)

    def test_pause_interrupts_current_work_and_resume_finishes_without_starting_next(self):
        """Starting the next track while paused or losing interrupted work must fail."""
        provider = ControllableProvider(block_once=("one.wav",))
        manager = self._start(provider)
        manager.queue_tracks((self.ids["one.wav"], self.ids["two.wav"]))
        self.assertTrue(provider.entered.wait(1.0))

        manager.pause()
        paused = self._wait_for(lambda: manager.status() if manager.status().paused == 1 else None)

        self.assertEqual(paused.state, "paused")
        self.assertEqual(provider.analyzed_names, ["one.wav"])
        manager.resume()
        finished = self._wait_for(lambda: manager.status() if manager.status().succeeded == 2 else None)
        self.assertEqual(finished.failed, 0)
        self.assertEqual(provider.analyzed_names, ["one.wav", "one.wav", "two.wav"])

    def test_rebuild_interrupts_selected_running_work_and_preserves_unselected_analysis(self):
        """A stale selected completion or collateral invalidation must fail the rebuild flow."""
        retained_track_id = self.ids["two.wav"]
        retained_features = _features(
            "fp-two.wav",
            provider="fake-local",
            provider_version="1.2.3",
            pipeline_version="pipeline-v1",
        )
        self.database.put_analysis_job(
            retained_track_id,
            status="succeeded",
            progress_ppm=1_000_000,
            attempt_count=4,
            error_code=None,
            error_message=None,
            fingerprint=retained_features.fingerprint,
            provider=retained_features.provider,
            provider_version=retained_features.provider_version,
            pipeline_version=retained_features.pipeline_version,
        )
        self.database.put_track_features(retained_track_id, retained_features)
        provider = ControllableProvider(block_once=("one.wav",))
        manager = self._start(provider)
        rebuilt_track_id = self.ids["one.wav"]
        manager.queue_tracks((rebuilt_track_id,))
        self.assertTrue(provider.entered.wait(1.0))

        manager.rebuild_tracks((rebuilt_track_id,))

        rebuilt = self._wait_for(
            lambda: manager.status((rebuilt_track_id,))
            if manager.status((rebuilt_track_id,)).items[0][1].status == "succeeded"
            else None
        )
        self.assertEqual(provider.analyzed_names, ["one.wav", "one.wav"])
        self.assertEqual(rebuilt.items[0][1].attempt_count, 1)
        retained = manager.status((retained_track_id,)).items[0][1]
        self.assertEqual(retained.status, "succeeded")
        self.assertEqual(retained.attempt_count, 4)
        self.assertEqual(retained.features, retained_features)

    def test_rebuild_with_any_unknown_track_does_not_interrupt_known_running_work(self):
        """Validating after signalling the worker would partially apply a rejected rebuild."""
        provider = ControllableProvider(block_once=("one.wav",))
        manager = self._start(provider)
        running_track_id = self.ids["one.wav"]
        manager.queue_tracks((running_track_id,))
        self.assertTrue(provider.entered.wait(1.0))

        with self.assertRaises(ValueError):
            manager.rebuild_tracks((running_track_id, "unknown-track"))

        self.assertFalse(provider.interrupted.wait(0.1))
        running = manager.status((running_track_id,)).items[0][1]
        self.assertEqual(running.status, "running")
        self.assertEqual(provider.analyzed_names, ["one.wav"])

    def test_stop_requeues_running_work_for_a_fresh_manager(self):
        """Leaving a durable running row after shutdown must fail restart recovery."""
        first_provider = ControllableProvider(block_once=("one.wav",))
        manager = self._start(first_provider)
        manager.queue_tracks((self.ids["one.wav"],))
        self.assertTrue(first_provider.entered.wait(1.0))

        manager.stop()
        self.assertEqual(manager.status((self.ids["one.wav"],)).items[0][1].status, "queued")
        self.assertEqual(manager.status().state, "running")
        second_provider = ControllableProvider()
        self.manager = AnalysisManager(self.database, second_provider)
        self.manager.start()
        self._wait_for(lambda: self.manager.status().succeeded == 1)

        self.assertEqual(second_provider.analyzed_names, ["one.wav"])

    def test_failed_item_uses_stable_sanitized_error_and_does_not_stop_queue(self):
        """A source-path leak or queue-wide abort after one provider error must fail."""
        source = self.root / "one.wav"
        provider = ControllableProvider(
            failures={"one.wav": ("decode_failed", f"could not decode {source}")}
        )
        manager = self._start(provider)
        manager.queue_tracks((self.ids["one.wav"], self.ids["two.wav"]))

        finished = self._wait_for(
            lambda: manager.status((self.ids["one.wav"], self.ids["two.wav"]))
            if manager.status().failed == 1 and manager.status().succeeded == 1
            else None
        )

        first_summary = finished.items[0][1]
        self.assertEqual(first_summary.error_code, "decode_failed")
        self.assertNotIn(str(source), first_summary.error_message)
        self.assertLessEqual(len(first_summary.error_message), 500)
        self.assertEqual(provider.analyzed_names, ["one.wav", "two.wav"])

    def test_exact_cache_reuses_features_but_fingerprint_or_pipeline_changes_reanalyze(self):
        """Ignoring any cache provenance key, or never reusing an exact match, must fail."""
        provider = ControllableProvider()
        manager = self._start(provider)
        track_id = self.ids["one.wav"]
        manager.queue_tracks((track_id,))
        self._wait_for(
            lambda: manager.status((track_id,)).items[0][1].status == "succeeded"
            and manager.status((track_id,)).items[0][1].attempt_count == 1
        )

        manager.queue_tracks((track_id,))
        self._wait_for(
            lambda: manager.status((track_id,)).items[0][1].status == "succeeded"
            and manager.status((track_id,)).items[0][1].attempt_count == 2
        )
        self.assertEqual(provider.analyzed_names, ["one.wav"])

        provider.fingerprints["one.wav"] = "fp-changed"
        manager.queue_tracks((track_id,))
        self._wait_for(
            lambda: manager.status((track_id,)).items[0][1].status == "succeeded"
            and manager.status((track_id,)).items[0][1].attempt_count == 3
        )
        self.assertEqual(provider.analyzed_names, ["one.wav", "one.wav"])
        manager.stop()

        changed_pipeline = ControllableProvider(pipeline_version="pipeline-v2")
        changed_pipeline.fingerprints["one.wav"] = "fp-changed"
        self.manager = AnalysisManager(self.database, changed_pipeline)
        self.manager.start()
        self.manager.queue_tracks((track_id,))
        final = self._wait_for(
            lambda: self.manager.status((track_id,))
            if self.manager.status((track_id,)).items[0][1].status == "succeeded"
            and self.manager.status((track_id,)).items[0][1].attempt_count == 4
            else None
        )
        self.assertEqual(changed_pipeline.analyzed_names, ["one.wav"])
        self.assertEqual(final.items[0][1].features.pipeline_version, "pipeline-v2")

    def test_status_is_globally_bounded_and_validates_requested_item_ids(self):
        """Leaking unrequested items or accepting ambiguous/unbounded ID lists must fail."""
        provider = ControllableProvider(block_once=("one.wav",))
        manager = self._start(provider)
        manager.queue_tracks((self.ids["one.wav"], self.ids["two.wav"]))
        self.assertTrue(provider.entered.wait(1.0))

        requested = manager.status((self.ids["two.wav"], self.ids["one.wav"]))

        self.assertEqual([track_id for track_id, _summary in requested.items], [self.ids["two.wav"], self.ids["one.wav"]])
        self.assertTrue(0 <= requested.progress_ppm <= 1_000_000)
        self.assertEqual(requested.capabilities, provider.capabilities())
        self.assertEqual(manager.status().items, ())
        invalid_requests = (
            (),
            (self.ids["one.wav"], self.ids["one.wav"]),
            ("unknown",),
            tuple(f"unknown-{index}" for index in range(201)),
        )
        for track_ids in invalid_requests:
            with self.subTest(track_ids=len(track_ids)):
                with self.assertRaises(ValueError):
                    manager.status(track_ids)


if __name__ == "__main__":
    unittest.main()
