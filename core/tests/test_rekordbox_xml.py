import hashlib
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dj_copilot.rekordbox_xml import ParseLimits, RekordboxImportError, parse_rekordbox_xml


ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "fixtures" / "rekordbox" / "phase0-library.xml"
FIXTURE_SHA256 = "780618d97cfa005cb34daa5c721e0b1529e1bc4c1a7d6315d4115fa8418ab176"


class RekordboxXMLTests(unittest.TestCase):
    def parse_text(self, xml, *, limits=None, encoding="utf-8"):
        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "library.xml"
            source.write_bytes(xml.encode(encoding) if isinstance(xml, str) else xml)
            return parse_rekordbox_xml(source, limits=limits)

    def test_imports_fixture_with_normalized_tracks_and_structural_playlists(self):
        before = FIXTURE.read_bytes()

        imported = parse_rekordbox_xml(FIXTURE)

        self.assertEqual(imported.source_sha256, FIXTURE_SHA256)
        self.assertEqual(len(imported.tracks), 4)
        self.assertEqual(
            [(track.external_id, track.title, track.artist, track.path, track.availability) for track in imported.tracks],
            [
                ("1", "Same Title", "Same Artist", "/Users/example/Music/alpha & beta.mp3", "missing"),
                ("2", "Same Title", "Same Artist", "/Users/example/Music/Café ✓.mp3", "missing"),
                ("3", "Missing", "Elsewhere", "/Users/example/Music/missing.mp3", "missing"),
                ("4", "Percent%", "Special & Artist", "/Users/example/Music/100% hit.mp3", "missing"),
            ],
        )
        self.assertEqual(
            [(playlist.import_key, playlist.parent_import_key, playlist.name, playlist.kind, playlist.order, playlist.track_external_ids) for playlist in imported.playlists],
            [
                ("0", None, "Root", "folder", 0, ()),
                ("0/0", "0", "Warmup", "folder", 0, ()),
                ("0/0/0", "0/0", "Opening", "playlist", 0, ("2", "1")),
                ("0/1", "0", "Closer", "playlist", 1, ("4", "3")),
            ],
        )
        self.assertEqual(FIXTURE.read_bytes(), before)
        self.assertEqual(hashlib.sha256(before).hexdigest(), FIXTURE_SHA256)

    def test_converts_display_metadata_and_first_tempo_to_wire_units(self):
        imported = self.parse_text(
            '<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="1">'
            '<TRACK TrackID="1" Name="Title" Artist="Artist" Album="Album" Genre="Genre" Tonality="8A" '
            'AverageBpm="120.0005" TotalTime="123.4567" Location="file://localhost/music/song.mp3">'
            '<TEMPO Bpm="90.5"/></TRACK></COLLECTION></DJ_PLAYLISTS>'
        )

        track = imported.tracks[0]
        self.assertEqual((track.album, track.genre, track.musical_key), ("Album", "Genre", "8A"))
        self.assertEqual(track.bpm_milli, 120000)
        self.assertEqual(track.duration_ms, 123457)

    def test_uses_first_valid_tempo_when_average_bpm_is_absent(self):
        imported = self.parse_text(
            '<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="1">'
            '<TRACK TrackID="1" Location="file://localhost/music/song.mp3">'
            '<TEMPO Bpm="bad"/><TEMPO Bpm="121.2345"/><TEMPO Bpm="99.0"/>'
            '</TRACK></COLLECTION></DJ_PLAYLISTS>'
        )

        self.assertEqual(imported.tracks[0].bpm_milli, 121234)

    def test_default_limits_cover_a_practical_personal_library_while_remaining_bounded(self):
        limits = ParseLimits()

        self.assertGreaterEqual(limits.max_bytes, 20 * 1_024 * 1_024)
        self.assertGreaterEqual(limits.max_tracks, 100_000)
        self.assertGreaterEqual(limits.max_nodes, 500_000)
        self.assertGreaterEqual(limits.max_text, 20 * 1_024 * 1_024)
        self.assertGreaterEqual(limits.max_playlist_entries, 500_000)

    def test_rejects_utf16_and_dtd_entity_before_xml_parse(self):
        utf16 = '<?xml version="1.0" encoding="UTF-16"?><DJ_PLAYLISTS Version="1.0.0"/>'.encode("utf-16")

        for source, code in [
            (utf16, "unsupported_encoding"),
            ('<!DOCTYPE x [<!ENTITY a "x">]><DJ_PLAYLISTS Version="1.0.0"/>', "dtd_not_allowed"),
        ]:
            with self.subTest(code=code), self.assertRaises(RekordboxImportError) as raised:
                self.parse_text(source)
            self.assertEqual(raised.exception.code, code)
            self.assertLessEqual(len(raised.exception.message), 500)

    def test_rejects_malformed_wrong_root_wrong_version_and_declared_count(self):
        cases = [
            ('<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="1">', "malformed_xml"),
            ('<OTHER Version="1.0.0"/>', "unsupported_root"),
            ('<DJ_PLAYLISTS Version="2.0.0"><COLLECTION Entries="0"/></DJ_PLAYLISTS>', "unsupported_version"),
            ('<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="0"><TRACK TrackID="1" Location="file://localhost/a"/></COLLECTION></DJ_PLAYLISTS>', "declared_count_mismatch"),
        ]

        for xml, code in cases:
            with self.subTest(code=code), self.assertRaises(RekordboxImportError) as raised:
                self.parse_text(xml)
            self.assertEqual(raised.exception.code, code)

    def test_rejects_duplicate_ids_unresolved_references_and_nonlocal_uris(self):
        cases = [
            ('<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="2"><TRACK TrackID="1" Location="file://localhost/a"/><TRACK TrackID="1" Location="file://localhost/b"/></COLLECTION></DJ_PLAYLISTS>', "duplicate_track_id"),
            ('<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="0"/><PLAYLISTS><NODE Type="1" Name="x" Entries="1"><TRACK KeyType="TrackID" Key="404"/></NODE></PLAYLISTS></DJ_PLAYLISTS>', "unresolved_playlist_reference"),
            ('<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="1"><TRACK TrackID="1" Location="file://server/a"/></COLLECTION></DJ_PLAYLISTS>', "nonlocal_file_uri"),
        ]

        for xml, code in cases:
            with self.subTest(code=code), self.assertRaises(RekordboxImportError) as raised:
                self.parse_text(xml)
            self.assertEqual(raised.exception.code, code)

    def test_rejects_excessive_hierarchy_depth_and_playlist_entry_total(self):
        deeply_nested = '<NODE Type="0" Name="x" Count="1">' * 3 + '<NODE Type="1" Name="p" Entries="0"/>' + '</NODE>' * 3
        depth_xml = '<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="0"/><PLAYLISTS>' + deeply_nested + '</PLAYLISTS></DJ_PLAYLISTS>'
        entries_xml = (
            '<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="1"><TRACK TrackID="1" Location="file://localhost/a"/>'
            '</COLLECTION><PLAYLISTS><NODE Type="1" Name="p" Entries="2"><TRACK KeyType="TrackID" Key="1"/>'
            '<TRACK KeyType="TrackID" Key="1"/></NODE></PLAYLISTS></DJ_PLAYLISTS>'
        )

        for xml, limits, code in [
            (depth_xml, ParseLimits(max_depth=3), "hierarchy_depth_exceeded"),
            (entries_xml, ParseLimits(max_playlist_entries=1), "playlist_entry_limit_exceeded"),
        ]:
            with self.subTest(code=code), self.assertRaises(RekordboxImportError) as raised:
                self.parse_text(xml, limits=limits)
            self.assertEqual(raised.exception.code, code)

    def test_rejects_ambiguous_location_playlist_reference(self):
        xml = (
            '<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="2">'
            '<TRACK TrackID="1" Location="file://localhost/a"/><TRACK TrackID="2" Location="file://localhost/a"/>'
            '</COLLECTION><PLAYLISTS><NODE Type="1" Name="p" Entries="1">'
            '<TRACK KeyType="Location" Key="file://localhost/a"/></NODE></PLAYLISTS></DJ_PLAYLISTS>'
        )

        with self.assertRaises(RekordboxImportError) as raised:
            self.parse_text(xml)
        self.assertEqual(raised.exception.code, "ambiguous_location_reference")

    def test_accepts_official_node_level_numeric_track_id_and_location_references(self):
        xml = (
            '<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="2">'
            '<TRACK TrackID="1" Location="file://localhost/music/one.mp3"/>'
            '<TRACK TrackID="2" Location="file://localhost/music/Caf%C3%A9%20%26%20two.mp3"/>'
            '</COLLECTION><PLAYLISTS><NODE Type="0" Name="ROOT" Count="2">'
            '<NODE Type="1" Name="By ID" KeyType="0" Entries="2">'
            '<TRACK Key="2"/><TRACK Key="1"/></NODE>'
            '<NODE Type="1" Name="By location" KeyType="1" Entries="1">'
            '<TRACK Key="file://localhost/music/Caf%C3%A9%20%26%20two.mp3"/></NODE>'
            '</NODE></PLAYLISTS></DJ_PLAYLISTS>'
        )

        imported = self.parse_text(xml)

        self.assertEqual(imported.playlists[1].track_external_ids, ("2", "1"))
        self.assertEqual(imported.playlists[2].track_external_ids, ("2",))

    def test_rejects_unknown_or_mixed_official_playlist_reference_styles(self):
        prefix = (
            '<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="1">'
            '<TRACK TrackID="1" Location="file://localhost/music/one.mp3"/>'
            '</COLLECTION><PLAYLISTS>'
        )
        suffix = '</PLAYLISTS></DJ_PLAYLISTS>'
        cases = [
            '<NODE Type="1" Name="Unknown numeric" KeyType="2" Entries="1"><TRACK Key="1"/></NODE>',
            '<NODE Type="1" Name="Unknown text" KeyType="TrackID" Entries="1"><TRACK Key="1"/></NODE>',
            '<NODE Type="1" Name="Node child conflict" KeyType="0" Entries="1">'
            '<TRACK KeyType="TrackID" Key="1"/></NODE>',
            '<NODE Type="1" Name="Numeric child" Entries="1"><TRACK KeyType="0" Key="1"/></NODE>',
            '<NODE Type="1" Name="Mixed children" Entries="2">'
            '<TRACK KeyType="TrackID" Key="1"/><TRACK Key="1"/></NODE>',
        ]

        for playlist in cases:
            with self.subTest(playlist=playlist):
                with self.assertRaises(RekordboxImportError) as raised:
                    self.parse_text(prefix + playlist + suffix)
                self.assertEqual(raised.exception.code, "unsupported_playlist_reference")


if __name__ == "__main__":
    unittest.main()
