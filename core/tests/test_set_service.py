from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dj_copilot.service import RequestError, _validate_request
from dj_copilot.service import _dispatch
from dj_copilot.database import LibraryDatabase
from dj_copilot.models import ImportedPlaylist, ImportedTrack, RekordboxImport
import tempfile


PLAN = {
    "intent": "smooth",
    "targetDurationMs": None,
    "maxArtistRepeats": None,
    "candidateFilters": {},
}


class SetServiceRequestTests(unittest.TestCase):
    def request(self, command, payload):
        return {"version": 1, "id": f"{command}-1", "command": command, "payload": payload}

    def test_all_eight_set_commands_accept_only_their_fixed_payload_shapes(self):
        valid = {
            "list_set_drafts": {},
            "create_set_draft": {"title": "Night Set", "plan": PLAN, "source": {"kind": "empty"}},
            "get_set_draft": {"draftId": "draft-1", "revision": 1},
            "mutate_set_draft": {
                "draftId": "draft-1",
                "expectedRevision": 1,
                "mutation": {"type": "set_entry_goal", "entryId": "entry-1", "role": "build", "targetEnergyPpm": 700_000},
            },
            "find_set_replacements": {"draftId": "draft-1", "entryId": "entry-1", "revision": 1},
            "analyze_set": {"kind": "draft", "draftId": "draft-1"},
            "preview_set_export": {
                "draftId": "draft-1", "expectedRevision": 1,
                "destinationPath": "/tmp/export.xml", "expectedDestinationState": "absent",
            },
            "export_set_draft": {
                "draftId": "draft-1", "expectedRevision": 1,
                "destinationPath": "/tmp/export.xml", "expectedDestinationState": "regular_file",
            },
        }

        for command, payload in valid.items():
            with self.subTest(command=command):
                self.assertEqual(_validate_request(self.request(command, payload))[1], command)

    def test_set_commands_reject_unknown_fields_bad_bounds_and_mixed_inspection_variants(self):
        invalid = [
            ("create_set_draft", {"title": "Night", "plan": PLAN, "source": {"kind": "tracks", "trackIds": ["one", "one"]}}),
            ("create_set_draft", {"title": "Night", "plan": {**PLAN, "candidateFilters": {"cursor": "private"}}, "source": {"kind": "empty"}}),
            ("mutate_set_draft", {"draftId": "draft", "expectedRevision": 1, "mutation": {"type": "undo", "extra": True}}),
            ("find_set_replacements", {"draftId": "draft", "entryId": "entry", "revision": 0}),
            ("analyze_set", {"kind": "draft", "draftId": "draft", "playlistId": "mixed"}),
            ("preview_set_export", {"draftId": "draft", "expectedRevision": 1, "destinationPath": "", "expectedDestinationState": "absent"}),
            ("export_set_draft", {"draftId": "draft", "expectedRevision": 1, "destinationPath": "/tmp/export.xml", "expectedDestinationState": "changed"}),
        ]

        for command, payload in invalid:
            with self.subTest(command=command, payload=payload), self.assertRaises(RequestError) as raised:
                _validate_request(self.request(command, payload))
            self.assertEqual(raised.exception.code, "invalid_request")


class SetServiceDispatchTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database = LibraryDatabase(Path(self.temporary_directory.name) / "library.sqlite3")
        self.database.import_library(
            RekordboxImport(
                "c" * 64,
                (
                    ImportedTrack("1", "First", "Artist One", None, "House", 120_000, "8A", 180_000, "/missing/one.mp3", "available"),
                    ImportedTrack("2", "Second", "Artist Two", None, "House", 122_000, "8B", 181_000, "/missing/two.mp3", "available"),
                ),
                (
                    ImportedPlaylist("repeated", None, "Repeated", "playlist", 0, ("1", "2", "1")),
                    ImportedPlaylist(
                        "long",
                        None,
                        "Long",
                        "playlist",
                        1,
                        tuple("1" if index % 2 == 0 else "2" for index in range(125)),
                    ),
                ),
            )
        )
        self.track_ids = [item.id for item in self.database.list_tracks(limit=10).items]
        self.playlist_ids = {item.name: item.id for item in self.database.get_playlist_tree()}

    def tearDown(self):
        self.database.close()
        self.temporary_directory.cleanup()

    def test_eight_commands_return_path_free_bounded_results_and_export_requires_reimport(self):
        manager = object()
        created = _dispatch("create_set_draft", {"title": "Night", "plan": PLAN, "source": {"kind": "tracks", "trackIds": self.track_ids}}, self.database, manager)
        draft_id = created["draftId"]
        entry_id = created["entries"][0]["id"]
        listed = _dispatch("list_set_drafts", {}, self.database, manager)
        gotten = _dispatch("get_set_draft", {"draftId": draft_id}, self.database, manager)
        mutated = _dispatch("mutate_set_draft", {"draftId": draft_id, "expectedRevision": 1, "mutation": {"type": "rename", "title": "Renamed"}}, self.database, manager)
        replacements = _dispatch("find_set_replacements", {"draftId": draft_id, "entryId": entry_id}, self.database, manager)
        inspection = _dispatch("analyze_set", {"kind": "draft", "draftId": draft_id}, self.database, manager)
        preview = _dispatch("preview_set_export", {"draftId": draft_id, "expectedRevision": 2, "destinationPath": "/tmp/private.xml", "expectedDestinationState": "absent"}, self.database, manager)
        exported = _dispatch("export_set_draft", {"draftId": draft_id, "expectedRevision": 2, "destinationPath": "/tmp/private.xml", "expectedDestinationState": "absent"}, self.database, manager)

        self.assertEqual((listed["items"][0]["draftId"], gotten["contentRevision"], mutated["status"]), (draft_id, 1, "updated"))
        self.assertEqual(set(replacements), {"scannedCount", "scanTruncated", "items"})
        self.assertEqual(inspection["inspectedPositionCount"], 2)
        self.assertEqual((preview["status"], preview["reasons"][0]["code"]), ("blocked", "reimport_required"))
        self.assertEqual((exported["status"], exported["destinationState"]), ("blocked", "unchanged"))
        self.assertNotIn("/missing", str((created, listed, gotten, mutated, replacements, inspection, preview, exported)))

    def test_playlist_create_preserves_repeats_and_inspection_reports_first_100_of_full_source(self):
        manager = object()

        created = _dispatch(
            "create_set_draft",
            {
                "title": "Repeated",
                "plan": PLAN,
                "source": {"kind": "playlist", "playlistId": self.playlist_ids["Repeated"]},
            },
            self.database,
            manager,
        )
        inspection = _dispatch(
            "analyze_set",
            {"kind": "playlist", "playlistId": self.playlist_ids["Long"]},
            self.database,
            manager,
        )

        self.assertEqual(
            [entry["trackId"] for entry in created["entries"]],
            [self.track_ids[0], self.track_ids[1], self.track_ids[0]],
        )
        self.assertEqual(
            (
                inspection["sourcePositionCount"],
                inspection["inspectedPositionCount"],
                inspection["inputTruncated"],
            ),
            (125, 100, True),
        )
        self.assertEqual(
            [point["trackId"] for point in inspection["points"][:3]],
            [self.track_ids[0], self.track_ids[1], self.track_ids[0]],
        )
        self.assertTrue(all(point["entryId"] is None for point in inspection["points"]))

    def test_generated_constraints_and_saved_version_identity_remain_honest(self):
        manager = object()
        generated = _dispatch(
            "create_set_draft",
            {
                "title": "Generated",
                "plan": {**PLAN, "targetDurationMs": 900_000, "maxArtistRepeats": 1},
                "source": {"kind": "generated", "maxTracks": 5},
            },
            self.database,
            manager,
        )
        self.assertEqual(
            {notice["code"] for notice in generated["unmetConstraints"]},
            {"target_duration", "track_count"},
        )
        reloaded_generated = _dispatch(
            "get_set_draft",
            {"draftId": generated["draftId"]},
            self.database,
            manager,
        )
        self.assertIn(
            "target_duration",
            {notice["code"] for notice in reloaded_generated["unmetConstraints"]},
        )

        created = _dispatch(
            "create_set_draft",
            {"title": "Versioned", "plan": PLAN, "source": {"kind": "empty"}},
            self.database,
            manager,
        )
        draft_id = created["draftId"]
        renamed = _dispatch(
            "mutate_set_draft",
            {"draftId": draft_id, "expectedRevision": 1, "mutation": {"type": "rename", "title": "Saved"}},
            self.database,
            manager,
        )["snapshot"]
        _dispatch(
            "mutate_set_draft",
            {"draftId": draft_id, "expectedRevision": 2, "mutation": {"type": "save_version", "label": "First saved version"}},
            self.database,
            manager,
        )
        current = _dispatch(
            "mutate_set_draft",
            {"draftId": draft_id, "expectedRevision": 2, "mutation": {"type": "rename", "title": "Current"}},
            self.database,
            manager,
        )["snapshot"]
        historical = _dispatch(
            "get_set_draft",
            {"draftId": draft_id, "revision": renamed["contentRevision"]},
            self.database,
            manager,
        )
        conflict = _dispatch(
            "mutate_set_draft",
            {"draftId": draft_id, "expectedRevision": 2, "mutation": {"type": "restore_version", "version": 1}},
            self.database,
            manager,
        )

        self.assertEqual((current["currentRevision"], historical["contentRevision"]), (3, 2))
        self.assertEqual(historical["viewingVersion"], 1)
        self.assertEqual(conflict, {"status": "conflict", "currentRevision": 3})


if __name__ == "__main__":
    unittest.main()
