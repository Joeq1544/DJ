"""Pure, deterministic library filtering and M3 discovery scoring."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Literal, TypeAlias
import unicodedata

from .analysis.provider import AnalysisFeatures
from .models import AnalysisSummary, StoredTrack


PPM = 1_000_000
MAX_SCAN_COUNT = 25_000
SIMILARITY_ALGORITHM_VERSION = "feature-similarity-v1"
TRANSITION_ALGORITHM_VERSION = "transition-v1"

DiscoveryIntent: TypeAlias = Literal[
    "smooth",
    "build",
    "peak",
    "reset",
    "genre_shift",
    "adventurous",
    "singalong_continuation",
    "closer",
]
ComponentName: TypeAlias = Literal[
    "tempo",
    "key",
    "energy",
    "style",
    "timbre",
    "vocal",
    "structure",
    "preference",
]
ComponentEffect: TypeAlias = Literal["bonus", "penalty", "neutral", "missing"]

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
_ANALYSIS_STATES = frozenset(("any", "analyzed", "not_analyzed", "failed"))
_ANALYSIS_STATUSES = frozenset(("not_queued", "queued", "running", "paused", "succeeded", "failed"))
_AVAILABILITIES = frozenset(("available", "missing", "unreadable"))
_FILTER_AVAILABILITIES = _AVAILABILITIES | {"any"}
_KEY_RELATIONS = frozenset(("exact", "compatible"))
_COMPONENT_ORDER = {
    "tempo": 0,
    "key": 1,
    "energy": 2,
    "style": 3,
    "timbre": 4,
    "vocal": 5,
    "structure": 6,
    "preference": 7,
}
_MISSING_REASONS = {
    "tempo": "Tempo evidence is unavailable for one or both tracks.",
    "key": "Key evidence is unavailable for one or both tracks.",
    "energy": "Local energy evidence is unavailable for one or both tracks.",
    "style": "Genre evidence is unavailable for one or both tracks.",
    "timbre": "Local timbre evidence is unavailable for one or both tracks.",
    "vocal": "Vocal evidence is not available in M3.",
    "structure": "Structure evidence is not available in M3.",
    "preference": "Preference evidence is not available in M3.",
}
_COMPONENT_LABELS = {
    "tempo": "Tempo compatibility",
    "key": "Key compatibility",
    "energy": "Energy direction",
    "style": "Genre relationship",
    "timbre": "Timbre relationship",
    "vocal": "Vocal evidence",
    "structure": "Structure evidence",
    "preference": "Preference evidence",
}
_SIMILARITY_WEIGHTS = (
    ("tempo", 250_000),
    ("key", 250_000),
    ("energy", 200_000),
    ("style", 150_000),
    ("timbre", 150_000),
)
_TRANSITION_WEIGHTS = {
    "smooth": (("tempo", 300_000), ("key", 250_000), ("energy", 200_000), ("style", 150_000), ("timbre", 100_000)),
    "build": (("tempo", 200_000), ("key", 150_000), ("energy", 350_000), ("style", 150_000), ("timbre", 150_000)),
    "peak": (("tempo", 150_000), ("key", 150_000), ("energy", 400_000), ("style", 100_000), ("timbre", 200_000)),
    "reset": (("tempo", 150_000), ("key", 150_000), ("energy", 400_000), ("style", 150_000), ("timbre", 150_000)),
    "genre_shift": (("tempo", 150_000), ("key", 150_000), ("energy", 150_000), ("style", 350_000), ("timbre", 200_000)),
    "adventurous": (("tempo", 150_000), ("key", 100_000), ("energy", 200_000), ("style", 250_000), ("timbre", 300_000)),
    "singalong_continuation": (
        ("tempo", 200_000),
        ("key", 150_000),
        ("energy", 200_000),
        ("style", 150_000),
        ("timbre", 100_000),
        ("vocal", 200_000),
    ),
    "closer": (
        ("tempo", 150_000),
        ("key", 200_000),
        ("energy", 300_000),
        ("style", 150_000),
        ("timbre", 100_000),
        ("structure", 100_000),
    ),
}
_REQUIRED_MISSING = {
    "singalong_continuation": "vocal",
    "closer": "structure",
}

_CAMELOT_PATTERN = re.compile(r"^\s*(1[0-2]|[1-9])\s*([AaBb])\s*$")
_NOTE_PATTERN = re.compile(r"^\s*([A-Ga-g])([#b]?)(?:\s*(major|minor|maj|min|m))?\s*$", re.IGNORECASE)
_PITCH_CLASSES = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}
_MAJOR_CAMELOT = (8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1)
_MINOR_CAMELOT = (5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10)


class DiscoveryError(ValueError):
    """A stable discovery-domain failure suitable for service translation."""

    def __init__(self, code: str, message: str):
        self.code = code[:64]
        self.message = message[:500]
        super().__init__(self.message)


@dataclass(frozen=True)
class TrackFilters:
    text: str | None = None
    playlist_id: str | None = None
    bpm_min_milli: int | None = None
    bpm_max_milli: int | None = None
    musical_key: str | None = None
    key_relation: str | None = None
    genre: str | None = None
    energy_min_ppm: int | None = None
    energy_max_ppm: int | None = None
    analysis_state: str = "any"
    availability: str = "any"


@dataclass(frozen=True)
class TrackEvidence:
    track: StoredTrack
    analysis: AnalysisSummary | None = None
    playlist_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class DiscoveryTrack:
    id: str
    title: str | None
    artist: str | None
    album: str | None
    genre: str | None
    bpm_milli: int | None
    musical_key: str | None
    duration_ms: int | None
    availability: str


@dataclass(frozen=True)
class ScoreComponent:
    name: ComponentName
    score_ppm: int | None
    weight_ppm: int
    contribution_signed_ppm: int
    effect: ComponentEffect
    reason: str


@dataclass(frozen=True)
class DiscoveryCandidate:
    track: DiscoveryTrack
    score_ppm: int
    confidence_ppm: int
    reasons: tuple[str, ...]
    components: tuple[ScoreComponent, ...]


@dataclass(frozen=True)
class SimilarityResult:
    seed: DiscoveryTrack
    algorithm_version: str
    scanned_count: int
    truncated: bool
    items: tuple[DiscoveryCandidate, ...]


@dataclass(frozen=True)
class RecommendationResult:
    seed: DiscoveryTrack
    intent: DiscoveryIntent
    algorithm_version: str
    scanned_count: int
    truncated: bool
    items: tuple[DiscoveryCandidate, ...]


def filter_evidence(
    catalog: tuple[TrackEvidence, ...],
    filters: TrackFilters = TrackFilters(),
    *,
    allow_repeated_track_ids: bool = False,
) -> tuple[TrackEvidence, ...]:
    """Return matching records without changing their input order."""
    if type(allow_repeated_track_ids) is not bool:
        _invalid("The repeated-track flag must be a boolean.")
    _validate_catalog(catalog, allow_repeated_track_ids=allow_repeated_track_ids)
    _validate_filters(filters)
    return tuple(evidence for evidence in catalog if _matches_filters(evidence, filters))


def find_similar_tracks(
    catalog: tuple[TrackEvidence, ...],
    seed_track_id: str,
    filters: TrackFilters = TrackFilters(),
    limit: int = 10,
    truncated: bool = False,
) -> SimilarityResult:
    _validate_discovery_request(catalog, seed_track_id, filters, limit, truncated)
    seed = _find_seed(catalog, seed_track_id)
    candidates = (
        evidence
        for evidence in catalog
        if evidence.track.id != seed_track_id
        and evidence.track.availability == "available"
        and _matches_filters(evidence, filters)
    )
    items = tuple(
        sorted(
            (_score_candidate(seed, candidate, _SIMILARITY_WEIGHTS, None) for candidate in candidates),
            key=_candidate_sort_key,
        )[:limit]
    )
    return SimilarityResult(
        seed=_discovery_track(seed.track),
        algorithm_version=SIMILARITY_ALGORITHM_VERSION,
        scanned_count=len(catalog),
        truncated=truncated,
        items=items,
    )


def recommend_next_tracks(
    catalog: tuple[TrackEvidence, ...],
    seed_track_id: str,
    intent: DiscoveryIntent,
    filters: TrackFilters = TrackFilters(),
    limit: int = 10,
    truncated: bool = False,
) -> RecommendationResult:
    _validate_discovery_request(catalog, seed_track_id, filters, limit, truncated)
    if not isinstance(intent, str) or intent not in _INTENTS:
        _invalid("The discovery intent is invalid.")
    seed = _find_seed(catalog, seed_track_id)
    candidates = (
        evidence
        for evidence in catalog
        if evidence.track.id != seed_track_id
        and evidence.track.availability == "available"
        and _matches_filters(evidence, filters)
    )
    items = tuple(
        sorted(
            (
                _score_candidate(seed, candidate, _TRANSITION_WEIGHTS[intent], intent)
                for candidate in candidates
            ),
            key=_candidate_sort_key,
        )[:limit]
    )
    return RecommendationResult(
        seed=_discovery_track(seed.track),
        intent=intent,
        algorithm_version=TRANSITION_ALGORITHM_VERSION,
        scanned_count=len(catalog),
        truncated=truncated,
        items=items,
    )


def _validate_discovery_request(
    catalog: tuple[TrackEvidence, ...],
    seed_track_id: str,
    filters: TrackFilters,
    limit: int,
    truncated: bool,
) -> None:
    _validate_catalog(catalog)
    _validate_id(seed_track_id, "seed track")
    _validate_filters(filters)
    if type(limit) is not int or not 1 <= limit <= 20:
        _invalid("The discovery limit must be an integer from 1 to 20.")
    if type(truncated) is not bool:
        _invalid("The discovery truncated flag must be a boolean.")


def _validate_catalog(
    catalog: tuple[TrackEvidence, ...],
    *,
    allow_repeated_track_ids: bool = False,
) -> None:
    if type(catalog) is not tuple:
        _invalid("The discovery catalog must be a tuple.")
    if len(catalog) > MAX_SCAN_COUNT:
        _invalid("The discovery catalog exceeds the 25,000-track scan cap.")
    seen_ids = set()
    for evidence in catalog:
        if not isinstance(evidence, TrackEvidence) or not isinstance(evidence.track, StoredTrack):
            _invalid("The discovery catalog contains invalid track evidence.")
        track = evidence.track
        _validate_id(track.id, "track")
        _validate_id(track.external_id, "external track")
        if not allow_repeated_track_ids and track.id in seen_ids:
            _invalid("The discovery catalog contains duplicate track IDs.")
        seen_ids.add(track.id)
        for value in (track.title, track.artist, track.album, track.genre):
            if value is not None and (not isinstance(value, str) or len(value) > 1_000):
                _invalid("The discovery catalog contains invalid display text.")
        if track.bpm_milli is not None and (type(track.bpm_milli) is not int or track.bpm_milli <= 0):
            _invalid("The discovery catalog contains invalid tempo metadata.")
        if track.musical_key is not None and (
            not isinstance(track.musical_key, str) or len(track.musical_key) > 64
        ):
            _invalid("The discovery catalog contains invalid key metadata.")
        if track.duration_ms is not None and (type(track.duration_ms) is not int or track.duration_ms < 0):
            _invalid("The discovery catalog contains invalid duration metadata.")
        if track.availability not in _AVAILABILITIES:
            _invalid("The discovery catalog contains invalid availability metadata.")
        if type(evidence.playlist_ids) is not tuple:
            _invalid("Track playlist IDs must be a tuple.")
        for playlist_id in evidence.playlist_ids:
            _validate_id(playlist_id, "playlist")
        if evidence.analysis is not None:
            if not isinstance(evidence.analysis, AnalysisSummary) or evidence.analysis.status not in _ANALYSIS_STATUSES:
                _invalid("The discovery catalog contains an invalid analysis summary.")
            if evidence.analysis.features is not None and not isinstance(evidence.analysis.features, AnalysisFeatures):
                _invalid("The discovery catalog contains invalid local features.")


def _validate_filters(filters: TrackFilters) -> None:
    if not isinstance(filters, TrackFilters):
        _invalid("Discovery filters must use TrackFilters.")
    _validate_optional_text(filters.text, 200, "text")
    if filters.playlist_id is not None:
        _validate_id(filters.playlist_id, "playlist")
    _validate_optional_integer(filters.bpm_min_milli, 30_000, 400_000, "minimum BPM")
    _validate_optional_integer(filters.bpm_max_milli, 30_000, 400_000, "maximum BPM")
    if (
        filters.bpm_min_milli is not None
        and filters.bpm_max_milli is not None
        and filters.bpm_min_milli > filters.bpm_max_milli
    ):
        _invalid("The minimum BPM cannot exceed the maximum BPM.")
    _validate_optional_text(filters.musical_key, 64, "musical key")
    if filters.key_relation is not None and filters.key_relation not in _KEY_RELATIONS:
        _invalid("The key relation is invalid.")
    if filters.key_relation is not None and filters.musical_key is None:
        _invalid("A key relation requires a musical key.")
    _validate_optional_text(filters.genre, 200, "genre")
    _validate_optional_integer(filters.energy_min_ppm, 0, PPM, "minimum energy")
    _validate_optional_integer(filters.energy_max_ppm, 0, PPM, "maximum energy")
    if (
        filters.energy_min_ppm is not None
        and filters.energy_max_ppm is not None
        and filters.energy_min_ppm > filters.energy_max_ppm
    ):
        _invalid("The minimum energy cannot exceed the maximum energy.")
    if filters.analysis_state not in _ANALYSIS_STATES:
        _invalid("The analysis state is invalid.")
    if filters.availability not in _FILTER_AVAILABILITIES:
        _invalid("The availability filter is invalid.")


def _validate_optional_text(value: str | None, maximum: int, label: str) -> None:
    if value is not None and (not isinstance(value, str) or not 1 <= len(value) <= maximum):
        _invalid(f"The {label} must contain 1 to {maximum} characters.")


def _validate_optional_integer(value: int | None, minimum: int, maximum: int, label: str) -> None:
    if value is not None and (type(value) is not int or not minimum <= value <= maximum):
        _invalid(f"The {label} is outside its bounded range.")


def _validate_id(value: object, label: str) -> None:
    if not isinstance(value, str) or not 1 <= len(value) <= 128:
        _invalid(f"The {label} ID must contain 1 to 128 characters.")


def _invalid(message: str) -> None:
    raise DiscoveryError("invalid_request", message)


def _find_seed(catalog: tuple[TrackEvidence, ...], seed_track_id: str) -> TrackEvidence:
    for evidence in catalog:
        if evidence.track.id == seed_track_id:
            return evidence
    raise DiscoveryError("not_found", "The requested seed track was not found.")


def _matches_filters(evidence: TrackEvidence, filters: TrackFilters) -> bool:
    track = evidence.track
    if filters.text is not None:
        fields = tuple((value or "").casefold() for value in (track.title, track.artist, track.album, track.genre))
        if not all(any(token in field for field in fields) for token in filters.text.casefold().split()):
            return False
    if filters.playlist_id is not None and filters.playlist_id not in evidence.playlist_ids:
        return False

    tempo = _effective_tempo(evidence)
    if filters.bpm_min_milli is not None and (tempo is None or tempo[0] < filters.bpm_min_milli):
        return False
    if filters.bpm_max_milli is not None and (tempo is None or tempo[0] > filters.bpm_max_milli):
        return False

    if filters.musical_key is not None:
        wanted = _normalize_key(filters.musical_key)
        actual = _effective_key(evidence)
        if wanted is None or actual is None:
            return False
        key_score = _camelot_score(wanted, actual[0])
        relation = filters.key_relation or "exact"
        if relation == "exact" and key_score != PPM:
            return False
        if relation == "compatible" and key_score < 800_000:
            return False

    if filters.genre is not None:
        if track.genre is None or filters.genre.casefold() not in track.genre.casefold():
            return False

    features = _successful_features(evidence)
    energy = features.energy_ppm if features is not None else None
    if filters.energy_min_ppm is not None and (energy is None or energy < filters.energy_min_ppm):
        return False
    if filters.energy_max_ppm is not None and (energy is None or energy > filters.energy_max_ppm):
        return False

    analyzed = features is not None
    failed = evidence.analysis is not None and evidence.analysis.status == "failed"
    if filters.analysis_state == "analyzed" and not analyzed:
        return False
    if filters.analysis_state == "not_analyzed" and analyzed:
        return False
    if filters.analysis_state == "failed" and not failed:
        return False
    if filters.availability != "any" and track.availability != filters.availability:
        return False
    return True


def _score_candidate(
    seed: TrackEvidence,
    candidate: TrackEvidence,
    weights: tuple[tuple[str, int], ...],
    intent: str | None,
) -> DiscoveryCandidate:
    components = []
    qualities = []
    for name, weight in weights:
        score_quality = _component_score(seed, candidate, name, intent)
        if score_quality is None:
            component = ScoreComponent(
                name=name,
                score_ppm=None,
                weight_ppm=weight,
                contribution_signed_ppm=0,
                effect="missing",
                reason=_MISSING_REASONS[name],
            )
            quality = 0
        else:
            score, quality = score_quality
            contribution = _round_half_away_from_zero(weight * (2 * score - PPM), PPM)
            effect = "bonus" if score >= 600_000 else "penalty" if score < 400_000 else "neutral"
            component = ScoreComponent(
                name=name,
                score_ppm=score,
                weight_ppm=weight,
                contribution_signed_ppm=contribution,
                effect=effect,
                reason=f"{_COMPONENT_LABELS[name]} is a {effect} ({score} ppm).",
            )
        components.append(component)
        qualities.append(quality)

    available = [component for component in components if component.score_ppm is not None]
    available_weight = sum(component.weight_ppm for component in available)
    if available_weight:
        score_ppm = _round_half_up(
            sum(component.weight_ppm * component.score_ppm for component in available),
            available_weight,
        )
    else:
        score_ppm = 0
    confidence_ppm = _round_half_up(
        sum(component.weight_ppm * quality for component, quality in zip(components, qualities)),
        PPM,
    )
    reasons = _main_reasons(tuple(components), intent)
    return DiscoveryCandidate(
        track=_discovery_track(candidate.track),
        score_ppm=score_ppm,
        confidence_ppm=confidence_ppm,
        reasons=reasons,
        components=tuple(components),
    )


def _component_score(
    seed: TrackEvidence,
    candidate: TrackEvidence,
    name: str,
    intent: str | None,
) -> tuple[int, int] | None:
    if name == "tempo":
        return _tempo_score(seed, candidate)
    if name == "key":
        return _key_score(seed, candidate)
    if name == "energy":
        return _energy_score(seed, candidate, intent)
    if name == "style":
        return _style_score(seed, candidate, intent)
    if name == "timbre":
        return _timbre_score(seed, candidate, intent)
    return None


def _tempo_score(seed: TrackEvidence, candidate: TrackEvidence) -> tuple[int, int] | None:
    seed_tempo = _effective_tempo(seed)
    candidate_tempo = _effective_tempo(candidate)
    if seed_tempo is None or candidate_tempo is None:
        return None
    seed_value, seed_quality = seed_tempo
    candidate_value, candidate_quality = candidate_tempo
    difference_ppm = min(
        _round_half_up(abs(numerator - seed_value * denominator) * PPM, seed_value * denominator)
        for numerator, denominator in (
            (candidate_value, 1),
            (candidate_value, 2),
            (candidate_value * 2, 1),
        )
    )
    score = max(0, PPM - _round_half_up(difference_ppm * PPM, 120_000))
    return score, min(seed_quality, candidate_quality)


def _key_score(seed: TrackEvidence, candidate: TrackEvidence) -> tuple[int, int] | None:
    seed_key = _effective_key(seed)
    candidate_key = _effective_key(candidate)
    if seed_key is None or candidate_key is None:
        return None
    return _camelot_score(seed_key[0], candidate_key[0]), min(seed_key[1], candidate_key[1])


def _energy_score(
    seed: TrackEvidence,
    candidate: TrackEvidence,
    intent: str | None,
) -> tuple[int, int] | None:
    seed_features = _successful_features(seed)
    candidate_features = _successful_features(candidate)
    if seed_features is None or candidate_features is None:
        return None
    seed_energy = seed_features.energy_ppm
    candidate_energy = candidate_features.energy_ppm
    if intent == "build":
        score = _target_ramp(candidate_energy, min(PPM, seed_energy + 150_000), 300_000)
    elif intent == "peak":
        score = _target_ramp(candidate_energy, max(seed_energy, 850_000), 300_000)
    elif intent == "reset":
        score = _target_ramp(candidate_energy, max(0, seed_energy - 200_000), 400_000)
    elif intent == "adventurous":
        score = abs(candidate_energy - seed_energy)
    elif intent == "closer":
        target = min(550_000, max(250_000, seed_energy - 200_000))
        score = _target_ramp(candidate_energy, target, 400_000)
    else:
        score = PPM - abs(candidate_energy - seed_energy)
    return _clamp_ppm(score), 700_000


def _style_score(
    seed: TrackEvidence,
    candidate: TrackEvidence,
    intent: str | None,
) -> tuple[int, int] | None:
    seed_genre = _normalized_genre(seed.track.genre)
    candidate_genre = _normalized_genre(candidate.track.genre)
    if seed_genre is None or candidate_genre is None:
        return None
    continuity = PPM if seed_genre == candidate_genre else 0
    score = PPM - continuity if intent in {"genre_shift", "adventurous"} else continuity
    return score, 600_000


def _timbre_score(
    seed: TrackEvidence,
    candidate: TrackEvidence,
    intent: str | None,
) -> tuple[int, int] | None:
    seed_features = _successful_features(seed)
    candidate_features = _successful_features(candidate)
    if seed_features is None or candidate_features is None:
        return None
    closeness = [
        _bounded_closeness(seed_features.brightness_ppm, candidate_features.brightness_ppm),
        _bounded_closeness(seed_features.beat_strength_ppm, candidate_features.beat_strength_ppm),
        _relative_closeness(seed_features.onset_rate_milli_hz, candidate_features.onset_rate_milli_hz),
    ]
    if seed_features.spectral_centroid_hz is not None and candidate_features.spectral_centroid_hz is not None:
        closeness.append(
            _relative_closeness(seed_features.spectral_centroid_hz, candidate_features.spectral_centroid_hz)
        )
    score = _round_half_up(sum(closeness), len(closeness))
    if intent in {"peak", "adventurous"}:
        score = PPM - score
    return _clamp_ppm(score), 700_000


def _target_ramp(candidate: int, target: int, tolerance: int) -> int:
    distance = min(PPM, _round_half_up(abs(candidate - target) * PPM, tolerance))
    return PPM - distance


def _bounded_closeness(first: int, second: int) -> int:
    return _clamp_ppm(PPM - abs(first - second))


def _relative_closeness(first: int, second: int) -> int:
    difference = min(PPM, _round_half_up(abs(first - second) * PPM, max(first, second, 1)))
    return PPM - difference


def _effective_tempo(evidence: TrackEvidence) -> tuple[int, int] | None:
    features = _successful_features(evidence)
    if (
        features is not None
        and features.bpm_milli is not None
        and features.bpm_milli > 0
        and features.tempo_confidence_ppm >= 500_000
    ):
        return features.bpm_milli, features.tempo_confidence_ppm
    if evidence.track.bpm_milli is not None and evidence.track.bpm_milli > 0:
        return evidence.track.bpm_milli, 600_000
    return None


def _effective_key(evidence: TrackEvidence) -> tuple[tuple[int, str], int] | None:
    features = _successful_features(evidence)
    if features is not None and features.key_confidence_ppm >= 500_000:
        local_key = _normalize_key(features.musical_key, features.mode)
        if local_key is not None:
            return local_key, features.key_confidence_ppm
    imported_key = _normalize_key(evidence.track.musical_key)
    if imported_key is not None:
        return imported_key, 600_000
    return None


def _successful_features(evidence: TrackEvidence) -> AnalysisFeatures | None:
    analysis = evidence.analysis
    if analysis is not None and analysis.status == "succeeded" and isinstance(analysis.features, AnalysisFeatures):
        return analysis.features
    return None


def _normalize_key(value: str | None, mode: str | None = None) -> tuple[int, str] | None:
    if value is None:
        return None
    normalized = value.replace("♯", "#").replace("♭", "b")
    camelot = _CAMELOT_PATTERN.fullmatch(normalized)
    if camelot is not None:
        return int(camelot.group(1)), camelot.group(2).upper()
    note = _NOTE_PATTERN.fullmatch(normalized)
    if note is None:
        return None
    letter, accidental, suffix = note.groups()
    pitch = _PITCH_CLASSES[letter.casefold()]
    if accidental == "#":
        pitch += 1
    elif accidental.casefold() == "b":
        pitch -= 1
    normalized_mode = suffix.casefold() if suffix is not None else (mode or "major").casefold()
    if normalized_mode in {"m", "min", "minor"}:
        return _MINOR_CAMELOT[pitch % 12], "A"
    if normalized_mode in {"maj", "major"}:
        return _MAJOR_CAMELOT[pitch % 12], "B"
    return None


def _camelot_score(first: tuple[int, str], second: tuple[int, str]) -> int:
    if first == second:
        return PPM
    first_number, first_letter = first
    second_number, second_letter = second
    if first_letter == second_letter and (first_number - second_number) % 12 in {1, 11}:
        return 900_000
    if first_number == second_number and first_letter != second_letter:
        return 800_000
    return 0


def _main_reasons(components: tuple[ScoreComponent, ...], intent: str | None) -> tuple[str, ...]:
    available = [component for component in components if component.score_ppm is not None]
    if not available:
        return tuple(component.reason for component in components[:3])
    strongest = sorted(
        available,
        key=lambda component: (
            -abs(component.contribution_signed_ppm),
            _COMPONENT_ORDER[component.name],
        ),
    )[:2]
    reasons = [component.reason for component in strongest]
    required_name = _REQUIRED_MISSING.get(intent)
    if required_name is not None:
        required = next(component for component in components if component.name == required_name)
        if required.effect == "missing" and len(reasons) < 3:
            reasons.append(required.reason)
    return tuple(reasons)


def _discovery_track(track: StoredTrack) -> DiscoveryTrack:
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


def _candidate_sort_key(candidate: DiscoveryCandidate) -> tuple[object, ...]:
    return (
        -candidate.score_ppm,
        -candidate.confidence_ppm,
        _normalized_sort_text(candidate.track.title),
        _normalized_sort_text(candidate.track.artist),
        candidate.track.id,
    )


def _normalized_sort_text(value: str | None) -> str:
    return unicodedata.normalize("NFKC", value or "").strip().casefold()


def _normalized_genre(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().casefold()
    return normalized or None


def _clamp_ppm(value: int) -> int:
    return max(0, min(PPM, value))


def _round_half_up(numerator: int, denominator: int) -> int:
    return (numerator + denominator // 2) // denominator


def _round_half_away_from_zero(numerator: int, denominator: int) -> int:
    magnitude = _round_half_up(abs(numerator), denominator)
    return -magnitude if numerator < 0 else magnitude


__all__ = (
    "DiscoveryCandidate",
    "DiscoveryError",
    "DiscoveryIntent",
    "DiscoveryTrack",
    "RecommendationResult",
    "ScoreComponent",
    "SimilarityResult",
    "TrackEvidence",
    "TrackFilters",
    "filter_evidence",
    "find_similar_tracks",
    "recommend_next_tracks",
)
