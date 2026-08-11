from dataclasses import FrozenInstanceError, replace
import json
from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dj_copilot.analysis.provider import AnalysisFeatures
from dj_copilot.discovery import (
    DiscoveryError,
    RecommendationResult,
    SimilarityResult,
    TrackEvidence,
    TrackFilters,
    filter_evidence,
    find_similar_tracks,
    recommend_next_tracks,
    score_transition,
    strip_preference,
)
from dj_copilot.models import AnalysisSummary, StoredTrack
from dj_copilot.personalization import PreferenceEvidence


ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "fixtures" / "discovery" / "m3-library.json"
SEED_ID = "00000000-0000-4000-8000-000000000001"


def _load_catalog() -> tuple[tuple[TrackEvidence, ...], dict[str, TrackEvidence], dict[str, str]]:
    document = json.loads(FIXTURE.read_text(encoding="utf-8"))
    catalog = []
    roles = {}
    for payload in document["tracks"]:
        track = StoredTrack(
            id=payload["id"],
            external_id=payload["external_id"],
            title=payload["title"],
            artist=payload["artist"],
            album=payload["album"],
            genre=payload["genre"],
            bpm_milli=payload["bpm_milli"],
            musical_key=payload["musical_key"],
            duration_ms=payload["duration_ms"],
            availability=payload["availability"],
        )
        analysis_payload = payload["analysis"]
        analysis = None
        if analysis_payload is not None:
            features_payload = analysis_payload["features"]
            features = None
            if features_payload is not None:
                features_payload = dict(features_payload)
                features_payload["tempo_candidates_milli"] = tuple(features_payload["tempo_candidates_milli"])
                features_payload["energy_curve_ppm"] = tuple(features_payload["energy_curve_ppm"])
                features_payload["limitations"] = tuple(features_payload["limitations"])
                features = AnalysisFeatures(**features_payload)
            analysis = AnalysisSummary(
                status=analysis_payload["status"],
                progress_ppm=analysis_payload["progress_ppm"],
                attempt_count=analysis_payload["attempt_count"],
                error_code=analysis_payload["error_code"],
                error_message=analysis_payload["error_message"],
                features=features,
            )
        evidence = TrackEvidence(
            track=track,
            analysis=analysis,
            playlist_ids=tuple(payload["playlist_ids"]),
        )
        catalog.append(evidence)
        roles[payload["role"]] = evidence
    return tuple(catalog), roles, document["playlists"]


def _with_track(evidence: TrackEvidence, **changes) -> TrackEvidence:
    return replace(evidence, track=replace(evidence.track, **changes))


def _with_features(evidence: TrackEvidence, **changes) -> TrackEvidence:
    if evidence.analysis is None or evidence.analysis.features is None:
        raise AssertionError("test evidence must contain local features")
    return replace(
        evidence,
        analysis=replace(
            evidence.analysis,
            features=replace(evidence.analysis.features, **changes),
        ),
    )


def _component(candidate, name: str):
    return next(component for component in candidate.components if component.name == name)


class DiscoveryFilterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog, cls.roles, cls.playlists = _load_catalog()

    def test_records_are_immutable_and_empty_filters_preserve_input_order(self):
        filters = TrackFilters()

        self.assertEqual(filter_evidence(self.catalog, filters), self.catalog)
        with self.assertRaises(FrozenInstanceError):
            filters.text = "changed"
        with self.assertRaises(FrozenInstanceError):
            self.roles["seed"].playlist_ids = ()

    def test_casefolded_tokens_match_across_unicode_display_fields(self):
        matched = filter_evidence(self.catalog, TrackFilters(text="STRASSE ÉLAN"))

        self.assertEqual(matched, (self.roles["unicode_bridge"],))

    def test_combined_filters_use_effective_local_evidence_and_and_semantics(self):
        matched = filter_evidence(
            self.catalog,
            TrackFilters(
                text="fixture ascent",
                playlist_id=self.playlists["main"],
                bpm_min_milli=120_000,
                bpm_max_milli=120_000,
                musical_key="8B",
                key_relation="exact",
                genre="HOUSE",
                energy_min_ppm=600_000,
                energy_max_ppm=700_000,
                analysis_state="analyzed",
                availability="available",
            ),
        )

        self.assertEqual(matched, (self.roles["build"],))

    def test_local_tempo_and_key_override_imported_values_only_after_success(self):
        seed = self.roles["seed"]
        local_match = filter_evidence(
            (seed,),
            TrackFilters(
                bpm_min_milli=120_000,
                bpm_max_milli=120_000,
                musical_key="C major",
                key_relation="exact",
            ),
        )
        imported_miss = filter_evidence(
            (seed,),
            TrackFilters(
                bpm_min_milli=124_000,
                bpm_max_milli=124_000,
                musical_key="8A",
                key_relation="exact",
            ),
        )
        failed_with_stale_features = replace(
            seed,
            analysis=replace(seed.analysis, status="failed"),
        )
        failed_match = filter_evidence(
            (failed_with_stale_features,),
            TrackFilters(
                bpm_min_milli=124_000,
                bpm_max_milli=124_000,
                musical_key="8A",
                key_relation="exact",
                analysis_state="failed",
            ),
        )

        self.assertEqual(local_match, (seed,))
        self.assertEqual(imported_miss, ())
        self.assertEqual(failed_match, (failed_with_stale_features,))

    def test_exact_and_compatible_keys_normalize_camelot_notes_sharps_and_flats(self):
        exact = filter_evidence(
            self.catalog,
            TrackFilters(musical_key="C major", key_relation="exact"),
        )
        compatible = filter_evidence(
            self.catalog,
            TrackFilters(musical_key="8B", key_relation="compatible"),
        )
        flat = _with_track(
            self.roles["compatible_key"],
            id="00000000-0000-4000-8000-000000000009",
            musical_key="D♭ minor",
        )
        sharp_exact = filter_evidence(
            (flat,),
            TrackFilters(musical_key="C# minor", key_relation="exact"),
        )

        self.assertEqual(
            [item.track.id for item in exact],
            [
                SEED_ID,
                self.roles["build"].track.id,
                self.roles["reset"].track.id,
                self.roles["half_tempo"].track.id,
                self.roles["unicode_bridge"].track.id,
            ],
        )
        self.assertEqual([item.track.id for item in compatible], [item.track.id for item in self.catalog[:7]])
        self.assertEqual(sharp_exact, (flat,))

    def test_analysis_state_and_availability_keep_failed_distinct_from_analyzed(self):
        analyzed = filter_evidence(self.catalog, TrackFilters(analysis_state="analyzed"))
        failed = filter_evidence(self.catalog, TrackFilters(analysis_state="failed"))
        not_analyzed = filter_evidence(self.catalog, TrackFilters(analysis_state="not_analyzed"))
        missing = filter_evidence(self.catalog, TrackFilters(availability="missing"))

        self.assertEqual(
            [item.track.id for item in analyzed],
            [
                self.roles["seed"].track.id,
                self.roles["smooth_match"].track.id,
                self.roles["build"].track.id,
                self.roles["reset"].track.id,
                self.roles["unicode_bridge"].track.id,
            ],
        )
        self.assertEqual(failed, (self.roles["sparse_unavailable"],))
        self.assertEqual(
            [item.track.id for item in not_analyzed],
            [
                self.roles["compatible_key"].track.id,
                self.roles["half_tempo"].track.id,
                self.roles["sparse_unavailable"].track.id,
            ],
        )
        self.assertEqual(missing, (self.roles["sparse_unavailable"],))

    def test_rating_tag_and_metadata_text_filters_compose_with_exact_tag_semantics(self):
        enriched = replace(
            self.roles["build"],
            rating=4,
            tags=("Peak Time", "Élan"),
            note="Golden bridge for the late set",
        )
        lower_rating = replace(
            self.roles["reset"],
            rating=3,
            tags=("Peak",),
            note="Golden alternative",
        )

        matched = filter_evidence(
            (lower_rating, enriched),
            TrackFilters(
                text="golden peak",
                rating_min=4,
                tag="peak time",
            ),
        )
        exact_tag_miss = filter_evidence(
            (enriched,),
            TrackFilters(tag="peak"),
        )
        unicode_tag = filter_evidence(
            (enriched,),
            TrackFilters(text="ÉLAN", tag="élan"),
        )

        self.assertEqual(matched, (enriched,))
        self.assertEqual(exact_tag_miss, ())
        self.assertEqual(unicode_tag, (enriched,))


class SimilarityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog, cls.roles, cls.playlists = _load_catalog()

    def test_similarity_uses_hand_calculated_integer_scores_and_mixed_quality(self):
        result = find_similar_tracks(self.catalog, SEED_ID, limit=20)
        by_id = {item.track.id: item for item in result.items}
        smooth = by_id[self.roles["smooth_match"].track.id]
        imported = by_id[self.roles["half_tempo"].track.id]

        self.assertIsInstance(result, SimilarityResult)
        self.assertEqual(result.algorithm_version, "feature-similarity-v1")
        self.assertEqual(result.scanned_count, 8)
        self.assertFalse(result.truncated)
        self.assertEqual(smooth.score_ppm, 948_943)
        self.assertEqual(smooth.confidence_ppm, 710_000)
        self.assertEqual(
            {component.name: component.score_ppm for component in smooth.components},
            {
                "tempo": 930_558,
                "key": 900_000,
                "energy": 980_000,
                "style": 1_000_000,
                "timbre": 968_691,
            },
        )
        self.assertEqual(imported.confidence_ppm, 390_000)

    def test_key_scores_cover_adjacent_same_number_and_known_incompatible(self):
        incompatible = _with_track(
            self.roles["compatible_key"],
            id="00000000-0000-4000-8000-000000000009",
            musical_key="1A",
        )
        result = find_similar_tracks(
            (self.roles["seed"], self.roles["smooth_match"], self.roles["compatible_key"], incompatible),
            SEED_ID,
            limit=20,
        )
        by_id = {item.track.id: item for item in result.items}

        self.assertEqual(_component(by_id[self.roles["smooth_match"].track.id], "key").score_ppm, 900_000)
        self.assertEqual(_component(by_id[self.roles["compatible_key"].track.id], "key").score_ppm, 800_000)
        self.assertEqual(_component(by_id[incompatible.track.id], "key").score_ppm, 0)

    def test_tempo_matches_half_and_double_time_and_reaches_zero_at_twelve_percent(self):
        double = _with_track(
            self.roles["half_tempo"],
            id="00000000-0000-4000-8000-000000000009",
            title="Half Echo",
            bpm_milli=240_000,
        )
        boundary = _with_track(
            self.roles["half_tempo"],
            id="00000000-0000-4000-8000-000000000010",
            title="Boundary Echo",
            bpm_milli=134_400,
        )
        result = find_similar_tracks(
            (self.roles["seed"], self.roles["half_tempo"], double, boundary),
            SEED_ID,
            limit=20,
        )
        by_id = {item.track.id: item for item in result.items}

        self.assertEqual(_component(by_id[self.roles["half_tempo"].track.id], "tempo").score_ppm, 1_000_000)
        self.assertEqual(_component(by_id[double.track.id], "tempo").score_ppm, 1_000_000)
        self.assertEqual(_component(by_id[boundary.track.id], "tempo").score_ppm, 0)

    def test_seed_and_unavailable_tracks_are_excluded_even_when_filter_requests_them(self):
        ordinary = find_similar_tracks(self.catalog, SEED_ID, limit=20, truncated=True)
        missing = find_similar_tracks(
            self.catalog,
            SEED_ID,
            filters=TrackFilters(availability="missing"),
            limit=20,
        )
        unreadable = find_similar_tracks(
            self.catalog,
            SEED_ID,
            filters=TrackFilters(availability="unreadable"),
            limit=20,
        )

        ids = {item.track.id for item in ordinary.items}
        self.assertNotIn(SEED_ID, ids)
        self.assertNotIn(self.roles["sparse_unavailable"].track.id, ids)
        self.assertEqual(len(ordinary.items), 6)
        self.assertTrue(ordinary.truncated)
        self.assertEqual(missing.items, ())
        self.assertEqual(unreadable.items, ())

    def test_missing_components_are_not_negative_evidence(self):
        all_missing = replace(
            self.roles["sparse_unavailable"],
            track=replace(
                self.roles["sparse_unavailable"].track,
                id="00000000-0000-4000-8000-000000000009",
                availability="available",
            ),
            analysis=None,
        )
        negative = _with_track(
            self.roles["compatible_key"],
            id="00000000-0000-4000-8000-000000000010",
            bpm_milli=None,
            musical_key="1A",
            genre="Techno",
        )
        result = find_similar_tracks((self.roles["seed"], all_missing, negative), SEED_ID, limit=20)
        by_id = {item.track.id: item for item in result.items}
        missing_item = by_id[all_missing.track.id]
        negative_item = by_id[negative.track.id]

        self.assertEqual(missing_item.score_ppm, 0)
        self.assertEqual(missing_item.confidence_ppm, 0)
        self.assertTrue(all(component.score_ppm is None for component in missing_item.components))
        self.assertTrue(all(component.effect == "missing" for component in missing_item.components))
        self.assertTrue(all(component.contribution_signed_ppm == 0 for component in missing_item.components))
        self.assertEqual(len(missing_item.reasons), 3)
        self.assertEqual(_component(negative_item, "key").score_ppm, 0)
        self.assertEqual(_component(negative_item, "key").effect, "penalty")
        self.assertEqual(_component(negative_item, "key").contribution_signed_ppm, -250_000)
        self.assertEqual(_component(missing_item, "key").score_ppm, None)
        self.assertEqual(_component(missing_item, "key").effect, "missing")

    def test_stable_ties_sort_by_normalized_metadata_then_id_and_results_are_capped(self):
        base = self.roles["compatible_key"]
        candidates = []
        for number in range(10, 35):
            candidates.append(
                _with_track(
                    base,
                    id=f"00000000-0000-4000-8000-{number:012d}",
                    external_id=str(number),
                    title=" Tie " if number % 2 else "tie",
                    artist="ARTIST" if number % 2 else "artist",
                )
            )
        result = find_similar_tracks(
            (self.roles["seed"], *reversed(candidates)),
            SEED_ID,
            limit=20,
        )

        self.assertEqual(len(result.items), 20)
        self.assertEqual(
            [item.track.id for item in result.items],
            [candidate.track.id for candidate in candidates[:20]],
        )
        self.assertFalse(hasattr(result.seed, "external_id"))
        self.assertFalse(hasattr(result.seed, "path"))


class RecommendationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog, cls.roles, cls.playlists = _load_catalog()

    def test_every_intent_uses_the_frozen_weights_directions_and_target_endpoints(self):
        expected = {
            "smooth": (
                self.roles["smooth_match"].track.id,
                "energy",
                980_000,
                {"tempo": 300_000, "key": 250_000, "energy": 200_000, "style": 150_000, "timbre": 100_000},
            ),
            "build": (
                self.roles["build"].track.id,
                "energy",
                1_000_000,
                {"tempo": 200_000, "key": 150_000, "energy": 350_000, "style": 150_000, "timbre": 150_000},
            ),
            "peak": (
                self.roles["unicode_bridge"].track.id,
                "energy",
                1_000_000,
                {"tempo": 150_000, "key": 150_000, "energy": 400_000, "style": 100_000, "timbre": 200_000},
            ),
            "reset": (
                self.roles["reset"].track.id,
                "energy",
                1_000_000,
                {"tempo": 150_000, "key": 150_000, "energy": 400_000, "style": 150_000, "timbre": 150_000},
            ),
            "genre_shift": (
                self.roles["unicode_bridge"].track.id,
                "style",
                1_000_000,
                {"tempo": 150_000, "key": 150_000, "energy": 150_000, "style": 350_000, "timbre": 200_000},
            ),
            "adventurous": (
                self.roles["unicode_bridge"].track.id,
                "style",
                1_000_000,
                {"tempo": 150_000, "key": 100_000, "energy": 200_000, "style": 250_000, "timbre": 300_000},
            ),
            "singalong_continuation": (
                self.roles["smooth_match"].track.id,
                "vocal",
                None,
                {"tempo": 200_000, "key": 150_000, "energy": 200_000, "style": 150_000, "timbre": 100_000, "vocal": 200_000},
            ),
            "closer": (
                self.roles["reset"].track.id,
                "structure",
                None,
                {"tempo": 150_000, "key": 200_000, "energy": 300_000, "style": 150_000, "timbre": 100_000, "structure": 100_000},
            ),
        }

        for intent, (track_id, component_name, score_ppm, weights) in expected.items():
            with self.subTest(intent=intent):
                result = recommend_next_tracks(self.catalog, SEED_ID, intent, limit=20)
                by_id = {item.track.id: item for item in result.items}
                candidate = by_id[track_id]

                self.assertIsInstance(result, RecommendationResult)
                self.assertEqual(result.intent, intent)
                self.assertEqual(result.algorithm_version, "transition-v1")
                self.assertEqual(result.scanned_count, 8)
                self.assertEqual(_component(candidate, component_name).score_ppm, score_ppm)
                self.assertEqual(
                    {component.name: component.weight_ppm for component in candidate.components},
                    weights,
                )
                if component_name in {"vocal", "structure"}:
                    limitation = _component(candidate, component_name)
                    self.assertEqual(limitation.effect, "missing")
                    self.assertIn(limitation.reason, candidate.reasons)

    def test_public_pair_scorer_reuses_the_exact_transition_v1_candidate(self):
        expected = next(
            item
            for item in recommend_next_tracks(
                self.catalog,
                SEED_ID,
                "build",
                limit=20,
            ).items
            if item.track.id == self.roles["build"].track.id
        )

        actual = score_transition(
            self.roles["seed"],
            self.roles["build"],
            "build",
        )

        self.assertEqual(actual, expected)

    def test_round_half_up_and_signed_half_away_from_zero_are_exact(self):
        reset_tie = _with_features(self.roles["reset"], energy_ppm=299_999)
        reset_result = recommend_next_tracks(
            (self.roles["seed"], reset_tie),
            SEED_ID,
            "reset",
            limit=20,
        )

        rounding_seed = _with_features(
            self.roles["seed"],
            brightness_ppm=0,
            beat_strength_ppm=0,
            onset_rate_milli_hz=1_000_000,
            spectral_centroid_hz=1_000_000,
        )
        positive = _with_features(
            self.roles["build"],
            brightness_ppm=499_995,
            beat_strength_ppm=499_995,
            onset_rate_milli_hz=500_005,
            spectral_centroid_hz=500_005,
        )
        negative = _with_features(
            self.roles["reset"],
            brightness_ppm=500_005,
            beat_strength_ppm=500_005,
            onset_rate_milli_hz=499_995,
            spectral_centroid_hz=499_995,
        )
        contribution_result = recommend_next_tracks(
            (rounding_seed, positive, negative),
            SEED_ID,
            "build",
            limit=20,
        )
        by_id = {item.track.id: item for item in contribution_result.items}

        self.assertEqual(_component(reset_result.items[0], "energy").score_ppm, 999_997)
        self.assertEqual(_component(by_id[positive.track.id], "timbre").score_ppm, 500_005)
        self.assertEqual(_component(by_id[positive.track.id], "timbre").contribution_signed_ppm, 2)
        self.assertEqual(_component(by_id[negative.track.id], "timbre").score_ppm, 499_995)
        self.assertEqual(_component(by_id[negative.track.id], "timbre").contribution_signed_ppm, -2)

    def test_reasons_and_components_are_bounded_and_effects_are_transparent(self):
        for intent in (
            "smooth",
            "build",
            "peak",
            "reset",
            "genre_shift",
            "adventurous",
            "singalong_continuation",
            "closer",
        ):
            with self.subTest(intent=intent):
                result = recommend_next_tracks(self.catalog, SEED_ID, intent, limit=20)
                for candidate in result.items:
                    self.assertLessEqual(len(candidate.reasons), 3)
                    self.assertGreaterEqual(len(candidate.reasons), 1)
                    self.assertTrue(all(1 <= len(reason) <= 200 for reason in candidate.reasons))
                    self.assertTrue(1 <= len(candidate.components) <= 8)
                    for component in candidate.components:
                        self.assertTrue(1 <= len(component.reason) <= 200)
                        self.assertIn(component.effect, {"bonus", "penalty", "neutral", "missing"})
                        if component.effect == "missing":
                            self.assertIsNone(component.score_ppm)
                            self.assertEqual(component.contribution_signed_ppm, 0)

    def test_active_preference_reorders_ties_and_baseline_stripping_is_exact(self):
        base = self.roles["compatible_key"]
        disliked = replace(
            _with_track(
                base,
                id="00000000-0000-4000-8000-000000000051",
                external_id="preference-51",
                title="Alpha",
            ),
            rating=1,
            tags=("Keep",),
            note="Metadata survives baseline stripping",
            preference=PreferenceEvidence(
                score_ppm=0,
                quality_ppm=500_000,
                weight_ppm=150_000,
                supporting_evidence_count=5,
            ),
        )
        liked = replace(
            _with_track(
                base,
                id="00000000-0000-4000-8000-000000000052",
                external_id="preference-52",
                title="Beta",
            ),
            preference=PreferenceEvidence(
                score_ppm=1_000_000,
                quality_ppm=500_000,
                weight_ppm=150_000,
                supporting_evidence_count=5,
            ),
        )
        personalized_catalog = (self.roles["seed"], disliked, liked)

        baseline_catalog = strip_preference(personalized_catalog)
        baseline = recommend_next_tracks(baseline_catalog, SEED_ID, "smooth", limit=20)
        personalized = recommend_next_tracks(personalized_catalog, SEED_ID, "smooth", limit=20)

        self.assertEqual([item.track.id for item in baseline.items], [disliked.track.id, liked.track.id])
        self.assertEqual([item.track.id for item in personalized.items], [liked.track.id, disliked.track.id])
        self.assertEqual(baseline.items[0].score_ppm, baseline.items[1].score_ppm)
        self.assertEqual(_component(personalized.items[0], "preference").score_ppm, 1_000_000)
        self.assertEqual(_component(personalized.items[0], "preference").weight_ppm, 150_000)
        self.assertEqual(_component(personalized.items[1], "preference").score_ppm, 0)
        self.assertEqual(_component(personalized.items[1], "preference").effect, "penalty")
        self.assertTrue(all(component.name != "preference" for item in baseline.items for component in item.components))
        self.assertEqual(baseline_catalog[1].rating, 1)
        self.assertEqual(baseline_catalog[1].tags, ("Keep",))
        self.assertEqual(baseline_catalog[1].note, "Metadata survives baseline stripping")
        self.assertIsNone(baseline_catalog[1].preference)
        self.assertIsNotNone(disliked.preference)

    def test_missing_preference_is_absent_while_explicit_negative_evidence_is_a_penalty(self):
        base = self.roles["compatible_key"]
        missing = _with_track(
            base,
            id="00000000-0000-4000-8000-000000000053",
            external_id="preference-53",
            title="Missing",
        )
        negative = replace(
            _with_track(
                base,
                id="00000000-0000-4000-8000-000000000054",
                external_id="preference-54",
                title="Negative",
            ),
            preference=PreferenceEvidence(0, 500_000, 150_000, 5),
        )

        result = recommend_next_tracks(
            (self.roles["seed"], missing, negative),
            SEED_ID,
            "smooth",
            limit=20,
        )
        by_id = {item.track.id: item for item in result.items}

        self.assertTrue(all(component.name != "preference" for component in by_id[missing.track.id].components))
        self.assertEqual(_component(by_id[negative.track.id], "preference").score_ppm, 0)
        self.assertEqual(_component(by_id[negative.track.id], "preference").effect, "penalty")


class DiscoveryValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog, cls.roles, cls.playlists = _load_catalog()

    def test_unknown_seed_is_not_found_instead_of_empty_success(self):
        with self.assertRaises(DiscoveryError) as raised:
            find_similar_tracks(self.catalog, "00000000-0000-4000-8000-999999999999")

        self.assertEqual(raised.exception.code, "not_found")

    def test_domain_entry_points_reject_invalid_bounds_ranges_ids_and_enums(self):
        invalid_filters = (
            TrackFilters(text=""),
            TrackFilters(text="x" * 201),
            TrackFilters(playlist_id=""),
            TrackFilters(bpm_min_milli=29_999),
            TrackFilters(bpm_max_milli=400_001),
            TrackFilters(bpm_min_milli=130_000, bpm_max_milli=120_000),
            TrackFilters(musical_key=""),
            TrackFilters(musical_key="x" * 65),
            TrackFilters(key_relation="exact"),
            TrackFilters(musical_key="8B", key_relation="near"),
            TrackFilters(genre=""),
            TrackFilters(genre="x" * 201),
            TrackFilters(energy_min_ppm=-1),
            TrackFilters(energy_max_ppm=1_000_001),
            TrackFilters(energy_min_ppm=700_000, energy_max_ppm=600_000),
            TrackFilters(analysis_state="complete"),
            TrackFilters(availability="offline"),
            TrackFilters(rating_min=0),
            TrackFilters(rating_min=6),
            TrackFilters(rating_min=True),
            TrackFilters(tag=""),
            TrackFilters(tag="x" * 41),
            TrackFilters(tag=" tag "),
        )
        for filters in invalid_filters:
            with self.subTest(filters=filters), self.assertRaises(DiscoveryError) as raised:
                filter_evidence(self.catalog, filters)
            self.assertEqual(raised.exception.code, "invalid_request")

        invalid_calls = (
            lambda: filter_evidence(list(self.catalog), TrackFilters()),
            lambda: find_similar_tracks(self.catalog, ""),
            lambda: find_similar_tracks(self.catalog, "x" * 129),
            lambda: find_similar_tracks(self.catalog, SEED_ID, limit=0),
            lambda: find_similar_tracks(self.catalog, SEED_ID, limit=21),
            lambda: find_similar_tracks(self.catalog, SEED_ID, limit=True),
            lambda: find_similar_tracks(self.catalog, SEED_ID, truncated=1),
            lambda: recommend_next_tracks(self.catalog, SEED_ID, "unknown"),
            lambda: filter_evidence(
                (
                    replace(
                        self.roles["seed"],
                        preference=PreferenceEvidence(1_000_001, 500_000, 15_000, 1),
                    ),
                )
            ),
        )
        for call in invalid_calls:
            with self.subTest(call=call), self.assertRaises(DiscoveryError) as raised:
                call()
            self.assertEqual(raised.exception.code, "invalid_request")


if __name__ == "__main__":
    unittest.main()
