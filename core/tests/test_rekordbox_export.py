from dataclasses import replace
import errno
import hashlib
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dj_copilot.rekordbox_export import (
    RekordboxExportError,
    RekordboxExportSnapshot,
    RekordboxExportTrack,
    preview_rekordbox_export,
    serialize_rekordbox_export,
    write_rekordbox_export,
)
from dj_copilot.rekordbox_xml import RekordboxImportError, parse_rekordbox_xml


class RekordboxExportTests(unittest.TestCase):
    def make_snapshot(self, directory: Path) -> RekordboxExportSnapshot:
        source = directory / "import-source.xml"
        source.write_bytes(b'<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="0"/></DJ_PLAYLISTS>')
        first_audio = directory / 'Caf\N{LATIN SMALL LETTER E WITH ACUTE} & 100%.mp3'
        second_audio = directory / "second track.wav"
        first_audio.write_bytes(b"generated fixture one")
        second_audio.write_bytes(b"generated fixture two")
        first = RekordboxExportTrack(
            external_id="7",
            title='Caf\N{LATIN SMALL LETTER E WITH ACUTE} & "Tea"',
            artist="A & B",
            album="<Album>",
            genre="House",
            bpm_milli=120_001,
            musical_key="8A",
            duration_ms=123_456,
            path=str(first_audio),
            availability="available",
        )
        second = RekordboxExportTrack(
            external_id="8",
            title="Second \N{CHECK MARK}",
            artist=None,
            album=None,
            genre=None,
            bpm_milli=None,
            musical_key=None,
            duration_ms=None,
            path=str(second_audio),
            availability="available",
        )
        return RekordboxExportSnapshot(
            playlist_name='Night & "Day" \N{CHECK MARK}',
            imported_source_path=str(source),
            entries=(first, second, first),
        )

    def assert_no_temporary_siblings(self, destination: Path) -> None:
        self.assertEqual(list(destination.parent.glob(f".{destination.name}.*.tmp")), [])

    def test_serializes_one_leaf_deterministically_with_unicode_escaping_uri_round_trip_and_repeats(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            snapshot = self.make_snapshot(directory)

            first = serialize_rekordbox_export(snapshot)
            second = serialize_rekordbox_export(snapshot)

            self.assertEqual(first, second)
            self.assertIn(b'Name="Night &amp; &quot;Day&quot; \xe2\x9c\x93"', first)
            self.assertIn(b'Caf%C3%A9%20%26%20100%25.mp3', first)
            self.assertIn(b'KeyType="0"', first)
            serialized = directory / "serialized.xml"
            serialized.write_bytes(first)
            imported = parse_rekordbox_xml(serialized)
            self.assertEqual([track.external_id for track in imported.tracks], ["7", "8"])
            self.assertEqual([track.path for track in imported.tracks], [snapshot.entries[0].path, snapshot.entries[1].path])
            self.assertEqual(imported.tracks[0].title, snapshot.entries[0].title)
            self.assertEqual(imported.tracks[0].bpm_milli, 120_001)
            self.assertEqual(imported.tracks[0].duration_ms, 123_456)
            self.assertEqual(
                [(playlist.name, playlist.kind, playlist.track_external_ids) for playlist in imported.playlists],
                [
                    ("ROOT", "folder", ()),
                    (snapshot.playlist_name, "playlist", ("7", "8", "7")),
                ],
            )

    def test_preview_never_writes_and_new_or_confirmed_regular_destinations_finalize_mode_0600(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            snapshot = self.make_snapshot(directory)
            destination = directory / "export.xml"
            source_hash = hashlib.sha256(Path(snapshot.imported_source_path).read_bytes()).hexdigest()

            preview = preview_rekordbox_export(snapshot, destination, "absent")

            self.assertEqual((preview.playlist_name, preview.track_count), (snapshot.playlist_name, 3))
            self.assertEqual(preview.expected_destination_state, "absent")
            self.assertFalse(destination.exists())

            created = write_rekordbox_export(snapshot, destination, "absent")

            self.assertEqual(created.destination_state, "replaced")
            self.assertFalse(created.overwritten)
            self.assertEqual(created.format, "rekordbox_xml_1_0_0")
            self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o600)
            self.assertEqual(destination.read_bytes(), serialize_rekordbox_export(snapshot))

            destination.write_bytes(b"confirmed old regular file")
            overwritten = write_rekordbox_export(snapshot, destination, "regular_file")

            self.assertTrue(overwritten.overwritten)
            self.assertEqual(destination.read_bytes(), serialize_rekordbox_export(snapshot))
            self.assertEqual(hashlib.sha256(Path(snapshot.imported_source_path).read_bytes()).hexdigest(), source_hash)
            self.assert_no_temporary_siblings(destination)

    def test_rejects_unresolved_stale_nonnumeric_invalid_missing_and_unreadable_track_entries(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            snapshot = self.make_snapshot(directory)
            track = snapshot.entries[0]
            destination = directory / "export.xml"
            cases = [
                (replace(snapshot, entries=(None,)), "unresolved_track", None),
                (replace(snapshot, entries=(replace(track, availability="missing"),)), "unavailable_track", None),
                (replace(snapshot, entries=(replace(track, external_id="not-numeric"),)), "invalid_external_id", None),
                (replace(snapshot, entries=(replace(track, path="relative.mp3"),)), "invalid_track_path", None),
                (
                    replace(snapshot, entries=(replace(track, path=str(directory / "missing.mp3")),)),
                    "track_source_missing",
                    None,
                ),
                (replace(snapshot, entries=(track,)), "track_source_unreadable", False),
            ]

            for candidate, code, access_result in cases:
                access_patch = (
                    mock.patch("dj_copilot.rekordbox_export.os.access", return_value=access_result)
                    if access_result is not None
                    else mock.patch("dj_copilot.rekordbox_export.os.access", wraps=os.access)
                )
                with self.subTest(code=code), access_patch, self.assertRaises(RekordboxExportError) as raised:
                    preview_rekordbox_export(candidate, destination, "absent")
                self.assertEqual(raised.exception.code, code)
                self.assertEqual(raised.exception.destination_state, "unchanged")
                self.assertFalse(destination.exists())

    def test_destination_policy_rejects_relative_wrong_extension_state_mismatch_symlink_nonregular_and_source_alias(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            snapshot = self.make_snapshot(directory)
            existing = directory / "existing.xml"
            existing.write_bytes(b"existing")
            symlink = directory / "symlink.xml"
            symlink.symlink_to(existing)
            nonregular = directory / "folder.xml"
            nonregular.mkdir()
            alias = directory / "source-alias.xml"
            os.link(snapshot.imported_source_path, alias)
            cases = [
                (Path("relative.xml"), "absent", "destination_not_absolute"),
                (directory / "wrong.txt", "absent", "destination_not_xml"),
                (directory / "missing-parent" / "export.xml", "absent", "destination_parent_invalid"),
                (existing, "absent", "destination_state_changed"),
                (directory / "absent.xml", "regular_file", "destination_state_changed"),
                (symlink, "regular_file", "destination_symlink"),
                (nonregular, "regular_file", "destination_not_regular"),
                (alias, "regular_file", "source_alias"),
            ]

            for destination, expected_state, code in cases:
                with self.subTest(code=code), self.assertRaises(RekordboxExportError) as raised:
                    preview_rekordbox_export(snapshot, destination, expected_state)
                self.assertEqual(raised.exception.code, code)
                self.assertEqual(raised.exception.destination_state, "unchanged")

            with self.assertRaises(RekordboxExportError) as raised:
                preview_rekordbox_export(snapshot, directory / "export.xml", "unknown")
            self.assertEqual(raised.exception.code, "invalid_destination_state")

    def test_absent_to_regular_and_regular_to_absent_races_fail_without_clobbering(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            snapshot = self.make_snapshot(directory)
            real_parser = parse_rekordbox_xml

            absent_destination = directory / "absent-race.xml"

            def create_competing_destination(temporary_path):
                parsed = real_parser(temporary_path)
                absent_destination.write_bytes(b"competitor")
                return parsed

            with mock.patch(
                "dj_copilot.rekordbox_export.parse_rekordbox_xml",
                side_effect=create_competing_destination,
            ), self.assertRaises(RekordboxExportError) as raised:
                write_rekordbox_export(snapshot, absent_destination, "absent")
            self.assertEqual(raised.exception.code, "destination_state_changed")
            self.assertEqual(raised.exception.destination_state, "unchanged")
            self.assertEqual(absent_destination.read_bytes(), b"competitor")
            self.assert_no_temporary_siblings(absent_destination)

            regular_destination = directory / "regular-race.xml"
            regular_destination.write_bytes(b"confirmed regular")

            def remove_confirmed_destination(temporary_path):
                parsed = real_parser(temporary_path)
                regular_destination.unlink()
                return parsed

            with mock.patch(
                "dj_copilot.rekordbox_export.parse_rekordbox_xml",
                side_effect=remove_confirmed_destination,
            ), self.assertRaises(RekordboxExportError) as raised:
                write_rekordbox_export(snapshot, regular_destination, "regular_file")
            self.assertEqual(raised.exception.code, "destination_state_changed")
            self.assertEqual(raised.exception.destination_state, "unchanged")
            self.assertFalse(regular_destination.exists())
            self.assert_no_temporary_siblings(regular_destination)

    def test_regular_to_regular_change_is_allowed_but_a_late_source_alias_is_blocked(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            snapshot = self.make_snapshot(directory)
            destination = directory / "export.xml"
            destination.write_bytes(b"confirmed regular")
            real_parser = parse_rekordbox_xml

            def replace_with_another_regular(temporary_path):
                parsed = real_parser(temporary_path)
                destination.write_bytes(b"another regular")
                return parsed

            with mock.patch(
                "dj_copilot.rekordbox_export.parse_rekordbox_xml",
                side_effect=replace_with_another_regular,
            ):
                result = write_rekordbox_export(snapshot, destination, "regular_file")
            self.assertEqual(result.destination_state, "replaced")
            self.assertEqual(destination.read_bytes(), serialize_rekordbox_export(snapshot))

            destination.write_bytes(b"confirmed regular again")

            def replace_with_source_alias(temporary_path):
                parsed = real_parser(temporary_path)
                destination.unlink()
                os.link(snapshot.imported_source_path, destination)
                return parsed

            with mock.patch(
                "dj_copilot.rekordbox_export.parse_rekordbox_xml",
                side_effect=replace_with_source_alias,
            ), self.assertRaises(RekordboxExportError) as raised:
                write_rekordbox_export(snapshot, destination, "regular_file")
            self.assertEqual(raised.exception.code, "source_alias")
            self.assertEqual(raised.exception.destination_state, "unchanged")
            self.assertTrue(os.path.samefile(destination, snapshot.imported_source_path))
            self.assert_no_temporary_siblings(destination)

    def test_fsync_and_semantic_reparse_failures_leave_existing_destination_and_source_unchanged(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            snapshot = self.make_snapshot(directory)
            destination = directory / "export.xml"
            destination.write_bytes(b"old destination")
            source_hash = hashlib.sha256(Path(snapshot.imported_source_path).read_bytes()).hexdigest()
            destination_hash = hashlib.sha256(destination.read_bytes()).hexdigest()

            def semantic_mismatch(temporary_path):
                imported = parse_rekordbox_xml(temporary_path)
                wrong_leaf = replace(imported.playlists[1], track_external_ids=("8",))
                return replace(imported, playlists=(imported.playlists[0], wrong_leaf))

            failures = [
                (
                    mock.patch("dj_copilot.rekordbox_export.os.fsync", side_effect=OSError("fsync failed")),
                    "export_failed",
                ),
                (
                    mock.patch(
                        "dj_copilot.rekordbox_export.parse_rekordbox_xml",
                        side_effect=RekordboxImportError("malformed_xml", "injected parse failure"),
                    ),
                    "semantic_validation_failed",
                ),
                (
                    mock.patch(
                        "dj_copilot.rekordbox_export.parse_rekordbox_xml",
                        side_effect=semantic_mismatch,
                    ),
                    "semantic_validation_failed",
                ),
            ]
            for failure, expected_code in failures:
                with self.subTest(expected_code=expected_code):
                    with failure, self.assertRaises(RekordboxExportError) as raised:
                        write_rekordbox_export(snapshot, destination, "regular_file")
                    self.assertEqual(raised.exception.code, expected_code)
                    self.assertEqual(raised.exception.destination_state, "unchanged")
                    self.assertEqual(hashlib.sha256(destination.read_bytes()).hexdigest(), destination_hash)
                    self.assertEqual(hashlib.sha256(Path(snapshot.imported_source_path).read_bytes()).hexdigest(), source_hash)
                    self.assert_no_temporary_siblings(destination)

    def test_temporary_file_is_mode_0600_and_replace_failure_reports_unknown_with_cleanup(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            snapshot = self.make_snapshot(directory)
            destination = directory / "export.xml"
            destination.write_bytes(b"old destination")
            old_hash = hashlib.sha256(destination.read_bytes()).hexdigest()
            real_parser = parse_rekordbox_xml

            def assert_mode_then_parse(temporary_path):
                self.assertEqual(stat.S_IMODE(Path(temporary_path).stat().st_mode), 0o600)
                return real_parser(temporary_path)

            with mock.patch(
                "dj_copilot.rekordbox_export.parse_rekordbox_xml",
                side_effect=assert_mode_then_parse,
            ), mock.patch(
                "dj_copilot.rekordbox_export.os.replace",
                side_effect=OSError(errno.EXDEV, "injected cross-device failure"),
            ), self.assertRaises(RekordboxExportError) as raised:
                write_rekordbox_export(snapshot, destination, "regular_file")

            self.assertEqual(raised.exception.code, "finalize_failed")
            self.assertEqual(raised.exception.destination_state, "unknown")
            self.assertEqual(hashlib.sha256(destination.read_bytes()).hexdigest(), old_hash)
            self.assert_no_temporary_siblings(destination)


if __name__ == "__main__":
    unittest.main()
