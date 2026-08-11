"""Pure, deterministic ``preference-linear-v1`` projection primitives."""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
from typing import Literal, TypeAlias
import unicodedata


PPM = 1_000_000
ALGORITHM_VERSION = "preference-linear-v1"
MINIMUM_EVIDENCE_COUNT = 5
MAX_PREFERENCE_WEIGHT_PPM = 150_000
WEIGHT_STEP_PPM = 15_000
MAX_PROFILE_AFFINITIES = 50
EVIDENCE_QUALITY_STEP_PPM = 100_000

FeedbackEventType: TypeAlias = Literal[
    "liked",
    "disliked",
    "accepted",
    "rejected",
    "skipped",
    "manual_replacement",
    "manual_reorder",
    "pinned",
    "removed",
    "banned",
]
PreferenceStatus: TypeAlias = Literal["baseline", "learning", "active"]

_EVENT_ORDER: tuple[FeedbackEventType, ...] = (
    "liked",
    "disliked",
    "accepted",
    "rejected",
    "skipped",
    "manual_replacement",
    "manual_reorder",
    "pinned",
    "removed",
    "banned",
)
_EVENT_SIGNALS: dict[FeedbackEventType, int] = {
    "liked": 2,
    "disliked": -2,
    "accepted": 2,
    "rejected": -2,
    "skipped": -1,
    "manual_replacement": 0,
    "manual_reorder": 1,
    "pinned": 2,
    "removed": -2,
    "banned": -2,
}


class PersonalizationError(ValueError):
    """A stable failure raised for malformed preference-domain input."""

    def __init__(self, message: str):
        self.code = "invalid_request"
        self.message = message[:500]
        super().__init__(self.message)


@dataclass(frozen=True)
class PreferenceTrack:
    track_id: str
    genre: str | None = None


@dataclass(frozen=True)
class PreferenceEvent:
    """One stored feedback projection.

    For ``manual_replacement``, ``track_id`` is the old track and
    ``related_track_id`` is the replacement track.
    """

    event_type: FeedbackEventType
    track_id: str
    related_track_id: str | None = None


@dataclass(frozen=True)
class PreferenceRating:
    track_id: str
    rating: int


@dataclass(frozen=True)
class PreferenceEventCount:
    event_type: FeedbackEventType
    count: int


@dataclass(frozen=True)
class TrackAffinity:
    track_id: str
    score_ppm: int
    evidence_count: int


@dataclass(frozen=True)
class GenreAffinity:
    genre: str
    score_ppm: int
    evidence_count: int


@dataclass(frozen=True)
class PreferenceProfile:
    algorithm_version: str
    revision: str
    status: PreferenceStatus
    total_personal_data_count: int
    effective_evidence_count: int
    minimum_evidence_count: int
    preference_weight_ppm: int
    event_counts: tuple[PreferenceEventCount, ...]
    track_affinities: tuple[TrackAffinity, ...]
    genre_affinities: tuple[GenreAffinity, ...]
    track_affinities_truncated: bool
    genre_affinities_truncated: bool


@dataclass(frozen=True)
class PreferenceEvidence:
    score_ppm: int
    quality_ppm: int
    weight_ppm: int
    supporting_evidence_count: int


@dataclass(frozen=True)
class PreferenceModel:
    """A bounded public profile plus complete path-free scoring affinities."""

    profile: PreferenceProfile
    track_affinities: tuple[TrackAffinity, ...]
    genre_affinities: tuple[GenreAffinity, ...]


def build_preference_model(
    current_tracks: tuple[PreferenceTrack, ...],
    events: tuple[PreferenceEvent, ...],
    ratings: tuple[PreferenceRating, ...],
) -> PreferenceModel:
    """Aggregate current-library evidence without consulting storage or clocks."""
    tracks_by_id = _validate_tracks(current_tracks)
    _validate_events(events)
    _validate_ratings(ratings)

    track_totals: dict[str, list[int]] = {}
    genre_totals: dict[str, list[int]] = {}
    effective_evidence_count = 0
    event_counts = {event_type: 0 for event_type in _EVENT_ORDER}

    for event in events:
        event_counts[event.event_type] += 1
        if event.event_type == "manual_replacement":
            contributions = ((event.track_id, -2), (event.related_track_id, 2))
        else:
            contributions = ((event.track_id, _EVENT_SIGNALS[event.event_type]),)
        for track_id, signal in contributions:
            if track_id not in tracks_by_id:
                continue
            effective_evidence_count += 1
            _add_signal(
                track_totals,
                genre_totals,
                tracks_by_id,
                track_id,
                signal,
            )

    for rating in ratings:
        if rating.track_id not in tracks_by_id:
            continue
        effective_evidence_count += 1
        _add_signal(
            track_totals,
            genre_totals,
            tracks_by_id,
            rating.track_id,
            rating.rating - 3,
        )

    full_track_affinities = tuple(
        TrackAffinity(track_id, _affinity_score(*totals), totals[1])
        for track_id, totals in sorted(track_totals.items())
    )
    full_genre_affinities = tuple(
        GenreAffinity(genre, _affinity_score(*totals), totals[1])
        for genre, totals in sorted(genre_totals.items())
    )
    fixed_event_counts = tuple(
        PreferenceEventCount(event_type, event_counts[event_type])
        for event_type in _EVENT_ORDER
    )
    total_personal_data_count = len(events) + len(ratings)
    status, preference_weight_ppm = _status_and_weight(effective_evidence_count)
    revision = _revision(
        total_personal_data_count,
        effective_evidence_count,
        fixed_event_counts,
        full_track_affinities,
        full_genre_affinities,
    )

    public_tracks = tuple(sorted(full_track_affinities, key=_track_display_key)[:MAX_PROFILE_AFFINITIES])
    public_genres = tuple(sorted(full_genre_affinities, key=_genre_display_key)[:MAX_PROFILE_AFFINITIES])
    profile = PreferenceProfile(
        algorithm_version=ALGORITHM_VERSION,
        revision=revision,
        status=status,
        total_personal_data_count=total_personal_data_count,
        effective_evidence_count=effective_evidence_count,
        minimum_evidence_count=MINIMUM_EVIDENCE_COUNT,
        preference_weight_ppm=preference_weight_ppm,
        event_counts=fixed_event_counts,
        track_affinities=public_tracks,
        genre_affinities=public_genres,
        track_affinities_truncated=len(full_track_affinities) > MAX_PROFILE_AFFINITIES,
        genre_affinities_truncated=len(full_genre_affinities) > MAX_PROFILE_AFFINITIES,
    )
    return PreferenceModel(profile, full_track_affinities, full_genre_affinities)


def candidate_preference(
    model: PreferenceModel,
    track_id: str,
    genre: str | None,
) -> PreferenceEvidence | None:
    """Return active candidate evidence, keeping absent affinity genuinely missing."""
    if not isinstance(model, PreferenceModel):
        _invalid("Preference scoring requires a PreferenceModel.")
    _validate_id(track_id, "track")
    if genre is not None and (not isinstance(genre, str) or len(genre) > 1_000):
        _invalid("The candidate genre is invalid.")
    if model.profile.preference_weight_ppm == 0:
        return None

    track_affinity = _find_track_affinity(model.track_affinities, track_id)
    normalized_genre = _normalize_genre(genre)
    genre_affinity = (
        _find_genre_affinity(model.genre_affinities, normalized_genre)
        if normalized_genre is not None
        else None
    )
    if track_affinity is None and genre_affinity is None:
        return None
    if track_affinity is not None and genre_affinity is not None:
        score_ppm = _round_half_up(
            2 * track_affinity.score_ppm + genre_affinity.score_ppm,
            3,
        )
        supporting_evidence_count = (
            2 * track_affinity.evidence_count + genre_affinity.evidence_count
        )
    elif track_affinity is not None:
        score_ppm = track_affinity.score_ppm
        supporting_evidence_count = track_affinity.evidence_count
    else:
        score_ppm = genre_affinity.score_ppm
        supporting_evidence_count = genre_affinity.evidence_count
    return PreferenceEvidence(
        score_ppm=score_ppm,
        quality_ppm=min(PPM, supporting_evidence_count * EVIDENCE_QUALITY_STEP_PPM),
        weight_ppm=model.profile.preference_weight_ppm,
        supporting_evidence_count=supporting_evidence_count,
    )


def _validate_tracks(current_tracks: tuple[PreferenceTrack, ...]) -> dict[str, str | None]:
    if type(current_tracks) is not tuple:
        _invalid("Current preference tracks must be a tuple.")
    tracks_by_id: dict[str, str | None] = {}
    for track in current_tracks:
        if not isinstance(track, PreferenceTrack):
            _invalid("Current preference tracks contain an invalid record.")
        _validate_id(track.track_id, "track")
        if track.track_id in tracks_by_id:
            _invalid("Current preference tracks contain duplicate IDs.")
        if track.genre is not None and (
            not isinstance(track.genre, str) or len(track.genre) > 1_000
        ):
            _invalid("A current preference track has an invalid genre.")
        tracks_by_id[track.track_id] = _normalize_genre(track.genre)
    return tracks_by_id


def _validate_events(events: tuple[PreferenceEvent, ...]) -> None:
    if type(events) is not tuple:
        _invalid("Preference events must be a tuple.")
    for event in events:
        if not isinstance(event, PreferenceEvent):
            _invalid("Preference events contain an invalid record.")
        if event.event_type not in _EVENT_SIGNALS:
            _invalid("The preference event type is invalid.")
        _validate_id(event.track_id, "event track")
        if event.event_type == "manual_replacement":
            _validate_id(event.related_track_id, "replacement track")
        elif event.related_track_id is not None:
            _invalid("Only manual replacement can reference a related track.")


def _validate_ratings(ratings: tuple[PreferenceRating, ...]) -> None:
    if type(ratings) is not tuple:
        _invalid("Preference ratings must be a tuple.")
    seen_ids = set()
    for rating in ratings:
        if not isinstance(rating, PreferenceRating):
            _invalid("Preference ratings contain an invalid record.")
        _validate_id(rating.track_id, "rating track")
        if rating.track_id in seen_ids:
            _invalid("Preference ratings contain duplicate track IDs.")
        seen_ids.add(rating.track_id)
        if type(rating.rating) is not int or not 1 <= rating.rating <= 5:
            _invalid("A preference rating must be an integer from 1 to 5.")


def _validate_id(value: object, label: str) -> None:
    if not isinstance(value, str) or not 1 <= len(value) <= 128:
        _invalid(f"The {label} ID must contain 1 to 128 characters.")


def _invalid(message: str) -> None:
    raise PersonalizationError(message)


def _add_signal(
    track_totals: dict[str, list[int]],
    genre_totals: dict[str, list[int]],
    tracks_by_id: dict[str, str | None],
    track_id: str,
    signal: int,
) -> None:
    track_total = track_totals.setdefault(track_id, [0, 0])
    track_total[0] += signal
    track_total[1] += 1
    genre = tracks_by_id[track_id]
    if genre is not None:
        genre_total = genre_totals.setdefault(genre, [0, 0])
        genre_total[0] += signal
        genre_total[1] += 1


def _affinity_score(signal_sum: int, evidence_count: int) -> int:
    offset = _round_half_away_from_zero(signal_sum * 250_000, evidence_count)
    return max(0, min(PPM, 500_000 + offset))


def _status_and_weight(effective_evidence_count: int) -> tuple[PreferenceStatus, int]:
    if effective_evidence_count == 0:
        return "baseline", 0
    if effective_evidence_count < MINIMUM_EVIDENCE_COUNT:
        return "learning", 0
    return (
        "active",
        min(
            MAX_PREFERENCE_WEIGHT_PPM,
            (effective_evidence_count - (MINIMUM_EVIDENCE_COUNT - 1)) * WEIGHT_STEP_PPM,
        ),
    )


def _revision(
    total_personal_data_count: int,
    effective_evidence_count: int,
    event_counts: tuple[PreferenceEventCount, ...],
    track_affinities: tuple[TrackAffinity, ...],
    genre_affinities: tuple[GenreAffinity, ...],
) -> str:
    canonical = {
        "algorithmVersion": ALGORITHM_VERSION,
        "effectiveEvidenceCount": effective_evidence_count,
        "eventCounts": [
            [item.event_type, item.count]
            for item in event_counts
        ],
        "genreAffinities": [
            [item.genre, item.score_ppm, item.evidence_count]
            for item in genre_affinities
        ],
        "totalPersonalDataCount": total_personal_data_count,
        "trackAffinities": [
            [item.track_id, item.score_ppm, item.evidence_count]
            for item in track_affinities
        ],
    }
    encoded = json.dumps(
        canonical,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return sha256(encoded).hexdigest()


def _track_display_key(item: TrackAffinity) -> tuple[object, ...]:
    return (-item.evidence_count, -abs(item.score_ppm - 500_000), item.track_id)


def _genre_display_key(item: GenreAffinity) -> tuple[object, ...]:
    return (-item.evidence_count, -abs(item.score_ppm - 500_000), item.genre)


def _find_track_affinity(
    affinities: tuple[TrackAffinity, ...],
    track_id: str,
) -> TrackAffinity | None:
    low = 0
    high = len(affinities)
    while low < high:
        middle = (low + high) // 2
        item = affinities[middle]
        if item.track_id < track_id:
            low = middle + 1
        else:
            high = middle
    if low < len(affinities) and affinities[low].track_id == track_id:
        return affinities[low]
    return None


def _find_genre_affinity(
    affinities: tuple[GenreAffinity, ...],
    genre: str,
) -> GenreAffinity | None:
    low = 0
    high = len(affinities)
    while low < high:
        middle = (low + high) // 2
        item = affinities[middle]
        if item.genre < genre:
            low = middle + 1
        else:
            high = middle
    if low < len(affinities) and affinities[low].genre == genre:
        return affinities[low]
    return None


def _normalize_genre(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = unicodedata.normalize("NFKC", value).strip().casefold()
    return normalized or None


def _round_half_up(numerator: int, denominator: int) -> int:
    return (numerator + denominator // 2) // denominator


def _round_half_away_from_zero(numerator: int, denominator: int) -> int:
    magnitude = _round_half_up(abs(numerator), denominator)
    return -magnitude if numerator < 0 else magnitude


__all__ = (
    "ALGORITHM_VERSION",
    "FeedbackEventType",
    "GenreAffinity",
    "PersonalizationError",
    "PreferenceEvent",
    "PreferenceEventCount",
    "PreferenceEvidence",
    "PreferenceModel",
    "PreferenceProfile",
    "PreferenceRating",
    "PreferenceStatus",
    "PreferenceTrack",
    "TrackAffinity",
    "build_preference_model",
    "candidate_preference",
)
