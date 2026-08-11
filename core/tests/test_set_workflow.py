from __future__ import annotations

from dataclasses import replace
import json
from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dj_copilot.analysis.provider import AnalysisFeatures
from dj_copilot.discovery import TrackEvidence, TrackFilters, score_transition
from dj_copilot.models import AnalysisSummary, StoredTrack
from dj_copilot.personalization import PreferenceEvidence
from dj_copilot.set_workflow import (
    DraftEntry,
    DraftError,
    DraftPlan,
    DraftState,
    apply_draft_mutation,
    create_draft,
    draft_state_from_payload,
    draft_state_to_payload,
    find_replacements,
    generate_draft,
    inspect_set,
    optimize_draft,
)


ROOT = Path(__file__).resolve().parents[2]
DISCOVERY_FIXTURE = ROOT / "fixtures" / "discovery" / "m3-library.json"
SET_FIXTURE = ROOT / "fixtures" / "sets" / "m4-set.json"


def _load_catalog() -> tuple[tuple[TrackEvidence, ...], dict[str, TrackEvidence]]:
    document = json.loads(DISCOVERY_FIXTURE.read_text(encoding="utf-8"))
    catalog: list[TrackEvidence] = []
    roles: dict[str, TrackEvidence] = {}
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
                normalized = dict(features_payload)
                normalized["tempo_candidates_milli"] = tuple(normalized["tempo_candidates_milli"])
                normalized["energy_curve_ppm"] = tuple(normalized["energy_curve_ppm"])
                normalized["limitations"] = tuple(normalized["limitations"])
                features = AnalysisFeatures(**normalized)
            analysis = AnalysisSummary(
                status=analysis_payload["status"],
                progress_ppm=analysis_payload["progress_ppm"],
                attempt_count=analysis_payload["attempt_count"],
                error_code=analysis_payload["error_code"],
                error_message=analysis_payload["error_message"],
                features=features,
            )
        evidence = TrackEvidence(track, analysis, tuple(payload["playlist_ids"]))
        catalog.append(evidence)
        roles[payload["role"]] = evidence
    return tuple(catalog), roles


class _IdFactory:
    def __init__(self, prefix: int = 3):
        self.prefix = prefix
        self.next_value = 1

    def __call__(self) -> str:
        value = f"{self.prefix}0000000-0000-4000-8000-{self.next_value:012d}"
        self.next_value += 1
        return value


def _entry(number: int, evidence: TrackEvidence, **changes) -> DraftEntry:
    return DraftEntry(
        id=f"40000000-0000-4000-8000-{number:012d}",
        track_id=evidence.track.id,
        **changes,
    )


def _plan(**changes) -> DraftPlan:
    return replace(DraftPlan(intent="smooth"), **changes)


class DraftSnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.document = json.loads(SET_FIXTURE.read_text(encoding="utf-8"))

    def test_strict_snapshot_round_trip_preserves_repeats_and_both_pin_types(self):
        state = draft_state_from_payload(self.document["snapshot"])
        expected_v4 = json.loads(json.dumps(self.document["snapshot"]))
        expected_v4["plan"]["candidateFilters"].update(
            {"ratingMin": None, "tag": None}
        )

        self.assertEqual(draft_state_to_payload(state), expected_v4)
        self.assertEqual(len(state.entries), 4)
        self.assertEqual(state.entries[2].track_id, state.entries[3].track_id)
        self.assertTrue(state.entries[0].track_pinned)
        self.assertFalse(state.entries[0].position_pinned)
        self.assertTrue(state.entries[1].track_pinned)
        self.assertTrue(state.entries[1].position_pinned)

    def test_decoder_accepts_exact_v3_or_v4_filters_and_rejects_hybrid_shapes(self):
        v3 = json.loads(json.dumps(self.document["snapshot"]))
        v4 = json.loads(json.dumps(v3))
        v4["plan"]["candidateFilters"].update(
            {"ratingMin": 4, "tag": "Peak Time"}
        )
        hybrid = json.loads(json.dumps(v3))
        hybrid["plan"]["candidateFilters"]["ratingMin"] = 4
        unknown = json.loads(json.dumps(v4))
        unknown["plan"]["candidateFilters"]["unknown"] = None

        old_state = draft_state_from_payload(v3)
        new_state = draft_state_from_payload(v4)

        self.assertIsNone(old_state.plan.candidate_filters.rating_min)
        self.assertIsNone(old_state.plan.candidate_filters.tag)
        self.assertEqual(new_state.plan.candidate_filters.rating_min, 4)
        self.assertEqual(new_state.plan.candidate_filters.tag, "Peak Time")
        self.assertEqual(
            set(draft_state_to_payload(old_state)["plan"]["candidateFilters"]),
            {
                "text",
                "playlistId",
                "bpmMinMilli",
                "bpmMaxMilli",
                "musicalKey",
                "keyRelation",
                "genre",
                "energyMinPpm",
                "energyMaxPpm",
                "analysisState",
                "availability",
                "ratingMin",
                "tag",
            },
        )
        for payload in (hybrid, unknown):
            with self.subTest(payload=payload), self.assertRaises(DraftError) as raised:
                draft_state_from_payload(payload)
            self.assertEqual(raised.exception.code, "invalid_snapshot")

    def test_snapshot_rejects_unknown_fields_bad_bounds_and_broken_invariants(self):
        original = self.document["snapshot"]
        invalid_payloads = []

        extra = json.loads(json.dumps(original))
        extra["extra"] = True
        invalid_payloads.append(extra)

        position_without_track = json.loads(json.dumps(original))
        position_without_track["entries"][1]["trackPinned"] = False
        invalid_payloads.append(position_without_track)

        duplicate_entry_id = json.loads(json.dumps(original))
        duplicate_entry_id["entries"][1]["id"] = duplicate_entry_id["entries"][0]["id"]
        invalid_payloads.append(duplicate_entry_id)

        unsorted_bans = json.loads(json.dumps(original))
        unsorted_bans["bans"] = ["z", "a"]
        invalid_payloads.append(unsorted_bans)

        banned_current_track = json.loads(json.dumps(original))
        banned_current_track["bans"] = [banned_current_track["entries"][0]["trackId"]]
        invalid_payloads.append(banned_current_track)

        too_many_entries = json.loads(json.dumps(original))
        base = too_many_entries["entries"][0]
        too_many_entries["entries"] = [
            {**base, "id": f"50000000-0000-4000-8000-{index:012d}"}
            for index in range(101)
        ]
        invalid_payloads.append(too_many_entries)

        for payload in invalid_payloads:
            with self.subTest(payload=payload), self.assertRaises(DraftError) as raised:
                draft_state_from_payload(payload)
            self.assertEqual(raised.exception.code, "invalid_snapshot")


class DraftCreationAndMutationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog, cls.roles = _load_catalog()
        cls.fixture_state = draft_state_from_payload(
            json.loads(SET_FIXTURE.read_text(encoding="utf-8"))["snapshot"]
        )

    def test_create_preserves_playlist_repeats_but_can_require_unique_selected_tracks(self):
        repeated = (self.roles["seed"].track.id, self.roles["seed"].track.id)

        playlist_state = create_draft(
            "Repeated playlist",
            _plan(),
            repeated,
            self.catalog,
            allow_repeated_tracks=True,
            entry_id_factory=_IdFactory(),
        )
        with self.assertRaises(DraftError) as raised:
            create_draft(
                "Selected tracks",
                _plan(),
                repeated,
                self.catalog,
                allow_repeated_tracks=False,
                entry_id_factory=_IdFactory(),
            )

        self.assertEqual([entry.track_id for entry in playlist_state.entries], list(repeated))
        self.assertEqual(raised.exception.code, "invalid_request")

    def test_generation_keeps_artist_cap_hard_and_returns_a_deterministic_partial_draft(self):
        plan = _plan(target_duration_ms=1_200_000, max_artist_repeats=1)
        seed_id = self.roles["seed"].track.id

        forward = generate_draft(
            "Artist cap",
            plan,
            self.catalog,
            max_tracks=5,
            seed_track_id=seed_id,
            entry_id_factory=_IdFactory(),
            scan_truncated=True,
        )
        backward = generate_draft(
            "Artist cap",
            plan,
            tuple(reversed(self.catalog)),
            max_tracks=5,
            seed_track_id=seed_id,
            entry_id_factory=_IdFactory(),
            scan_truncated=True,
        )

        forward_ids = [entry.track_id for entry in forward.state.entries]
        self.assertEqual(forward_ids, [entry.track_id for entry in backward.state.entries])
        self.assertEqual(forward_ids[0], seed_id)
        self.assertEqual(len(forward_ids), 2)
        self.assertEqual(
            {evidence.track.artist.strip().casefold() for evidence in self.catalog if evidence.track.id in forward_ids},
            {"generated fixture", "strasse atelier"},
        )
        self.assertEqual(
            {notice.code for notice in forward.unmet_constraints},
            {"max_artist_repeats", "target_duration", "track_count"},
        )
        self.assertEqual((forward.scanned_count, forward.scan_truncated), (8, True))

    def test_generation_uses_known_energy_seed_and_unknown_artists_do_not_share_a_cap(self):
        unknown_one = replace(
            self.roles["reset"],
            track=replace(
                self.roles["reset"].track,
                id="00000000-0000-4000-8000-000000000021",
                external_id="21",
                title="Unknown One",
                artist=None,
            ),
        )
        unknown_two = replace(
            self.roles["build"],
            track=replace(
                self.roles["build"].track,
                id="00000000-0000-4000-8000-000000000022",
                external_id="22",
                title="Unknown Two",
                artist="  ",
            ),
        )
        result = generate_draft(
            "Unknown artists",
            _plan(max_artist_repeats=1),
            (unknown_two, self.roles["seed"], unknown_one),
            max_tracks=3,
            entry_id_factory=_IdFactory(),
        )

        self.assertEqual(result.state.entries[0].track_id, unknown_one.track.id)
        self.assertEqual(len(result.state.entries), 3)
        self.assertEqual(result.unmet_constraints, ())

    def test_mutations_enforce_track_and_position_pins_and_apply_bans_and_goals(self):
        position_entry = self.fixture_state.entries[1]
        track_entry = self.fixture_state.entries[0]
        repeated_entry = self.fixture_state.entries[3]

        for mutation in (
            {"type": "remove_entry", "entry_id": track_entry.id},
            {"type": "replace_entry", "entry_id": position_entry.id, "replacement_track_id": self.roles["build"].track.id},
            {"type": "insert_track", "track_id": self.roles["build"].track.id, "to_index": 0},
        ):
            with self.subTest(mutation=mutation), self.assertRaises(DraftError) as raised:
                apply_draft_mutation(self.fixture_state, mutation, self.catalog, entry_id_factory=_IdFactory())
            self.assertEqual(raised.exception.code, "pin_conflict")

        without_position_pin = apply_draft_mutation(
            self.fixture_state,
            {"type": "set_position_pin", "entry_id": position_entry.id, "pinned": False},
            self.catalog,
        )
        moved = apply_draft_mutation(
            without_position_pin,
            {"type": "move_entry", "entry_id": track_entry.id, "to_index": 2},
            self.catalog,
        )
        repinned = apply_draft_mutation(
            moved,
            {"type": "set_position_pin", "entry_id": repeated_entry.id, "pinned": True},
            self.catalog,
        )
        cleared_position = apply_draft_mutation(
            repinned,
            {"type": "set_position_pin", "entry_id": repeated_entry.id, "pinned": False},
            self.catalog,
        )
        untrack_pinned = apply_draft_mutation(
            cleared_position,
            {"type": "set_track_pin", "entry_id": repeated_entry.id, "pinned": False},
            self.catalog,
        )
        goal = apply_draft_mutation(
            untrack_pinned,
            {"type": "set_entry_goal", "entry_id": position_entry.id, "role": "build", "target_energy_ppm": 700_000},
            self.catalog,
        )
        banned = apply_draft_mutation(
            goal,
            {"type": "ban_entry", "entry_id": position_entry.id},
            self.catalog,
        )
        unbanned = apply_draft_mutation(
            banned,
            {"type": "unban_track", "track_id": repeated_entry.track_id},
            self.catalog,
        )

        self.assertEqual([entry.id for entry in moved.entries], [entry.id for entry in self.fixture_state.entries])
        self.assertEqual(moved.entries[2].track_id, track_entry.track_id)
        self.assertTrue(moved.entries[2].track_pinned)
        self.assertTrue(repinned.entries[next(i for i, item in enumerate(repinned.entries) if item.id == repeated_entry.id)].track_pinned)
        cleared = next(item for item in cleared_position.entries if item.id == repeated_entry.id)
        self.assertTrue(cleared.track_pinned)
        self.assertFalse(cleared.position_pinned)
        goal_entry = next(item for item in goal.entries if item.id == position_entry.id)
        self.assertEqual((goal_entry.role, goal_entry.target_energy_ppm), ("build", 700_000))
        self.assertNotIn(goal_entry.track_id, [entry.track_id for entry in banned.entries])
        self.assertEqual(banned.bans, tuple(sorted((*goal.bans, goal_entry.track_id))))
        self.assertNotIn(goal_entry.track_id, unbanned.bans)

    def test_mutation_is_strict_and_new_track_ids_must_be_current(self):
        with self.assertRaises(DraftError) as extra:
            apply_draft_mutation(
                self.fixture_state,
                {"type": "rename", "title": "New", "extra": True},
                self.catalog,
            )
        with self.assertRaises(DraftError) as unknown:
            apply_draft_mutation(
                self.fixture_state,
                {"type": "insert_track", "track_id": "removed-track", "to_index": 4},
                self.catalog,
            )

        self.assertEqual(extra.exception.code, "invalid_request")
        self.assertEqual(unknown.exception.code, "not_found")

        no_op = apply_draft_mutation(
            self.fixture_state,
            {"type": "rename", "title": self.fixture_state.title},
            self.catalog,
        )
        stale_ban = DraftState("Stale ban", _plan(), (), ("removed-track",))
        cleared_stale_ban = apply_draft_mutation(
            stale_ban,
            {"type": "unban_track", "track_id": "removed-track"},
            self.catalog,
        )
        with self.assertRaises(DraftError) as bad_factory:
            apply_draft_mutation(
                DraftState("Insert", _plan()),
                {"type": "insert_track", "track_id": self.roles["seed"].track.id, "to_index": 0},
                self.catalog,
                entry_id_factory=None,
            )

        self.assertIs(no_op, self.fixture_state)
        self.assertEqual(cleared_stale_ban.bans, ())
        self.assertEqual(bad_factory.exception.code, "invalid_request")

    def test_rename_plan_insert_replace_and_remove_use_the_closed_internal_shape(self):
        original = create_draft(
            "Original",
            _plan(),
            (self.roles["seed"].track.id, self.roles["build"].track.id),
            self.catalog,
            allow_repeated_tracks=False,
            entry_id_factory=_IdFactory(7),
        )
        renamed = apply_draft_mutation(
            original,
            {"type": "rename", "title": "Renamed"},
            self.catalog,
        )
        replanned = apply_draft_mutation(
            renamed,
            {
                "type": "set_plan",
                "plan": {
                    "intent": "build",
                    "target_duration_ms": 900_000,
                    "max_artist_repeats": 2,
                    "candidate_filters": TrackFilters(availability="available"),
                },
            },
            self.catalog,
        )
        inserted = apply_draft_mutation(
            replanned,
            {"type": "insert_track", "track_id": self.roles["smooth_match"].track.id, "to_index": 1},
            self.catalog,
            entry_id_factory=_IdFactory(8),
        )
        inserted_slot = inserted.entries[1]
        replaced = apply_draft_mutation(
            inserted,
            {"type": "replace_entry", "entry_id": inserted_slot.id, "replacement_track_id": self.roles["reset"].track.id},
            self.catalog,
        )
        removed = apply_draft_mutation(
            replaced,
            {"type": "remove_entry", "entry_id": inserted_slot.id},
            self.catalog,
        )

        self.assertEqual(renamed.title, "Renamed")
        self.assertEqual(replanned.plan, _plan(intent="build", target_duration_ms=900_000, max_artist_repeats=2, candidate_filters=TrackFilters(availability="available")))
        self.assertEqual(
            (inserted_slot.role, inserted_slot.target_energy_ppm, inserted_slot.track_pinned, inserted_slot.position_pinned),
            (None, None, False, False),
        )
        self.assertEqual(replaced.entries[1].id, inserted_slot.id)
        self.assertEqual(replaced.entries[1].track_id, self.roles["reset"].track.id)
        self.assertEqual([entry.id for entry in removed.entries], [entry.id for entry in original.entries])
        self.assertEqual([entry.track_id for entry in removed.entries], [entry.track_id for entry in original.entries])


class ReplacementAndOptimizerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog, cls.roles = _load_catalog()
        cls.state = draft_state_from_payload(
            json.loads(SET_FIXTURE.read_text(encoding="utf-8"))["snapshot"]
        )

    def test_replacements_are_bounded_stable_and_return_exact_m3_edge_evidence(self):
        target = self.state.entries[2]
        state = apply_draft_mutation(
            self.state,
            {"type": "set_entry_goal", "entry_id": target.id, "role": "build", "target_energy_ppm": 650_000},
            self.catalog,
        )

        forward = find_replacements(state, target.id, self.catalog, limit=10, scan_truncated=True)
        backward = find_replacements(state, target.id, tuple(reversed(self.catalog)), limit=10, scan_truncated=True)

        self.assertEqual([item.track.id for item in forward.items], [item.track.id for item in backward.items])
        self.assertLessEqual(len(forward.items), 10)
        self.assertEqual((forward.scanned_count, forward.scan_truncated), (8, True))
        excluded = {entry.track_id for entry in state.entries} | set(state.bans)
        self.assertTrue(all(item.track.id not in excluded for item in forward.items))
        self.assertTrue(all(item.track.availability == "available" for item in forward.items))
        self.assertTrue(any(item.goal_score_ppm is None for item in forward.items))

        first = forward.items[0]
        previous = next(evidence for evidence in self.catalog if evidence.track.id == state.entries[1].track_id)
        candidate = next(evidence for evidence in self.catalog if evidence.track.id == first.track.id)
        self.assertEqual(first.affected_edges[0].candidate, score_transition(previous, candidate, state.plan.intent))

    def test_optimizer_is_pin_safe_non_worsening_and_idempotent_at_its_local_optimum(self):
        entries = (
            _entry(1, self.roles["unicode_bridge"], track_pinned=True),
            _entry(2, self.roles["seed"], track_pinned=True, position_pinned=True),
            _entry(3, self.roles["reset"]),
            _entry(4, self.roles["build"]),
            _entry(5, self.roles["smooth_match"]),
        )
        state = DraftState("Optimizer", _plan(), entries, ())

        first = optimize_draft(state, self.catalog)
        second = optimize_draft(first.state, self.catalog)

        self.assertGreaterEqual(
            (first.after.score_ppm, first.after.confidence_ppm),
            (first.before.score_ppm, first.before.confidence_ppm),
        )
        self.assertEqual(first.state.entries[1].id, entries[1].id)
        self.assertEqual(first.state.entries[1].track_id, entries[1].track_id)
        self.assertEqual([entry.id for entry in first.state.entries], [entry.id for entry in entries])
        self.assertEqual(
            [(entry.role, entry.target_energy_ppm, entry.position_pinned) for entry in first.state.entries],
            [(entry.role, entry.target_energy_ppm, entry.position_pinned) for entry in entries],
        )
        self.assertEqual([entry.track_id for entry in second.state.entries], [entry.track_id for entry in first.state.entries])
        self.assertFalse(second.changed)
        self.assertEqual(second.before, second.after)

    def test_set_transition_scoring_uses_active_preference_evidence(self):
        preferred = replace(
            self.roles["build"],
            preference=PreferenceEvidence(
                score_ppm=1_000_000,
                quality_ppm=500_000,
                weight_ppm=75_000,
                supporting_evidence_count=5,
            ),
        )
        state = DraftState(
            "Personalized set",
            _plan(intent="build"),
            (
                _entry(1, self.roles["seed"]),
                _entry(2, preferred),
            ),
            (),
        )

        result = inspect_set(state, (self.roles["seed"], preferred))
        component = next(
            item
            for item in result.transitions[0].candidate.components
            if item.name == "preference"
        )

        self.assertEqual(component.score_ppm, 1_000_000)
        self.assertEqual(component.weight_ppm, 75_000)
        self.assertEqual(component.effect, "bonus")


class InspectionAndOrganizationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog, cls.roles = _load_catalog()

    def test_inspection_distinguishes_weak_from_limited_evidence_and_reports_progression(self):
        known_bad = replace(
            self.roles["compatible_key"],
            track=replace(
                self.roles["compatible_key"].track,
                id="00000000-0000-4000-8000-000000000031",
                external_id="31",
                bpm_milli=134_400,
                musical_key="1A",
                genre="Techno",
            ),
        )
        all_missing = replace(
            self.roles["sparse_unavailable"],
            track=replace(
                self.roles["sparse_unavailable"].track,
                id="00000000-0000-4000-8000-000000000032",
                external_id="32",
                title="Unknown Evidence",
                availability="available",
            ),
            analysis=None,
            playlist_ids=(),
        )
        catalog = (self.roles["seed"], known_bad, all_missing, self.roles["build"], self.roles["reset"])
        state = DraftState(
            "Inspection",
            _plan(target_duration_ms=1_200_000, max_artist_repeats=1),
            (
                _entry(1, self.roles["seed"], target_energy_ppm=500_000),
                _entry(2, self.roles["build"]),
                _entry(3, self.roles["reset"]),
                _entry(4, known_bad, target_energy_ppm=700_000),
                _entry(5, all_missing, target_energy_ppm=600_000),
            ),
            (),
        )

        result = inspect_set(state, catalog, source_position_count=125, scan_truncated=True)
        warning_codes = [warning.code for warning in result.warnings]

        self.assertEqual((result.source_position_count, result.inspected_position_count, result.input_truncated), (125, 5, True))
        self.assertEqual((result.scanned_count, result.scan_truncated), (5, True))
        self.assertIn("weak_transition", warning_codes)
        self.assertIn("limited_transition_evidence", warning_codes)
        self.assertIn("missing_analysis", warning_codes)
        self.assertIn("missing_goal_evidence", warning_codes)
        self.assertIn("target_duration", warning_codes)
        self.assertIn("max_artist_repeats", warning_codes)
        self.assertEqual(result.points[1].energy_direction, "rise")
        self.assertEqual(result.points[2].energy_direction, "fall")
        self.assertTrue(any(component.effect == "missing" for edge in result.transitions for component in edge.candidate.components))

    def test_inspection_preserves_repeats_warns_on_unavailable_and_unresolved_entries(self):
        state = DraftState(
            "Resolution",
            _plan(),
            (
                _entry(1, self.roles["seed"]),
                _entry(2, self.roles["seed"]),
                _entry(3, self.roles["sparse_unavailable"]),
                DraftEntry("40000000-0000-4000-8000-000000000004", "removed-track"),
            ),
            (),
        )

        result = inspect_set(state, self.catalog)
        warning_codes = [warning.code for warning in result.warnings]

        self.assertEqual(result.points[0].track.id, result.points[1].track.id)
        self.assertIsNone(result.points[3].track)
        self.assertIn("duplicate_track", warning_codes)
        self.assertIn("adjacent_same_artist", warning_codes)
        self.assertIn("unavailable_track", warning_codes)
        self.assertIn("unresolved_track", warning_codes)

    def test_organization_suggestions_report_catalog_and_per_suggestion_truncation(self):
        base = self.roles["seed"]
        catalog = tuple(
            replace(
                base,
                track=replace(
                    base.track,
                    id=f"00000000-0000-4000-8001-{index:012d}",
                    external_id=f"organization-{index}",
                    title=f"Organization {index:03d}",
                    genre=f"Genre {index % 21:02d}",
                ),
                playlist_ids=(),
            )
            for index in range(105)
        )
        state = DraftState("Suggestions", _plan(), (_entry(1, catalog[0]),), ())

        result = inspect_set(state, catalog, scan_truncated=True)

        self.assertEqual(result.scanned_count, 105)
        self.assertTrue(result.scan_truncated)
        self.assertEqual(len(result.organization_suggestions), 20)
        self.assertEqual(result.matched_suggestion_count, 23)
        self.assertTrue(result.suggestions_truncated)
        energy = result.organization_suggestions[0]
        self.assertEqual(energy.kind, "energy_group")
        self.assertEqual(energy.matched_track_count, 105)
        self.assertEqual(len(energy.track_ids), 100)
        self.assertTrue(energy.track_ids_truncated)
        self.assertEqual(result.organization_label, "Suggestions only—nothing has changed in Rekordbox.")

    def test_warning_output_is_capped_with_explicit_metadata(self):
        entries = tuple(
            DraftEntry(
                id=f"60000000-0000-4000-8000-{index:012d}",
                track_id=self.roles["sparse_unavailable"].track.id,
                target_energy_ppm=500_000,
            )
            for index in range(100)
        )
        state = DraftState(
            "Bounded warnings",
            _plan(max_artist_repeats=1),
            entries,
            (),
        )

        result = inspect_set(state, self.catalog)

        self.assertEqual(len(result.warnings), 200)
        self.assertGreater(result.matched_warning_count, len(result.warnings))
        self.assertTrue(result.warnings_truncated)


if __name__ == "__main__":
    unittest.main()
