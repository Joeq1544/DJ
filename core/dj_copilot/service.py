"""A local Unix-socket service exposing the bounded M1 library protocol."""

import argparse
import json
import os
from pathlib import Path
import signal
import socket
import stat
from typing import Any

from .analysis.jobs import AnalysisManager
from .analysis.provider import AnalysisFeatures, FfmpegNumpyProvider, ProviderCapabilities
from .database import DISCOVERY_SCAN_LIMIT, LibraryDatabase, TrackEvidencePage
from .discovery import (
    DiscoveryCandidate,
    DiscoveryError,
    DiscoveryTrack,
    RecommendationResult,
    ScoreComponent,
    SimilarityResult,
    TrackEvidence,
    TrackFilters,
    find_similar_tracks,
    recommend_next_tracks,
)
from .models import (
    AnalysisQueueStatus,
    AnalysisSummary,
    ImportSummary,
    PlaylistTreeNode,
    StoredTrack,
    TrackPage,
)
from .rekordbox_xml import RekordboxImportError
from .rekordbox_export import RekordboxExportError, RekordboxExportSnapshot, RekordboxExportTrack, preview_rekordbox_export, write_rekordbox_export
from .set_workflow import (
    DraftError, DraftPlan, DraftState, apply_draft_mutation, create_draft,
    find_replacements, generate_draft, inspect_set,
)


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
    provider = FfmpegNumpyProvider()
    manager = AnalysisManager(database, provider)
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
        manager.start()
        while running:
            try:
                connection, _ = server.accept()
            except TimeoutError:
                continue
            with connection:
                connection.settimeout(5)
                response = _handle_connection(connection, database, manager)
                try:
                    _send_response(connection, response)
                except (BrokenPipeError, ConnectionResetError):
                    pass
    finally:
        signal.signal(signal.SIGTERM, previous_term)
        signal.signal(signal.SIGINT, previous_int)
        manager.stop()
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


def _handle_connection(
    connection: socket.socket,
    database: LibraryDatabase,
    manager: AnalysisManager,
) -> dict[str, Any]:
    try:
        line = _read_line(connection)
    except RequestError as error:
        return _error_response(FALLBACK_REQUEST_ID, error.code, error.message)
    request_id = FALLBACK_REQUEST_ID
    try:
        raw_request = json.loads(line.decode("utf-8"))
        request_id, command, payload = _validate_request(raw_request)
        result = _dispatch(command, payload, database, manager)
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
    except DraftError as error:
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
    allowed_commands = {
        "health",
        "import_library",
        "get_playlist_tree",
        "list_tracks",
        "queue_analysis",
        "get_analysis_status",
        "pause_analysis",
        "resume_analysis",
        "find_similar_tracks",
        "recommend_next_tracks",
        "list_set_drafts",
        "create_set_draft",
        "get_set_draft",
        "mutate_set_draft",
        "find_set_replacements",
        "analyze_set",
        "preview_set_export",
        "export_set_draft",
    }
    if command not in allowed_commands:
        raise RequestError("unknown_command", "The requested core command is not supported.")
    expected_top_level = {"version", "id", "command", "payload"}
    if set(raw_request) != expected_top_level:
        raise RequestError("invalid_request", "The request contains unsupported fields.")
    if command in {"health", "get_playlist_tree", "pause_analysis", "resume_analysis", "list_set_drafts"}:
        if payload:
            raise RequestError("invalid_request", "This command does not accept a payload.")
    elif command == "import_library":
        source_path = payload.get("sourcePath")
        if set(payload) != {"sourcePath"} or not isinstance(source_path, str) or not 1 <= len(source_path) <= 4_096:
            raise RequestError("invalid_request", "The import sourcePath must contain 1 to 4096 characters.")
    elif command == "list_tracks":
        _validate_list_tracks_payload(payload)
    elif command == "find_similar_tracks":
        _validate_discovery_payload(payload, recommendation=False)
    elif command == "recommend_next_tracks":
        _validate_discovery_payload(payload, recommendation=True)
    elif command == "queue_analysis":
        _validate_analysis_track_ids_payload(payload, optional=False)
    elif command == "get_analysis_status":
        _validate_analysis_track_ids_payload(payload, optional=True)
    elif command == "create_set_draft":
        _validate_set_create_payload(payload)
    elif command == "get_set_draft":
        _validate_set_get_payload(payload)
    elif command == "mutate_set_draft":
        _validate_set_mutation_payload(payload)
    elif command == "find_set_replacements":
        _validate_set_replacements_payload(payload)
    elif command == "analyze_set":
        _validate_set_inspect_payload(payload)
    elif command in {"preview_set_export", "export_set_draft"}:
        _validate_set_export_payload(payload)
    return request_id, command, payload


def _validate_list_tracks_payload(payload: dict[str, Any]) -> None:
    if set(payload) - (_FILTER_FIELDS | {"cursor", "limit"}):
        raise RequestError("invalid_request", "The list_tracks payload contains unsupported fields.")
    _validate_filters_payload(payload)
    cursor = payload.get("cursor")
    if cursor is not None and (not isinstance(cursor, str) or not 1 <= len(cursor) <= 2_048):
        raise RequestError("invalid_request", "The list_tracks cursor is invalid.")
    limit = payload.get("limit", 100)
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 200:
        raise RequestError("invalid_request", "The list_tracks limit must be an integer from 1 to 200.")


_FILTER_FIELDS = {
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
}
_DISCOVERY_INTENTS = {
    "smooth",
    "build",
    "peak",
    "reset",
    "genre_shift",
    "adventurous",
    "singalong_continuation",
    "closer",
}


def _validate_filters_payload(payload: dict[str, Any]) -> None:
    for key, maximum in (
        ("text", 200),
        ("playlistId", 128),
        ("musicalKey", 64),
        ("genre", 200),
    ):
        value = payload.get(key)
        if value is not None and (not isinstance(value, str) or not 1 <= len(value) <= maximum):
            raise RequestError("invalid_request", f"The discovery filter {key} is invalid.")
    for key, minimum, maximum in (
        ("bpmMinMilli", 30_000, 400_000),
        ("bpmMaxMilli", 30_000, 400_000),
        ("energyMinPpm", 0, 1_000_000),
        ("energyMaxPpm", 0, 1_000_000),
    ):
        value = payload.get(key)
        if value is not None and (
            not isinstance(value, int)
            or isinstance(value, bool)
            or not minimum <= value <= maximum
        ):
            raise RequestError("invalid_request", f"The discovery filter {key} is invalid.")
    for lower, upper in (("bpmMinMilli", "bpmMaxMilli"), ("energyMinPpm", "energyMaxPpm")):
        if payload.get(lower) is not None and payload.get(upper) is not None and payload[lower] > payload[upper]:
            raise RequestError("invalid_request", f"The discovery filter {lower} exceeds {upper}.")
    key_relation = payload.get("keyRelation")
    if key_relation is not None and key_relation not in {"exact", "compatible"}:
        raise RequestError("invalid_request", "The discovery keyRelation is invalid.")
    if key_relation is not None and "musicalKey" not in payload:
        raise RequestError("invalid_request", "The discovery keyRelation requires musicalKey.")
    if payload.get("analysisState", "any") not in {"any", "analyzed", "not_analyzed", "failed"}:
        raise RequestError("invalid_request", "The discovery analysisState is invalid.")
    if payload.get("availability", "any") not in {"any", "available", "missing", "unreadable"}:
        raise RequestError("invalid_request", "The discovery availability is invalid.")


def _validate_discovery_payload(payload: dict[str, Any], *, recommendation: bool) -> None:
    required = {"seedTrackId", "intent"} if recommendation else {"seedTrackId"}
    allowed = required | {"filters", "limit"}
    if not required.issubset(payload) or set(payload) - allowed:
        raise RequestError("invalid_request", "The discovery payload has unsupported or missing fields.")
    seed_track_id = payload.get("seedTrackId")
    if not isinstance(seed_track_id, str) or not 1 <= len(seed_track_id) <= 128:
        raise RequestError("invalid_request", "The discovery seedTrackId is invalid.")
    filters = payload.get("filters", {})
    if not isinstance(filters, dict) or set(filters) - _FILTER_FIELDS:
        raise RequestError("invalid_request", "The discovery filters are invalid.")
    _validate_filters_payload(filters)
    limit = payload.get("limit", 10)
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 20:
        raise RequestError("invalid_request", "The discovery limit must be an integer from 1 to 20.")
    if recommendation and payload.get("intent") not in _DISCOVERY_INTENTS:
        raise RequestError("invalid_request", "The discovery intent is invalid.")


def _filters_from_wire(payload: dict[str, Any]) -> TrackFilters:
    return TrackFilters(
        text=payload.get("text"),
        playlist_id=payload.get("playlistId"),
        bpm_min_milli=payload.get("bpmMinMilli"),
        bpm_max_milli=payload.get("bpmMaxMilli"),
        musical_key=payload.get("musicalKey"),
        key_relation=payload.get("keyRelation"),
        genre=payload.get("genre"),
        energy_min_ppm=payload.get("energyMinPpm"),
        energy_max_ppm=payload.get("energyMaxPpm"),
        analysis_state=payload.get("analysisState", "any"),
        availability=payload.get("availability", "any"),
    )


def _draft_plan_from_wire(payload: dict[str, Any]) -> DraftPlan:
    return DraftPlan(
        intent=payload["intent"],
        target_duration_ms=payload["targetDurationMs"],
        max_artist_repeats=payload["maxArtistRepeats"],
        candidate_filters=_filters_from_wire(payload["candidateFilters"]),
    )


def _mutation_from_wire(mutation: dict[str, Any]) -> dict[str, Any]:
    key_map = {
        "trackId": "track_id", "toIndex": "to_index", "entryId": "entry_id",
        "replacementTrackId": "replacement_track_id", "targetEnergyPpm": "target_energy_ppm",
    }
    result = {key_map.get(key, key): value for key, value in mutation.items()}
    if result["type"] == "set_plan":
        plan = result["plan"]
        result["plan"] = {
            "intent": plan["intent"], "target_duration_ms": plan["targetDurationMs"],
            "max_artist_repeats": plan["maxArtistRepeats"],
            "candidate_filters": _filters_from_wire(plan["candidateFilters"]),
        }
    return result


def _validate_analysis_track_ids_payload(payload: dict[str, Any], *, optional: bool) -> None:
    if optional and not payload:
        return
    if set(payload) != {"trackIds"}:
        raise RequestError("invalid_request", "The analysis payload must contain only trackIds.")
    track_ids = payload["trackIds"]
    if not isinstance(track_ids, list) or not 1 <= len(track_ids) <= 200:
        raise RequestError("invalid_request", "Analysis trackIds must contain 1 to 200 IDs.")
    if any(type(track_id) is not str or not 1 <= len(track_id) <= 128 for track_id in track_ids):
        raise RequestError("invalid_request", "Analysis trackIds must be non-empty strings.")
    if len(set(track_ids)) != len(track_ids):
        raise RequestError("invalid_request", "Analysis trackIds must be unique.")


def _valid_id(value: object) -> bool:
    return isinstance(value, str) and 1 <= len(value) <= 128


def _valid_revision(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 2_147_483_647


def _validate_set_plan(payload: object) -> None:
    if not isinstance(payload, dict) or set(payload) != {"intent", "targetDurationMs", "maxArtistRepeats", "candidateFilters"}:
        raise RequestError("invalid_request", "The set draft plan is invalid.")
    if payload["intent"] not in _DISCOVERY_INTENTS:
        raise RequestError("invalid_request", "The set draft plan intent is invalid.")
    target = payload["targetDurationMs"]
    if target is not None and (not isinstance(target, int) or isinstance(target, bool) or not 900_000 <= target <= 28_800_000):
        raise RequestError("invalid_request", "The set draft target duration is invalid.")
    repeats = payload["maxArtistRepeats"]
    if repeats is not None and (not isinstance(repeats, int) or isinstance(repeats, bool) or not 1 <= repeats <= 20):
        raise RequestError("invalid_request", "The set draft artist repeat limit is invalid.")
    filters = payload["candidateFilters"]
    if not isinstance(filters, dict) or set(filters) - _FILTER_FIELDS:
        raise RequestError("invalid_request", "The set draft candidate filters are invalid.")
    _validate_filters_payload(filters)


def _validate_set_create_payload(payload: dict[str, Any]) -> None:
    if set(payload) != {"title", "plan", "source"} or not isinstance(payload.get("title"), str) or not 1 <= len(payload["title"]) <= 200:
        raise RequestError("invalid_request", "The set draft create request is invalid.")
    _validate_set_plan(payload["plan"])
    source = payload["source"]
    if not isinstance(source, dict) or not isinstance(source.get("kind"), str):
        raise RequestError("invalid_request", "The set draft source is invalid.")
    kind = source["kind"]
    if kind == "empty" and set(source) == {"kind"}:
        return
    if kind == "tracks" and set(source) == {"kind", "trackIds"}:
        track_ids = source["trackIds"]
        if isinstance(track_ids, list) and 1 <= len(track_ids) <= 100 and all(_valid_id(track_id) for track_id in track_ids) and len(set(track_ids)) == len(track_ids):
            return
    if kind == "playlist" and set(source) == {"kind", "playlistId"} and _valid_id(source["playlistId"]):
        return
    if kind == "generated" and set(source) in ({"kind", "maxTracks"}, {"kind", "maxTracks", "seedTrackId"}):
        if (
            isinstance(source["maxTracks"], int)
            and not isinstance(source["maxTracks"], bool)
            and 1 <= source["maxTracks"] <= 50
            and ("seedTrackId" not in source or _valid_id(source["seedTrackId"]))
        ):
            return
    raise RequestError("invalid_request", "The set draft source is invalid.")


def _validate_set_get_payload(payload: dict[str, Any]) -> None:
    if set(payload) not in ({"draftId"}, {"draftId", "revision"}) or not _valid_id(payload.get("draftId")):
        raise RequestError("invalid_request", "The set draft request is invalid.")
    if "revision" in payload and not _valid_revision(payload["revision"]):
        raise RequestError("invalid_request", "The set draft revision is invalid.")


def _validate_set_mutation_payload(payload: dict[str, Any]) -> None:
    if set(payload) != {"draftId", "expectedRevision", "mutation"} or not _valid_id(payload.get("draftId")) or not _valid_revision(payload.get("expectedRevision")):
        raise RequestError("invalid_request", "The set draft mutation request is invalid.")
    mutation = payload["mutation"]
    if not isinstance(mutation, dict) or not isinstance(mutation.get("type"), str):
        raise RequestError("invalid_request", "The set draft mutation is invalid.")
    mutation_type = mutation["type"]
    exact: dict[str, set[str]] = {
        "rename": {"type", "title"}, "set_plan": {"type", "plan"}, "insert_track": {"type", "trackId", "toIndex"},
        "move_entry": {"type", "entryId", "toIndex"}, "set_track_pin": {"type", "entryId", "pinned"},
        "set_position_pin": {"type", "entryId", "pinned"}, "remove_entry": {"type", "entryId"},
        "ban_entry": {"type", "entryId"}, "unban_track": {"type", "trackId"},
        "replace_entry": {"type", "entryId", "replacementTrackId"}, "set_entry_goal": {"type", "entryId", "role", "targetEnergyPpm"},
        "optimize": {"type"}, "undo": {"type"}, "redo": {"type"}, "save_version": {"type", "label"}, "restore_version": {"type", "version"},
    }
    if mutation_type not in exact or set(mutation) != exact[mutation_type]:
        raise RequestError("invalid_request", "The set draft mutation is invalid.")
    if mutation_type == "rename" and (not isinstance(mutation["title"], str) or not 1 <= len(mutation["title"]) <= 200):
        raise RequestError("invalid_request", "The set draft title is invalid.")
    if mutation_type == "set_plan":
        _validate_set_plan(mutation["plan"])
    if mutation_type in {"insert_track", "unban_track"} and not _valid_id(mutation.get("trackId")):
        raise RequestError("invalid_request", "The set draft track ID is invalid.")
    if mutation_type in {"move_entry", "set_track_pin", "set_position_pin", "remove_entry", "ban_entry", "replace_entry", "set_entry_goal"} and not _valid_id(mutation.get("entryId")):
        raise RequestError("invalid_request", "The set draft entry ID is invalid.")
    if mutation_type == "insert_track" and (not isinstance(mutation["toIndex"], int) or isinstance(mutation["toIndex"], bool) or not 0 <= mutation["toIndex"] <= 100):
        raise RequestError("invalid_request", "The set draft index is invalid.")
    if mutation_type == "move_entry" and (not isinstance(mutation["toIndex"], int) or isinstance(mutation["toIndex"], bool) or not 0 <= mutation["toIndex"] <= 99):
        raise RequestError("invalid_request", "The set draft index is invalid.")
    if mutation_type in {"set_track_pin", "set_position_pin"} and not isinstance(mutation["pinned"], bool):
        raise RequestError("invalid_request", "The set draft pin is invalid.")
    if mutation_type == "replace_entry" and not _valid_id(mutation["replacementTrackId"]):
        raise RequestError("invalid_request", "The replacement track ID is invalid.")
    if mutation_type == "set_entry_goal":
        if mutation["role"] is not None and mutation["role"] not in {"warmup", "groove", "build", "peak", "singalong", "reset", "bridge", "closer"}:
            raise RequestError("invalid_request", "The set draft role is invalid.")
        goal = mutation["targetEnergyPpm"]
        if goal is not None and (not isinstance(goal, int) or isinstance(goal, bool) or not 0 <= goal <= 1_000_000):
            raise RequestError("invalid_request", "The set draft energy goal is invalid.")
    if mutation_type == "save_version" and (not isinstance(mutation["label"], str) or not 1 <= len(mutation["label"]) <= 100):
        raise RequestError("invalid_request", "The set draft version label is invalid.")
    if mutation_type == "restore_version" and not _valid_revision(mutation["version"]):
        raise RequestError("invalid_request", "The set draft version is invalid.")


def _validate_set_replacements_payload(payload: dict[str, Any]) -> None:
    _validate_set_get_payload({key: value for key, value in payload.items() if key != "entryId"})
    if set(payload) not in ({"draftId", "entryId"}, {"draftId", "entryId", "revision"}) or not _valid_id(payload.get("entryId")):
        raise RequestError("invalid_request", "The set replacement request is invalid.")


def _validate_set_inspect_payload(payload: dict[str, Any]) -> None:
    if payload.get("kind") == "draft" and set(payload) in ({"kind", "draftId"}, {"kind", "draftId", "revision"}):
        _validate_set_get_payload({key: value for key, value in payload.items() if key != "kind"})
        return
    if payload.get("kind") == "playlist" and set(payload) == {"kind", "playlistId"} and _valid_id(payload["playlistId"]):
        return
    raise RequestError("invalid_request", "The set inspection request is invalid.")


def _validate_set_export_payload(payload: dict[str, Any]) -> None:
    if set(payload) != {"draftId", "expectedRevision", "destinationPath", "expectedDestinationState"} or not _valid_id(payload.get("draftId")) or not _valid_revision(payload.get("expectedRevision")):
        raise RequestError("invalid_request", "The set export request is invalid.")
    if not isinstance(payload["destinationPath"], str) or not 1 <= len(payload["destinationPath"]) <= 4_096:
        raise RequestError("invalid_request", "The export destination path is invalid.")
    if payload["expectedDestinationState"] not in {"absent", "regular_file"}:
        raise RequestError("invalid_request", "The expected export destination state is invalid.")


def _dispatch(
    command: str,
    payload: dict[str, Any],
    database: LibraryDatabase,
    manager: AnalysisManager,
) -> Any:
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
        page = database.search_track_evidence(
            _filters_from_wire(payload),
            cursor=payload.get("cursor"),
            limit=payload.get("limit", 100),
        )
        return _track_evidence_page_wire(page)
    if command in {"find_similar_tracks", "recommend_next_tracks"}:
        filters = _filters_from_wire(payload.get("filters", {}))
        seed = database.get_track_evidence(payload["seedTrackId"])
        if seed is None:
            raise RequestError("not_found", "The selected discovery seed was not found.")
        catalog, truncated = database.discovery_catalog(playlist_id=filters.playlist_id)
        catalog, truncated = _catalog_with_seed(catalog, seed, truncated)
        try:
            if command == "find_similar_tracks":
                result = find_similar_tracks(
                    catalog,
                    seed.track.id,
                    filters,
                    payload.get("limit", 10),
                    truncated,
                )
                return _similarity_wire(result)
            result = recommend_next_tracks(
                catalog,
                seed.track.id,
                payload["intent"],
                filters,
                payload.get("limit", 10),
                truncated,
            )
            return _recommendation_wire(result)
        except DiscoveryError as error:
            raise RequestError(error.code, error.message) from error
    if command == "list_set_drafts":
        return {"items": [_set_draft_list_item(record, database) for record in database.list_set_drafts()]}
    if command == "create_set_draft":
        catalog, truncated = database.discovery_catalog()
        plan = _draft_plan_from_wire(payload["plan"])
        source = payload["source"]
        generated_notices = None
        try:
            if source["kind"] == "empty":
                state = create_draft(payload["title"], plan, (), catalog, allow_repeated_tracks=False)
            elif source["kind"] == "tracks":
                state = create_draft(payload["title"], plan, tuple(source["trackIds"]), catalog, allow_repeated_tracks=False)
            elif source["kind"] == "playlist":
                evidence, source_position_count = database.playlist_evidence(source["playlistId"])
                if source_position_count > 100:
                    raise DraftError(
                        "playlist_too_large",
                        "A set draft can contain at most 100 playlist entries.",
                    )
                state = create_draft(payload["title"], plan, tuple(item.track.id for item in evidence), catalog, allow_repeated_tracks=True)
            else:
                generated = generate_draft(payload["title"], plan, catalog, max_tracks=source["maxTracks"], seed_track_id=source.get("seedTrackId"), scan_truncated=truncated)
                state = generated.state
                generated_notices = generated.unmet_constraints
            record = database.create_set_draft(state)
            snapshot = _set_draft_snapshot_wire(record, database)
            if generated_notices is not None:
                snapshot["unmetConstraints"] = [
                    {"code": notice.code, "message": notice.message}
                    for notice in generated_notices
                ]
            return snapshot
        except (DraftError, RekordboxImportError) as error:
            raise RequestError(error.code, error.message) from error
    if command == "get_set_draft":
        viewing_revision = payload.get("revision")
        return _set_draft_snapshot_wire(
            database.get_set_draft(payload["draftId"], revision=viewing_revision),
            database,
            viewing_revision=viewing_revision,
        )
    if command == "mutate_set_draft":
        record = database.get_set_draft(payload["draftId"])
        mutation = payload["mutation"]
        if payload["expectedRevision"] != record.current_revision:
            return {"status": "conflict", "currentRevision": record.current_revision}
        if mutation["type"] == "undo":
            updated = database.undo_set_draft(record.id, payload["expectedRevision"])
        elif mutation["type"] == "redo":
            updated = database.redo_set_draft(record.id, payload["expectedRevision"])
        elif mutation["type"] == "save_version":
            saved = database.save_set_draft_version(record.id, payload["expectedRevision"], mutation["label"])
            if saved is None:
                return {"status": "conflict", "currentRevision": database.get_set_draft(record.id).current_revision}
            return {"status": "updated", "snapshot": _set_draft_snapshot_wire(database.get_set_draft(record.id), database)}
        elif mutation["type"] == "restore_version":
            updated = database.restore_set_draft_version(record.id, payload["expectedRevision"], mutation["version"])
        else:
            catalog, _ = database.discovery_catalog()
            updated_state = apply_draft_mutation(record.state, _mutation_from_wire(mutation), catalog)
            updated = database.append_set_draft_revision(record.id, payload["expectedRevision"], updated_state, mutation["type"])
        if updated is None:
            return {"status": "conflict", "currentRevision": database.get_set_draft(record.id).current_revision}
        return {"status": "updated", "snapshot": _set_draft_snapshot_wire(updated, database)}
    if command == "find_set_replacements":
        record = database.get_set_draft(payload["draftId"], revision=payload.get("revision"))
        catalog, truncated = database.discovery_catalog()
        result = find_replacements(record.state, payload["entryId"], catalog, scan_truncated=truncated)
        return _replacement_wire(result)
    if command == "analyze_set":
        if payload["kind"] == "draft":
            record = database.get_set_draft(payload["draftId"], revision=payload.get("revision"))
            state = record.state
            source_position_count = len(state.entries)
            include_entry_ids = True
        else:
            playlist_evidence, source_position_count = database.playlist_evidence(payload["playlistId"])
            catalog, _ = database.discovery_catalog()
            state = create_draft(
                "Imported playlist",
                DraftPlan(intent="smooth"),
                tuple(item.track.id for item in playlist_evidence),
                catalog,
                allow_repeated_tracks=True,
            )
            include_entry_ids = False
        catalog, truncated = database.discovery_catalog()
        return _inspection_wire(
            inspect_set(
                state,
                catalog,
                source_position_count=source_position_count,
                scan_truncated=truncated,
            ),
            include_entry_ids=include_entry_ids,
        )
    if command in {"preview_set_export", "export_set_draft"}:
        record = database.get_set_draft(payload["draftId"])
        if record.current_revision != payload["expectedRevision"]:
            return {"status": "blocked", "reasons": [{"code": "conflict", "message": "The set draft changed before export."}], "destinationState": "unchanged"}
        source = database.get_import_source_path()
        if source is None:
            return {"status": "blocked", "reasons": [{"code": "reimport_required", "message": "Reimport the Rekordbox XML before exporting this set."}], "destinationState": "unchanged"}
        snapshot = RekordboxExportSnapshot(record.state.title, str(source), tuple(database.get_export_track(entry.track_id) for entry in record.state.entries))
        try:
            if command == "preview_set_export":
                preview = preview_rekordbox_export(snapshot, Path(payload["destinationPath"]), payload["expectedDestinationState"])
                known, unknown = _draft_durations(record.state, database)
                return {"status": "ready", "draftId": record.id, "revision": record.current_revision, "playlistName": preview.playlist_name, "trackCount": preview.track_count, "knownDurationMs": known, "unknownDurationCount": unknown, "warnings": [], "expectedDestinationState": preview.expected_destination_state}
            result = write_rekordbox_export(snapshot, Path(payload["destinationPath"]), payload["expectedDestinationState"])
            return {"status": "exported", "draftId": record.id, "revision": record.current_revision, "playlistName": result.playlist_name, "trackCount": result.track_count, "overwritten": result.overwritten, "format": result.format, "destinationState": result.destination_state}
        except RekordboxExportError as error:
            return {"status": "blocked", "reasons": [{"code": error.code, "message": error.message}], "destinationState": error.destination_state}
    try:
        if command == "queue_analysis":
            return _analysis_queue_wire(manager.queue_tracks(tuple(payload["trackIds"])))
        if command == "get_analysis_status":
            track_ids = tuple(payload["trackIds"]) if "trackIds" in payload else None
            return _analysis_queue_wire(manager.status(track_ids))
        if command == "pause_analysis":
            return _analysis_queue_wire(manager.pause())
        if command == "resume_analysis":
            return _analysis_queue_wire(manager.resume())
    except ValueError as error:
        raise RequestError("invalid_request", "The analysis request is invalid.") from error
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


def _track_page_wire(page: TrackPage, database: LibraryDatabase) -> dict[str, Any]:
    return {
        "items": [
            _track_wire(track, database.analysis_summary(track.id)) for track in page.items
        ],
        "nextCursor": page.next_cursor,
        "truncated": False,
    }


def _track_evidence_page_wire(page: TrackEvidencePage) -> dict[str, Any]:
    return {
        "items": [_track_wire(item.track, item.analysis) for item in page.items],
        "nextCursor": page.next_cursor,
        "truncated": page.truncated,
    }


def _catalog_with_seed(
    catalog: tuple[TrackEvidence, ...],
    seed: TrackEvidence,
    truncated: bool,
) -> tuple[tuple[TrackEvidence, ...], bool]:
    without_seed = tuple(item for item in catalog if item.track.id != seed.track.id)
    available_slots = DISCOVERY_SCAN_LIMIT - 1
    clipped = without_seed[:available_slots]
    was_clipped = len(without_seed) > len(clipped)
    return (seed, *clipped), truncated or was_clipped


def _discovery_track_wire(track: DiscoveryTrack) -> dict[str, Any]:
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


def _set_draft_snapshot_wire(
    record,
    database: LibraryDatabase,
    *,
    viewing_revision: int | None = None,
) -> dict[str, Any]:
    catalog, _ = database.discovery_catalog()
    evidence_by_id = {item.track.id: item for item in catalog}
    entries = []
    known_duration = 0
    unknown_duration = 0
    for entry in record.state.entries:
        evidence = evidence_by_id.get(entry.track_id)
        if evidence is None:
            entries.append({"id": entry.id, "trackId": entry.track_id, "track": None, "resolution": "missing", "bpmMilli": None, "musicalKey": None, "energyPpm": None, "trackPinned": entry.track_pinned, "positionPinned": entry.position_pinned, "role": entry.role, "targetEnergyPpm": entry.target_energy_ppm})
            unknown_duration += 1
            continue
        features = evidence.analysis.features if evidence.analysis is not None and evidence.analysis.status == "succeeded" else None
        duration = evidence.track.duration_ms
        if duration is None:
            unknown_duration += 1
        else:
            known_duration += duration
        entries.append({"id": entry.id, "trackId": entry.track_id, "track": _discovery_track_wire(DiscoveryTrack(evidence.track.id, evidence.track.title, evidence.track.artist, evidence.track.album, evidence.track.genre, evidence.track.bpm_milli, evidence.track.musical_key, evidence.track.duration_ms, evidence.track.availability)), "resolution": "resolved", "bpmMilli": features.bpm_milli if features is not None else evidence.track.bpm_milli, "musicalKey": features.musical_key if features is not None else evidence.track.musical_key, "energyPpm": features.energy_ppm if features is not None else None, "trackPinned": entry.track_pinned, "positionPinned": entry.position_pinned, "role": entry.role, "targetEnergyPpm": entry.target_energy_ppm})
    can_undo, can_redo = database.set_draft_history_capabilities(record.id)
    versions = database.list_set_draft_versions(record.id)
    viewing_version = None
    if viewing_revision is not None:
        matching_versions = [
            item.version for item in versions if item.revision == record.content_revision
        ]
        viewing_version = max(matching_versions, default=None)
    return {"draftId": record.id, "currentRevision": record.current_revision, "contentRevision": record.content_revision, "title": record.state.title, "plan": {"intent": record.state.plan.intent, "targetDurationMs": record.state.plan.target_duration_ms, "maxArtistRepeats": record.state.plan.max_artist_repeats, "candidateFilters": _filters_to_wire(record.state.plan.candidate_filters)}, "entries": entries, "bans": list(record.state.bans), "knownDurationMs": known_duration, "unknownDurationCount": unknown_duration, "unmetConstraints": _current_unmet_constraints(record.state, evidence_by_id, known_duration, unknown_duration), "canUndo": can_undo, "canRedo": can_redo, "versions": [{"version": item.version, "revision": item.revision, "label": item.label} for item in versions], "viewingVersion": viewing_version}


def _current_unmet_constraints(
    state: DraftState,
    evidence_by_id: dict[str, TrackEvidence],
    known_duration_ms: int,
    unknown_duration_count: int,
) -> list[dict[str, str]]:
    notices: list[dict[str, str]] = []
    if state.plan.target_duration_ms is not None and (
        known_duration_ms < state.plan.target_duration_ms or unknown_duration_count > 0
    ):
        notices.append({
            "code": "target_duration",
            "message": "Known track duration does not reach the requested target.",
        })
    if state.plan.max_artist_repeats is not None:
        artist_counts: dict[str, int] = {}
        for entry in state.entries:
            evidence = evidence_by_id.get(entry.track_id)
            artist = evidence.track.artist if evidence is not None else None
            normalized = artist.strip().casefold() if artist is not None else ""
            if normalized:
                artist_counts[normalized] = artist_counts.get(normalized, 0) + 1
        if any(count > state.plan.max_artist_repeats for count in artist_counts.values()):
            notices.append({
                "code": "max_artist_repeats",
                "message": "The current set exceeds the maximum repeats for a known artist.",
            })
    return notices


def _filters_to_wire(filters: TrackFilters) -> dict[str, Any]:
    values = {"text": filters.text, "playlistId": filters.playlist_id, "bpmMinMilli": filters.bpm_min_milli, "bpmMaxMilli": filters.bpm_max_milli, "musicalKey": filters.musical_key, "keyRelation": filters.key_relation, "genre": filters.genre, "energyMinPpm": filters.energy_min_ppm, "energyMaxPpm": filters.energy_max_ppm, "analysisState": filters.analysis_state, "availability": filters.availability}
    return {key: value for key, value in values.items() if value is not None and not (key in {"analysisState", "availability"} and value == "any")}


def _set_draft_list_item(record, database: LibraryDatabase) -> dict[str, Any]:
    snapshot = _set_draft_snapshot_wire(record, database)
    return {"draftId": record.id, "currentRevision": record.current_revision, "title": record.state.title, "trackCount": len(record.state.entries), "knownDurationMs": snapshot["knownDurationMs"], "unknownDurationCount": snapshot["unknownDurationCount"]}


def _draft_durations(state: DraftState, database: LibraryDatabase) -> tuple[int, int]:
    catalog, _ = database.discovery_catalog()
    durations = {item.track.id: item.track.duration_ms for item in catalog}
    known = 0
    unknown = 0
    for entry in state.entries:
        duration = durations.get(entry.track_id)
        if duration is None:
            unknown += 1
        else:
            known += duration
    return known, unknown


def _replacement_wire(result) -> dict[str, Any]:
    return {"scannedCount": result.scanned_count, "scanTruncated": result.scan_truncated, "items": [{"track": _discovery_track_wire(item.track), "scorePpm": item.score_ppm, "confidencePpm": item.confidence_ppm, "goalScorePpm": item.goal_score_ppm, "affectedTransitions": [_transition_wire(edge) for edge in item.affected_edges]} for item in result.items]}


def _transition_wire(edge) -> dict[str, Any]:
    return {"fromPosition": edge.from_position, "toPosition": edge.to_position, "scorePpm": edge.candidate.score_ppm, "confidencePpm": edge.candidate.confidence_ppm, "utilitySignedPpm": edge.utility_signed_ppm, "reasons": list(edge.candidate.reasons), "components": [_score_component_wire(component) for component in edge.candidate.components]}


def _inspection_wire(result, *, include_entry_ids: bool = True) -> dict[str, Any]:
    direction = {"steady": "flat", "missing": "unknown"}
    return {"sourcePositionCount": result.source_position_count, "inspectedPositionCount": result.inspected_position_count, "inputTruncated": result.input_truncated, "knownDurationMs": result.known_duration_ms, "unknownDurationCount": result.unknown_duration_count, "points": [{"position": point.position, "entryId": point.entry_id if include_entry_ids else None, "trackId": point.track_id, "track": _discovery_track_wire(point.track) if point.track is not None else None, "resolution": "resolved" if point.resolution == "current" else "missing", "bpmMilli": point.effective_bpm_milli, "musicalKey": point.effective_musical_key, "energyPpm": point.local_energy_ppm, "energyDirection": direction.get(point.energy_direction, point.energy_direction), "bpmDirection": direction.get(point.bpm_direction, point.bpm_direction)} for point in result.points], "transitions": [_transition_wire(edge) for edge in result.transitions], "warnings": [{"code": warning.code, "message": warning.message} for warning in result.warnings], "matchedWarningCount": result.matched_warning_count, "warningsTruncated": result.warnings_truncated, "scannedCount": result.scanned_count, "scanTruncated": result.scan_truncated, "organizationLabel": result.organization_label, "organizationSuggestions": [{"kind": "not_in_playlist" if suggestion.kind == "unassigned" else suggestion.kind, "label": suggestion.name, "evidence": suggestion.evidence, "trackIds": list(suggestion.track_ids), "matchedTrackCount": suggestion.matched_track_count, "trackIdsTruncated": suggestion.track_ids_truncated} for suggestion in result.organization_suggestions], "matchedSuggestionCount": result.matched_suggestion_count, "suggestionsTruncated": result.suggestions_truncated}


def _score_component_wire(component: ScoreComponent) -> dict[str, Any]:
    return {
        "name": component.name,
        "scorePpm": component.score_ppm,
        "weightPpm": component.weight_ppm,
        "contributionSignedPpm": component.contribution_signed_ppm,
        "effect": component.effect,
        "reason": component.reason,
    }


def _discovery_candidate_wire(candidate: DiscoveryCandidate) -> dict[str, Any]:
    return {
        "track": _discovery_track_wire(candidate.track),
        "scorePpm": candidate.score_ppm,
        "confidencePpm": candidate.confidence_ppm,
        "reasons": list(candidate.reasons),
        "components": [_score_component_wire(component) for component in candidate.components],
    }


def _similarity_wire(result: SimilarityResult) -> dict[str, Any]:
    return {
        "seed": _discovery_track_wire(result.seed),
        "algorithmVersion": result.algorithm_version,
        "scannedCount": result.scanned_count,
        "truncated": result.truncated,
        "items": [_discovery_candidate_wire(candidate) for candidate in result.items],
    }


def _recommendation_wire(result: RecommendationResult) -> dict[str, Any]:
    return {
        "seed": _discovery_track_wire(result.seed),
        "intent": result.intent,
        "algorithmVersion": result.algorithm_version,
        "scannedCount": result.scanned_count,
        "truncated": result.truncated,
        "items": [_discovery_candidate_wire(candidate) for candidate in result.items],
    }


def _track_wire(track: StoredTrack, analysis: AnalysisSummary | None) -> dict[str, Any]:
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
        "analysis": _analysis_summary_wire(analysis) if analysis is not None else None,
    }


def _analysis_queue_wire(status: AnalysisQueueStatus) -> dict[str, Any]:
    return {
        "state": status.state,
        "queued": status.queued,
        "running": status.running,
        "paused": status.paused,
        "succeeded": status.succeeded,
        "failed": status.failed,
        "progressPpm": status.progress_ppm,
        "capabilities": _capabilities_wire(status.capabilities),
        "items": [
            {"trackId": track_id, **_analysis_summary_wire(summary)}
            for track_id, summary in status.items
        ],
    }


def _analysis_summary_wire(summary: AnalysisSummary) -> dict[str, Any]:
    return {
        "status": summary.status,
        "progressPpm": summary.progress_ppm,
        "attemptCount": summary.attempt_count,
        "errorCode": summary.error_code,
        "errorMessage": summary.error_message,
        "features": _analysis_features_wire(summary.features) if summary.features is not None else None,
    }


def _capabilities_wire(capabilities: ProviderCapabilities) -> dict[str, Any]:
    unavailable_reason = None
    if not capabilities.available:
        unavailable_reason = "Local audio analysis prerequisites are unavailable."
    return {
        "available": capabilities.available,
        "provider": capabilities.provider,
        "providerVersion": capabilities.provider_version,
        "pipelineVersion": capabilities.pipeline_version,
        "availableStages": list(capabilities.available_stages),
        "unavailableStages": list(capabilities.unavailable_stages),
        "unavailableReason": unavailable_reason,
    }


def _analysis_features_wire(features: AnalysisFeatures) -> dict[str, Any]:
    return {
        "fingerprint": features.fingerprint,
        "fileSize": features.file_size,
        "mtimeNs": features.mtime_ns,
        "codec": features.codec,
        "container": features.container,
        "durationMs": features.duration_ms,
        "sampleRateHz": features.sample_rate_hz,
        "channels": features.channels,
        "bpmMilli": features.bpm_milli,
        "tempoConfidencePpm": features.tempo_confidence_ppm,
        "tempoCandidatesMilli": list(features.tempo_candidates_milli),
        "onsetCount": features.onset_count,
        "beatStrengthPpm": features.beat_strength_ppm,
        "musicalKey": features.musical_key,
        "mode": features.mode,
        "keyConfidencePpm": features.key_confidence_ppm,
        "rmsMilliDbfs": features.rms_milli_dbfs,
        "peakMilliDbfs": features.peak_milli_dbfs,
        "crestFactorMilliDb": features.crest_factor_milli_db,
        "energyPpm": features.energy_ppm,
        "dynamicRangeMilliDb": features.dynamic_range_milli_db,
        "onsetRateMilliHz": features.onset_rate_milli_hz,
        "spectralCentroidHz": features.spectral_centroid_hz,
        "brightnessPpm": features.brightness_ppm,
        "energyCurvePpm": list(features.energy_curve_ppm),
        "provider": features.provider,
        "providerVersion": features.provider_version,
        "pipelineVersion": features.pipeline_version,
        "limitations": list(features.limitations),
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
