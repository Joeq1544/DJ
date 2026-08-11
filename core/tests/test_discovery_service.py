from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dj_copilot.analysis.provider import AnalysisFeatures
import dj_copilot.database as database_module
from dj_copilot.database import LibraryDatabase
from dj_copilot.discovery import TrackFilters
from dj_copilot.models import ImportedPlaylist, ImportedTrack, RekordboxImport
from dj_copilot.service import RequestError, _dispatch, _validate_request


def _feature(
    fingerprint: str,
    *,
    bpm_milli: int,
    musical_key: str,
    mode: str,
    energy_ppm: int,
    tempo_confidence_ppm: int = 800_000,
    key_confidence_ppm: int = 800_000,
) -> AnalysisFeatures:
    return AnalysisFeatures(
        fingerprint=fingerprint,
        file_size=1_024,
        mtime_ns=123,
        codec="pcm_s16le",
        container="wav",
        duration_ms=180_000,
        sample_rate_hz=44_100,
        channels=2,
        bpm_milli=bpm_milli,
        tempo_confidence_ppm=tempo_confidence_ppm,
        tempo_candidates_milli=(bpm_milli,),
        onset_count=64,
        beat_strength_ppm=600_000,
        musical_key=musical_key,
        mode=mode,
        key_confidence_ppm=key_confidence_ppm,
        rms_milli_dbfs=-12_000,
        peak_milli_dbfs=-1_000,
        crest_factor_milli_db=11_000,
        energy_ppm=energy_ppm,
        dynamic_range_milli_db=8_000,
        onset_rate_milli_hz=2_000,
        spectral_centroid_hz=2_000,
        brightness_ppm=500_000,
        energy_curve_ppm=(energy_ppm,) * 16,
        provider="ffmpeg-numpy-basic",
        provider_version="ffmpeg 8.1.2; ffprobe 8.1.2; numpy 2.4.4",
        pipeline_version="baseline-v1",
        limitations=("Generated M3 fixture evidence.",),
    )


def _library() -> RekordboxImport:
    tracks = (
        ImportedTrack("seed", "Neón Seed", "Fixture Artist", "M3", "House", 90_000, "8B", 180_000, "/fixtures/seed.wav", "available"),
        ImportedTrack("smooth", "A Smooth Match", "Fixture Artist", "M3", "House", 119_000, "9B", 182_000, "/fixtures/smooth.wav", "available"),
        ImportedTrack("build", "Build Lift", "Another Artist", "M3", "House", 121_000, "8B", 183_000, "/fixtures/build.wav", "available"),
        ImportedTrack("bridge", "Genre Bridge", "Otro Artista", "M3", "Disco", 120_000, "8A", 184_000, "/fixtures/bridge.wav", "available"),
        ImportedTrack("failed", "Failed Read", "Fixture Artist", "M3", "House", 120_000, "8B", 185_000, "/fixtures/failed.wav", "available"),
        ImportedTrack("missing", "Missing File", "Fixture Artist", "M3", "House", 120_000, "8B", 186_000, "/fixtures/missing.wav", "missing"),
    )
    playlists = (
        ImportedPlaylist("playlist:root", None, "Root", "folder", 0, ()),
        ImportedPlaylist("playlist:m3", "playlist:root", "M3 Order", "playlist", 0, ("build", "seed", "smooth", "bridge", "missing")),
    )
    return RekordboxImport("d" * 64, tracks, playlists)


class DiscoveryRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database = LibraryDatabase(Path(self.temporary_directory.name) / "library.sqlite3")
        self.database.import_library(_library())
        self.track_ids = {
            track.external_id: track.id for track in self.database.list_tracks(limit=100).items
        }
        for external_id, bpm, key, mode, energy in (
            ("seed", 120_000, "C", "major", 500_000),
            ("smooth", 120_000, "G", "major", 520_000),
            ("build", 122_000, "C", "major", 670_000),
            ("bridge", 120_000, "A", "minor", 540_000),
        ):
            track_id = self.track_ids[external_id]
            features = _feature(
                external_id[0] * 64,
                bpm_milli=bpm,
                musical_key=key,
                mode=mode,
                energy_ppm=energy,
            )
            self.database.put_analysis_job(
                track_id,
                status="succeeded",
                progress_ppm=1_000_000,
                attempt_count=1,
                error_code=None,
                error_message=None,
                fingerprint=features.fingerprint,
                provider=features.provider,
                provider_version=features.provider_version,
                pipeline_version=features.pipeline_version,
            )
            self.database.put_track_features(track_id, features)
        failed_id = self.track_ids["failed"]
        self.database.put_analysis_job(
            failed_id,
            status="failed",
            progress_ppm=100_000,
            attempt_count=1,
            error_code="decode_failed",
            error_message="Generated fixture failure.",
            fingerprint=None,
            provider="ffmpeg-numpy-basic",
            provider_version="ffmpeg 8.1.2; ffprobe 8.1.2; numpy 2.4.4",
            pipeline_version="baseline-v1",
        )

    def tearDown(self):
        self.database.close()
        self.temporary_directory.cleanup()

    def test_search_uses_one_batched_projection_and_pages_filtered_playlist_order(self):
        playlist = next(node for node in self.database.get_playlist_tree() if node.name == "M3 Order")
        filters = TrackFilters(
            text="m3 house",
            playlist_id=playlist.id,
            bpm_min_milli=119_000,
            bpm_max_milli=123_000,
            energy_min_ppm=500_000,
            energy_max_ppm=700_000,
            analysis_state="analyzed",
            availability="available",
        )

        with patch.object(self.database, "analysis_summary", side_effect=AssertionError("N+1 summary")):
            first = self.database.search_track_evidence(filters, limit=2)
            second = self.database.search_track_evidence(filters, limit=2, cursor=first.next_cursor)

        self.assertEqual(
            [item.track.external_id for item in first.items],
            ["build", "seed"],
        )
        self.assertEqual([item.track.external_id for item in second.items], ["smooth"])
        self.assertIsNone(second.next_cursor)
        self.assertFalse(first.truncated)
        self.assertEqual(first.items[0].analysis.status, "succeeded")
        self.assertFalse(hasattr(first.items[0].track, "source_path"))
        self.assertIn(playlist.id, first.items[0].playlist_ids)

    def test_analysis_and_availability_filter_mapping_is_exhaustive(self):
        expected = {
            "any": {"seed", "smooth", "build", "bridge", "failed", "missing"},
            "analyzed": {"seed", "smooth", "build", "bridge"},
            "not_analyzed": {"failed", "missing"},
            "failed": {"failed"},
        }
        for state, external_ids in expected.items():
            with self.subTest(state=state):
                page = self.database.search_track_evidence(TrackFilters(analysis_state=state), limit=100)
                self.assertEqual({item.track.external_id for item in page.items}, external_ids)

        for availability in ("available", "missing", "unreadable"):
            with self.subTest(availability=availability):
                page = self.database.search_track_evidence(
                    TrackFilters(availability=availability), limit=100
                )
                self.assertTrue(all(item.track.availability == availability for item in page.items))

    def test_scan_cap_is_reported_without_schema_change(self):
        with patch.object(database_module, "DISCOVERY_SCAN_LIMIT", 2):
            page = self.database.search_track_evidence(TrackFilters(), limit=100)
        self.assertEqual(len(page.items), 2)
        self.assertTrue(page.truncated)
        self.assertEqual(self.database.connection.execute("PRAGMA user_version").fetchone()[0], 2)


class DiscoveryRequestAndDispatchTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database = LibraryDatabase(Path(self.temporary_directory.name) / "library.sqlite3")
        self.database.import_library(_library())
        self.track_ids = {
            track.external_id: track.id for track in self.database.list_tracks(limit=100).items
        }

    def tearDown(self):
        self.database.close()
        self.temporary_directory.cleanup()

    def test_list_and_discovery_payloads_are_strict_and_cross_field_validated(self):
        valid = (
            ("list_tracks", {"text": "neón", "bpmMinMilli": 90_000, "bpmMaxMilli": 130_000}),
            ("find_similar_tracks", {"seedTrackId": self.track_ids["seed"], "limit": 5}),
            ("recommend_next_tracks", {"seedTrackId": self.track_ids["seed"], "intent": "smooth", "filters": {"availability": "any"}}),
        )
        for index, (command, payload) in enumerate(valid):
            self.assertEqual(
                _validate_request({"version": 1, "id": f"valid-{index}", "command": command, "payload": payload})[1],
                command,
            )

        invalid = (
            ("list_tracks", {"bpmMinMilli": 130_000, "bpmMaxMilli": 90_000}),
            ("list_tracks", {"musicalKey": "8B", "keyRelation": "wrong"}),
            ("list_tracks", {"text": ""}),
            ("find_similar_tracks", {"seedTrackId": "seed", "limit": 21}),
            ("find_similar_tracks", {"seedTrackId": "seed", "extra": True}),
            ("recommend_next_tracks", {"seedTrackId": "seed", "intent": "invented"}),
            ("recommend_next_tracks", {"seedTrackId": "seed", "intent": "smooth", "filters": {"cursor": "no"}}),
        )
        for index, (command, payload) in enumerate(invalid):
            with self.subTest(command=command, payload=payload):
                with self.assertRaises(RequestError):
                    _validate_request({"version": 1, "id": f"invalid-{index}", "command": command, "payload": payload})

    def test_dispatch_returns_path_free_literal_discovery_shapes(self):
        seed_id = self.track_ids["seed"]
        page = _dispatch("list_tracks", {"text": "neón", "limit": 10}, self.database, object())
        similar = _dispatch(
            "find_similar_tracks",
            {"seedTrackId": seed_id, "limit": 3},
            self.database,
            object(),
        )
        recommended = _dispatch(
            "recommend_next_tracks",
            {"seedTrackId": seed_id, "intent": "singalong_continuation", "limit": 3},
            self.database,
            object(),
        )

        self.assertEqual(set(page), {"items", "nextCursor", "truncated"})
        self.assertFalse(page["truncated"])
        self.assertEqual(
            set(similar),
            {"seed", "algorithmVersion", "scannedCount", "truncated", "items"},
        )
        self.assertEqual(similar["algorithmVersion"], "feature-similarity-v1")
        self.assertEqual(
            set(recommended),
            {"seed", "intent", "algorithmVersion", "scannedCount", "truncated", "items"},
        )
        self.assertEqual(recommended["algorithmVersion"], "transition-v1")
        self.assertEqual(recommended["intent"], "singalong_continuation")
        self.assertTrue(
            any(component["effect"] == "missing" for item in recommended["items"] for component in item["components"])
        )
        self.assertNotIn("/fixtures/", json.dumps((page, similar, recommended)))

    def test_unknown_seed_is_not_an_empty_success(self):
        with self.assertRaises(RequestError) as raised:
            _dispatch(
                "find_similar_tracks",
                {"seedTrackId": "removed-track", "limit": 10},
                self.database,
                object(),
            )
        self.assertEqual(raised.exception.code, "not_found")


if __name__ == "__main__":
    unittest.main()
