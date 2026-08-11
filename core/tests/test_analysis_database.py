from dataclasses import fields
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dj_copilot.analysis.provider import AnalysisFeatures
from dj_copilot.database import LibraryDatabase
from dj_copilot.models import ImportedTrack, RekordboxImport


def _features(
    fingerprint: str,
    *,
    provider: str = "fake-local",
    provider_version: str = "1.2.3",
    pipeline_version: str = "pipeline-v1",
    tempo_confidence_ppm: int = 345_678,
) -> AnalysisFeatures:
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
        tempo_confidence_ppm=tempo_confidence_ppm,
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
        provider=provider,
        provider_version=provider_version,
        pipeline_version=pipeline_version,
        limitations=("Generated test evidence only.",),
    )


def _import(*external_ids: str) -> RekordboxImport:
    tracks = tuple(
        ImportedTrack(
            external_id=external_id,
            title=f"Track {external_id}",
            artist="Fixture Artist",
            album=None,
            genre=None,
            bpm_milli=None,
            musical_key=None,
            duration_ms=1_000,
            path=f"/private/tmp/dj-copilot/{external_id}/../{external_id}.wav",
            availability="missing",
        )
        for external_id in external_ids
    )
    return RekordboxImport(source_sha256="a" * 64, tracks=tracks, playlists=())


def _create_m1_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE library_state (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            revision INTEGER NOT NULL,
            source_sha256 TEXT NOT NULL
        );
        CREATE TABLE tracks (
            id TEXT PRIMARY KEY,
            external_id TEXT NOT NULL UNIQUE,
            title TEXT,
            artist TEXT,
            album TEXT,
            genre TEXT,
            bpm_milli INTEGER,
            musical_key TEXT,
            duration_ms INTEGER,
            availability TEXT NOT NULL
        );
        CREATE TABLE playlists (
            id TEXT PRIMARY KEY,
            import_key TEXT NOT NULL UNIQUE,
            parent_id TEXT REFERENCES playlists(id),
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            sort_order INTEGER NOT NULL,
            sequence INTEGER NOT NULL
        );
        CREATE TABLE playlist_tracks (
            playlist_id TEXT NOT NULL REFERENCES playlists(id),
            track_id TEXT NOT NULL REFERENCES tracks(id),
            position INTEGER NOT NULL,
            PRIMARY KEY (playlist_id, position)
        );
        INSERT INTO library_state VALUES (1, 7, 'm1-source');
        INSERT INTO tracks VALUES (
            'stable-track-id', 'external-1', 'M1 Track', 'Artist', NULL, NULL,
            120000, 'C', 1000, 'available'
        );
        """
    )
    connection.commit()
    connection.close()


class AnalysisDatabaseMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_m1_upgrade_uses_first_free_sibling_backup_before_schema_changes(self):
        """Skipping, overwriting, or post-DDL backup of an M1 database must fail."""
        path = self.root / "library.sqlite3"
        _create_m1_database(path)
        reserved = self.root / "library.pre-m2.sqlite3"
        reserved.write_bytes(b"reserved")

        database = LibraryDatabase(path)
        expected_backup = self.root / "library.pre-m2-2.sqlite3"
        try:
            self.assertEqual(database.migration_backup_path, expected_backup)
            self.assertEqual(reserved.read_bytes(), b"reserved")
            self.assertEqual(database.connection.execute("PRAGMA user_version").fetchone()[0], 2)
            self.assertEqual(database.list_tracks(limit=10).items[0].id, "stable-track-id")
        finally:
            database.close()

        backup = sqlite3.connect(expected_backup)
        try:
            self.assertEqual(
                backup.execute("SELECT id, title FROM tracks").fetchone(),
                ("stable-track-id", "M1 Track"),
            )
            columns = {row[1] for row in backup.execute("PRAGMA table_info(tracks)")}
            self.assertNotIn("source_path", columns)
            self.assertIsNone(
                backup.execute(
                    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'analysis_jobs'"
                ).fetchone()
            )
        finally:
            backup.close()

    def test_new_empty_database_starts_at_v2_without_a_backup(self):
        """Creating a recovery copy for a database with no M1 data must fail."""
        path = self.root / "new.sqlite3"

        database = LibraryDatabase(path)
        try:
            self.assertIsNone(database.migration_backup_path)
            self.assertEqual(database.connection.execute("PRAGMA user_version").fetchone()[0], 2)
            self.assertEqual(list(self.root.glob("new.pre-m2*.sqlite3")), [])
        finally:
            database.close()


class AnalysisDatabaseRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.path = Path(self.temporary_directory.name) / "library.sqlite3"
        self.database = LibraryDatabase(self.path)

    def tearDown(self):
        self.database.close()
        self.temporary_directory.cleanup()

    def _import_ids(self, *external_ids: str) -> dict[str, str]:
        self.database.import_library(_import(*external_ids))
        return {
            item.external_id: item.id
            for item in self.database.list_tracks(limit=200).items
        }

    def test_reimport_preserves_retained_analysis_and_removes_orphans(self):
        """Changing stable-ID retention or omitting orphan cleanup must fail."""
        first_ids = self._import_ids("one", "two")
        for external_id in ("one", "two"):
            track_id = first_ids[external_id]
            self.database.put_analysis_job(
                track_id,
                status="succeeded",
                progress_ppm=1_000_000,
                attempt_count=1,
                error_code=None,
                error_message=None,
                fingerprint=f"fp-{external_id}",
                provider="fake-local",
                provider_version="1.2.3",
                pipeline_version="pipeline-v1",
            )
            self.database.put_track_features(track_id, _features(f"fp-{external_id}"))

        second_ids = self._import_ids("one")

        self.assertEqual(second_ids["one"], first_ids["one"])
        self.assertEqual(
            self.database.analysis_summary(first_ids["one"]).features,
            _features("fp-one"),
        )
        self.assertIsNone(self.database.analysis_summary(first_ids["two"]))
        self.assertEqual(
            self.database.connection.execute("SELECT COUNT(*) FROM analysis_jobs").fetchone()[0],
            1,
        )
        self.assertEqual(
            self.database.connection.execute("SELECT COUNT(*) FROM track_features").fetchone()[0],
            1,
        )

    def test_latest_rows_clamp_progress_and_round_trip_strict_features(self):
        """Duplicate history rows, unbounded progress, or lossy provenance must fail."""
        track_id = self._import_ids("one")["one"]
        first = _features("fp-old", tempo_confidence_ppm=111_111)
        latest = _features(
            "fp-new",
            provider="fake-local-v2",
            provider_version="9.8.7",
            pipeline_version="pipeline-v2",
            tempo_confidence_ppm=987_654,
        )

        self.database.put_analysis_job(
            track_id,
            status="running",
            progress_ppm=-50,
            attempt_count=1,
            error_code=None,
            error_message=None,
            fingerprint="fp-old",
            provider="fake-local",
            provider_version="1.2.3",
            pipeline_version="pipeline-v1",
        )
        self.database.put_track_features(track_id, first)
        self.database.put_analysis_job(
            track_id,
            status="succeeded",
            progress_ppm=1_500_000,
            attempt_count=2,
            error_code=None,
            error_message=None,
            fingerprint="fp-new",
            provider="fake-local-v2",
            provider_version="9.8.7",
            pipeline_version="pipeline-v2",
        )
        self.database.put_track_features(track_id, latest)

        summary = self.database.analysis_summary(track_id)
        self.assertEqual(summary.progress_ppm, 1_000_000)
        self.assertEqual(summary.attempt_count, 2)
        self.assertEqual(summary.features, latest)
        self.assertEqual(summary.features.tempo_confidence_ppm, 987_654)
        self.assertEqual(
            tuple(
                self.database.connection.execute(
                    "SELECT COUNT(*), provider, provider_version, pipeline_version FROM analysis_jobs"
                ).fetchone()
            ),
            (1, "fake-local-v2", "9.8.7", "pipeline-v2"),
        )
        feature_row = self.database.connection.execute(
            "SELECT feature_json, provider, provider_version, pipeline_version FROM track_features"
        ).fetchone()
        self.assertEqual(
            set(json.loads(feature_row["feature_json"])),
            {field.name for field in fields(AnalysisFeatures)},
        )
        self.assertEqual(
            tuple(feature_row[name] for name in ("provider", "provider_version", "pipeline_version")),
            ("fake-local-v2", "9.8.7", "pipeline-v2"),
        )

    def test_malformed_feature_json_is_rejected_instead_of_partially_decoded(self):
        """Accepting missing, extra, or incorrectly typed feature fields must fail."""
        track_id = self._import_ids("one")["one"]
        self.database.put_analysis_job(
            track_id,
            status="succeeded",
            progress_ppm=1_000_000,
            attempt_count=1,
            error_code=None,
            error_message=None,
            fingerprint="fp-one",
            provider="fake-local",
            provider_version="1.2.3",
            pipeline_version="pipeline-v1",
        )
        self.database.put_track_features(track_id, _features("fp-one"))
        self.database.connection.execute(
            "UPDATE track_features SET feature_json = ? WHERE track_id = ?",
            ('{"fingerprint":"fp-one","unexpected":true}', track_id),
        )
        self.database.connection.commit()

        with self.assertRaises(ValueError):
            self.database.analysis_summary(track_id)

    def test_startup_requeues_running_jobs_but_leaves_paused_jobs_paused(self):
        """Losing restart work or silently resuming user-paused work must fail."""
        ids = self._import_ids("running", "paused")
        for external_id, status in (("running", "running"), ("paused", "paused")):
            self.database.put_analysis_job(
                ids[external_id],
                status=status,
                progress_ppm=500_000,
                attempt_count=3,
                error_code=None,
                error_message=None,
                fingerprint=f"fp-{external_id}",
                provider="fake-local",
                provider_version="1.2.3",
                pipeline_version="pipeline-v1",
            )
        self.database.close()

        self.database = LibraryDatabase(self.path)

        self.assertEqual(self.database.analysis_summary(ids["running"]).status, "queued")
        self.assertEqual(self.database.analysis_summary(ids["paused"]).status, "paused")


if __name__ == "__main__":
    unittest.main()
