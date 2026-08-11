from datetime import datetime
import os
from pathlib import Path
import sqlite3
import stat
import sys
import tempfile
import unittest
from unittest import mock


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dj_copilot.analysis.provider import AnalysisFeatures
from dj_copilot.database import CURRENT_SCHEMA_VERSION, LibraryDatabase
from dj_copilot.models import ImportedTrack, RekordboxImport


def _features(fingerprint: str) -> AnalysisFeatures:
    return AnalysisFeatures(
        fingerprint=fingerprint,
        file_size=1234,
        mtime_ns=5678,
        codec="pcm_s16le",
        container="wav",
        duration_ms=16_000,
        sample_rate_hz=48_000,
        channels=2,
        bpm_milli=120_000,
        tempo_confidence_ppm=345_678,
        tempo_candidates_milli=(120_000, 60_000),
        onset_count=32,
        beat_strength_ppm=456_789,
        musical_key="C",
        mode="major",
        key_confidence_ppm=567_890,
        rms_milli_dbfs=-12_345,
        peak_milli_dbfs=-1_234,
        crest_factor_milli_db=11_111,
        energy_ppm=234_567,
        dynamic_range_milli_db=8_765,
        onset_rate_milli_hz=2_000,
        spectral_centroid_hz=1_234,
        brightness_ppm=345_678,
        energy_curve_ppm=(100_000, 200_000, 300_000),
        provider="fake-local",
        provider_version="1.2.3",
        pipeline_version="pipeline-v1",
        limitations=("Generated test evidence only.",),
    )


class RecoveryDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.database_path = self.root / "library.sqlite3"
        self.database = LibraryDatabase(self.database_path)
        self.database.import_library(
            RekordboxImport(
                source_sha256="a" * 64,
                tracks=tuple(
                    ImportedTrack(
                        external_id=name,
                        title=f"Track {name}",
                        artist="Fixture Artist",
                        album=None,
                        genre=None,
                        bpm_milli=None,
                        musical_key=None,
                        duration_ms=1_000,
                        path=str(self.root / f"{name}.wav"),
                        availability="available",
                    )
                    for name in ("one", "two", "three")
                ),
                playlists=(),
            )
        )
        self.ids = {
            track.external_id: track.id
            for track in self.database.list_tracks(limit=10).items
        }

    def tearDown(self):
        self.database.close()
        self.temporary_directory.cleanup()

    def _put_finished(self, name: str, fingerprint: str) -> None:
        track_id = self.ids[name]
        self.database.put_analysis_job(
            track_id,
            status="succeeded",
            progress_ppm=1_000_000,
            attempt_count=3,
            error_code=None,
            error_message=None,
            fingerprint=fingerprint,
            provider="fake-local",
            provider_version="1.2.3",
            pipeline_version="pipeline-v1",
        )
        self.database.put_track_features(track_id, _features(fingerprint))

    def test_selected_rebuild_invalidates_features_and_requeues_only_current_tracks(self):
        """Keeping selected features, stale completion eligibility, or touching other rows must fail."""
        self._put_finished("one", "fp-one")
        self._put_finished("two", "fp-two")
        self._put_finished("three", "fp-three")

        self.database.rebuild_analysis_tracks(
            (self.ids["one"], self.ids["two"]),
            provider="fake-local",
            provider_version="1.2.3",
            pipeline_version="pipeline-v1",
        )

        for name in ("one", "two"):
            rebuilt = self.database.analysis_summary(self.ids[name])
            self.assertEqual(rebuilt.status, "queued")
            self.assertEqual(rebuilt.progress_ppm, 0)
            self.assertEqual(rebuilt.attempt_count, 0)
            self.assertIsNone(rebuilt.features)
            self.assertIsNone(
                self.database.connection.execute(
                    "SELECT fingerprint FROM analysis_jobs WHERE track_id = ?",
                    (self.ids[name],),
                ).fetchone()[0]
            )
        retained = self.database.analysis_summary(self.ids["three"])
        self.assertEqual(retained.status, "succeeded")
        self.assertEqual(retained.features, _features("fp-three"))

        self.database.finish_analysis_success(self.ids["one"], _features("fp-one"))
        refused_late_result = self.database.analysis_summary(self.ids["one"])
        self.assertEqual(refused_late_result.status, "queued")
        self.assertIsNone(refused_late_result.features)

    def test_rebuild_rejects_any_unknown_track_without_partial_invalidation(self):
        """Silently dropping an unknown selection or mutating known rows first must fail."""
        self._put_finished("one", "fp-one")
        before = tuple(
            self.database.connection.execute(
                "SELECT track_id, status, fingerprint FROM analysis_jobs ORDER BY track_id"
            )
        )

        with self.assertRaises(KeyError):
            self.database.rebuild_analysis_tracks(
                (self.ids["one"], "unknown-track"),
                provider="fake-local",
                provider_version="1.2.3",
                pipeline_version="pipeline-v1",
            )

        after = tuple(
            self.database.connection.execute(
                "SELECT track_id, status, fingerprint FROM analysis_jobs ORDER BY track_id"
            )
        )
        self.assertEqual(after, before)
        self.assertEqual(
            self.database.analysis_summary(self.ids["one"]).features,
            _features("fp-one"),
        )

    def test_online_backup_is_verified_mode_0600_and_atomically_replaces_a_regular_file(self):
        """A partial, loose-permission, stale, or schema-mismatched backup must fail."""
        self._put_finished("one", "fp-one")
        backup_directory = self.root / "backups"
        backup_directory.mkdir()
        destination = backup_directory / "DJ Copilot Backup.sqlite3"
        destination.write_bytes(b"old backup")
        destination.chmod(0o644)

        result = self.database.backup_database(destination)

        self.assertEqual(result.status, "backed_up")
        self.assertEqual(result.schema_version, CURRENT_SCHEMA_VERSION)
        self.assertEqual(result.integrity, "ok")
        self.assertEqual(result.size_bytes, destination.stat().st_size)
        self.assertGreater(result.size_bytes, 0)
        self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o600)
        parsed_created_at = datetime.fromisoformat(result.created_at.replace("Z", "+00:00"))
        self.assertIsNotNone(parsed_created_at.tzinfo)
        backup = sqlite3.connect(destination)
        try:
            self.assertEqual(
                backup.execute("PRAGMA user_version").fetchone()[0],
                CURRENT_SCHEMA_VERSION,
            )
            self.assertEqual(backup.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(backup.execute("SELECT COUNT(*) FROM tracks").fetchone()[0], 3)
            self.assertEqual(backup.execute("SELECT COUNT(*) FROM track_features").fetchone()[0], 1)
        finally:
            backup.close()
        self.assertEqual(self.database.integrity_status(), "ok")
        self.assertEqual(list(backup_directory.glob(f".{destination.name}.*.tmp")), [])

    def test_backup_destination_policy_rejects_aliases_symlinks_nonregular_and_missing_parents(self):
        """A renderer-controlled relative or special destination must not escape the save-dialog boundary."""
        target = self.root / "target.sqlite3"
        target.write_bytes(b"target remains")
        symlink = self.root / "link.sqlite3"
        symlink.symlink_to(target)
        directory = self.root / "directory.sqlite3"
        directory.mkdir()
        cases = (
            Path("relative.sqlite3"),
            self.database_path,
            symlink,
            directory,
            self.root / "missing-parent" / "backup.sqlite3",
        )

        for destination in cases:
            with self.subTest(destination=destination):
                with self.assertRaises(ValueError):
                    self.database.backup_database(destination)

        self.assertEqual(target.read_bytes(), b"target remains")
        self.assertEqual(self.database.integrity_status(), "ok")

    def test_backup_failure_preserves_existing_destination_and_cleans_temporary_file(self):
        """A failed durability step must not replace the last good backup or leave private temp data."""
        backup_directory = self.root / "backups"
        backup_directory.mkdir()
        destination = backup_directory / "DJ Copilot Backup.sqlite3"
        destination.write_bytes(b"last good backup")

        with mock.patch("dj_copilot.database.os.fsync", side_effect=OSError("fsync failed")):
            with self.assertRaises(OSError):
                self.database.backup_database(destination)

        self.assertEqual(destination.read_bytes(), b"last good backup")
        self.assertEqual(list(backup_directory.glob(f".{destination.name}.*.tmp")), [])
        self.assertEqual(self.database.integrity_status(), "ok")


if __name__ == "__main__":
    unittest.main()
