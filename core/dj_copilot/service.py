"""A local Unix-socket service exposing the bounded M1 library protocol."""

import argparse
import json
import os
from pathlib import Path
import signal
import socket
import stat
from typing import Any

from .database import LibraryDatabase
from .models import ImportSummary, PlaylistTreeNode, StoredTrack, TrackPage
from .rekordbox_xml import RekordboxImportError


MAX_LINE_BYTES = 1_048_576
PROTOCOL_VERSION = 1
FALLBACK_REQUEST_ID = "invalid-request"


class RequestError(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code[:64]
        self.message = message[:500]
        super().__init__(self.message)


def serve(socket_path: Path, database_path: Path) -> None:
    """Serve one line-delimited JSON request per Unix socket connection."""
    endpoint = Path(socket_path)
    _prepare_socket_directory(endpoint.parent)
    if os.path.lexists(endpoint):
        raise RuntimeError("Refusing to replace an existing socket path.")
    database = LibraryDatabase(database_path)
    running = True

    def stop(_signal_number: int, _frame: Any) -> None:
        nonlocal running
        running = False

    previous_term = signal.signal(signal.SIGTERM, stop)
    previous_int = signal.signal(signal.SIGINT, stop)
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        server.bind(str(endpoint))
        os.chmod(endpoint, 0o600)
        server.listen()
        server.settimeout(0.1)
        while running:
            try:
                connection, _ = server.accept()
            except TimeoutError:
                continue
            with connection:
                connection.settimeout(5)
                response = _handle_connection(connection, database)
                _send_response(connection, response)
    finally:
        signal.signal(signal.SIGTERM, previous_term)
        signal.signal(signal.SIGINT, previous_int)
        server.close()
        database.close()
        try:
            endpoint.unlink()
        except FileNotFoundError:
            pass


def _prepare_socket_directory(directory: Path) -> None:
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory_stat = directory.stat()
    if not stat.S_ISDIR(directory_stat.st_mode):
        raise RuntimeError("The socket parent is not a directory.")
    os.chmod(directory, 0o700)


def _handle_connection(connection: socket.socket, database: LibraryDatabase) -> dict[str, Any]:
    try:
        line = _read_line(connection)
    except RequestError as error:
        return _error_response(FALLBACK_REQUEST_ID, error.code, error.message)
    request_id = FALLBACK_REQUEST_ID
    try:
        raw_request = json.loads(line.decode("utf-8"))
        request_id, command, payload = _validate_request(raw_request)
        result = _dispatch(command, payload, database)
        return {"version": PROTOCOL_VERSION, "id": request_id, "ok": True, "result": result}
    except UnicodeDecodeError:
        return _error_response(request_id, "invalid_request", "The request must be UTF-8 JSON.")
    except json.JSONDecodeError:
        return _error_response(request_id, "invalid_request", "The request is not valid JSON.")
    except RequestError as error:
        request_id = _safe_request_id(raw_request if "raw_request" in locals() else None)
        return _error_response(request_id, error.code, error.message)
    except RekordboxImportError as error:
        return _error_response(request_id, error.code, error.message)
    except Exception:
        return _error_response(request_id, "internal_error", "The core service could not process the request.")


def _read_line(connection: socket.socket) -> bytes:
    data = bytearray()
    while True:
        chunk = connection.recv(min(65_536, MAX_LINE_BYTES + 1 - len(data)))
        if not chunk:
            raise RequestError("invalid_request", "The request must contain one JSON line.")
        data.extend(chunk)
        newline = data.find(b"\n")
        if newline >= 0:
            if newline > MAX_LINE_BYTES:
                raise RequestError("line_too_large", "The request line exceeds 1 MiB.")
            if data[newline + 1:].strip():
                raise RequestError("invalid_request", "The connection may contain only one JSON line.")
            return bytes(data[:newline])
        if len(data) > MAX_LINE_BYTES:
            raise RequestError("line_too_large", "The request line exceeds 1 MiB.")


def _validate_request(raw_request: Any) -> tuple[str, str, dict[str, Any]]:
    if not isinstance(raw_request, dict):
        raise RequestError("invalid_request", "The request must be a JSON object.")
    if raw_request.get("version") != PROTOCOL_VERSION:
        raise RequestError("invalid_request", "The request version must be 1.")
    request_id = raw_request.get("id")
    if not isinstance(request_id, str) or not 1 <= len(request_id) <= 128:
        raise RequestError("invalid_request", "The request ID must contain 1 to 128 characters.")
    command = raw_request.get("command")
    if not isinstance(command, str):
        raise RequestError("invalid_request", "The request command must be a string.")
    payload = raw_request.get("payload")
    if not isinstance(payload, dict):
        raise RequestError("invalid_request", "The request payload must be an object.")
    allowed_commands = {"health", "import_library", "get_playlist_tree", "list_tracks"}
    if command not in allowed_commands:
        raise RequestError("unknown_command", "The requested core command is not supported.")
    expected_top_level = {"version", "id", "command", "payload"}
    if set(raw_request) != expected_top_level:
        raise RequestError("invalid_request", "The request contains unsupported fields.")
    if command in {"health", "get_playlist_tree"}:
        if payload:
            raise RequestError("invalid_request", "This command does not accept a payload.")
    elif command == "import_library":
        source_path = payload.get("sourcePath")
        if set(payload) != {"sourcePath"} or not isinstance(source_path, str) or not 1 <= len(source_path) <= 4_096:
            raise RequestError("invalid_request", "The import sourcePath must contain 1 to 4096 characters.")
    else:
        _validate_list_tracks_payload(payload)
    return request_id, command, payload


def _validate_list_tracks_payload(payload: dict[str, Any]) -> None:
    if set(payload) - {"playlistId", "cursor", "limit"}:
        raise RequestError("invalid_request", "The list_tracks payload contains unsupported fields.")
    for key, maximum in (("playlistId", 128), ("cursor", 2_048)):
        value = payload.get(key)
        if value is not None and (not isinstance(value, str) or not 1 <= len(value) <= maximum):
            raise RequestError("invalid_request", f"The list_tracks {key} is invalid.")
    limit = payload.get("limit", 100)
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 200:
        raise RequestError("invalid_request", "The list_tracks limit must be an integer from 1 to 200.")


def _dispatch(command: str, payload: dict[str, Any], database: LibraryDatabase) -> Any:
    if command == "health":
        return {"state": "ready"}
    if command == "import_library":
        try:
            summary = database.import_path(Path(payload["sourcePath"]))
        except RekordboxImportError as error:
            return {
                "success": False,
                "error": {"code": error.code, "message": error.message},
                "preservedPreviousLibrary": True,
            }
        return {"success": True, "summary": _summary_wire(summary)}
    if command == "get_playlist_tree":
        return [_playlist_wire(node) for node in database.get_playlist_tree()]
    if command == "list_tracks":
        page = database.list_tracks(
            playlist_id=payload.get("playlistId"), cursor=payload.get("cursor"), limit=payload.get("limit", 100)
        )
        return _track_page_wire(page)
    raise AssertionError("validated command was not dispatched")


def _summary_wire(summary: ImportSummary) -> dict[str, Any]:
    return {
        "revision": summary.revision,
        "sourceSha256": summary.source_sha256,
        "importedTracks": summary.imported_tracks,
        "importedPlaylists": summary.imported_playlists,
        "unavailableTracks": summary.unavailable_tracks,
    }


def _playlist_wire(node: PlaylistTreeNode) -> dict[str, Any]:
    return {
        "id": node.id,
        "parentId": node.parent_id,
        "name": node.name,
        "kind": node.kind,
        "order": node.order,
        "trackCount": node.track_count,
    }


def _track_page_wire(page: TrackPage) -> dict[str, Any]:
    return {"items": [_track_wire(track) for track in page.items], "nextCursor": page.next_cursor}


def _track_wire(track: StoredTrack) -> dict[str, Any]:
    return {
        "id": track.id,
        "title": track.title,
        "artist": track.artist,
        "album": track.album,
        "genre": track.genre,
        "bpmMilli": track.bpm_milli,
        "musicalKey": track.musical_key,
        "durationMs": track.duration_ms,
        "availability": track.availability,
    }


def _safe_request_id(raw_request: Any) -> str:
    if isinstance(raw_request, dict):
        request_id = raw_request.get("id")
        if isinstance(request_id, str) and 1 <= len(request_id) <= 128:
            return request_id
    return FALLBACK_REQUEST_ID


def _error_response(request_id: str, code: str, message: str) -> dict[str, Any]:
    return {
        "version": PROTOCOL_VERSION,
        "id": request_id,
        "ok": False,
        "error": {"code": code[:64], "message": message[:500]},
    }


def _send_response(connection: socket.socket, response: dict[str, Any]) -> None:
    encoded = json.dumps(response, ensure_ascii=True, separators=(",", ":")).encode("utf-8") + b"\n"
    if len(encoded) - 1 > MAX_LINE_BYTES:
        response_id = response.get("id")
        request_id = response_id if isinstance(response_id, str) and 1 <= len(response_id) <= 128 else FALLBACK_REQUEST_ID
        encoded = json.dumps(
            _error_response(request_id, "response_too_large", "The core response exceeds 1 MiB."),
            ensure_ascii=True,
            separators=(",", ":"),
        ).encode("utf-8") + b"\n"
    connection.sendall(encoded)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", required=True, type=Path)
    parser.add_argument("--database", required=True, type=Path)
    arguments = parser.parse_args()
    serve(arguments.socket, arguments.database)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
