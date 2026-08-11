"""Pure, immutable, deterministic set-draft workflow primitives."""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Callable, Literal, Mapping, TypeAlias
import unicodedata
from uuid import UUID, uuid4

from .analysis.provider import AnalysisFeatures
from .discovery import (
    DiscoveryCandidate,
    DiscoveryError,
    DiscoveryIntent,
    DiscoveryTrack,
    TrackEvidence,
    TrackFilters,
    filter_evidence,
    recommend_next_tracks,
    score_transition,
)


PPM = 1_000_000
MAX_DRAFT_ENTRIES = 100
MAX_BANS = 200
MAX_GENERATED_TRACKS = 50
MAX_ALTERNATIVES = 10
MAX_INSPECTED_POSITIONS = 100
MAX_WARNINGS = 200
MAX_ORGANIZATION_SUGGESTIONS = 20
MAX_SUGGESTION_TRACK_IDS = 100
SET_ORDER_ALGORITHM_VERSION = "set-order-v1"
ORGANIZATION_ALGORITHM_VERSION = "organization-v1"
ORGANIZATION_LABEL = "Suggestions only—nothing has changed in Rekordbox."

DraftRole: TypeAlias = Literal[
    "warmup",
    "groove",
    "build",
    "peak",
    "singalong",
    "reset",
    "bridge",
    "closer",
]
Direction: TypeAlias = Literal["rise", "fall", "steady", "missing"]

_INTENTS = frozenset(
    (
        "smooth",
        "build",
        "peak",
        "reset",
        "genre_shift",
        "adventurous",
        "singalong_continuation",
        "closer",
    )
)
_ROLES = frozenset(("warmup", "groove", "build", "peak", "singalong", "reset", "bridge", "closer"))
_FILTER_WIRE_TO_ATTR_V3 = {
    "text": "text",
    "playlistId": "playlist_id",
    "bpmMinMilli": "bpm_min_milli",
    "bpmMaxMilli": "bpm_max_milli",
    "musicalKey": "musical_key",
    "keyRelation": "key_relation",
    "genre": "genre",
    "energyMinPpm": "energy_min_ppm",
    "energyMaxPpm": "energy_max_ppm",
    "analysisState": "analysis_state",
    "availability": "availability",
}
_FILTER_WIRE_TO_ATTR = {
    **_FILTER_WIRE_TO_ATTR_V3,
    "ratingMin": "rating_min",
    "tag": "tag",
}
_FILTER_KEYS_V3 = frozenset(_FILTER_WIRE_TO_ATTR_V3)
_FILTER_KEYS_V4 = frozenset(_FILTER_WIRE_TO_ATTR)
_FILTER_ATTR_KEYS = frozenset(_FILTER_WIRE_TO_ATTR.values())
_PLAN_KEYS = frozenset(("intent", "targetDurationMs", "maxArtistRepeats", "candidateFilters"))
_MUTATION_PLAN_KEYS = frozenset(
    ("intent", "target_duration_ms", "max_artist_repeats", "candidate_filters")
)
_ENTRY_KEYS = frozenset(
    ("id", "trackId", "trackPinned", "positionPinned", "role", "targetEnergyPpm")
)
_STATE_KEYS = frozenset(("title", "plan", "entries", "bans"))


class DraftError(ValueError):
    """A bounded set-domain failure suitable for service translation."""

    def __init__(self, code: str, message: str):
        self.code = code[:64]
        self.message = message[:500]
        super().__init__(self.message)


@dataclass(frozen=True)
class DraftPlan:
    intent: DiscoveryIntent
    target_duration_ms: int | None = None
    max_artist_repeats: int | None = None
    candidate_filters: TrackFilters = TrackFilters()


@dataclass(frozen=True)
class DraftEntry:
    id: str
    track_id: str
    track_pinned: bool = False
    position_pinned: bool = False
    role: DraftRole | None = None
    target_energy_ppm: int | None = None


@dataclass(frozen=True)
class DraftState:
    title: str
    plan: DraftPlan
    entries: tuple[DraftEntry, ...] = ()
    bans: tuple[str, ...] = ()


@dataclass(frozen=True)
class ConstraintNotice:
    code: str
    message: str


@dataclass(frozen=True)
class GeneratedDraft:
    state: DraftState
    unmet_constraints: tuple[ConstraintNotice, ...]
    scanned_count: int
    scan_truncated: bool


@dataclass(frozen=True)
class TransitionEdge:
    from_position: int
    to_position: int
    candidate: DiscoveryCandidate
    utility_signed_ppm: int


@dataclass(frozen=True)
class ReplacementAlternative:
    track: DiscoveryTrack
    score_ppm: int
    confidence_ppm: int
    goal_score_ppm: int | None
    affected_edges: tuple[TransitionEdge, ...]


@dataclass(frozen=True)
class ReplacementResult:
    entry_id: str
    items: tuple[ReplacementAlternative, ...]
    scanned_count: int
    scan_truncated: bool


@dataclass(frozen=True)
class SequenceObjective:
    score_ppm: int
    confidence_ppm: int


@dataclass(frozen=True)
class OptimizationResult:
    state: DraftState
    before: SequenceObjective
    after: SequenceObjective
    changed: bool
    algorithm_version: str
    transitions: tuple[TransitionEdge, ...]


@dataclass(frozen=True)
class InspectionPoint:
    position: int
    entry_id: str
    track_id: str
    track: DiscoveryTrack | None
    resolution: Literal["current", "missing"]
    effective_bpm_milli: int | None
    effective_musical_key: str | None
    local_energy_ppm: int | None
    bpm_direction: Direction
    energy_direction: Direction


@dataclass(frozen=True)
class SetWarning:
    code: str
    message: str
    positions: tuple[int, ...] = ()


@dataclass(frozen=True)
class OrganizationSuggestion:
    kind: Literal["energy_group", "genre_group", "unassigned"]
    name: str
    track_ids: tuple[str, ...]
    matched_track_count: int
    track_ids_truncated: bool
    evidence: str


@dataclass(frozen=True)
class SetInspection:
    source_position_count: int
    inspected_position_count: int
    input_truncated: bool
    known_duration_ms: int
    unknown_duration_count: int
    points: tuple[InspectionPoint, ...]
    transitions: tuple[TransitionEdge, ...]
    warnings: tuple[SetWarning, ...]
    matched_warning_count: int
    warnings_truncated: bool
    organization_algorithm_version: str
    organization_label: str
    organization_suggestions: tuple[OrganizationSuggestion, ...]
    matched_suggestion_count: int
    suggestions_truncated: bool
    scanned_count: int
    scan_truncated: bool


def draft_state_from_payload(payload: object) -> DraftState:
    """Decode and strictly validate one persisted snake-case snapshot."""
    try:
        state_payload = _exact_mapping(payload, _STATE_KEYS, "snapshot")
        plan_payload = _exact_mapping(state_payload["plan"], _PLAN_KEYS, "draft plan")
        filter_payload = _filter_mapping(plan_payload["candidateFilters"])
        plan = DraftPlan(
            intent=plan_payload["intent"],
            target_duration_ms=plan_payload["targetDurationMs"],
            max_artist_repeats=plan_payload["maxArtistRepeats"],
            candidate_filters=_filters_from_payload(filter_payload),
        )
        raw_entries = state_payload["entries"]
        if type(raw_entries) is not list:
            _fail("invalid_snapshot", "Draft entries must be an array.")
        entries = tuple(_entry_from_payload(item) for item in raw_entries)
        raw_bans = state_payload["bans"]
        if type(raw_bans) is not list:
            _fail("invalid_snapshot", "Draft bans must be an array.")
        state = DraftState(
            title=state_payload["title"],
            plan=plan,
            entries=entries,
            bans=tuple(raw_bans),
        )
        _validate_state(state, "invalid_snapshot")
        return state
    except DraftError as error:
        if error.code == "invalid_snapshot":
            raise
        raise DraftError("invalid_snapshot", error.message) from error
    except (TypeError, ValueError) as error:
        raise DraftError("invalid_snapshot", "The draft snapshot is invalid.") from error


def draft_state_to_payload(state: DraftState) -> dict[str, object]:
    """Return the canonical strict persisted form for a draft."""
    _validate_state(state, "invalid_snapshot")
    filters = state.plan.candidate_filters
    return {
        "title": state.title,
        "plan": {
            "intent": state.plan.intent,
            "targetDurationMs": state.plan.target_duration_ms,
            "maxArtistRepeats": state.plan.max_artist_repeats,
            "candidateFilters": {
                wire_name: getattr(filters, attribute_name)
                for wire_name, attribute_name in _FILTER_WIRE_TO_ATTR.items()
            },
        },
        "entries": [
            {
                "id": entry.id,
                "trackId": entry.track_id,
                "trackPinned": entry.track_pinned,
                "positionPinned": entry.position_pinned,
                "role": entry.role,
                "targetEnergyPpm": entry.target_energy_ppm,
            }
            for entry in state.entries
        ],
        "bans": list(state.bans),
    }


def validate_draft_state(state: DraftState) -> None:
    """Validate a programmatically constructed draft as a live request."""
    _validate_state(state, "invalid_request")


def create_draft(
    title: str,
    plan: DraftPlan,
    track_ids: tuple[str, ...],
    catalog: tuple[TrackEvidence, ...],
    *,
    allow_repeated_tracks: bool,
    entry_id_factory: Callable[[], str] = lambda: str(uuid4()),
) -> DraftState:
    """Create an empty/selected/playlist draft from current library IDs."""
    catalog_by_id = _catalog_by_id(catalog)
    _validate_title(title, "invalid_request")
    _validate_plan(plan, "invalid_request")
    if type(track_ids) is not tuple or len(track_ids) > MAX_DRAFT_ENTRIES:
        _fail("invalid_request", "Draft track IDs must be a tuple with at most 100 items.")
    if type(allow_repeated_tracks) is not bool:
        _fail("invalid_request", "The repeated-track flag must be a boolean.")
    if not callable(entry_id_factory):
        _fail("invalid_request", "The entry ID factory is invalid.")
    if not allow_repeated_tracks and len(set(track_ids)) != len(track_ids):
        _fail("invalid_request", "Selected track IDs must be unique.")
    for track_id in track_ids:
        _require_current_track(track_id, catalog_by_id)
    entries = tuple(
        DraftEntry(id=entry_id_factory(), track_id=track_id)
        for track_id in track_ids
    )
    state = DraftState(title=title, plan=plan, entries=entries)
    _validate_state(state, "invalid_request")
    return state


def generate_draft(
    title: str,
    plan: DraftPlan,
    catalog: tuple[TrackEvidence, ...],
    *,
    max_tracks: int,
    seed_track_id: str | None = None,
    entry_id_factory: Callable[[], str] = lambda: str(uuid4()),
    scan_truncated: bool = False,
) -> GeneratedDraft:
    """Generate a deterministic, constraint-honest draft from current evidence."""
    _validate_title(title, "invalid_request")
    _validate_plan(plan, "invalid_request")
    if type(max_tracks) is not int or not 1 <= max_tracks <= MAX_GENERATED_TRACKS:
        _fail("invalid_request", "Generated track count must be an integer from 1 to 50.")
    if seed_track_id is not None:
        _validate_track_id(seed_track_id, "invalid_request")
    if type(scan_truncated) is not bool:
        _fail("invalid_request", "The scan-truncated flag must be a boolean.")
    if not callable(entry_id_factory):
        _fail("invalid_request", "The entry ID factory is invalid.")
    catalog_by_id = _catalog_by_id(catalog)
    try:
        matching = tuple(
            evidence
            for evidence in filter_evidence(catalog, plan.candidate_filters)
            if evidence.track.availability == "available"
        )
    except DiscoveryError as error:
        raise DraftError(error.code, error.message) from error

    if seed_track_id is not None:
        seed = _require_current_track(seed_track_id, catalog_by_id)
        if seed.track.availability != "available" or all(
            evidence.track.id != seed_track_id for evidence in matching
        ):
            _fail("invalid_request", "The generation seed must be available and match the candidate filters.")
    elif matching:
        seed = min(matching, key=_seed_sort_key)
    else:
        seed = None

    chosen: list[TrackEvidence] = []
    selected_ids: set[str] = set()
    artist_counts: dict[str, int] = {}
    known_duration_ms = 0
    artist_cap_blocked = False
    if seed is not None:
        chosen.append(seed)
        selected_ids.add(seed.track.id)
        _increment_artist(artist_counts, seed.track.artist)
        if seed.track.duration_ms is not None:
            known_duration_ms += seed.track.duration_ms

    while chosen and len(chosen) < max_tracks:
        if plan.target_duration_ms is not None and known_duration_ms >= plan.target_duration_ms:
            break
        eligible = []
        for evidence in matching:
            if evidence.track.id in selected_ids:
                continue
            if _would_exceed_artist_cap(evidence.track.artist, artist_counts, plan.max_artist_repeats):
                artist_cap_blocked = True
                continue
            eligible.append(evidence)
        if not eligible:
            break
        try:
            recommendation = recommend_next_tracks(
                (chosen[-1], *eligible),
                chosen[-1].track.id,
                plan.intent,
                limit=1,
            )
        except DiscoveryError as error:
            raise DraftError(error.code, error.message) from error
        selected = next(
            evidence for evidence in eligible
            if evidence.track.id == recommendation.items[0].track.id
        )
        chosen.append(selected)
        selected_ids.add(selected.track.id)
        _increment_artist(artist_counts, selected.track.artist)
        if selected.track.duration_ms is not None:
            known_duration_ms += selected.track.duration_ms

    entries = tuple(
        DraftEntry(id=entry_id_factory(), track_id=evidence.track.id)
        for evidence in chosen
    )
    state = DraftState(title=title, plan=plan, entries=entries)
    _validate_state(state, "invalid_request")

    target_unmet = (
        plan.target_duration_ms is not None
        and known_duration_ms < plan.target_duration_ms
    )
    count_unmet = len(entries) < max_tracks and (
        plan.target_duration_ms is None or target_unmet
    )
    notices = []
    if artist_cap_blocked and count_unmet:
        notices.append(
            ConstraintNotice(
                "max_artist_repeats",
                "The artist-repeat cap prevented additional matching tracks.",
            )
        )
    if target_unmet:
        notices.append(
            ConstraintNotice(
                "target_duration",
                "Known track duration does not reach the requested target.",
            )
        )
    if count_unmet:
        notices.append(
            ConstraintNotice(
                "track_count",
                "Fewer matching tracks were available than requested.",
            )
        )
    return GeneratedDraft(
        state=state,
        unmet_constraints=tuple(notices),
        scanned_count=len(catalog),
        scan_truncated=scan_truncated,
    )


def apply_draft_mutation(
    state: DraftState,
    mutation: object,
    catalog: tuple[TrackEvidence, ...],
    *,
    entry_id_factory: Callable[[], str] = lambda: str(uuid4()),
) -> DraftState:
    """Apply one strict content mutation while preserving frozen slot semantics."""
    _validate_state(state, "invalid_request")
    catalog_by_id = _catalog_by_id(catalog)
    if type(mutation) is not dict or not isinstance(mutation.get("type"), str):
        _fail("invalid_request", "A mutation must be a strict typed object.")
    operation = mutation["type"]
    expected_keys = {
        "rename": frozenset(("type", "title")),
        "set_plan": frozenset(("type", "plan")),
        "insert_track": frozenset(("type", "track_id", "to_index")),
        "move_entry": frozenset(("type", "entry_id", "to_index")),
        "set_track_pin": frozenset(("type", "entry_id", "pinned")),
        "set_position_pin": frozenset(("type", "entry_id", "pinned")),
        "remove_entry": frozenset(("type", "entry_id")),
        "ban_entry": frozenset(("type", "entry_id")),
        "unban_track": frozenset(("type", "track_id")),
        "replace_entry": frozenset(("type", "entry_id", "replacement_track_id")),
        "set_entry_goal": frozenset(("type", "entry_id", "role", "target_energy_ppm")),
        "optimize": frozenset(("type",)),
        "undo": frozenset(("type",)),
        "redo": frozenset(("type",)),
        "save_version": frozenset(("type", "label")),
        "restore_version": frozenset(("type", "version")),
    }.get(operation)
    if expected_keys is None or frozenset(mutation) != expected_keys:
        _fail("invalid_request", "The mutation shape is invalid.")

    if operation == "rename":
        _validate_title(mutation["title"], "invalid_request")
        result = replace(state, title=mutation["title"])
    elif operation == "set_plan":
        plan = mutation["plan"]
        if type(plan) is dict:
            plan = _plan_from_mutation_payload(plan)
        _validate_plan(plan, "invalid_request")
        result = replace(state, plan=plan)
    elif operation == "insert_track":
        if len(state.entries) >= MAX_DRAFT_ENTRIES:
            _fail("invalid_request", "The draft already contains 100 entries.")
        if not callable(entry_id_factory):
            _fail("invalid_request", "The entry ID factory is invalid.")
        track_id = mutation["track_id"]
        _require_current_track(track_id, catalog_by_id)
        if track_id in state.bans:
            _fail("invalid_request", "A banned track cannot be inserted.")
        to_index = mutation["to_index"]
        _validate_index(to_index, len(state.entries), allow_end=True)
        new_entry = DraftEntry(id=entry_id_factory(), track_id=track_id)
        entries = (*state.entries[:to_index], new_entry, *state.entries[to_index:])
        _assert_position_slots_unchanged(state.entries, entries)
        result = replace(state, entries=entries)
    elif operation == "move_entry":
        source_index = _entry_index(state.entries, mutation["entry_id"])
        to_index = mutation["to_index"]
        _validate_index(to_index, len(state.entries), allow_end=False)
        if source_index == to_index:
            return state
        assignments = [(entry.track_id, entry.track_pinned) for entry in state.entries]
        assignment = assignments.pop(source_index)
        assignments.insert(to_index, assignment)
        entries = tuple(
            replace(slot, track_id=track_id, track_pinned=track_pinned)
            for slot, (track_id, track_pinned) in zip(state.entries, assignments)
        )
        _assert_position_slots_unchanged(state.entries, entries)
        result = replace(state, entries=entries)
    elif operation in {"set_track_pin", "set_position_pin"}:
        index = _entry_index(state.entries, mutation["entry_id"])
        pinned = mutation["pinned"]
        if type(pinned) is not bool:
            _fail("invalid_request", "The pin value must be a boolean.")
        entry = state.entries[index]
        if operation == "set_track_pin":
            if not pinned and entry.position_pinned:
                _fail("pin_conflict", "A position-pinned slot must keep its track pinned.")
            updated = replace(entry, track_pinned=pinned)
        else:
            updated = replace(
                entry,
                position_pinned=pinned,
                track_pinned=True if pinned else entry.track_pinned,
            )
        result = replace(state, entries=_replace_at(state.entries, index, updated))
    elif operation == "remove_entry":
        index = _entry_index(state.entries, mutation["entry_id"])
        entry = state.entries[index]
        if entry.track_pinned or entry.position_pinned:
            _fail("pin_conflict", "Pinned track assignments cannot be removed.")
        entries = (*state.entries[:index], *state.entries[index + 1 :])
        _assert_position_slots_unchanged(state.entries, entries)
        result = replace(state, entries=entries)
    elif operation == "ban_entry":
        index = _entry_index(state.entries, mutation["entry_id"])
        track_id = state.entries[index].track_id
        occurrences = tuple(entry for entry in state.entries if entry.track_id == track_id)
        if any(entry.track_pinned or entry.position_pinned for entry in occurrences):
            _fail("pin_conflict", "Pinned track assignments cannot be banned.")
        entries = tuple(entry for entry in state.entries if entry.track_id != track_id)
        _assert_position_slots_unchanged(state.entries, entries)
        result = replace(state, entries=entries, bans=tuple(sorted((*state.bans, track_id))))
    elif operation == "unban_track":
        track_id = mutation["track_id"]
        _validate_track_id(track_id, "invalid_request")
        if track_id not in state.bans:
            _require_current_track(track_id, catalog_by_id)
        result = replace(state, bans=tuple(item for item in state.bans if item != track_id))
    elif operation == "replace_entry":
        index = _entry_index(state.entries, mutation["entry_id"])
        entry = state.entries[index]
        if entry.track_pinned or entry.position_pinned:
            _fail("pin_conflict", "Pinned track assignments cannot be replaced.")
        track_id = mutation["replacement_track_id"]
        _require_current_track(track_id, catalog_by_id)
        if track_id in state.bans:
            _fail("invalid_request", "A banned track cannot be used as a replacement.")
        result = replace(
            state,
            entries=_replace_at(state.entries, index, replace(entry, track_id=track_id)),
        )
    elif operation == "set_entry_goal":
        index = _entry_index(state.entries, mutation["entry_id"])
        _validate_role(mutation["role"], "invalid_request")
        _validate_optional_integer(
            mutation["target_energy_ppm"],
            0,
            PPM,
            "target energy",
            "invalid_request",
        )
        result = replace(
            state,
            entries=_replace_at(
                state.entries,
                index,
                replace(
                    state.entries[index],
                    role=mutation["role"],
                    target_energy_ppm=mutation["target_energy_ppm"],
                ),
            ),
        )
    elif operation == "optimize":
        result = optimize_draft(state, catalog).state
    else:
        _fail("history_required", "This mutation is handled by draft history persistence.")

    _validate_state(result, "invalid_request")
    return state if result == state else result


def find_replacements(
    state: DraftState,
    entry_id: str,
    catalog: tuple[TrackEvidence, ...],
    *,
    limit: int = MAX_ALTERNATIVES,
    scan_truncated: bool = False,
) -> ReplacementResult:
    """Rank bounded replacement alternatives using only available evidence terms."""
    _validate_state(state, "invalid_request")
    if type(limit) is not int or not 1 <= limit <= MAX_ALTERNATIVES:
        _fail("invalid_request", "Replacement limit must be an integer from 1 to 10.")
    if type(scan_truncated) is not bool:
        _fail("invalid_request", "The scan-truncated flag must be a boolean.")
    target_index = _entry_index(state.entries, entry_id)
    catalog_by_id = _catalog_by_id(catalog)
    try:
        matching = filter_evidence(catalog, state.plan.candidate_filters)
    except DiscoveryError as error:
        raise DraftError(error.code, error.message) from error
    excluded = {entry.track_id for entry in state.entries} | set(state.bans)
    previous = catalog_by_id.get(state.entries[target_index - 1].track_id) if target_index else None
    following = (
        catalog_by_id.get(state.entries[target_index + 1].track_id)
        if target_index + 1 < len(state.entries)
        else None
    )
    target = state.entries[target_index]
    alternatives = []
    for evidence in matching:
        if evidence.track.id in excluded or evidence.track.availability != "available":
            continue
        edges = []
        score_terms = []
        confidence_terms = []
        if previous is not None:
            edge = _make_transition_edge(previous, evidence, state.plan.intent, target_index - 1, target_index)
            edges.append(edge)
            if _candidate_has_evidence(edge.candidate):
                score_terms.append(edge.candidate.score_ppm)
                confidence_terms.append(edge.candidate.confidence_ppm)
        if following is not None:
            edge = _make_transition_edge(evidence, following, state.plan.intent, target_index, target_index + 1)
            edges.append(edge)
            if _candidate_has_evidence(edge.candidate):
                score_terms.append(edge.candidate.score_ppm)
                confidence_terms.append(edge.candidate.confidence_ppm)
        goal_score = None
        energy = _local_energy(evidence)
        if target.target_energy_ppm is not None and energy is not None:
            goal_score = PPM - abs(energy - target.target_energy_ppm)
            score_terms.append(goal_score)
            confidence_terms.append(700_000)
        alternatives.append(
            ReplacementAlternative(
                track=_discovery_track(evidence),
                score_ppm=_mean(score_terms),
                confidence_ppm=_mean(confidence_terms),
                goal_score_ppm=goal_score,
                affected_edges=tuple(edges),
            )
        )
    alternatives.sort(key=_replacement_sort_key)
    return ReplacementResult(
        entry_id=entry_id,
        items=tuple(alternatives[:limit]),
        scanned_count=len(catalog),
        scan_truncated=scan_truncated,
    )


def optimize_draft(
    state: DraftState,
    catalog: tuple[TrackEvidence, ...],
) -> OptimizationResult:
    """Run four deterministic adjacent-swap passes over track assignments."""
    _validate_state(state, "invalid_request")
    catalog_by_id = _catalog_by_id(catalog)
    unresolved = tuple(entry.track_id for entry in state.entries if entry.track_id not in catalog_by_id)
    if unresolved:
        _fail("unresolved_track", "Every draft entry must resolve before optimization.")
    before, _ = _sequence_objective(state, catalog_by_id)
    working = state
    for _pass in range(4):
        for index in range(max(0, len(working.entries) - 1)):
            left = working.entries[index]
            right = working.entries[index + 1]
            if left.position_pinned or right.position_pinned:
                continue
            trial_entries = list(working.entries)
            trial_entries[index] = replace(
                left,
                track_id=right.track_id,
                track_pinned=right.track_pinned,
            )
            trial_entries[index + 1] = replace(
                right,
                track_id=left.track_id,
                track_pinned=left.track_pinned,
            )
            trial = replace(working, entries=tuple(trial_entries))
            current_objective, _ = _sequence_objective(working, catalog_by_id)
            trial_objective, _ = _sequence_objective(trial, catalog_by_id)
            if (
                trial_objective.score_ppm,
                trial_objective.confidence_ppm,
            ) > (
                current_objective.score_ppm,
                current_objective.confidence_ppm,
            ):
                working = trial
    after, transitions = _sequence_objective(working, catalog_by_id)
    return OptimizationResult(
        state=working,
        before=before,
        after=after,
        changed=working != state,
        algorithm_version=SET_ORDER_ALGORITHM_VERSION,
        transitions=transitions,
    )


def inspect_set(
    state: DraftState,
    catalog: tuple[TrackEvidence, ...],
    *,
    source_position_count: int | None = None,
    scan_truncated: bool = False,
) -> SetInspection:
    """Inspect a bounded ordered set and return evidence-backed advisory output."""
    _validate_state(state, "invalid_request")
    catalog_by_id = _catalog_by_id(catalog)
    if source_position_count is None:
        source_position_count = len(state.entries)
    if type(source_position_count) is not int or source_position_count < len(state.entries):
        _fail("invalid_request", "Source position count cannot be smaller than the inspected input.")
    if type(scan_truncated) is not bool:
        _fail("invalid_request", "The scan-truncated flag must be a boolean.")

    inspected_entries = state.entries[:MAX_INSPECTED_POSITIONS]
    points = []
    previous_bpm = None
    previous_energy = None
    for position, entry in enumerate(inspected_entries):
        evidence = catalog_by_id.get(entry.track_id)
        bpm = _effective_bpm(evidence) if evidence is not None else None
        energy = _local_energy(evidence) if evidence is not None else None
        points.append(
            InspectionPoint(
                position=position,
                entry_id=entry.id,
                track_id=entry.track_id,
                track=_discovery_track(evidence) if evidence is not None else None,
                resolution="current" if evidence is not None else "missing",
                effective_bpm_milli=bpm,
                effective_musical_key=_effective_key_text(evidence) if evidence is not None else None,
                local_energy_ppm=energy,
                bpm_direction=_direction(previous_bpm, bpm, 3_000),
                energy_direction=_direction(previous_energy, energy, 75_000),
            )
        )
        previous_bpm = bpm
        previous_energy = energy

    transitions = []
    for position in range(max(0, len(inspected_entries) - 1)):
        first = catalog_by_id.get(inspected_entries[position].track_id)
        second = catalog_by_id.get(inspected_entries[position + 1].track_id)
        if first is not None and second is not None:
            transitions.append(_make_transition_edge(first, second, state.plan.intent, position, position + 1))

    warnings = _inspection_warnings(state, inspected_entries, catalog_by_id, tuple(transitions))
    suggestions = _organization_suggestions(catalog)
    known_duration = sum(
        evidence.track.duration_ms
        for entry in inspected_entries
        if (evidence := catalog_by_id.get(entry.track_id)) is not None
        and evidence.track.duration_ms is not None
    )
    unknown_duration = sum(
        1
        for entry in inspected_entries
        if (evidence := catalog_by_id.get(entry.track_id)) is None
        or evidence.track.duration_ms is None
    )
    return SetInspection(
        source_position_count=source_position_count,
        inspected_position_count=len(inspected_entries),
        input_truncated=source_position_count > len(inspected_entries),
        known_duration_ms=known_duration,
        unknown_duration_count=unknown_duration,
        points=tuple(points),
        transitions=tuple(transitions),
        warnings=warnings[:MAX_WARNINGS],
        matched_warning_count=len(warnings),
        warnings_truncated=len(warnings) > MAX_WARNINGS,
        organization_algorithm_version=ORGANIZATION_ALGORITHM_VERSION,
        organization_label=ORGANIZATION_LABEL,
        organization_suggestions=suggestions[:MAX_ORGANIZATION_SUGGESTIONS],
        matched_suggestion_count=len(suggestions),
        suggestions_truncated=len(suggestions) > MAX_ORGANIZATION_SUGGESTIONS,
        scanned_count=len(catalog),
        scan_truncated=scan_truncated,
    )


def _validate_state(state: DraftState, code: str) -> None:
    if not isinstance(state, DraftState):
        _fail(code, "The draft snapshot is invalid.")
    _validate_title(state.title, code)
    _validate_plan(state.plan, code)
    if type(state.entries) is not tuple or len(state.entries) > MAX_DRAFT_ENTRIES:
        _fail(code, "Draft entries must be a tuple with at most 100 items.")
    entry_ids = set()
    current_track_ids = set()
    for entry in state.entries:
        if not isinstance(entry, DraftEntry):
            _fail(code, "The draft contains an invalid entry.")
        _validate_entry_id(entry.id, code)
        _validate_track_id(entry.track_id, code)
        if entry.id in entry_ids:
            _fail(code, "Draft entry IDs must be unique.")
        entry_ids.add(entry.id)
        current_track_ids.add(entry.track_id)
        if type(entry.track_pinned) is not bool or type(entry.position_pinned) is not bool:
            _fail(code, "Draft pin values must be boolean.")
        if entry.position_pinned and not entry.track_pinned:
            _fail(code, "A position-pinned slot must also pin its track.")
        _validate_role(entry.role, code)
        _validate_optional_integer(entry.target_energy_ppm, 0, PPM, "target energy", code)
    if type(state.bans) is not tuple or len(state.bans) > MAX_BANS:
        _fail(code, "Draft bans must be a tuple with at most 200 items.")
    for track_id in state.bans:
        _validate_track_id(track_id, code)
    if state.bans != tuple(sorted(state.bans)) or len(set(state.bans)) != len(state.bans):
        _fail(code, "Draft bans must be unique and sorted.")
    if current_track_ids.intersection(state.bans):
        _fail(code, "A banned track cannot remain in the draft.")


def _validate_plan(plan: object, code: str) -> None:
    if not isinstance(plan, DraftPlan):
        _fail(code, "The draft plan is invalid.")
    if not isinstance(plan.intent, str) or plan.intent not in _INTENTS:
        _fail(code, "The draft intent is invalid.")
    _validate_optional_integer(
        plan.target_duration_ms,
        900_000,
        28_800_000,
        "target duration",
        code,
    )
    _validate_optional_integer(plan.max_artist_repeats, 1, 20, "artist-repeat cap", code)
    try:
        filter_evidence((), plan.candidate_filters)
    except DiscoveryError as error:
        _fail(code, error.message)


def _validate_title(value: object, code: str) -> None:
    if not isinstance(value, str) or not 1 <= len(value) <= 200:
        _fail(code, "Draft title must contain 1 to 200 characters.")


def _validate_entry_id(value: object, code: str) -> None:
    if not isinstance(value, str):
        _fail(code, "Draft entry ID must be a canonical UUID.")
    try:
        parsed = UUID(value)
    except (ValueError, AttributeError, TypeError) as error:
        raise DraftError(code, "Draft entry ID must be a canonical UUID.") from error
    if str(parsed) != value:
        _fail(code, "Draft entry ID must be a canonical UUID.")


def _validate_track_id(value: object, code: str) -> None:
    if not isinstance(value, str) or not 1 <= len(value) <= 128:
        _fail(code, "Track IDs must contain 1 to 128 characters.")


def _validate_role(value: object, code: str) -> None:
    if value is not None and (not isinstance(value, str) or value not in _ROLES):
        _fail(code, "The draft role is invalid.")


def _validate_optional_integer(
    value: object,
    minimum: int,
    maximum: int,
    label: str,
    code: str,
) -> None:
    if value is not None and (type(value) is not int or not minimum <= value <= maximum):
        _fail(code, f"The {label} is outside its bounded range.")


def _exact_mapping(value: object, keys: frozenset[str], label: str) -> dict[str, object]:
    if type(value) is not dict or frozenset(value) != keys:
        _fail("invalid_snapshot", f"The {label} shape is invalid.")
    return value


def _filter_mapping(value: object) -> dict[str, object]:
    if type(value) is not dict or frozenset(value) not in {_FILTER_KEYS_V3, _FILTER_KEYS_V4}:
        _fail("invalid_snapshot", "The candidate filters shape is invalid.")
    return value


def _filters_from_payload(payload: Mapping[str, object]) -> TrackFilters:
    return TrackFilters(
        **{
            attribute_name: payload[wire_name]
            for wire_name, attribute_name in _FILTER_WIRE_TO_ATTR.items()
            if wire_name in payload
        }
    )


def _entry_from_payload(payload: object) -> DraftEntry:
    item = _exact_mapping(payload, _ENTRY_KEYS, "draft entry")
    return DraftEntry(
        id=item["id"],
        track_id=item["trackId"],
        track_pinned=item["trackPinned"],
        position_pinned=item["positionPinned"],
        role=item["role"],
        target_energy_ppm=item["targetEnergyPpm"],
    )


def _plan_from_mutation_payload(payload: dict[str, object]) -> DraftPlan:
    if frozenset(payload) != _MUTATION_PLAN_KEYS:
        _fail("invalid_request", "The draft plan shape is invalid.")
    filters = payload["candidate_filters"]
    if isinstance(filters, TrackFilters):
        candidate_filters = filters
    elif type(filters) is dict and not frozenset(filters) - _FILTER_ATTR_KEYS:
        candidate_filters = TrackFilters(**filters)
    else:
        _fail("invalid_request", "The candidate-filter shape is invalid.")
    try:
        return DraftPlan(
            intent=payload["intent"],
            target_duration_ms=payload["target_duration_ms"],
            max_artist_repeats=payload["max_artist_repeats"],
            candidate_filters=candidate_filters,
        )
    except TypeError as error:
        raise DraftError("invalid_request", "The draft plan is invalid.") from error


def _catalog_by_id(catalog: tuple[TrackEvidence, ...]) -> dict[str, TrackEvidence]:
    try:
        validated = filter_evidence(catalog)
    except DiscoveryError as error:
        raise DraftError(error.code, error.message) from error
    return {evidence.track.id: evidence for evidence in validated}


def _require_current_track(track_id: object, catalog_by_id: Mapping[str, TrackEvidence]) -> TrackEvidence:
    _validate_track_id(track_id, "invalid_request")
    evidence = catalog_by_id.get(track_id)
    if evidence is None:
        _fail("not_found", "The requested track is not in the current library.")
    return evidence


def _seed_sort_key(evidence: TrackEvidence) -> tuple[object, ...]:
    energy = _local_energy(evidence)
    return (
        energy is None,
        abs(energy - 350_000) if energy is not None else 0,
        _normalized_text(evidence.track.title),
        _normalized_text(evidence.track.artist),
        evidence.track.id,
    )


def _normalized_text(value: str | None) -> str:
    return unicodedata.normalize("NFKC", value or "").strip().casefold()


def _normalized_nonempty(value: str | None) -> str | None:
    normalized = _normalized_text(value)
    return normalized or None


def _increment_artist(counts: dict[str, int], artist: str | None) -> None:
    normalized = _normalized_nonempty(artist)
    if normalized is not None:
        counts[normalized] = counts.get(normalized, 0) + 1


def _would_exceed_artist_cap(
    artist: str | None,
    counts: Mapping[str, int],
    cap: int | None,
) -> bool:
    normalized = _normalized_nonempty(artist)
    return cap is not None and normalized is not None and counts.get(normalized, 0) >= cap


def _entry_index(entries: tuple[DraftEntry, ...], entry_id: object) -> int:
    _validate_entry_id(entry_id, "invalid_request")
    for index, entry in enumerate(entries):
        if entry.id == entry_id:
            return index
    _fail("not_found", "The requested draft entry was not found.")


def _validate_index(value: object, length: int, *, allow_end: bool) -> None:
    maximum = length if allow_end else length - 1
    if type(value) is not int or not 0 <= value <= maximum:
        _fail("invalid_request", "The destination index is outside the draft.")


def _replace_at(entries: tuple[DraftEntry, ...], index: int, entry: DraftEntry) -> tuple[DraftEntry, ...]:
    return (*entries[:index], entry, *entries[index + 1 :])


def _assert_position_slots_unchanged(
    before: tuple[DraftEntry, ...],
    after: tuple[DraftEntry, ...],
) -> None:
    after_indexes = {entry.id: index for index, entry in enumerate(after)}
    after_by_id = {entry.id: entry for entry in after}
    for index, entry in enumerate(before):
        if not entry.position_pinned:
            continue
        current = after_by_id.get(entry.id)
        if current is None or after_indexes[entry.id] != index or current.track_id != entry.track_id:
            _fail("pin_conflict", "The mutation would shift or change a position-pinned slot.")


def _successful_features(evidence: TrackEvidence) -> AnalysisFeatures | None:
    analysis = evidence.analysis
    if analysis is not None and analysis.status == "succeeded" and isinstance(analysis.features, AnalysisFeatures):
        return analysis.features
    return None


def _local_energy(evidence: TrackEvidence) -> int | None:
    features = _successful_features(evidence)
    return features.energy_ppm if features is not None else None


def _effective_bpm(evidence: TrackEvidence) -> int | None:
    features = _successful_features(evidence)
    if (
        features is not None
        and features.bpm_milli is not None
        and features.bpm_milli > 0
        and features.tempo_confidence_ppm >= 500_000
    ):
        return features.bpm_milli
    return evidence.track.bpm_milli


def _effective_key_text(evidence: TrackEvidence) -> str | None:
    features = _successful_features(evidence)
    if features is not None and features.key_confidence_ppm >= 500_000 and features.musical_key:
        if features.mode:
            return f"{features.musical_key} {features.mode}"
        return features.musical_key
    return evidence.track.musical_key


def _discovery_track(evidence: TrackEvidence) -> DiscoveryTrack:
    track = evidence.track
    return DiscoveryTrack(
        id=track.id,
        title=track.title,
        artist=track.artist,
        album=track.album,
        genre=track.genre,
        bpm_milli=track.bpm_milli,
        musical_key=track.musical_key,
        duration_ms=track.duration_ms,
        availability=track.availability,
    )


def _make_transition_edge(
    first: TrackEvidence,
    second: TrackEvidence,
    intent: DiscoveryIntent,
    from_position: int,
    to_position: int,
) -> TransitionEdge:
    try:
        candidate = score_transition(first, second, intent)
    except DiscoveryError as error:
        raise DraftError(error.code, error.message) from error
    return TransitionEdge(
        from_position=from_position,
        to_position=to_position,
        candidate=candidate,
        utility_signed_ppm=sum(component.contribution_signed_ppm for component in candidate.components),
    )


def _candidate_has_evidence(candidate: DiscoveryCandidate) -> bool:
    return any(component.score_ppm is not None for component in candidate.components)


def _mean(values: list[int]) -> int:
    return _round_half_up(sum(values), len(values)) if values else 0


def _round_half_up(numerator: int, denominator: int) -> int:
    return (numerator + denominator // 2) // denominator


def _replacement_sort_key(item: ReplacementAlternative) -> tuple[object, ...]:
    return (
        -item.score_ppm,
        -item.confidence_ppm,
        _normalized_text(item.track.title),
        _normalized_text(item.track.artist),
        item.track.id,
    )


def _sequence_objective(
    state: DraftState,
    catalog_by_id: Mapping[str, TrackEvidence],
) -> tuple[SequenceObjective, tuple[TransitionEdge, ...]]:
    score_terms = []
    confidence_terms = []
    transitions = []
    for index in range(max(0, len(state.entries) - 1)):
        first = catalog_by_id[state.entries[index].track_id]
        second = catalog_by_id[state.entries[index + 1].track_id]
        edge = _make_transition_edge(first, second, state.plan.intent, index, index + 1)
        transitions.append(edge)
        if _candidate_has_evidence(edge.candidate):
            score_terms.append(edge.candidate.score_ppm)
            confidence_terms.append(edge.candidate.confidence_ppm)
    for entry in state.entries:
        if entry.target_energy_ppm is None:
            continue
        energy = _local_energy(catalog_by_id[entry.track_id])
        if energy is not None:
            score_terms.append(PPM - abs(energy - entry.target_energy_ppm))
            confidence_terms.append(700_000)
    return (
        SequenceObjective(_mean(score_terms), _mean(confidence_terms)),
        tuple(transitions),
    )


def _direction(previous: int | None, current: int | None, threshold: int) -> Direction:
    if previous is None or current is None:
        return "missing"
    difference = current - previous
    if difference >= threshold:
        return "rise"
    if difference <= -threshold:
        return "fall"
    return "steady"


def _inspection_warnings(
    state: DraftState,
    entries: tuple[DraftEntry, ...],
    catalog_by_id: Mapping[str, TrackEvidence],
    transitions: tuple[TransitionEdge, ...],
) -> tuple[SetWarning, ...]:
    warnings = []
    seen_tracks: dict[str, int] = {}
    known_duration = 0
    unknown_duration = 0
    artist_positions: dict[str, list[int]] = {}
    for position, entry in enumerate(entries):
        evidence = catalog_by_id.get(entry.track_id)
        if evidence is None:
            warnings.append(SetWarning("unresolved_track", "This track no longer resolves in the current library.", (position,)))
            unknown_duration += 1
        else:
            if evidence.track.availability != "available":
                warnings.append(SetWarning("unavailable_track", "This track is not currently available.", (position,)))
            if _successful_features(evidence) is None:
                warnings.append(SetWarning("missing_analysis", "Local analysis evidence is unavailable for this track.", (position,)))
            if evidence.track.duration_ms is None:
                unknown_duration += 1
            else:
                known_duration += evidence.track.duration_ms
            artist = _normalized_nonempty(evidence.track.artist)
            if artist is not None:
                artist_positions.setdefault(artist, []).append(position)
        if entry.track_id in seen_tracks:
            warnings.append(
                SetWarning(
                    "duplicate_track",
                    "This track appears more than once in the inspected order.",
                    (seen_tracks[entry.track_id], position),
                )
            )
        else:
            seen_tracks[entry.track_id] = position
        if entry.target_energy_ppm is not None and (
            evidence is None or _local_energy(evidence) is None
        ):
            warnings.append(
                SetWarning(
                    "missing_goal_evidence",
                    "The slot has an energy goal but no local energy evidence.",
                    (position,),
                )
            )

    for position in range(max(0, len(entries) - 1)):
        first = catalog_by_id.get(entries[position].track_id)
        second = catalog_by_id.get(entries[position + 1].track_id)
        first_artist = _normalized_nonempty(first.track.artist) if first is not None else None
        second_artist = _normalized_nonempty(second.track.artist) if second is not None else None
        if first_artist is not None and first_artist == second_artist:
            warnings.append(
                SetWarning(
                    "adjacent_same_artist",
                    "Adjacent tracks have the same known artist.",
                    (position, position + 1),
                )
            )

    for edge in transitions:
        candidate = edge.candidate
        if candidate.confidence_ppm < 400_000:
            warnings.append(
                SetWarning(
                    "limited_transition_evidence",
                    "This transition has limited evidence; its score is not strong negative evidence.",
                    (edge.from_position, edge.to_position),
                )
            )
        elif candidate.score_ppm < 400_000:
            warnings.append(
                SetWarning(
                    "weak_transition",
                    "Available evidence indicates a weak transition.",
                    (edge.from_position, edge.to_position),
                )
            )

    if state.plan.target_duration_ms is not None and (
        known_duration < state.plan.target_duration_ms or unknown_duration > 0
    ):
        warnings.append(
            SetWarning(
                "target_duration",
                "Known duration does not establish that the target duration is met.",
            )
        )
    if state.plan.max_artist_repeats is not None:
        for artist, positions in artist_positions.items():
            if len(positions) > state.plan.max_artist_repeats:
                warnings.append(
                    SetWarning(
                        "max_artist_repeats",
                        f"A known artist appears {len(positions)} times, above the configured cap.",
                        tuple(positions),
                    )
                )

    priority = {
        "unavailable_track": 0,
        "unresolved_track": 1,
        "missing_analysis": 2,
        "duplicate_track": 3,
        "adjacent_same_artist": 4,
        "weak_transition": 5,
        "limited_transition_evidence": 6,
        "target_duration": 7,
        "max_artist_repeats": 8,
        "missing_goal_evidence": 9,
    }
    warnings.sort(key=lambda item: (priority[item.code], item.positions, item.message))
    return tuple(warnings)


def _organization_suggestions(catalog: tuple[TrackEvidence, ...]) -> tuple[OrganizationSuggestion, ...]:
    stable = tuple(
        sorted(
            catalog,
            key=lambda evidence: (
                _normalized_text(evidence.track.title),
                _normalized_text(evidence.track.artist),
                evidence.track.id,
            ),
        )
    )
    energy_groups: dict[str, list[str]] = {"low": [], "mid": [], "high": []}
    genre_groups: dict[str, list[str]] = {}
    unassigned = []
    for evidence in stable:
        energy = _local_energy(evidence)
        if energy is not None:
            bucket = "low" if energy < 400_000 else "mid" if energy < 700_000 else "high"
            energy_groups[bucket].append(evidence.track.id)
        genre = _normalized_nonempty(evidence.track.genre)
        if genre is not None:
            genre_groups.setdefault(genre, []).append(evidence.track.id)
        if not evidence.playlist_ids:
            unassigned.append(evidence.track.id)

    suggestions = []
    for name in ("low", "mid", "high"):
        track_ids = energy_groups[name]
        if len(track_ids) >= 2:
            suggestions.append(
                _organization_suggestion(
                    "energy_group",
                    name,
                    track_ids,
                    f"{len(track_ids)} tracks have local energy evidence in the {name} range.",
                )
            )
    for genre in sorted(genre_groups):
        track_ids = genre_groups[genre]
        if len(track_ids) >= 2:
            suggestions.append(
                _organization_suggestion(
                    "genre_group",
                    genre,
                    track_ids,
                    f"{len(track_ids)} tracks share the exact normalized genre {genre!r}.",
                )
            )
    if unassigned:
        suggestions.append(
                _organization_suggestion(
                "unassigned",
                "not in an imported playlist",
                unassigned,
                f"{len(unassigned)} current collection tracks are in no imported playlist.",
            )
        )
    return tuple(suggestions)


def _organization_suggestion(
    kind: Literal["energy_group", "genre_group", "unassigned"],
    name: str,
    track_ids: list[str],
    evidence: str,
) -> OrganizationSuggestion:
    return OrganizationSuggestion(
        kind=kind,
        name=name,
        track_ids=tuple(track_ids[:MAX_SUGGESTION_TRACK_IDS]),
        matched_track_count=len(track_ids),
        track_ids_truncated=len(track_ids) > MAX_SUGGESTION_TRACK_IDS,
        evidence=evidence,
    )


def _fail(code: str, message: str) -> None:
    raise DraftError(code, message)


__all__ = (
    "ConstraintNotice",
    "DraftEntry",
    "DraftError",
    "DraftPlan",
    "DraftRole",
    "DraftState",
    "GeneratedDraft",
    "InspectionPoint",
    "OptimizationResult",
    "OrganizationSuggestion",
    "ReplacementAlternative",
    "ReplacementResult",
    "SequenceObjective",
    "SetInspection",
    "SetWarning",
    "TransitionEdge",
    "apply_draft_mutation",
    "create_draft",
    "draft_state_from_payload",
    "draft_state_to_payload",
    "find_replacements",
    "generate_draft",
    "inspect_set",
    "optimize_draft",
    "validate_draft_state",
)
