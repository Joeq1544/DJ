from pathlib import Path
import os
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dj_copilot.database import LibraryDatabase
from dj_copilot.rekordbox_xml import RekordboxImportError, parse_rekordbox_xml


ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "fixtures" / "rekordbox" / "phase0-library.xml"


class LibraryDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database = LibraryDatabase(Path(self.temporary_directory.name) / "library.sqlite3")
        self.imported = parse_rekordbox_xml(FIXTURE)

    def tearDown(self):
        self.database.close()
        self.temporary_directory.cleanup()

    def test_failed_path_import_preserves_existing_library(self):
        first = self.database.import_library(self.imported)
        before = self.database.list_tracks(limit=100)
        invalid_path = Path(self.temporary_directory.name) / "invalid.xml"
        invalid_path.write_text('<!DOCTYPE x><DJ_PLAYLISTS Version="1.0.0"/>', encoding="utf-8")

        with self.assertRaises(RekordboxImportError) as raised:
            self.database.import_path(invalid_path)

        self.assertEqual(first.imported_tracks, 4)
        self.assertEqual(raised.exception.code, "dtd_not_allowed")
        self.assertEqual(self.database.list_tracks(limit=100), before)

    def test_reimport_keeps_track_and_playlist_ids_and_advances_revision_once(self):
        first = self.database.import_library(self.imported)
        first_tracks = self.database.list_tracks(limit=100).items
        first_playlists = self.database.get_playlist_tree()

        second = self.database.import_library(self.imported)
        second_tracks = self.database.list_tracks(limit=100).items
        second_playlists = self.database.get_playlist_tree()

        self.assertEqual((first.revision, second.revision), (1, 2))
        self.assertEqual(first.imported_playlists, 4)
        self.assertEqual(
            [(track.external_id, track.id) for track in first_tracks],
            [(track.external_id, track.id) for track in second_tracks],
        )
        self.assertEqual(
            [(playlist.import_key, playlist.id) for playlist in first_playlists],
            [(playlist.import_key, playlist.id) for playlist in second_playlists],
        )

    def test_playlist_track_page_preserves_membership_order(self):
        self.database.import_library(self.imported)
        opening = next(playlist for playlist in self.database.get_playlist_tree() if playlist.name == "Opening")
        closer = next(playlist for playlist in self.database.get_playlist_tree() if playlist.name == "Closer")

        opening_page = self.database.list_tracks(playlist_id=opening.id, limit=100)
        closer_page = self.database.list_tracks(playlist_id=closer.id, limit=100)

        self.assertEqual([track.external_id for track in opening_page.items], ["2", "1"])
        self.assertEqual([track.external_id for track in closer_page.items], ["4", "3"])

    def test_unknown_playlist_id_and_malformed_cursor_are_rejected(self):
        self.database.import_library(self.imported)

        with self.assertRaises(RekordboxImportError) as unknown:
            self.database.list_tracks(playlist_id="missing", limit=100)
        with self.assertRaises(RekordboxImportError) as malformed:
            self.database.list_tracks(limit=100, cursor="not-a-cursor")

        self.assertEqual(unknown.exception.code, "not_found")
        self.assertEqual(malformed.exception.code, "invalid_cursor")

    def test_playlist_tree_keeps_parent_relationships_on_first_import(self):
        self.database.import_library(self.imported)
        tree = {playlist.name: playlist for playlist in self.database.get_playlist_tree()}

        self.assertIsNone(tree["Root"].parent_id)
        self.assertEqual(tree["Warmup"].parent_id, tree["Root"].id)
        self.assertEqual(tree["Opening"].parent_id, tree["Warmup"].id)
        self.assertEqual(tree["Closer"].parent_id, tree["Root"].id)

    def test_structurally_invalid_cursor_is_rejected_with_a_protocol_error(self):
        self.database.import_library(self.imported)

        with self.assertRaises(RekordboxImportError) as raised:
            self.database.list_tracks(limit=100, cursor="WyJ0aXRsZSIsImlkIl0")

        self.assertEqual(raised.exception.code, "invalid_cursor")

    def test_collection_cursor_resumes_title_artist_order_without_duplicates(self):
        self.database.import_library(self.imported)

        first_page = self.database.list_tracks(limit=2)
        second_page = self.database.list_tracks(limit=2, cursor=first_page.next_cursor)

        self.assertEqual([(item.title, item.artist) for item in first_page.items], [("Missing", "Elsewhere"), ("Percent%", "Special & Artist")])
        self.assertEqual([(item.title, item.artist) for item in second_page.items], [("Same Title", "Same Artist"), ("Same Title", "Same Artist")])
        self.assertIsNone(second_page.next_cursor)

    def test_imported_source_paths_are_normalized_and_omitted_from_stored_tracks(self):
        """Leaking private paths through StoredTrack or storing lexical traversal must fail."""
        self.database.import_library(self.imported)
        imported_paths = {track.external_id: track.path for track in self.imported.tracks}

        for stored in self.database.list_tracks(limit=100).items:
            self.assertFalse(hasattr(stored, "source_path"))
            self.assertFalse(hasattr(stored, "path"))
            self.assertEqual(
                self.database.get_track_source_path(stored.id),
                Path(os.path.normpath(imported_paths[stored.external_id])),
            )


if __name__ == "__main__":
    unittest.main()
