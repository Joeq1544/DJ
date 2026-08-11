import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest

from spikes.rekordbox_xml.parser import ParseLimits, RekordboxXMLParser, RekordboxXMLError


ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / "fixtures/rekordbox/phase0-library.xml"
EXPECTED = ROOT / "fixtures/expected/phase0-rekordbox.json"


class RekordboxXMLParserTests(unittest.TestCase):
    def parse(self, text, **kwargs):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "library.xml"
            source.write_text(text, encoding="utf-8")
            return RekordboxXMLParser(**kwargs).parse(source)

    def test_normalizes_fixture_and_preserves_source_hash(self):
        before = hashlib.sha256(FIXTURE.read_bytes()).hexdigest()
        result = RekordboxXMLParser().parse(FIXTURE)
        self.assertEqual(result["source_sha256"], before)
        self.assertEqual(result["tracks"], json.loads(EXPECTED.read_text(encoding="utf-8")))
        self.assertEqual(hashlib.sha256(FIXTURE.read_bytes()).hexdigest(), before)

    def test_repeated_parse_has_identical_normalized_json(self):
        parser = RekordboxXMLParser()
        one = json.dumps(parser.parse(FIXTURE), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        two = json.dumps(parser.parse(FIXTURE), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        self.assertEqual(one, two)

    def test_rejects_dtd_and_entity_before_xml_parse(self):
        with self.assertRaisesRegex(RekordboxXMLError, "DTD or ENTITY"):
            self.parse('<!DOCTYPE x [<!ENTITY a "x">]><DJ_PLAYLISTS Version="1.0.0"/>')

    def test_rejects_bom_marked_utf16_dtd_and_entity_before_xml_parse(self):
        raw = ('<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE DJ_PLAYLISTS '
               '[<!ENTITY x "expanded">]><DJ_PLAYLISTS Version="1.0.0">'
               '<COLLECTION Entries="0">&x;</COLLECTION></DJ_PLAYLISTS>').encode("utf-16")
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "library.xml"
            source.write_bytes(raw)
            with self.assertRaisesRegex(RekordboxXMLError, "unsupported encoding|DTD or ENTITY"):
                RekordboxXMLParser().parse(source)

    def test_rejects_no_bom_utf16le_dtd_and_entity_before_xml_parse(self):
        text = ('<?xml version="1.0" encoding="UTF-16LE"?><!DOCTYPE DJ_PLAYLISTS '
                '[<!ENTITY x "expanded">]><DJ_PLAYLISTS Version="1.0.0">'
                '<COLLECTION Entries="0">&x;</COLLECTION></DJ_PLAYLISTS>')
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "library.xml"
            source.write_bytes(text.encode("utf-16le"))
            with self.assertRaisesRegex(RekordboxXMLError, "unsupported encoding|DTD or ENTITY"):
                RekordboxXMLParser().parse(source)

    def test_rejects_malformed_root_version_duplicate_and_unresolved_keys(self):
        cases = [
            ('<OTHER Version="1.0.0"/>', "root"),
            ('<DJ_PLAYLISTS Version="2.0.0"/>', "version"),
            ('<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="2"><TRACK TrackID="1" Location="file://localhost/a"/><TRACK TrackID="1" Location="file://localhost/b"/></COLLECTION></DJ_PLAYLISTS>', "duplicate"),
            ('<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="0"/><PLAYLISTS><NODE Type="1" Name="x" Entries="1"><TRACK KeyType="TrackID" Key="404"/></NODE></PLAYLISTS></DJ_PLAYLISTS>', "unresolved"),
            ('<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="1"><TRACK TrackID="1" Location="file://localhost/a"></COLLECTION></DJ_PLAYLISTS>', "malformed"),
        ]
        for xml, message in cases:
            with self.subTest(message=message), self.assertRaisesRegex(RekordboxXMLError, message):
                self.parse(xml)

    def test_rejects_declared_count_mismatches(self):
        xml = '<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="0"><TRACK TrackID="1" Location="file://localhost/a"/></COLLECTION></DJ_PLAYLISTS>'
        with self.assertRaisesRegex(RekordboxXMLError, "declared"):
            self.parse(xml)

    def test_rejects_nonlocal_nul_and_escape_paths(self):
        for location, message in [
            ("file://server/a", "non-local"),
            ("file://localhost/a%00b", "NUL"),
            ("file://localhost/allowed/../escape.mp3", "escape"),
        ]:
            xml = f'<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="1"><TRACK TrackID="1" Location="{location}"/></COLLECTION></DJ_PLAYLISTS>'
            with self.subTest(location=location), self.assertRaisesRegex(RekordboxXMLError, message):
                self.parse(xml, allowed_root="/allowed")

    def test_rejects_symlink_escape_without_opening_audio(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "allowed"
            root.mkdir()
            (root / "jump").symlink_to(Path(temp) / "outside")
            xml = '<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="1"><TRACK TrackID="1" Location="file://localhost' + str(root) + '/jump/song.mp3"/></COLLECTION></DJ_PLAYLISTS>'
            with self.assertRaisesRegex(RekordboxXMLError, "symlink escape"):
                self.parse(xml, allowed_root=str(root))

    def test_enforces_injectable_input_structure_and_record_limits(self):
        valid = '<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="1"><TRACK TrackID="1" Location="file://localhost/a"/></COLLECTION><PLAYLISTS><NODE Type="1" Name="p" Entries="1"><TRACK KeyType="TrackID" Key="1"/></NODE></PLAYLISTS></DJ_PLAYLISTS>'
        checks = [
            (ParseLimits(max_bytes=10), "byte"),
            (ParseLimits(max_nodes=2), "node"),
            (ParseLimits(max_text=1), "text"),
            (ParseLimits(max_depth=1), "depth"),
            (ParseLimits(max_tracks=0), "track"),
            (ParseLimits(max_playlists=0), "playlist"),
        ]
        for limits, message in checks:
            with self.subTest(message=message), self.assertRaisesRegex(RekordboxXMLError, message):
                self.parse(valid, limits=limits)

    def test_limits_playlist_nodes_when_multiple_playlists_share_one_track(self):
        xml = ('<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="1">'
               '<TRACK TrackID="1" Location="file://localhost/a"/></COLLECTION><PLAYLISTS>'
               '<NODE Type="1" Name="one" Entries="1"><TRACK KeyType="TrackID" Key="1"/></NODE>'
               '<NODE Type="1" Name="two" Entries="1"><TRACK KeyType="TrackID" Key="1"/></NODE>'
               '<NODE Type="1" Name="three" Entries="1"><TRACK KeyType="TrackID" Key="1"/></NODE>'
               '</PLAYLISTS></DJ_PLAYLISTS>')
        with self.assertRaisesRegex(RekordboxXMLError, "playlist limit"):
            self.parse(xml, limits=ParseLimits(max_playlists=2))


if __name__ == "__main__":
    unittest.main()
