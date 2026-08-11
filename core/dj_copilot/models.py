"""Immutable records shared by the local Rekordbox importer and repository."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING


if TYPE_CHECKING:
    from .analysis.provider import AnalysisFeatures, ProviderCapabilities


@dataclass(frozen=True)
class ImportedTrack:
    external_id: str
    title: str | None
    artist: str | None
    album: str | None
    genre: str | None
    bpm_milli: int | None
    musical_key: str | None
    duration_ms: int | None
    path: str
    availability: str


@dataclass(frozen=True)
class ImportedPlaylist:
    import_key: str
    parent_import_key: str | None
    name: str
    kind: str
    order: int
    track_external_ids: tuple[str, ...]


@dataclass(frozen=True)
class RekordboxImport:
    source_sha256: str
    tracks: tuple[ImportedTrack, ...]
    playlists: tuple[ImportedPlaylist, ...]


@dataclass(frozen=True)
class ImportSummary:
    revision: int
    source_sha256: str
    imported_tracks: int
    imported_playlists: int
    unavailable_tracks: int


@dataclass(frozen=True)
class StoredTrack:
    id: str
    external_id: str
    title: str | None
    artist: str | None
    album: str | None
    genre: str | None
    bpm_milli: int | None
    musical_key: str | None
    duration_ms: int | None
    availability: str


@dataclass(frozen=True)
class PlaylistTreeNode:
    id: str
    import_key: str
    parent_id: str | None
    name: str
    kind: str
    order: int
    track_count: int


@dataclass(frozen=True)
class TrackPage:
    items: tuple[StoredTrack, ...]
    next_cursor: str | None


@dataclass(frozen=True)
class AnalysisSummary:
    status: str
    progress_ppm: int
    attempt_count: int
    error_code: str | None
    error_message: str | None
    features: AnalysisFeatures | None


@dataclass(frozen=True)
class AnalysisQueueStatus:
    state: str
    queued: int
    running: int
    paused: int
    succeeded: int
    failed: int
    progress_ppm: int
    capabilities: ProviderCapabilities
    items: tuple[tuple[str, AnalysisSummary], ...]
