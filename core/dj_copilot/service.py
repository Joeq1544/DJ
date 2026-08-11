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
    }
    if command not in allowed_commands:
        raise RequestError("unknown_command", "The requested core command is not supported.")
    expected_top_level = {"version", "id", "command", "payload"}
    if set(raw_request) != expected_top_level:
        raise RequestError("invalid_request", "The request contains unsupported fields.")
    if command in {"health", "get_playlist_tree", "pause_analysis", "resume_analysis"}:
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
