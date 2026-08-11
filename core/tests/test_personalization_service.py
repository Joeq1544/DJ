from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dj_copilot.database import LibraryDatabase
from dj_copilot.models import ImportedTrack, RekordboxImport
from dj_copilot.service import RequestError, _dispatch, _validate_request


def _library() -> RekordboxImport:
    return RekordboxImport(
        "e" * 64,
        (
            ImportedTrack("seed", "Seed", "Fixture", None, "House", 120_000, "8A", 180_000, "/private/seed.wav", "available"),
            ImportedTrack("alpha", "Alpha", "Fixture", None, "House", 120_000, "8A", 180_000, "/private/alpha.wav", "available"),
            ImportedTrack("beta", "Beta", "Fixture", None, "House", 120_000, "8A", 180_000, "/private/beta.wav", "available"),
            ImportedTrack("gamma", "Gamma", "Fixture", None, "House", 120_000, "8A", 180_000, "/private/gamma.wav", "available"),
        ),
        (),
    )


def _request(command: str, payload: dict) -> dict:
    return {"version": 1, "id": f"test-{command}", "command": command, "payload": payload}


class PersonalizationServiceTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database = LibraryDatabase(
            Path(self.temporary_directory.name) / "library.sqlite3"
        )
        self.database.import_library(_library())
        self.ids = {
            track.external_id: track.id
            for track in self.database.list_tracks(limit=20).items
        }

    def tearDown(self):
        self.database.close()
        self.temporary_directory.cleanup()

    def test_new_request_shapes_and_metadata_filters_are_strict(self):
        valid = (
            ("get_track_metadata", {"trackId": self.ids["alpha"]}),
            (
                "update_track_metadata",
                {
                    "trackId": self.ids["alpha"],
                    "rating": 5,
                    "tags": ["Peak Time"],
                    "note": "Bridge note",
                },
            ),
            ("list_saved_filters", {}),
            ("save_saved_filter", {"name": "Peak", "filters": {"ratingMin": 4, "tag": "Peak Time"}}),
            ("delete_saved_filter", {"id": "filter-id"}),
            ("get_preference_profile", {}),
            ("record_feedback", {"type": "liked", "trackId": self.ids["alpha"]}),
            (
                "record_feedback",
                {
                    "type": "accepted",
                    "trackId": self.ids["alpha"],
                    "seedTrackId": self.ids["seed"],
                    "intent": "smooth",
                },
            ),
            (
                "compare_recommendations",
                {"seedTrackId": self.ids["seed"], "intent": "smooth", "limit": 3},
            ),
            ("reset_preferences", {}),
            ("get_preference_export", {}),
        )
        for command, payload in valid:
            with self.subTest(command=command):
                self.assertEqual(_validate_request(_request(command, payload))[1], command)

        invalid = (
            ("get_track_metadata", {"trackId": ""}),
            ("get_track_metadata", {"trackId": "id", "extra": True}),
            ("update_track_metadata", {"trackId": "id", "rating": 5, "tags": [], "note": None, "extra": True}),
            ("update_track_metadata", {"trackId": "id", "rating": True, "tags": [], "note": None}),
            ("update_track_metadata", {"trackId": "id", "rating": 5, "tags": [" tag"], "note": None}),
            ("update_track_metadata", {"trackId": "id", "rating": 5, "tags": ["Tag", "tag"], "note": None}),
            ("save_saved_filter", {"name": "Peak", "filters": {"ratingMin": 6}}),
            ("save_saved_filter", {"name": "Peak", "filters": {"tag": " tag"}}),
            ("record_feedback", {"type": "liked", "trackId": "id", "seedTrackId": "seed"}),
            ("record_feedback", {"type": "accepted", "trackId": "id", "seedTrackId": "seed"}),
            ("record_feedback", {"type": "manual_reorder", "trackId": "id"}),
            ("compare_recommendations", {"seedTrackId": "seed", "intent": "invented"}),
            ("reset_preferences", {"confirm": True}),
            ("get_preference_export", {"path": "/private/export.json"}),
            ("list_tracks", {"ratingMin": 0}),
            ("list_tracks", {"tag": " x"}),
        )
        for command, payload in invalid:
            with self.subTest(command=command, payload=payload), self.assertRaises(RequestError):
                _validate_request(_request(command, payload))

    def test_metadata_saved_filters_and_track_rows_use_the_frozen_path_free_wire(self):
        updated = _dispatch(
            "update_track_metadata",
            {
                "trackId": self.ids["alpha"],
                "rating": 5,
                "tags": ["Peak Time"],
                "note": "Bridge note",
            },
            self.database,
            object(),
        )
        gotten = _dispatch(
            "get_track_metadata",
            {"trackId": self.ids["alpha"]},
            self.database,
            object(),
        )
        page = _dispatch(
            "list_tracks",
            {"text": "bridge peak", "ratingMin": 5, "tag": "Peak Time"},
            self.database,
            object(),
        )
        saved = _dispatch(
            "save_saved_filter",
            {"name": "Peak", "filters": {"ratingMin": 5, "tag": "Peak Time"}},
            self.database,
            object(),
        )
        listed = _dispatch("list_saved_filters", {}, self.database, object())

        self.assertEqual(updated, gotten)
        self.assertEqual(
            set(gotten),
            {"trackId", "rating", "tags", "note", "updatedAt"},
        )
        self.assertEqual(page["items"][0]["id"], self.ids["alpha"])
        self.assertEqual(
            page["items"][0]["userMetadata"],
            {"rating": 5, "tags": ["Peak Time"], "note": "Bridge note"},
        )
        self.assertNotIn("updatedAt", page["items"][0]["userMetadata"])
        self.assertEqual(listed, {"items": [saved]})
        self.assertEqual(
            saved["filters"],
            {"ratingMin": 5, "tag": "Peak Time"},
        )
        serialized = json.dumps({"metadata": gotten, "page": page, "saved": listed})
        self.assertNotIn("/private", serialized)
        self.assertNotIn("external_id", serialized)

        deleted = _dispatch(
            "delete_saved_filter",
            {"id": saved["id"]},
            self.database,
            object(),
        )
        self.assertEqual(deleted, {"deleted": True})

    def test_feedback_profile_standard_recommendations_and_comparison_share_one_candidate_universe(self):
        request = {
            "seedTrackId": self.ids["seed"],
            "intent": "smooth",
            "limit": 3,
        }
        learning = _dispatch(
            "record_feedback",
            {"type": "liked", "trackId": self.ids["beta"]},
            self.database,
            object(),
        )
        below_threshold = _dispatch(
            "compare_recommendations", request, self.database, object()
        )
        for _ in range(2):
            _dispatch(
                "record_feedback",
                {"type": "liked", "trackId": self.ids["beta"]},
                self.database,
                object(),
            )
        for _ in range(2):
            active = _dispatch(
                "record_feedback",
                {"type": "disliked", "trackId": self.ids["alpha"]},
                self.database,
                object(),
            )
        compared = _dispatch(
            "compare_recommendations", request, self.database, object()
        )
        standard = _dispatch(
            "recommend_next_tracks", request, self.database, object()
        )

        self.assertTrue(learning["recorded"])
        self.assertEqual(learning["profile"]["status"], "learning")
        self.assertEqual(below_threshold["baseline"], below_threshold["personalized"])
        self.assertEqual(active["profile"]["status"], "active")
        self.assertEqual(active["profile"]["preferenceWeightPpm"], 15_000)
        profile = compared["profile"]
        self.assertEqual(
            set(profile),
            {
                "algorithmVersion",
                "revision",
                "status",
                "totalPersonalDataCount",
                "effectiveEvidenceCount",
                "minimumEvidenceCount",
                "preferenceWeightPpm",
                "eventCounts",
                "trackAffinities",
                "trackAffinitiesTruncated",
                "genreAffinities",
                "genreAffinitiesTruncated",
            },
        )
        self.assertEqual(profile["eventCounts"]["liked"], 3)
        self.assertEqual(profile["eventCounts"]["disliked"], 2)
        baseline_ids = [item["track"]["id"] for item in compared["baseline"]["items"]]
        personalized_ids = [item["track"]["id"] for item in compared["personalized"]["items"]]
        self.assertEqual(set(baseline_ids), set(personalized_ids))
        self.assertEqual(compared["baseline"]["algorithmVersion"], "transition-v1")
        self.assertEqual(
            compared["personalized"]["algorithmVersion"],
            "transition-v1+preference-linear-v1",
        )
        self.assertEqual(personalized_ids[0], self.ids["beta"])
        self.assertNotEqual(baseline_ids, personalized_ids)
        self.assertEqual(
            compared["baseline"]["scannedCount"],
            compared["personalized"]["scannedCount"],
        )
        self.assertEqual(
            compared["baseline"]["truncated"],
            compared["personalized"]["truncated"],
        )
        for change in compared["rankChanges"]:
            self.assertEqual(
                change["delta"],
                change["baselineRank"] - change["personalizedRank"],
            )
        self.assertEqual(
            standard["algorithmVersion"],
            "transition-v1+preference-linear-v1",
        )
        self.assertEqual(
            [item["track"]["id"] for item in standard["items"]],
            personalized_ids,
        )

    def test_private_export_and_reset_are_bounded_and_preserve_non_rating_metadata(self):
        _dispatch(
            "update_track_metadata",
            {
                "trackId": self.ids["beta"],
                "rating": 5,
                "tags": ["Secret tag"],
                "note": "Private note",
            },
            self.database,
            object(),
        )
        for _ in range(4):
            _dispatch(
                "record_feedback",
                {"type": "liked", "trackId": self.ids["beta"]},
                self.database,
                object(),
            )
        exported = _dispatch("get_preference_export", {}, self.database, object())
        reset = _dispatch("reset_preferences", {}, self.database, object())
        retained = _dispatch(
            "get_track_metadata",
            {"trackId": self.ids["beta"]},
            self.database,
            object(),
        )

        self.assertEqual(exported["format"], "dj-copilot-preferences-v1")
        self.assertEqual(exported["ratingCount"], 1)
        self.assertEqual(exported["status"], "active")
        self.assertNotIn("profile", exported)
        self.assertEqual(
            (reset["status"], reset["clearedFeedbackCount"], reset["clearedRatingCount"]),
            ("reset", 4, 1),
        )
        self.assertEqual(reset["profile"]["status"], "baseline")
        self.assertEqual(
            (retained["rating"], retained["tags"], retained["note"]),
            (None, ["Secret tag"], "Private note"),
        )
        serialized = json.dumps(exported, sort_keys=True)
        for forbidden in (
            "/private",
            "sourcePath",
            "externalId",
            "Private note",
            "Secret tag",
            "Beta",
            "Fixture",
        ):
            self.assertNotIn(forbidden, serialized)


if __name__ == "__main__":
    unittest.main()
