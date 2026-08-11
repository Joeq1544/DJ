from pathlib import Path
from dataclasses import asdict
import json
import sqlite3
import sys
import tempfile
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dj_copilot.database import (
    FeedbackWrite,
    LibraryDatabase,
    PreferenceExportRecord,
    PreferenceResetRecord,
    SavedFilterRecord,
    TrackUserMetadata,
)
from dj_copilot.discovery import TrackFilters
from dj_copilot.models import ImportedTrack, RekordboxImport
from dj_copilot.personalization import PreferenceProfile
from dj_copilot.rekordbox_xml import RekordboxImportError


def _create_v3_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE library_state (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            revision INTEGER NOT NULL,
            source_sha256 TEXT NOT NULL,
            source_path TEXT
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
            availability TEXT NOT NULL,
            source_path TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO library_state VALUES (1, 3, 'v3-source', NULL);
        INSERT INTO tracks VALUES (
            'stable-track', '1', 'V3 Track', 'Artist', NULL, 'House',
            120000, '8A', 180000, 'available', '/music/v3.mp3'
        );
        PRAGMA user_version = 3;
        """
    )
    connection.close()


def _library(*external_ids: str) -> RekordboxImport:
    return RekordboxImport(
        source_sha256=(external_ids[0] if external_ids else "0").rjust(64, "a")[-64:],
        tracks=tuple(
            ImportedTrack(
                external_id,
                f"Track {external_id}",
                f"Artist {external_id}",
                None,
                "House" if index < 2 else "Techno",
                120_000 + index * 1_000,
                "8A",
                180_000,
                f"/missing/{external_id}.mp3",
                "available",
            )
            for index, external_id in enumerate(external_ids)
        ),
        playlists=(),
    )


class PersonalizationMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_v3_upgrade_backs_up_before_v4_ddl_and_adds_exact_three_tables(self):
        path = self.root / "dj-copilot.sqlite3"
        _create_v3_database(path)
        reserved = self.root / "dj-copilot.pre-m5.sqlite3"
        reserved.write_bytes(b"reserved")

        database = LibraryDatabase(path)
        try:
            backup_path = self.root / "dj-copilot.pre-m5-2.sqlite3"
            self.assertEqual(database.migration_backup_path, backup_path)
            self.assertEqual(database.connection.execute("PRAGMA user_version").fetchone()[0], 4)
            self.assertEqual(
                {
                    row[0]
                    for row in database.connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table' "
                        "AND name IN ('track_user_metadata','saved_filters','user_feedback')"
                    )
                },
                {"track_user_metadata", "saved_filters", "user_feedback"},
            )
            self.assertEqual(
                [row[1] for row in database.connection.execute("PRAGMA table_info(track_user_metadata)")],
                ["track_id", "rating", "note", "tags_json", "updated_at"],
            )
            self.assertEqual(
                [row[1] for row in database.connection.execute("PRAGMA table_info(saved_filters)")],
                ["id", "name", "filter_json", "created_at", "updated_at"],
            )
            self.assertEqual(
                [row[1] for row in database.connection.execute("PRAGMA table_info(user_feedback)")],
                [
                    "id",
                    "event_type",
                    "track_id",
                    "related_track_id",
                    "seed_track_id",
                    "intent",
                    "draft_id",
                    "old_index",
                    "new_index",
                    "created_at",
                ],
            )
            for table in ("track_user_metadata", "saved_filters", "user_feedback"):
                self.assertEqual(list(database.connection.execute(f"PRAGMA foreign_key_list({table})")), [])
        finally:
            database.close()

        backup = sqlite3.connect(backup_path)
        try:
            self.assertEqual(backup.execute("PRAGMA user_version").fetchone()[0], 3)
            self.assertIsNone(
                backup.execute(
                    "SELECT 1 FROM sqlite_master WHERE name = 'track_user_metadata'"
                ).fetchone()
            )
            self.assertEqual(backup.execute("SELECT title FROM tracks").fetchone()[0], "V3 Track")
        finally:
            backup.close()

    def test_new_v4_and_reopen_create_no_backup_while_future_versions_fail_closed(self):
        path = self.root / "library.sqlite3"
        first = LibraryDatabase(path)
        self.assertIsNone(first.migration_backup_path)
        self.assertEqual(first.connection.execute("PRAGMA user_version").fetchone()[0], 4)
        first.close()

        reopened = LibraryDatabase(path)
        self.assertIsNone(reopened.migration_backup_path)
        reopened.close()
        self.assertEqual(list(self.root.glob("*.pre-m5*.sqlite3")), [])

        connection = sqlite3.connect(path)
        connection.execute("PRAGMA user_version = 5")
        connection.close()
        with self.assertRaisesRegex(RuntimeError, "newer than supported version 4"):
            LibraryDatabase(path)
        self.assertEqual(list(self.root.glob("*.pre-m5*.sqlite3")), [])


class MetadataAndSavedFilterRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.path = Path(self.temporary_directory.name) / "library.sqlite3"
        self.database = LibraryDatabase(self.path)
        self.database.import_library(_library("1", "2", "3"))
        self.ids = {
            item.external_id: item.id for item in self.database.list_tracks(limit=10).items
        }

    def tearDown(self):
        self.database.close()
        self.temporary_directory.cleanup()

    def test_metadata_normalizes_persists_filters_and_invalidates_existing_cursor(self):
        first_page = self.database.search_track_evidence(TrackFilters(), limit=1)
        self.assertIsNotNone(first_page.next_cursor)

        saved = self.database.update_track_metadata(
            self.ids["1"],
            rating=4,
            tags=("  Cafe\u0301  ", "CAFÉ", "Peak Time"),
            note="  Golden bridge  ",
        )
        matched = self.database.search_track_evidence(
            TrackFilters(text="golden peak", rating_min=4, tag="Peak Time"),
            limit=10,
        )

        self.assertIsInstance(saved, TrackUserMetadata)
        self.assertEqual((saved.rating, saved.tags, saved.note), (4, ("Café", "Peak Time"), "Golden bridge"))
        self.assertEqual([item.track.id for item in matched.items], [self.ids["1"]])
        with self.assertRaises(RekordboxImportError) as stale:
            self.database.search_track_evidence(
                TrackFilters(),
                limit=1,
                cursor=first_page.next_cursor,
            )
        self.assertEqual(stale.exception.code, "invalid_cursor")

        self.database.close()
        self.database = LibraryDatabase(self.path)
        self.assertEqual(self.database.get_track_metadata(self.ids["1"]), saved)

    def test_reimport_retains_current_metadata_cleans_removed_rows_and_empty_update_deletes(self):
        retained = self.database.update_track_metadata(
            self.ids["1"], rating=5, tags=("Keeper",), note="Keep me"
        )
        self.database.update_track_metadata(
            self.ids["2"], rating=1, tags=("Remove",), note="Remove me"
        )

        self.database.import_library(_library("1", "4"))

        self.assertEqual(self.database.get_track_metadata(self.ids["1"]), retained)
        self.assertEqual(
            self.database.connection.execute(
                "SELECT COUNT(*) FROM track_user_metadata"
            ).fetchone()[0],
            1,
        )
        cleared = self.database.update_track_metadata(
            self.ids["1"], rating=None, tags=(), note=None
        )
        self.assertEqual((cleared.rating, cleared.tags, cleared.note), (None, (), None))
        self.assertEqual(
            self.database.connection.execute(
                "SELECT COUNT(*) FROM track_user_metadata"
            ).fetchone()[0],
            0,
        )

    def test_metadata_rejects_unknown_tracks_and_out_of_bounds_values(self):
        invalid_calls = (
            lambda: self.database.update_track_metadata(
                "removed", rating=4, tags=(), note=None
            ),
            lambda: self.database.update_track_metadata(
                self.ids["1"], rating=True, tags=(), note=None
            ),
            lambda: self.database.update_track_metadata(
                self.ids["1"], rating=6, tags=(), note=None
            ),
            lambda: self.database.update_track_metadata(
                self.ids["1"], rating=None, tags=tuple(str(index) for index in range(21)), note=None
            ),
            lambda: self.database.update_track_metadata(
                self.ids["1"], rating=None, tags=("x" * 41,), note=None
            ),
            lambda: self.database.update_track_metadata(
                self.ids["1"], rating=None, tags=(), note="x" * 2_001
            ),
        )
        for call in invalid_calls:
            with self.subTest(call=call), self.assertRaises(RekordboxImportError):
                call()

    def test_saved_filters_crud_is_normalized_case_unique_persistent_and_bounded(self):
        created = self.database.save_saved_filter(
            None,
            "  Peak tracks  ",
            TrackFilters(rating_min=4, tag="Peak Time"),
        )
        updated = self.database.save_saved_filter(
            created.id,
            "Peak selection",
            TrackFilters(rating_min=5, tag="Peak Time"),
        )

        self.assertIsInstance(created, SavedFilterRecord)
        self.assertEqual(created.name, "Peak tracks")
        self.assertEqual(updated.id, created.id)
        self.assertEqual(updated.created_at, created.created_at)
        self.assertNotEqual(updated.updated_at, created.updated_at)
        self.assertEqual(self.database.list_saved_filters(), (updated,))
        with self.assertRaises(RekordboxImportError):
            self.database.save_saved_filter(None, "PEAK SELECTION", TrackFilters())

        self.database.close()
        self.database = LibraryDatabase(self.path)
        self.assertEqual(self.database.list_saved_filters(), (updated,))
        self.database.delete_saved_filter(updated.id)
        self.assertEqual(self.database.list_saved_filters(), ())

        for index in range(50):
            self.database.save_saved_filter(None, f"Filter {index:02d}", TrackFilters())
        with self.assertRaises(RekordboxImportError) as capped:
            self.database.save_saved_filter(None, "Filter 51", TrackFilters())
        self.assertEqual(capped.exception.code, "saved_filter_limit")


class FeedbackAndPreferenceRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.path = Path(self.temporary_directory.name) / "library.sqlite3"
        self.database = LibraryDatabase(self.path)
        self.database.import_library(_library("1", "2", "3"))
        self.ids = {
            item.external_id: item.id for item in self.database.list_tracks(limit=10).items
        }

    def tearDown(self):
        self.database.close()
        self.temporary_directory.cleanup()

    def test_feedback_projects_an_active_profile_and_embeds_current_candidate_evidence(self):
        writes = (
            FeedbackWrite("liked", self.ids["1"]),
            FeedbackWrite(
                "accepted",
                self.ids["1"],
                seed_track_id=self.ids["2"],
                intent="smooth",
            ),
            FeedbackWrite("disliked", self.ids["2"]),
            FeedbackWrite(
                "manual_replacement",
                self.ids["2"],
                related_track_id=self.ids["3"],
                draft_id="draft-1",
                old_index=1,
                new_index=1,
            ),
        )
        for write in writes:
            profile = self.database.record_feedback(write)

        catalog, truncated = self.database.discovery_catalog()
        by_id = {item.track.id: item for item in catalog}
        counts = {item.event_type: item.count for item in profile.event_counts}

        self.assertIsInstance(profile, PreferenceProfile)
        self.assertEqual(profile.total_personal_data_count, 4)
        self.assertEqual(profile.effective_evidence_count, 5)
        self.assertEqual((profile.status, profile.preference_weight_ppm), ("active", 15_000))
        self.assertEqual(
            (counts["liked"], counts["accepted"], counts["disliked"], counts["manual_replacement"]),
            (1, 1, 1, 1),
        )
        self.assertFalse(truncated)
        self.assertTrue(all(item.preference is not None for item in by_id.values()))
        self.assertEqual(
            self.database.connection.execute("SELECT COUNT(*) FROM user_feedback").fetchone()[0],
            4,
        )
        stored = self.database.connection.execute(
            """
            SELECT event_type, track_id, related_track_id, seed_track_id, intent,
                   draft_id, old_index, new_index
            FROM user_feedback WHERE event_type = 'manual_replacement'
            """
        ).fetchone()
        self.assertEqual(
            tuple(stored),
            (
                "manual_replacement",
                self.ids["2"],
                self.ids["3"],
                None,
                None,
                "draft-1",
                1,
                1,
            ),
        )

    def test_new_feedback_requires_current_ids_and_the_exact_public_or_internal_shape(self):
        invalid = (
            FeedbackWrite("liked", "removed"),
            FeedbackWrite("liked", self.ids["1"], seed_track_id=self.ids["2"]),
            FeedbackWrite("accepted", self.ids["1"]),
            FeedbackWrite(
                "accepted", self.ids["1"], seed_track_id="removed", intent="smooth"
            ),
            FeedbackWrite(
                "manual_replacement",
                self.ids["1"],
                related_track_id=None,
                draft_id="draft",
                old_index=0,
                new_index=0,
            ),
            FeedbackWrite(
                "manual_reorder",
                self.ids["1"],
                draft_id="draft",
                old_index=None,
                new_index=1,
            ),
            FeedbackWrite("unknown", self.ids["1"]),
        )

        for write in invalid:
            with self.subTest(write=write), self.assertRaises(RekordboxImportError):
                self.database.record_feedback(write)
        self.assertEqual(
            self.database.connection.execute("SELECT COUNT(*) FROM user_feedback").fetchone()[0],
            0,
        )

    def test_stale_feedback_is_retained_but_ignored_after_reimport(self):
        self.database.record_feedback(FeedbackWrite("liked", self.ids["2"]))
        before = self.database.get_preference_profile()

        self.database.import_library(_library("1", "3"))
        after = self.database.get_preference_profile()

        self.assertEqual(before.effective_evidence_count, 1)
        self.assertEqual(after.total_personal_data_count, 1)
        self.assertEqual(after.effective_evidence_count, 0)
        self.assertEqual(after.status, "baseline")
        self.assertEqual(
            self.database.connection.execute("SELECT COUNT(*) FROM user_feedback").fetchone()[0],
            1,
        )
        self.assertNotIn(
            self.ids["2"],
            {item.track_id for item in after.track_affinities},
        )

    def test_reset_clears_feedback_and_ratings_but_preserves_other_app_owned_state(self):
        self.database.update_track_metadata(
            self.ids["1"], rating=5, tags=("Keeper",), note="Keep this note"
        )
        self.database.update_track_metadata(
            self.ids["2"], rating=1, tags=(), note=None
        )
        saved_filter = self.database.save_saved_filter(None, "Keep filter", TrackFilters(tag="Keeper"))
        self.database.record_feedback(FeedbackWrite("liked", self.ids["1"]))
        tracks_before = self.database.list_tracks(limit=10).items

        reset = self.database.reset_preferences()

        self.assertIsInstance(reset, PreferenceResetRecord)
        self.assertEqual((reset.cleared_feedback_count, reset.cleared_rating_count), (1, 2))
        self.assertEqual((reset.profile.status, reset.profile.effective_evidence_count), ("baseline", 0))
        retained = self.database.get_track_metadata(self.ids["1"])
        cleared_only_rating = self.database.get_track_metadata(self.ids["2"])
        self.assertEqual((retained.rating, retained.tags, retained.note), (None, ("Keeper",), "Keep this note"))
        self.assertEqual((cleared_only_rating.rating, cleared_only_rating.tags, cleared_only_rating.note), (None, (), None))
        self.assertEqual(self.database.list_saved_filters(), (saved_filter,))
        self.assertEqual(self.database.list_tracks(limit=10).items, tracks_before)
        self.assertEqual(self.database.connection.execute("SELECT COUNT(*) FROM user_feedback").fetchone()[0], 0)

    def test_private_export_is_bounded_path_free_and_contains_no_authored_metadata(self):
        self.database.update_track_metadata(
            self.ids["1"], rating=5, tags=("Secret tag",), note="Private note"
        )
        for _ in range(5):
            self.database.record_feedback(FeedbackWrite("liked", self.ids["1"]))

        exported = self.database.get_preference_export()
        serialized = json.dumps(asdict(exported), sort_keys=True)

        self.assertIsInstance(exported, PreferenceExportRecord)
        self.assertEqual(exported.format, "dj-copilot-preferences-v1")
        self.assertEqual(exported.rating_count, 1)
        self.assertEqual(exported.profile.status, "active")
        self.assertLessEqual(len(exported.profile.track_affinities), 50)
        self.assertLessEqual(len(exported.profile.genre_affinities), 50)
        for forbidden in (
            "/missing",
            "source_path",
            "external_id",
            "Private note",
            "Secret tag",
            "Track 1",
            "Artist 1",
            "credential",
        ):
            self.assertNotIn(forbidden, serialized)


if __name__ == "__main__":
    unittest.main()
