from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dj_copilot.database import FeedbackWrite, LibraryDatabase
from dj_copilot.discovery import TrackFilters
from dj_copilot.models import ImportedTrack, RekordboxImport
from dj_copilot.set_workflow import DraftPlan, apply_draft_mutation, create_draft


ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "fixtures" / "rekordbox" / "phase0-library.xml"


def create_v2_database(path: Path) -> None:
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
            availability TEXT NOT NULL,
            source_path TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO library_state VALUES (1, 2, 'v2-source');
        INSERT INTO tracks VALUES ('stable-track', '1', 'V2 Track', 'Artist', NULL, NULL, NULL, NULL, NULL, 'available', '/music/v2.mp3');
        PRAGMA user_version = 2;
        """
    )
    connection.close()


class SetDatabaseMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_v2_upgrade_backs_up_before_draft_ddl_and_reaches_current_v4_schema(self):
        path = self.root / "dj-copilot.sqlite3"
        create_v2_database(path)
        reserved = self.root / "dj-copilot.pre-m4.sqlite3"
        reserved.write_bytes(b"reserved")

        database = LibraryDatabase(path)
        try:
            backup_path = self.root / "dj-copilot.pre-m4-2.sqlite3"
            self.assertEqual(database.migration_backup_path, backup_path)
            self.assertEqual(database.connection.execute("PRAGMA user_version").fetchone()[0], 4)
            self.assertEqual(
                {
                    row[0]
                    for row in database.connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'set_draft%'"
                    )
                },
                {"set_drafts", "set_draft_revisions", "set_draft_versions"},
            )
            state_columns = {row[1] for row in database.connection.execute("PRAGMA table_info(library_state)")}
            self.assertIn("source_path", state_columns)
            self.assertEqual(database.list_tracks(limit=10).items[0].id, "stable-track")
        finally:
            database.close()

        backup = sqlite3.connect(backup_path)
        try:
            self.assertEqual(backup.execute("PRAGMA user_version").fetchone()[0], 2)
            self.assertNotIn("source_path", {row[1] for row in backup.execute("PRAGMA table_info(library_state)")})
            self.assertIsNone(backup.execute("SELECT 1 FROM sqlite_master WHERE name = 'set_drafts'").fetchone())
        finally:
            backup.close()

    def test_v4_reopen_never_creates_another_backup_and_versions_above_v4_fail_closed(self):
        path = self.root / "dj-copilot.sqlite3"
        create_v2_database(path)
        first = LibraryDatabase(path)
        first.close()
        backups = list(self.root.glob("dj-copilot.pre-m4*.sqlite3"))

        reopened = LibraryDatabase(path)
        try:
            self.assertIsNone(reopened.migration_backup_path)
            self.assertEqual(list(self.root.glob("dj-copilot.pre-m4*.sqlite3")), backups)
        finally:
            reopened.close()

        connection = sqlite3.connect(path)
        connection.execute("PRAGMA user_version = 5")
        connection.close()
        with self.assertRaisesRegex(RuntimeError, "newer than supported version 4"):
            LibraryDatabase(path)
        self.assertEqual(list(self.root.glob("dj-copilot.pre-m4*.sqlite3")), backups)

    def test_import_path_persists_canonical_private_source_and_direct_import_clears_it(self):
        database = LibraryDatabase(self.root / "library.sqlite3")
        try:
            database.import_path(FIXTURE)
            self.assertEqual(database.get_import_source_path(), FIXTURE.resolve())

            database.import_library(
                RekordboxImport(
                    source_sha256="a" * 64,
                    tracks=(
                        ImportedTrack("1", "Fixture", None, None, None, None, None, None, "/not/opened.mp3", "missing"),
                    ),
                    playlists=(),
                )
            )
            self.assertIsNone(database.get_import_source_path())
        finally:
            database.close()


class SetDraftHistoryRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database = LibraryDatabase(Path(self.temporary_directory.name) / "library.sqlite3")
        self.database.import_library(
            RekordboxImport(
                source_sha256="b" * 64,
                tracks=(
                    ImportedTrack("1", "First", "Artist One", None, "House", 120_000, "8A", 180_000, "/missing/one.mp3", "available"),
                    ImportedTrack("2", "Second", "Artist Two", None, "House", 122_000, "8B", 181_000, "/missing/two.mp3", "available"),
                ),
                playlists=(),
            )
        )
        self.catalog, _ = self.database.discovery_catalog()
        self.track_ids = [item.track.id for item in self.catalog]
        self.state = create_draft(
            "Initial Set",
            DraftPlan(intent="smooth", candidate_filters=TrackFilters()),
            tuple(self.track_ids),
            self.catalog,
            allow_repeated_tracks=False,
        )

    def tearDown(self):
        self.database.close()
        self.temporary_directory.cleanup()

    def test_append_undo_redo_branch_and_historical_content_revision_are_atomic(self):
        created = self.database.create_set_draft(self.state)
        renamed = apply_draft_mutation(self.state, {"type": "rename", "title": "Renamed"}, self.catalog)
        second = self.database.append_set_draft_revision(created.id, 1, renamed, "rename")
        undo = self.database.undo_set_draft(created.id, 2)
        branched = apply_draft_mutation(self.state, {"type": "rename", "title": "Branched"}, self.catalog)
        third = self.database.append_set_draft_revision(created.id, 1, branched, "rename")
        historical = self.database.get_set_draft(created.id, revision=1)

        self.assertEqual((created.current_revision, second.current_revision), (1, 2))
        self.assertEqual((undo.current_revision, undo.redo_tip_revision), (1, 2))
        self.assertEqual((third.current_revision, third.redo_tip_revision), (3, None))
        self.assertEqual((historical.current_revision, historical.content_revision, historical.state.title), (3, 1, "Initial Set"))
        self.assertIsNone(self.database.redo_set_draft(created.id, 3))

    def test_conflict_and_saved_version_restore_preserve_history(self):
        created = self.database.create_set_draft(self.state)
        saved = self.database.save_set_draft_version(created.id, 1, "Baseline")
        renamed = apply_draft_mutation(self.state, {"type": "rename", "title": "Renamed"}, self.catalog)
        updated = self.database.append_set_draft_revision(created.id, 1, renamed, "rename")
        restored = self.database.restore_set_draft_version(created.id, 2, saved.version)

        self.assertIsNone(self.database.append_set_draft_revision(created.id, 1, renamed, "rename"))
        self.assertEqual((saved.version, saved.revision, updated.current_revision), (1, 1, 2))
        self.assertEqual((restored.current_revision, restored.state.title), (3, "Initial Set"))
        self.assertEqual([(item.version, item.revision, item.label) for item in self.database.list_set_draft_versions(created.id)], [(1, 1, "Baseline")])

    def test_restoring_an_identical_saved_head_still_appends_an_undoable_revision(self):
        created = self.database.create_set_draft(self.state)
        saved = self.database.save_set_draft_version(created.id, 1, "Baseline")
        restored = self.database.restore_set_draft_version(created.id, 1, saved.version)

        self.assertEqual((restored.current_revision, restored.state), (2, self.state))
        self.assertEqual(self.database.set_draft_history_capabilities(created.id), (True, False))
        undone = self.database.undo_set_draft(created.id, 2)
        self.assertEqual((undone.current_revision, undone.state), (1, self.state))

    def test_saved_versions_are_bounded_to_100(self):
        created = self.database.create_set_draft(self.state)

        for index in range(100):
            saved = self.database.save_set_draft_version(created.id, 1, f"Version {index + 1}")
            self.assertIsNotNone(saved)

        with self.assertRaisesRegex(Exception, "100 saved versions"):
            self.database.save_set_draft_version(created.id, 1, "Version 101")
        self.assertEqual(len(self.database.list_set_draft_versions(created.id)), 100)

    def test_revision_feedback_is_atomic_and_absent_for_conflicts_and_no_ops(self):
        created = self.database.create_set_draft(self.state)
        moved = apply_draft_mutation(
            self.state,
            {
                "type": "move_entry",
                "entry_id": self.state.entries[0].id,
                "to_index": 1,
            },
            self.catalog,
        )
        feedback = FeedbackWrite(
            "manual_reorder",
            self.state.entries[0].track_id,
            draft_id=created.id,
            old_index=0,
            new_index=1,
        )

        updated = self.database.append_set_draft_revision(
            created.id,
            1,
            moved,
            "move_entry",
            feedback=(feedback,),
        )
        conflict = self.database.append_set_draft_revision(
            created.id,
            1,
            moved,
            "move_entry",
            feedback=(feedback,),
        )
        no_op = self.database.append_set_draft_revision(
            created.id,
            2,
            moved,
            "move_entry",
            feedback=(feedback,),
        )

        self.assertEqual((updated.current_revision, no_op.current_revision), (2, 2))
        self.assertIsNone(conflict)
        self.assertEqual(
            self.database.connection.execute(
                "SELECT COUNT(*) FROM user_feedback"
            ).fetchone()[0],
            1,
        )

        renamed = apply_draft_mutation(
            moved,
            {"type": "rename", "title": "Must roll back"},
            self.catalog,
        )
        with self.assertRaises(Exception):
            self.database.append_set_draft_revision(
                created.id,
                2,
                renamed,
                "rename",
                feedback=(
                    FeedbackWrite(
                        "manual_reorder",
                        "removed-track",
                        draft_id=created.id,
                        old_index=0,
                        new_index=1,
                    ),
                ),
            )
        head = self.database.get_set_draft(created.id)
        self.assertEqual((head.current_revision, head.state), (2, moved))
        self.assertEqual(
            self.database.connection.execute(
                "SELECT COUNT(*) FROM set_draft_revisions WHERE draft_id = ?",
                (created.id,),
            ).fetchone()[0],
            2,
        )
        self.assertEqual(
            self.database.connection.execute(
                "SELECT COUNT(*) FROM user_feedback"
            ).fetchone()[0],
            1,
        )



if __name__ == "__main__":
    unittest.main()
