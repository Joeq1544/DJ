"""Bounded, read-only import of Rekordbox XML exports."""

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN
import hashlib
import os
from pathlib import Path
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ElementTree

from .models import ImportedPlaylist, ImportedTrack, RekordboxImport


class RekordboxImportError(ValueError):
    """A bounded import error suitable for the desktop protocol."""

    def __init__(self, code: str, message: str):
        self.code = code[:64]
        self.message = message[:500]
        super().__init__(self.message)


@dataclass(frozen=True)
class ParseLimits:
    max_bytes: int = 20 * 1_024 * 1_024
    max_nodes: int = 500_000
    max_text: int = 20 * 1_024 * 1_024
    max_depth: int = 64
    max_tracks: int = 100_000
    max_playlist_nodes: int = 25_000
    max_playlist_entries: int = 500_000


def parse_rekordbox_xml(source: Path, *, limits: ParseLimits | None = None) -> RekordboxImport:
    """Parse one UTF-8 Rekordbox XML export without writing it or opening audio."""
    effective_limits = limits or ParseLimits()
    source_path = Path(source)
    try:
        raw = source_path.read_bytes()
    except OSError as exc:
        raise RekordboxImportError("source_unreadable", "The Rekordbox XML source cannot be read.") from exc
    if len(raw) > effective_limits.max_bytes:
        _raise("byte_limit_exceeded", "The Rekordbox XML source exceeds the byte limit.")

    text = _decode_utf8(raw)
    upper_text = text.upper()
    if "<!DOCTYPE" in upper_text or "<!ENTITY" in upper_text:
        _raise("dtd_not_allowed", "DTD and entity declarations are not allowed in Rekordbox XML.")
    try:
        root = ElementTree.fromstring(text)
    except ElementTree.ParseError as exc:
        raise RekordboxImportError("malformed_xml", "The Rekordbox XML document is malformed.") from exc

    _check_xml_bounds(root, effective_limits)
    if root.tag != "DJ_PLAYLISTS":
        _raise("unsupported_root", "The Rekordbox XML root must be DJ_PLAYLISTS.")
    if root.get("Version") != "1.0.0":
        _raise("unsupported_version", "Only Rekordbox XML version 1.0.0 is supported.")
    collection = root.find("COLLECTION")
    if collection is None:
        _raise("missing_collection", "The Rekordbox XML document has no collection.")

    tracks, track_ids_by_path = _parse_tracks(collection, effective_limits)
    playlists = _parse_playlists(root.find("PLAYLISTS"), tracks, track_ids_by_path, effective_limits)
    return RekordboxImport(
        source_sha256=hashlib.sha256(raw).hexdigest(),
        tracks=tuple(tracks.values()),
        playlists=tuple(playlists),
    )


def _raise(code: str, message: str) -> None:
    raise RekordboxImportError(code, message)


def _decode_utf8(raw: bytes) -> str:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise RekordboxImportError("unsupported_encoding", "Only UTF-8 Rekordbox XML is supported.") from exc
    if "\x00" in text:
        _raise("unsupported_encoding", "Only UTF-8 Rekordbox XML is supported.")
    return text


def _check_xml_bounds(root: ElementTree.Element, limits: ParseLimits) -> None:
    node_count = 0
    text_count = 0
    stack = [(root, 0)]
    while stack:
        element, depth = stack.pop()
        node_count += 1
        if node_count > limits.max_nodes:
            _raise("node_limit_exceeded", "The Rekordbox XML document has too many nodes.")
        if depth > limits.max_depth:
            _raise("hierarchy_depth_exceeded", "The Rekordbox XML hierarchy is too deep.")
        text_count += len(element.text or "") + len(element.tail or "")
        text_count += sum(len(value) for value in element.attrib.values())
        if text_count > limits.max_text:
            _raise("text_limit_exceeded", "The Rekordbox XML document has too much text.")
        stack.extend((child, depth + 1) for child in element)


def _parse_tracks(collection: ElementTree.Element, limits: ParseLimits) -> tuple[dict[str, ImportedTrack], dict[str, list[str]]]:
    elements = collection.findall("TRACK")
    _require_declared_count(collection, "Entries", len(elements), "collection")
    if len(elements) > limits.max_tracks:
        _raise("track_limit_exceeded", "The Rekordbox XML collection has too many tracks.")
    tracks: dict[str, ImportedTrack] = {}
    track_ids_by_path: dict[str, list[str]] = {}
    for element in elements:
        external_id = _required_id(element.get("TrackID"), "track")
        if external_id in tracks:
            _raise("duplicate_track_id", "The Rekordbox XML collection has duplicate TrackID values.")
        path = _local_path(element.get("Location"))
        tracks[external_id] = ImportedTrack(
            external_id=external_id,
            title=_display_text(element.get("Name")),
            artist=_display_text(element.get("Artist")),
            album=_display_text(element.get("Album")),
            genre=_display_text(element.get("Genre")),
            bpm_milli=_bpm_milli(element),
            musical_key=_limited_text(element.get("Tonality"), 64, "musical_key"),
            duration_ms=_duration_ms(element.get("TotalTime")),
            path=path,
            availability=_availability(path),
        )
        track_ids_by_path.setdefault(path, []).append(external_id)
    return tracks, track_ids_by_path


def _parse_playlists(
    playlists_element: ElementTree.Element | None,
    tracks: dict[str, ImportedTrack],
    track_ids_by_path: dict[str, list[str]],
    limits: ParseLimits,
) -> list[ImportedPlaylist]:
    if playlists_element is None:
        return []
    roots = playlists_element.findall("NODE")
    playlists: list[ImportedPlaylist] = []
    entry_count = 0

    def walk(node: ElementTree.Element, parent_key: str | None, index_path: str, order: int) -> None:
        nonlocal entry_count
        if len(playlists) >= limits.max_playlist_nodes:
            _raise("playlist_node_limit_exceeded", "The Rekordbox XML document has too many playlist nodes.")
        node_type = node.get("Type")
        name = _required_playlist_name(node.get("Name"))
        if node_type == "0":
            children = node.findall("NODE")
            _require_declared_count(node, "Count", len(children), "folder")
            playlists.append(ImportedPlaylist(index_path, parent_key, name, "folder", order, ()))
            for child_order, child in enumerate(children):
                walk(child, index_path, f"{index_path}/{child_order}", child_order)
            return
        if node_type != "1":
            _raise("unsupported_playlist_node", "The Rekordbox XML playlist node type is unsupported.")
        references = node.findall("TRACK")
        _require_declared_count(node, "Entries", len(references), "playlist")
        entry_count += len(references)
        if entry_count > limits.max_playlist_entries:
            _raise("playlist_entry_limit_exceeded", "The Rekordbox XML document has too many playlist entries.")
        node_key_type = node.get("KeyType")
        if node_key_type is None:
            reference_key_type = None
        elif node_key_type == "0":
            reference_key_type = "TrackID"
        elif node_key_type == "1":
            reference_key_type = "Location"
        else:
            _raise("unsupported_playlist_reference", "The Rekordbox XML playlist reference format is unsupported.")
        if reference_key_type is not None and any(reference.get("KeyType") is not None for reference in references):
            _raise("unsupported_playlist_reference", "The Rekordbox XML playlist reference format is unsupported.")
        track_external_ids = tuple(
            _resolve_reference(reference, tracks, track_ids_by_path, key_type=reference_key_type)
            for reference in references
        )
        playlists.append(ImportedPlaylist(index_path, parent_key, name, "playlist", order, track_external_ids))

    for root_order, node in enumerate(roots):
        walk(node, None, str(root_order), root_order)
    return playlists


def _resolve_reference(
    reference: ElementTree.Element,
    tracks: dict[str, ImportedTrack],
    track_ids_by_path: dict[str, list[str]],
    *,
    key_type: str | None = None,
) -> str:
    effective_key_type = key_type if key_type is not None else reference.get("KeyType")
    key = reference.get("Key")
    if effective_key_type == "TrackID":
        external_id = _required_id(key, "playlist track")
    elif effective_key_type == "Location":
        normalized_path = _local_path(key)
        matching_ids = track_ids_by_path.get(normalized_path, [])
        if len(matching_ids) > 1:
            _raise("ambiguous_location_reference", "A playlist Location reference matches multiple collection tracks.")
        if not matching_ids:
            _raise("unresolved_playlist_reference", "A playlist reference does not resolve to a collection track.")
        external_id = matching_ids[0]
    else:
        _raise("unsupported_playlist_reference", "The Rekordbox XML playlist reference format is unsupported.")
    if external_id not in tracks:
        _raise("unresolved_playlist_reference", "A playlist reference does not resolve to a collection track.")
    return external_id


def _require_declared_count(element: ElementTree.Element, attribute: str, actual: int, label: str) -> None:
    try:
        declared = int(element.get(attribute, ""))
    except ValueError as exc:
        raise RekordboxImportError("invalid_declared_count", f"The declared {label} count is invalid.") from exc
    if declared != actual:
        _raise("declared_count_mismatch", f"The declared {label} count does not match its entries.")


def _required_id(value: str | None, label: str) -> str:
    if value is None or not value or len(value) > 128:
        _raise("invalid_id", f"The {label} ID must contain 1 to 128 characters.")
    return value


def _required_playlist_name(value: str | None) -> str:
    if value is None or not value or len(value) > 1_000:
        _raise("invalid_playlist_name", "A playlist name must contain 1 to 1000 characters.")
    return value


def _limited_text(value: str | None, maximum: int, label: str) -> str | None:
    if value is not None and len(value) > maximum:
        _raise("display_text_too_long", f"The {label} field exceeds its maximum length.")
    return value or None


def _display_text(value: str | None) -> str | None:
    return _limited_text(value, 1_000, "display")


def _bpm_milli(element: ElementTree.Element) -> int | None:
    average = _positive_decimal(element.get("AverageBpm"))
    if average is None:
        for tempo in element.findall("TEMPO"):
            average = _positive_decimal(tempo.get("Bpm"))
            if average is not None:
                break
    if average is None:
        return None
    return int((average * Decimal("1000")).quantize(Decimal("1"), rounding=ROUND_HALF_EVEN))


def _duration_ms(value: str | None) -> int | None:
    seconds = _nonnegative_decimal(value)
    if seconds is None:
        return None
    return int((seconds * Decimal("1000")).quantize(Decimal("1"), rounding=ROUND_HALF_EVEN))


def _positive_decimal(value: str | None) -> Decimal | None:
    parsed = _nonnegative_decimal(value)
    return parsed if parsed is not None and parsed > 0 else None


def _nonnegative_decimal(value: str | None) -> Decimal | None:
    if value is None:
        return None
    try:
        parsed = Decimal(value)
    except InvalidOperation:
        return None
    if not parsed.is_finite() or parsed < 0:
        return None
    return parsed


def _local_path(location: str | None) -> str:
    if not location:
        _raise("missing_file_uri", "A collection track or playlist reference has no file URI.")
    parts = urlsplit(location)
    if parts.scheme != "file" or parts.netloc not in ("", "localhost"):
        _raise("nonlocal_file_uri", "Only local file:// URIs are supported.")
    if parts.query or parts.fragment:
        _raise("invalid_file_uri", "A local file URI cannot contain a query or fragment.")
    path = unquote(parts.path)
    if "\x00" in path or not Path(path).is_absolute():
        _raise("invalid_file_uri", "A local file URI must contain an absolute path.")
    return str(Path(path))


def _availability(path: str) -> str:
    try:
        if not Path(path).exists():
            return "missing"
        return "available" if os.access(path, os.R_OK) else "unreadable"
    except OSError:
        return "unreadable"
