"""The service-owned SQLite projection of one imported Rekordbox library."""

import base64
import json
from pathlib import Path
import sqlite3
import uuid

from .models import ImportSummary, PlaylistTreeNode, RekordboxImport, StoredTrack, TrackPage
from .rekordbox_xml import RekordboxImportError, parse_rekordbox_xml


class LibraryDatabase:
    """Single-process SQLite repository. Rekordbox XML is parsed before writing."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.connection = sqlite3.connect(self.path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self._create_schema()

    def close(self) -> None:
        self.connection.close()

    def import_path(self, source_path: Path) -> ImportSummary:
        return self.import_library(parse_rekordbox_xml(source_path))

    def import_library(self, imported: RekordboxImport) -> ImportSummary:
        """Atomically replace the projection while retaining known application IDs."""
        try:
            self.connection.execute("BEGIN IMMEDIATE")
            track_ids = {
                row["external_id"]: row["id"]
                for row in self.connection.execute("SELECT id, external_id FROM tracks")
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

            for track in imported.tracks:
                track_id = track_ids.get(track.external_id, str(uuid.uuid4()))
                self.connection.execute(
                    """
                    INSERT INTO tracks (
                        id, external_id, title, artist, album, genre, bpm_milli,
                        musical_key, duration_ms, availability
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 200:
            raise RekordboxImportError("invalid_limit", "Track list limit must be an integer from 1 to 200.")
        if playlist_id is not None:
            if not isinstance(playlist_id, str) or not 1 <= len(playlist_id) <= 128:
                raise RekordboxImportError("not_found", "The requested playlist was not found.")
            if not self.connection.execute("SELECT 1 FROM playlists WHERE id = ?", (playlist_id,)).fetchone():
                raise RekordboxImportError("not_found", "The requested playlist was not found.")
            return self._playlist_track_page(playlist_id, limit, cursor)
        return self._collection_track_page(limit, cursor)

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

    def _track_id_for_external_id(self, external_id: str) -> str:
        row = self.connection.execute("SELECT id FROM tracks WHERE external_id = ?", (external_id,)).fetchone()
        if row is None:
            raise RekordboxImportError("unresolved_playlist_reference", "A playlist reference does not resolve to a collection track.")
        return row["id"]

    def _create_schema(self) -> None:
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS library_state (
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                revision INTEGER NOT NULL,
                source_sha256 TEXT NOT NULL
            );
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
                availability TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS playlists (
                id TEXT PRIMARY KEY,
                import_key TEXT NOT NULL UNIQUE,
                parent_id TEXT REFERENCES playlists(id),
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                sequence INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS playlist_tracks (
                playlist_id TEXT NOT NULL REFERENCES playlists(id),
                track_id TEXT NOT NULL REFERENCES tracks(id),
                position INTEGER NOT NULL,
                PRIMARY KEY (playlist_id, position)
            );
            """
        )


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
