"""The service-owned SQLite projection of one imported Rekordbox library."""

import base64
from dataclasses import asdict, dataclass, fields
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import threading
import time
import uuid

from .analysis.provider import AnalysisFeatures
from .discovery import TrackEvidence, TrackFilters, filter_evidence
from .models import AnalysisSummary, ImportSummary, PlaylistTreeNode, RekordboxImport, StoredTrack, TrackPage
from .rekordbox_xml import RekordboxImportError, parse_rekordbox_xml


_ANALYSIS_STATUSES = frozenset(("queued", "running", "paused", "succeeded", "failed"))
DISCOVERY_SCAN_LIMIT = 25_000


@dataclass(frozen=True)
class TrackEvidencePage:
    items: tuple[TrackEvidence, ...]
    next_cursor: str | None
    truncated: bool


class LibraryDatabase:
    """Single-process SQLite repository. Rekordbox XML is parsed before writing."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.RLock()
        self._last_timestamp = 0
        self.migration_backup_path: Path | None = None
        self.connection = sqlite3.connect(self.path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self._create_schema()

    def close(self) -> None:
        with self._lock:
            self.connection.close()

    def import_path(self, source_path: Path) -> ImportSummary:
        with self._lock:
            return self.import_library(parse_rekordbox_xml(source_path))

    def import_library(self, imported: RekordboxImport) -> ImportSummary:
        """Atomically replace the projection while retaining known application IDs."""
        with self._lock:
            try:
                self.connection.execute("BEGIN IMMEDIATE")
                existing_tracks = {
                    row["external_id"]: (
                        row["id"],
                        row["source_path"],
                        row["availability"],
                    )
                    for row in self.connection.execute(
                        "SELECT id, external_id, source_path, availability FROM tracks"
                    )
                }
                track_ids = {
                    external_id: existing[0]
                    for external_id, existing in existing_tracks.items()
                }
                playlist_ids = {
                    row["import_key"]: row["id"]
                    for row in self.connection.execute("SELECT id, import_key FROM playlists")
                }
                assigned_playlist_ids = {
                    playlist.import_key: playlist_ids.get(playlist.import_key, str(uuid.uuid4()))
                    for playlist in imported.playlists
                }
                current_revision = self.connection.execute(
                    "SELECT revision FROM library_state WHERE singleton = 1"
                ).fetchone()
                revision = (current_revision["revision"] if current_revision else 0) + 1
                self.connection.execute("DELETE FROM playlist_tracks")
                self.connection.execute("DELETE FROM tracks")
                self.connection.execute("DELETE FROM playlists")

                invalidated_track_ids: set[str] = set()
                for track in imported.tracks:
                    track_id = track_ids.get(track.external_id, str(uuid.uuid4()))
                    source_path = os.path.normpath(track.path)
                    existing = existing_tracks.get(track.external_id)
                    if existing is not None and (
                        existing[1] != source_path or existing[2] != track.availability
                    ):
                        invalidated_track_ids.add(track_id)
                    self.connection.execute(
                        """
                        INSERT INTO tracks (
                            id, external_id, title, artist, album, genre, bpm_milli,
                            musical_key, duration_ms, availability, source_path
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            track_id,
                            track.external_id,
                            track.title,
                            track.artist,
                            track.album,
                            track.genre,
                            track.bpm_milli,
                            track.musical_key,
                            track.duration_ms,
                            track.availability,
                            source_path,
                        ),
                    )
                for sequence, playlist in enumerate(imported.playlists):
                    playlist_id = assigned_playlist_ids[playlist.import_key]
                    parent_id = assigned_playlist_ids.get(playlist.parent_import_key) if playlist.parent_import_key else None
                    self.connection.execute(
                        """
                        INSERT INTO playlists (id, import_key, parent_id, name, kind, sort_order, sequence)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (playlist_id, playlist.import_key, parent_id, playlist.name, playlist.kind, playlist.order, sequence),
                    )
                    for position, external_id in enumerate(playlist.track_external_ids):
                        self.connection.execute(
                            "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)",
                            (playlist_id, track_ids.get(external_id, self._track_id_for_external_id(external_id)), position),
                        )
                if invalidated_track_ids:
                    invalidated = tuple(sorted(invalidated_track_ids))
                    placeholders = _placeholders(len(invalidated))
                    self.connection.execute(
                        f"DELETE FROM analysis_jobs WHERE track_id IN ({placeholders})",
                        invalidated,
                    )
                    self.connection.execute(
                        f"DELETE FROM track_features WHERE track_id IN ({placeholders})",
                        invalidated,
                    )
                self.connection.execute("DELETE FROM analysis_jobs WHERE track_id NOT IN (SELECT id FROM tracks)")
                self.connection.execute("DELETE FROM track_features WHERE track_id NOT IN (SELECT id FROM tracks)")
                self.connection.execute(
                    """
                    INSERT INTO library_state (singleton, revision, source_sha256)
                    VALUES (1, ?, ?)
                    ON CONFLICT(singleton) DO UPDATE SET revision = excluded.revision, source_sha256 = excluded.source_sha256
                    """,
                    (revision, imported.source_sha256),
                )
                self.connection.commit()
            except Exception:
                self.connection.rollback()
                raise
        return ImportSummary(
            revision=revision,
            source_sha256=imported.source_sha256,
            imported_tracks=len(imported.tracks),
            imported_playlists=len(imported.playlists),
            unavailable_tracks=sum(track.availability != "available" for track in imported.tracks),
        )

    def get_playlist_tree(self) -> tuple[PlaylistTreeNode, ...]:
        with self._lock:
            rows = self.connection.execute(
                """
                SELECT playlists.id, playlists.import_key, playlists.parent_id, playlists.name, playlists.kind,
                       playlists.sort_order, COUNT(playlist_tracks.track_id) AS track_count
                FROM playlists
                LEFT JOIN playlist_tracks ON playlist_tracks.playlist_id = playlists.id
                GROUP BY playlists.id
                ORDER BY playlists.sequence
                """
            )
            return tuple(
                PlaylistTreeNode(
                    id=row["id"],
                    import_key=row["import_key"],
                    parent_id=row["parent_id"],
                    name=row["name"],
                    kind=row["kind"],
                    order=row["sort_order"],
                    track_count=row["track_count"],
                )
                for row in rows
            )

    def list_tracks(self, *, limit: int, playlist_id: str | None = None, cursor: str | None = None) -> TrackPage:
        with self._lock:
            if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 200:
                raise RekordboxImportError("invalid_limit", "Track list limit must be an integer from 1 to 200.")
            if playlist_id is not None:
                if not isinstance(playlist_id, str) or not 1 <= len(playlist_id) <= 128:
                    raise RekordboxImportError("not_found", "The requested playlist was not found.")
                if not self.connection.execute("SELECT 1 FROM playlists WHERE id = ?", (playlist_id,)).fetchone():
                    raise RekordboxImportError("not_found", "The requested playlist was not found.")
                return self._playlist_track_page(playlist_id, limit, cursor)
            return self._collection_track_page(limit, cursor)

    def search_track_evidence(
        self,
        filters: TrackFilters,
        *,
        limit: int,
        cursor: str | None = None,
    ) -> TrackEvidencePage:
        """Return one bounded, filtered page with analysis joined in one projection."""
        with self._lock:
            if not isinstance(filters, TrackFilters):
                raise TypeError("filters must be TrackFilters")
            if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 200:
                raise RekordboxImportError("invalid_limit", "Track list limit must be an integer from 1 to 200.")
            catalog, truncated = self._track_evidence_catalog(playlist_id=filters.playlist_id)
            filtered = filter_evidence(catalog, filters)
            signature = self._track_filter_signature(filters)
            offset = 0
            if cursor is not None:
                cursor_signature, offset = _decode_cursor(cursor, (str, int))
                if cursor_signature != signature or not 0 <= offset <= DISCOVERY_SCAN_LIMIT:
                    raise RekordboxImportError("invalid_cursor", "The track list cursor is invalid.")
            visible = filtered[offset:offset + limit]
            next_offset = offset + len(visible)
            next_cursor = (
                _encode_cursor((signature, next_offset))
                if next_offset < len(filtered)
                else None
            )
            return TrackEvidencePage(visible, next_cursor, truncated)

    def discovery_catalog(
        self,
        *,
        playlist_id: str | None = None,
    ) -> tuple[tuple[TrackEvidence, ...], bool]:
        """Return bounded candidate evidence in deterministic library/playlist order."""
        with self._lock:
            return self._track_evidence_catalog(playlist_id=playlist_id)

    def get_track_evidence(self, track_id: str) -> TrackEvidence | None:
        """Return one current track and its path-free evidence by stable app ID."""
        with self._lock:
            if not isinstance(track_id, str) or not 1 <= len(track_id) <= 128:
                return None
            evidence, _ = self._track_evidence_catalog(track_id=track_id)
            return evidence[0] if evidence else None

    def get_track_source_path(self, track_id: str) -> Path | None:
        """Return the service-private local source for one stable application track ID."""
        with self._lock:
            row = self.connection.execute(
                "SELECT source_path FROM tracks WHERE id = ?",
                (track_id,),
            ).fetchone()
            return Path(row["source_path"]) if row is not None else None

    def put_analysis_job(
        self,
        track_id: str,
        *,
        status: str,
        progress_ppm: int,
        attempt_count: int,
        error_code: str | None,
        error_message: str | None,
        fingerprint: str | None,
        provider: str,
        provider_version: str | None,
        pipeline_version: str,
    ) -> None:
        """Create or replace the sole durable queue row for a known track."""
        with self._lock:
            if status not in _ANALYSIS_STATUSES:
                raise ValueError("invalid analysis status")
            if not self._track_exists(track_id):
                raise KeyError(track_id)
            self.connection.execute(
                """
                INSERT INTO analysis_jobs (
                    track_id, status, progress_ppm, attempt_count, error_code, error_message,
                    fingerprint, provider, provider_version, pipeline_version, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(track_id) DO UPDATE SET
                    status = excluded.status,
                    progress_ppm = excluded.progress_ppm,
                    attempt_count = excluded.attempt_count,
                    error_code = excluded.error_code,
                    error_message = excluded.error_message,
                    fingerprint = excluded.fingerprint,
                    provider = excluded.provider,
                    provider_version = excluded.provider_version,
                    pipeline_version = excluded.pipeline_version,
                    updated_at = excluded.updated_at
                """,
                (
                    track_id,
                    status,
                    _clamp_progress(progress_ppm),
                    max(0, int(attempt_count)),
                    error_code,
                    error_message[:500] if error_message is not None else None,
                    fingerprint,
                    str(provider),
                    str(provider_version) if provider_version is not None else None,
                    str(pipeline_version),
                    self._timestamp(),
                ),
            )
            self.connection.commit()

    def put_track_features(self, track_id: str, features_value: AnalysisFeatures) -> None:
        """Create or replace the sole validated feature row for a known track."""
        with self._lock:
            if not self._track_exists(track_id):
                raise KeyError(track_id)
            feature_json = _encode_analysis_features(features_value)
            self.connection.execute(
                """
                INSERT INTO track_features (
                    track_id, feature_json, fingerprint, provider, provider_version,
                    pipeline_version, generated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(track_id) DO UPDATE SET
                    feature_json = excluded.feature_json,
                    fingerprint = excluded.fingerprint,
                    provider = excluded.provider,
                    provider_version = excluded.provider_version,
                    pipeline_version = excluded.pipeline_version,
                    generated_at = excluded.generated_at
                """,
                (
                    track_id,
                    feature_json,
                    features_value.fingerprint,
                    features_value.provider,
                    features_value.provider_version,
                    features_value.pipeline_version,
                    self._timestamp(),
                ),
            )
            self.connection.commit()

    def analysis_summary(self, track_id: str) -> AnalysisSummary | None:
        with self._lock:
            row = self.connection.execute(
                """
                SELECT analysis_jobs.status, analysis_jobs.progress_ppm, analysis_jobs.attempt_count,
                       analysis_jobs.error_code, analysis_jobs.error_message,
                       track_features.feature_json, track_features.fingerprint AS feature_fingerprint,
                       track_features.provider AS feature_provider,
                       track_features.provider_version AS feature_provider_version,
                       track_features.pipeline_version AS feature_pipeline_version
                FROM analysis_jobs
                LEFT JOIN track_features ON track_features.track_id = analysis_jobs.track_id
                WHERE analysis_jobs.track_id = ?
                """,
                (track_id,),
            ).fetchone()
            return _summary_from_row(row) if row is not None else None

    def queue_analysis_tracks(
        self,
        track_ids: tuple[str, ...],
        *,
        provider: str,
        provider_version: str | None,
        pipeline_version: str,
    ) -> None:
        with self._lock:
            known = {
                row["id"]
                for row in self.connection.execute(
                    f"SELECT id FROM tracks WHERE id IN ({_placeholders(len(track_ids))})",
                    track_ids,
                )
            }
            if len(known) != len(track_ids):
                raise KeyError("unknown track ID")
            try:
                self.connection.execute("BEGIN IMMEDIATE")
                for track_id in track_ids:
                    self.connection.execute(
                        """
                        INSERT INTO analysis_jobs (
                            track_id, status, progress_ppm, attempt_count, error_code,
                            error_message, fingerprint, provider, provider_version,
                            pipeline_version, updated_at
                        ) VALUES (?, 'queued', 0, 0, NULL, NULL, NULL, ?, ?, ?, ?)
                        ON CONFLICT(track_id) DO UPDATE SET
                            status = 'queued',
                            progress_ppm = 0,
                            error_code = NULL,
                            error_message = NULL,
                            fingerprint = NULL,
                            provider = excluded.provider,
                            provider_version = excluded.provider_version,
                            pipeline_version = excluded.pipeline_version,
                            updated_at = excluded.updated_at
                        """,
                        (
                            track_id,
                            provider,
                            provider_version,
                            pipeline_version,
                            self._timestamp(),
                        ),
                    )
                self.connection.commit()
            except Exception:
                self.connection.rollback()
                raise

    def pause_analysis(self) -> None:
        with self._lock:
            self.connection.execute(
                "UPDATE analysis_control SET paused = 1 WHERE singleton = 1"
            )
            self.connection.commit()

    def resume_analysis(self) -> None:
        with self._lock:
            try:
                self.connection.execute("BEGIN IMMEDIATE")
                self.connection.execute(
                    "UPDATE analysis_control SET paused = 0 WHERE singleton = 1"
                )
                self.connection.execute(
                    "UPDATE analysis_jobs SET status = 'queued' WHERE status = 'paused'"
                )
                self.connection.commit()
            except Exception:
                self.connection.rollback()
                raise

    def claim_next_analysis_job(self) -> tuple[str, Path] | None:
        with self._lock:
            paused = self.connection.execute(
                "SELECT paused FROM analysis_control WHERE singleton = 1"
            ).fetchone()["paused"]
            if paused:
                return None
            row = self.connection.execute(
                """
                SELECT analysis_jobs.track_id, tracks.source_path
                FROM analysis_jobs
                JOIN tracks ON tracks.id = analysis_jobs.track_id
                WHERE analysis_jobs.status = 'queued'
                ORDER BY analysis_jobs.updated_at, analysis_jobs.track_id
                LIMIT 1
                """
            ).fetchone()
            if row is None:
                return None
            changed = self.connection.execute(
                """
                UPDATE analysis_jobs
                SET status = 'running', progress_ppm = 0, attempt_count = attempt_count + 1,
                    error_code = NULL, error_message = NULL
                WHERE track_id = ? AND status = 'queued'
                """,
                (row["track_id"],),
            )
            self.connection.commit()
            if changed.rowcount != 1:
                return None
            return row["track_id"], Path(row["source_path"])

    def cached_track_features(
        self,
        track_id: str,
        *,
        fingerprint: str,
        provider: str,
        provider_version: str | None,
        pipeline_version: str,
    ) -> AnalysisFeatures | None:
        with self._lock:
            if provider_version is None:
                return None
            row = self.connection.execute(
                """
                SELECT feature_json, fingerprint AS feature_fingerprint,
                       provider AS feature_provider, provider_version AS feature_provider_version,
                       pipeline_version AS feature_pipeline_version
                FROM track_features
                WHERE track_id = ? AND fingerprint = ? AND provider = ?
                      AND provider_version = ? AND pipeline_version = ?
                """,
                (track_id, fingerprint, provider, provider_version, pipeline_version),
            ).fetchone()
            if row is None:
                return None
            features_value = _decode_analysis_features(row["feature_json"])
            if (
                features_value.fingerprint != row["feature_fingerprint"]
                or features_value.provider != row["feature_provider"]
                or features_value.provider_version != row["feature_provider_version"]
                or features_value.pipeline_version != row["feature_pipeline_version"]
            ):
                raise ValueError("stored analysis feature provenance is inconsistent")
            return features_value

    def record_analysis_fingerprint(self, track_id: str, fingerprint: str) -> None:
        with self._lock:
            self.connection.execute(
                "UPDATE analysis_jobs SET fingerprint = ? WHERE track_id = ? AND status = 'running'",
                (fingerprint, track_id),
            )
            self.connection.commit()

    def update_analysis_progress(self, track_id: str, progress_ppm: int) -> None:
        with self._lock:
            bounded = _clamp_progress(progress_ppm)
            self.connection.execute(
                """
                UPDATE analysis_jobs
                SET progress_ppm = MAX(progress_ppm, ?)
                WHERE track_id = ? AND status = 'running'
                """,
                (bounded, track_id),
            )
            self.connection.commit()

    def finish_analysis_success(self, track_id: str, features_value: AnalysisFeatures) -> None:
        with self._lock:
            feature_json = _encode_analysis_features(features_value)
            try:
                self.connection.execute("BEGIN IMMEDIATE")
                eligible = self.connection.execute(
                    """
                    SELECT 1
                    FROM tracks
                    JOIN analysis_jobs ON analysis_jobs.track_id = tracks.id
                    WHERE tracks.id = ? AND analysis_jobs.status = 'running'
                          AND analysis_jobs.fingerprint = ?
                    """,
                    (track_id, features_value.fingerprint),
                ).fetchone()
                if eligible is None:
                    self.connection.commit()
                    return
                self.connection.execute(
                    """
                    INSERT INTO track_features (
                        track_id, feature_json, fingerprint, provider, provider_version,
                        pipeline_version, generated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(track_id) DO UPDATE SET
                        feature_json = excluded.feature_json,
                        fingerprint = excluded.fingerprint,
                        provider = excluded.provider,
                        provider_version = excluded.provider_version,
                        pipeline_version = excluded.pipeline_version,
                        generated_at = excluded.generated_at
                    """,
                    (
                        track_id,
                        feature_json,
                        features_value.fingerprint,
                        features_value.provider,
                        features_value.provider_version,
                        features_value.pipeline_version,
                        self._timestamp(),
                    ),
                )
                self.connection.execute(
                    """
                    UPDATE analysis_jobs
                    SET status = 'succeeded', progress_ppm = 1000000,
                        error_code = NULL, error_message = NULL,
                        fingerprint = ?, provider = ?, provider_version = ?,
                        pipeline_version = ?, updated_at = ?
                    WHERE track_id = ? AND status = 'running'
                    """,
                    (
                        features_value.fingerprint,
                        features_value.provider,
                        features_value.provider_version,
                        features_value.pipeline_version,
                        self._timestamp(),
                        track_id,
                    ),
                )
                self.connection.commit()
            except Exception:
                self.connection.rollback()
                raise

    def finish_analysis_cached(self, track_id: str, features_value: AnalysisFeatures) -> None:
        with self._lock:
            self.connection.execute(
                """
                UPDATE analysis_jobs
                SET status = 'succeeded', progress_ppm = 1000000,
                    error_code = NULL, error_message = NULL,
                    fingerprint = ?, provider = ?, provider_version = ?,
                    pipeline_version = ?, updated_at = ?
                WHERE track_id = ? AND status = 'running'
                """,
                (
                    features_value.fingerprint,
                    features_value.provider,
                    features_value.provider_version,
                    features_value.pipeline_version,
                    self._timestamp(),
                    track_id,
                ),
            )
            self.connection.commit()

    def finish_analysis_failure(self, track_id: str, *, code: str, message: str) -> None:
        with self._lock:
            self.connection.execute(
                """
                UPDATE analysis_jobs
                SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?
                WHERE track_id = ? AND status = 'running'
                """,
                (code, message[:500], self._timestamp(), track_id),
            )
            self.connection.commit()

    def interrupt_analysis(self, track_id: str, *, paused: bool) -> None:
        with self._lock:
            self.connection.execute(
                """
                UPDATE analysis_jobs SET status = ?
                WHERE track_id = ? AND status = 'running'
                """,
                ("paused" if paused else "queued", track_id),
            )
            self.connection.commit()

    def requeue_running_analysis(self) -> None:
        with self._lock:
            self.connection.execute(
                "UPDATE analysis_jobs SET status = 'queued' WHERE status = 'running'"
            )
            self.connection.commit()

    def analysis_snapshot(
        self,
        track_ids: tuple[str, ...] | None,
    ) -> tuple[
        bool,
        tuple[int, int, int, int, int],
        int,
        tuple[tuple[str, AnalysisSummary], ...],
    ]:
        with self._lock:
            counts_by_status = {
                row["status"]: row["count"]
                for row in self.connection.execute(
                    "SELECT status, COUNT(*) AS count FROM analysis_jobs GROUP BY status"
                )
            }
            total = sum(counts_by_status.values())
            progress_total = self.connection.execute(
                "SELECT COALESCE(SUM(progress_ppm), 0) AS total FROM analysis_jobs"
            ).fetchone()["total"]
            progress_ppm = _clamp_progress(round(progress_total / total)) if total else 0
            paused = bool(
                self.connection.execute(
                    "SELECT paused FROM analysis_control WHERE singleton = 1"
                ).fetchone()["paused"]
            )
            items: list[tuple[str, AnalysisSummary]] = []
            if track_ids is not None:
                known = {
                    row["id"]
                    for row in self.connection.execute(
                        f"SELECT id FROM tracks WHERE id IN ({_placeholders(len(track_ids))})",
                        track_ids,
                    )
                }
                if len(known) != len(track_ids):
                    raise KeyError("unknown track ID")
                for track_id in track_ids:
                    summary = self.analysis_summary(track_id)
                    if summary is None:
                        summary = AnalysisSummary("not_queued", 0, 0, None, None, None)
                    items.append((track_id, summary))
            return (
                paused,
                tuple(counts_by_status.get(status, 0) for status in ("queued", "running", "paused", "succeeded", "failed")),
                progress_ppm,
                tuple(items),
            )

    def _collection_track_page(self, limit: int, cursor: str | None) -> TrackPage:
        last = _decode_cursor(cursor, (str, str, str)) if cursor else None
        sql = """
            SELECT id, external_id, title, artist, album, genre, bpm_milli, musical_key, duration_ms, availability,
                   COALESCE(title, '') AS title_sort, COALESCE(artist, '') AS artist_sort
            FROM tracks
        """
        parameters: list[object] = []
        if last:
            title, artist, last_id = last
            sql += """ WHERE COALESCE(title, '') > ?
                         OR (COALESCE(title, '') = ? AND (COALESCE(artist, '') > ?
                         OR (COALESCE(artist, '') = ? AND id > ?)))"""
            parameters.extend([title, title, artist, artist, last_id])
        sql += " ORDER BY COALESCE(title, ''), COALESCE(artist, ''), id LIMIT ?"
        parameters.append(limit + 1)
        rows = list(self.connection.execute(sql, parameters))
        return _page_from_rows(rows, limit, lambda row: (row["title_sort"], row["artist_sort"], row["id"]))

    def _playlist_track_page(self, playlist_id: str, limit: int, cursor: str | None) -> TrackPage:
        last = _decode_cursor(cursor, (int, str)) if cursor else None
        sql = """
            SELECT tracks.id, tracks.external_id, tracks.title, tracks.artist, tracks.album, tracks.genre,
                   tracks.bpm_milli, tracks.musical_key, tracks.duration_ms, tracks.availability,
                   playlist_tracks.position
            FROM playlist_tracks
            JOIN tracks ON tracks.id = playlist_tracks.track_id
            WHERE playlist_tracks.playlist_id = ?
        """
        parameters: list[object] = [playlist_id]
        if last:
            position, last_id = last
            sql += " AND (playlist_tracks.position > ? OR (playlist_tracks.position = ? AND tracks.id > ?))"
            parameters.extend([position, position, last_id])
        sql += " ORDER BY playlist_tracks.position, tracks.id LIMIT ?"
        parameters.append(limit + 1)
        rows = list(self.connection.execute(sql, parameters))
        return _page_from_rows(rows, limit, lambda row: (row["position"], row["id"]))

    def _track_evidence_catalog(
        self,
        *,
        playlist_id: str | None = None,
        track_id: str | None = None,
    ) -> tuple[tuple[TrackEvidence, ...], bool]:
        if playlist_id is not None:
            if not isinstance(playlist_id, str) or not 1 <= len(playlist_id) <= 128:
                raise RekordboxImportError("not_found", "The requested playlist was not found.")
            if not self.connection.execute(
                "SELECT 1 FROM playlists WHERE id = ?", (playlist_id,)
            ).fetchone():
                raise RekordboxImportError("not_found", "The requested playlist was not found.")

        sql = """
            SELECT tracks.id, tracks.external_id, tracks.title, tracks.artist,
                   tracks.album, tracks.genre, tracks.bpm_milli,
                   tracks.musical_key, tracks.duration_ms, tracks.availability,
                   analysis_jobs.status, analysis_jobs.progress_ppm,
                   analysis_jobs.attempt_count, analysis_jobs.error_code,
                   analysis_jobs.error_message,
                   track_features.feature_json,
                   track_features.fingerprint AS feature_fingerprint,
                   track_features.provider AS feature_provider,
                   track_features.provider_version AS feature_provider_version,
                   track_features.pipeline_version AS feature_pipeline_version,
                   GROUP_CONCAT(DISTINCT memberships.playlist_id) AS playlist_ids
            FROM tracks
            LEFT JOIN analysis_jobs ON analysis_jobs.track_id = tracks.id
            LEFT JOIN track_features ON track_features.track_id = tracks.id
            LEFT JOIN playlist_tracks AS memberships ON memberships.track_id = tracks.id
        """
        parameters: list[object] = []
        predicates: list[str] = []
        if playlist_id is not None:
            sql += " JOIN playlist_tracks AS selected ON selected.track_id = tracks.id"
            predicates.append("selected.playlist_id = ?")
            parameters.append(playlist_id)
        if track_id is not None:
            predicates.append("tracks.id = ?")
            parameters.append(track_id)
        if predicates:
            sql += " WHERE " + " AND ".join(predicates)
        sql += " GROUP BY tracks.id"
        if playlist_id is not None:
            sql += " ORDER BY selected.position, tracks.id"
        else:
            sql += " ORDER BY COALESCE(tracks.title, ''), COALESCE(tracks.artist, ''), tracks.id"
        row_limit = 2 if track_id is not None else DISCOVERY_SCAN_LIMIT + 1
        sql += " LIMIT ?"
        parameters.append(row_limit)
        rows = list(self.connection.execute(sql, parameters))
        truncated = track_id is None and len(rows) > DISCOVERY_SCAN_LIMIT
        visible_rows = rows[:DISCOVERY_SCAN_LIMIT]
        evidence: list[TrackEvidence] = []
        for row in visible_rows:
            track = StoredTrack(
                id=row["id"],
                external_id=row["external_id"],
                title=row["title"],
                artist=row["artist"],
                album=row["album"],
                genre=row["genre"],
                bpm_milli=row["bpm_milli"],
                musical_key=row["musical_key"],
                duration_ms=row["duration_ms"],
                availability=row["availability"],
            )
            analysis = _summary_from_row(row) if row["status"] is not None else None
            playlist_ids = tuple(
                sorted(value for value in (row["playlist_ids"] or "").split(",") if value)
            )
            evidence.append(TrackEvidence(track, analysis, playlist_ids))
        return tuple(evidence), truncated

    def _track_filter_signature(self, filters: TrackFilters) -> str:
        revision_row = self.connection.execute(
            "SELECT revision FROM library_state WHERE singleton = 1"
        ).fetchone()
        revision = revision_row["revision"] if revision_row is not None else 0
        encoded = json.dumps(
            {"revision": revision, "filters": asdict(filters)},
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("ascii")
        return hashlib.sha256(encoded).hexdigest()[:24]

    def _track_id_for_external_id(self, external_id: str) -> str:
        row = self.connection.execute("SELECT id FROM tracks WHERE external_id = ?", (external_id,)).fetchone()
        if row is None:
            raise RekordboxImportError("unresolved_playlist_reference", "A playlist reference does not resolve to a collection track.")
        return row["id"]

    def _track_exists(self, track_id: str) -> bool:
        return self.connection.execute("SELECT 1 FROM tracks WHERE id = ?", (track_id,)).fetchone() is not None

    def _timestamp(self) -> str:
        self._last_timestamp = max(self._last_timestamp + 1, time.time_ns())
        return f"{self._last_timestamp:020d}"

    def _create_schema(self) -> None:
        with self._lock:
            version = self.connection.execute("PRAGMA user_version").fetchone()[0]
            if version > 2:
                raise RuntimeError(f"database schema version {version} is newer than supported version 2")
            track_columns = {
                row["name"] for row in self.connection.execute("PRAGMA table_info(tracks)")
            }
            if version == 0 and track_columns and "source_path" not in track_columns:
                self.migration_backup_path = self._backup_before_m2()
            try:
                self.connection.execute("BEGIN IMMEDIATE")
                self.connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS library_state (
                        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                        revision INTEGER NOT NULL,
                        source_sha256 TEXT NOT NULL
                    )
                    """
                )
                self.connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS tracks (
                        id TEXT PRIMARY KEY,
                        external_id TEXT NOT NULL UNIQUE,
                        title TEXT,
                        artist TEXT,
                        album TEXT,
                        genre TEXT,
                        bpm_milli INTEGER,
                        musical_key TEXT,
                        duration_ms INTEGER,
                        availability TEXT NOT NULL,
                        source_path TEXT NOT NULL DEFAULT ''
                    )
                    """
                )
                current_track_columns = {
                    row["name"] for row in self.connection.execute("PRAGMA table_info(tracks)")
                }
                if "source_path" not in current_track_columns:
                    self.connection.execute(
                        "ALTER TABLE tracks ADD COLUMN source_path TEXT NOT NULL DEFAULT ''"
                    )
                self.connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS playlists (
                        id TEXT PRIMARY KEY,
                        import_key TEXT NOT NULL UNIQUE,
                        parent_id TEXT REFERENCES playlists(id),
                        name TEXT NOT NULL,
                        kind TEXT NOT NULL,
                        sort_order INTEGER NOT NULL,
                        sequence INTEGER NOT NULL
                    )
                    """
                )
                self.connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS playlist_tracks (
                        playlist_id TEXT NOT NULL REFERENCES playlists(id),
                        track_id TEXT NOT NULL REFERENCES tracks(id),
                        position INTEGER NOT NULL,
                        PRIMARY KEY (playlist_id, position)
                    )
                    """
                )
                self.connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS analysis_control (
                        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                        paused INTEGER NOT NULL CHECK (paused IN (0, 1))
                    )
                    """
                )
                self.connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS analysis_jobs (
                        track_id TEXT PRIMARY KEY,
                        status TEXT NOT NULL CHECK (status IN ('queued','running','paused','succeeded','failed')),
                        progress_ppm INTEGER NOT NULL CHECK (progress_ppm BETWEEN 0 AND 1000000),
                        attempt_count INTEGER NOT NULL,
                        error_code TEXT,
                        error_message TEXT,
                        fingerprint TEXT,
                        provider TEXT NOT NULL,
                        provider_version TEXT,
                        pipeline_version TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                self.connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS track_features (
                        track_id TEXT PRIMARY KEY,
                        feature_json TEXT NOT NULL,
                        fingerprint TEXT NOT NULL,
                        provider TEXT NOT NULL,
                        provider_version TEXT NOT NULL,
                        pipeline_version TEXT NOT NULL,
                        generated_at TEXT NOT NULL
                    )
                    """
                )
                self.connection.execute(
                    "INSERT OR IGNORE INTO analysis_control (singleton, paused) VALUES (1, 0)"
                )
                self.connection.execute(
                    "UPDATE analysis_jobs SET status = 'queued' WHERE status = 'running'"
                )
                self.connection.execute("PRAGMA user_version = 2")
                self.connection.commit()
            except Exception:
                self.connection.rollback()
                raise

    def _backup_before_m2(self) -> Path:
        suffix = 1
        while True:
            numbered = "" if suffix == 1 else f"-{suffix}"
            candidate = self.path.with_name(f"{self.path.stem}.pre-m2{numbered}.sqlite3")
            if not candidate.exists():
                break
            suffix += 1
        destination = sqlite3.connect(candidate)
        try:
            self.connection.backup(destination)
        finally:
            destination.close()
        return candidate


def _page_from_rows(rows: list[sqlite3.Row], limit: int, cursor_tuple) -> TrackPage:
    visible_rows = rows[:limit]
    items = tuple(
        StoredTrack(
            id=row["id"], external_id=row["external_id"], title=row["title"], artist=row["artist"],
            album=row["album"], genre=row["genre"], bpm_milli=row["bpm_milli"],
            musical_key=row["musical_key"], duration_ms=row["duration_ms"], availability=row["availability"],
        )
        for row in visible_rows
    )
    next_cursor = _encode_cursor(cursor_tuple(visible_rows[-1])) if len(rows) > limit else None
    return TrackPage(items=items, next_cursor=next_cursor)


def _clamp_progress(value: int) -> int:
    return max(0, min(1_000_000, int(value)))


def _placeholders(count: int) -> str:
    return ",".join("?" for _ in range(count))


def _encode_analysis_features(features_value: AnalysisFeatures) -> str:
    if not isinstance(features_value, AnalysisFeatures):
        raise TypeError("features must be AnalysisFeatures")
    return json.dumps(asdict(features_value), ensure_ascii=True, separators=(",", ":"), sort_keys=True)


def _decode_analysis_features(raw: str) -> AnalysisFeatures:
    try:
        payload = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as error:
        raise ValueError("stored analysis features are invalid") from error
    expected_names = {field.name for field in fields(AnalysisFeatures)}
    if not isinstance(payload, dict) or set(payload) != expected_names:
        raise ValueError("stored analysis features have an invalid field set")

    required_strings = (
        "fingerprint",
        "codec",
        "container",
        "provider",
        "provider_version",
        "pipeline_version",
    )
    optional_strings = ("musical_key", "mode")
    required_integers = (
        "file_size",
        "mtime_ns",
        "duration_ms",
        "sample_rate_hz",
        "channels",
        "tempo_confidence_ppm",
        "onset_count",
        "beat_strength_ppm",
        "key_confidence_ppm",
        "energy_ppm",
        "onset_rate_milli_hz",
        "brightness_ppm",
    )
    optional_integers = (
        "bpm_milli",
        "rms_milli_dbfs",
        "peak_milli_dbfs",
        "crest_factor_milli_db",
        "dynamic_range_milli_db",
        "spectral_centroid_hz",
    )
    if any(type(payload[name]) is not str for name in required_strings):
        raise ValueError("stored analysis features contain an invalid string")
    if any(payload[name] is not None and type(payload[name]) is not str for name in optional_strings):
        raise ValueError("stored analysis features contain an invalid optional string")
    if any(type(payload[name]) is not int for name in required_integers):
        raise ValueError("stored analysis features contain an invalid integer")
    if any(payload[name] is not None and type(payload[name]) is not int for name in optional_integers):
        raise ValueError("stored analysis features contain an invalid optional integer")
    if not _integer_list(payload["tempo_candidates_milli"]):
        raise ValueError("stored analysis tempo candidates are invalid")
    if not _integer_list(payload["energy_curve_ppm"]):
        raise ValueError("stored analysis energy curve is invalid")
    if not isinstance(payload["limitations"], list) or any(
        type(value) is not str for value in payload["limitations"]
    ):
        raise ValueError("stored analysis limitations are invalid")
    for name in (
        "tempo_confidence_ppm",
        "beat_strength_ppm",
        "key_confidence_ppm",
        "energy_ppm",
        "brightness_ppm",
    ):
        if not 0 <= payload[name] <= 1_000_000:
            raise ValueError("stored analysis confidence is outside its bounded range")
    if any(not 0 <= value <= 1_000_000 for value in payload["energy_curve_ppm"]):
        raise ValueError("stored analysis energy curve is outside its bounded range")
    payload["tempo_candidates_milli"] = tuple(payload["tempo_candidates_milli"])
    payload["energy_curve_ppm"] = tuple(payload["energy_curve_ppm"])
    payload["limitations"] = tuple(payload["limitations"])
    return AnalysisFeatures(**payload)


def _integer_list(value: object) -> bool:
    return isinstance(value, list) and all(type(item) is int for item in value)


def _summary_from_row(row: sqlite3.Row) -> AnalysisSummary:
    features_value = None
    if row["feature_json"] is not None:
        features_value = _decode_analysis_features(row["feature_json"])
        if (
            features_value.fingerprint != row["feature_fingerprint"]
            or features_value.provider != row["feature_provider"]
            or features_value.provider_version != row["feature_provider_version"]
            or features_value.pipeline_version != row["feature_pipeline_version"]
        ):
            raise ValueError("stored analysis feature provenance is inconsistent")
    return AnalysisSummary(
        status=row["status"],
        progress_ppm=_clamp_progress(row["progress_ppm"]),
        attempt_count=max(0, int(row["attempt_count"])),
        error_code=row["error_code"],
        error_message=row["error_message"],
        features=features_value,
    )


def _encode_cursor(values: tuple[object, ...]) -> str:
    raw = json.dumps(values, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_cursor(cursor: str, expected_types: tuple[type, ...]) -> tuple[object, ...]:
    if not isinstance(cursor, str) or not cursor or len(cursor) > 2_048:
        raise RekordboxImportError("invalid_cursor", "The track list cursor is invalid.")
    try:
        padding = "=" * (-len(cursor) % 4)
        parsed = json.loads(base64.b64decode(cursor + padding, altchars=b"-_", validate=True).decode("ascii"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RekordboxImportError("invalid_cursor", "The track list cursor is invalid.") from exc
    if (
        not isinstance(parsed, list)
        or len(parsed) != len(expected_types)
        or any(type(value) is not expected_type for value, expected_type in zip(parsed, expected_types))
    ):
        raise RekordboxImportError("invalid_cursor", "The track list cursor is invalid.")
    return tuple(parsed)
