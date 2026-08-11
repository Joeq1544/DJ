from dataclasses import FrozenInstanceError, asdict
from pathlib import Path
import json
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dj_copilot.personalization import (
    PersonalizationError,
    PreferenceEvent,
    PreferenceRating,
    PreferenceTrack,
    build_preference_model,
    candidate_preference,
)


TRACK_A = "00000000-0000-4000-8000-000000000001"
TRACK_B = "00000000-0000-4000-8000-000000000002"
TRACK_C = "00000000-0000-4000-8000-000000000003"
TRACK_D = "00000000-0000-4000-8000-000000000004"
TRACK_E = "00000000-0000-4000-8000-000000000005"
TRACK_F = "00000000-0000-4000-8000-000000000006"
TRACK_G = "00000000-0000-4000-8000-000000000007"


def _track(track_id: str, genre: str | None = "House") -> PreferenceTrack:
    return PreferenceTrack(track_id=track_id, genre=genre)


def _track_affinity(model, track_id: str):
    return next(item for item in model.track_affinities if item.track_id == track_id)


def _genre_affinity(model, genre: str):
    return next(item for item in model.genre_affinities if item.genre == genre)


class PreferenceSignalTests(unittest.TestCase):
    def test_every_single_track_event_uses_the_frozen_signed_signal(self):
        expected_scores = {
            "liked": 1_000_000,
            "accepted": 1_000_000,
            "pinned": 1_000_000,
            "manual_reorder": 750_000,
            "skipped": 250_000,
            "disliked": 0,
            "rejected": 0,
            "removed": 0,
            "banned": 0,
        }

        for event_type, expected_score in expected_scores.items():
            with self.subTest(event_type=event_type):
                model = build_preference_model(
                    (_track(TRACK_A),),
                    (PreferenceEvent(event_type=event_type, track_id=TRACK_A),),
                    (),
                )

                affinity = _track_affinity(model, TRACK_A)
                self.assertEqual((affinity.score_ppm, affinity.evidence_count), (expected_score, 1))
                self.assertEqual(model.profile.effective_evidence_count, 1)
                self.assertEqual(model.profile.status, "learning")
                self.assertEqual(model.profile.preference_weight_ppm, 0)

    def test_manual_replacement_penalizes_old_track_and_rewards_replacement(self):
        model = build_preference_model(
            (_track(TRACK_A), _track(TRACK_B)),
            (
                PreferenceEvent(
                    event_type="manual_replacement",
                    track_id=TRACK_A,
                    related_track_id=TRACK_B,
                ),
            ),
            (),
        )

        self.assertEqual(_track_affinity(model, TRACK_A).score_ppm, 0)
        self.assertEqual(_track_affinity(model, TRACK_B).score_ppm, 1_000_000)
        self.assertEqual(model.profile.effective_evidence_count, 2)
        self.assertEqual(
            dict((item.event_type, item.count) for item in model.profile.event_counts)[
                "manual_replacement"
            ],
            1,
        )

    def test_each_rating_is_one_signal_including_neutral_three(self):
        expected_scores = {1: 0, 2: 250_000, 3: 500_000, 4: 750_000, 5: 1_000_000}

        for rating, expected_score in expected_scores.items():
            with self.subTest(rating=rating):
                model = build_preference_model(
                    (_track(TRACK_A),),
                    (),
                    (PreferenceRating(track_id=TRACK_A, rating=rating),),
                )

                self.assertEqual(_track_affinity(model, TRACK_A).score_ppm, expected_score)
                self.assertEqual(model.profile.total_personal_data_count, 1)
                self.assertEqual(model.profile.effective_evidence_count, 1)


class PreferenceProfileTests(unittest.TestCase):
    def test_status_threshold_weight_ramp_and_cap_are_exact(self):
        expected = {
            0: ("baseline", 0),
            1: ("learning", 0),
            4: ("learning", 0),
            5: ("active", 15_000),
            6: ("active", 30_000),
            14: ("active", 150_000),
            20: ("active", 150_000),
        }

        for count, (status, weight) in expected.items():
            with self.subTest(count=count):
                events = tuple(PreferenceEvent("liked", TRACK_A) for _ in range(count))
                model = build_preference_model((_track(TRACK_A),), events, ())

                self.assertEqual(model.profile.effective_evidence_count, count)
                self.assertEqual(model.profile.minimum_evidence_count, 5)
                self.assertEqual(model.profile.status, status)
                self.assertEqual(model.profile.preference_weight_ppm, weight)

    def test_order_independent_aggregation_revision_and_ties_are_deterministic(self):
        tracks = (_track(TRACK_A, "House"), _track(TRACK_B, "Techno"))
        events = (
            PreferenceEvent("liked", TRACK_B),
            PreferenceEvent("disliked", TRACK_A),
        )

        forward = build_preference_model(tracks, events, ())
        reverse = build_preference_model(tuple(reversed(tracks)), tuple(reversed(events)), ())

        self.assertEqual(forward, reverse)
        self.assertEqual(forward.profile.revision, reverse.profile.revision)
        self.assertEqual(
            tuple(item.track_id for item in forward.profile.track_affinities),
            (TRACK_A, TRACK_B),
        )

    def test_track_and_normalized_genre_affinities_combine_two_to_one(self):
        tracks = (
            _track(TRACK_A, " House "),
            _track(TRACK_B, "HOUSE"),
            _track(TRACK_C, "Techno"),
            _track(TRACK_D, "house"),
            _track(TRACK_E, "Ambient"),
            _track(TRACK_F, "Disco"),
            _track(TRACK_G, "Garage"),
        )
        events = (
            PreferenceEvent("liked", TRACK_A),
            PreferenceEvent("disliked", TRACK_B),
        )
        model = build_preference_model(
            tracks,
            events,
            (
                PreferenceRating(TRACK_E, 3),
                PreferenceRating(TRACK_F, 3),
                PreferenceRating(TRACK_G, 3),
            ),
        )

        self.assertEqual(
            (_genre_affinity(model, "house").score_ppm, _genre_affinity(model, "house").evidence_count),
            (500_000, 2),
        )
        direct_and_genre = candidate_preference(model, TRACK_A, "HOUSE")
        genre_only = candidate_preference(model, TRACK_D, "House")
        negative_not_missing = candidate_preference(model, TRACK_B, "house")

        self.assertEqual(
            (
                direct_and_genre.score_ppm,
                direct_and_genre.quality_ppm,
                direct_and_genre.supporting_evidence_count,
            ),
            (833_333, 400_000, 4),
        )
        self.assertEqual(
            (genre_only.score_ppm, genre_only.quality_ppm, genre_only.supporting_evidence_count),
            (500_000, 200_000, 2),
        )
        self.assertEqual(negative_not_missing.score_ppm, 166_667)
        self.assertIsNone(candidate_preference(model, TRACK_C, "Techno"))

    def test_inactive_profile_and_missing_affinity_return_missing_evidence(self):
        learning = build_preference_model(
            (_track(TRACK_A), _track(TRACK_B)),
            (PreferenceEvent("liked", TRACK_A),),
            (),
        )
        active = build_preference_model(
            (_track(TRACK_A), _track(TRACK_B, "Techno")),
            tuple(PreferenceEvent("liked", TRACK_A) for _ in range(5)),
            (),
        )

        self.assertIsNone(candidate_preference(learning, TRACK_A, "House"))
        self.assertIsNone(candidate_preference(active, TRACK_B, "Techno"))

    def test_public_profile_is_path_free_and_caps_affinities_without_losing_scoring_data(self):
        tracks = tuple(
            _track(f"00000000-0000-4000-8001-{number:012d}", f"Genre {number:02d}")
            for number in range(60)
        )
        events = tuple(PreferenceEvent("liked", track.track_id) for track in tracks)

        model = build_preference_model(tracks, events, ())
        serialized = json.dumps(asdict(model.profile), sort_keys=True)

        self.assertEqual(len(model.profile.track_affinities), 50)
        self.assertEqual(len(model.profile.genre_affinities), 50)
        self.assertTrue(model.profile.track_affinities_truncated)
        self.assertTrue(model.profile.genre_affinities_truncated)
        self.assertNotIn("path", serialized.casefold())
        self.assertNotIn("external_id", serialized.casefold())
        self.assertNotIn("audio", serialized.casefold())
        self.assertIsNotNone(
            candidate_preference(model, tracks[-1].track_id, tracks[-1].genre)
        )
        with self.assertRaises(FrozenInstanceError):
            model.profile.status = "baseline"

    def test_stale_references_do_not_become_effective_evidence(self):
        model = build_preference_model(
            (_track(TRACK_A),),
            (
                PreferenceEvent("liked", "removed-track"),
                PreferenceEvent("manual_replacement", "removed-track", TRACK_A),
            ),
            (PreferenceRating("removed-rating", 5),),
        )

        self.assertEqual(model.profile.total_personal_data_count, 3)
        self.assertEqual(model.profile.effective_evidence_count, 1)
        self.assertEqual(_track_affinity(model, TRACK_A).score_ppm, 1_000_000)

    def test_invalid_records_are_rejected_instead_of_silently_coerced(self):
        invalid_calls = (
            lambda: build_preference_model((_track(TRACK_A), _track(TRACK_A)), (), ()),
            lambda: build_preference_model(
                (_track(TRACK_A),),
                (PreferenceEvent("unknown", TRACK_A),),
                (),
            ),
            lambda: build_preference_model(
                (_track(TRACK_A),),
                (PreferenceEvent("manual_replacement", TRACK_A),),
                (),
            ),
            lambda: build_preference_model(
                (_track(TRACK_A),),
                (),
                (PreferenceRating(TRACK_A, True),),
            ),
            lambda: build_preference_model(
                (_track(TRACK_A),),
                (),
                (PreferenceRating(TRACK_A, 6),),
            ),
        )

        for call in invalid_calls:
            with self.subTest(call=call), self.assertRaises(PersonalizationError):
                call()


if __name__ == "__main__":
    unittest.main()
