"""Deterministic, fail-closed Rekordbox XML export for resolved set snapshots."""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import stat
import tempfile
from typing import Literal
import xml.etree.ElementTree as ElementTree

from .models import RekordboxImport
from .rekordbox_xml import RekordboxImportError, parse_rekordbox_xml


ExpectedDestinationState = Literal["absent", "regular_file"]
FailureDestinationState = Literal["unchanged", "unknown"]


class RekordboxExportError(ValueError):
    """A bounded export error with an explicit destination-state guarantee."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        destination_state: FailureDestinationState = "unchanged",
    ):
        self.code = code[:64]
        self.message = message[:500]
        self.destination_state = destination_state
        super().__init__(self.message)


@dataclass(frozen=True)
class RekordboxExportTrack:
    """One current, private track record resolved by the core service."""

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
class RekordboxExportSnapshot:
    """Path-bearing export input that never crosses the renderer boundary."""

    playlist_name: str
    imported_source_path: str
    entries: tuple[RekordboxExportTrack, ...]


@dataclass(frozen=True)
class RekordboxExportPreview:
    playlist_name: str
    track_count: int
    expected_destination_state: ExpectedDestinationState


@dataclass(frozen=True)
class RekordboxExportResult:
    playlist_name: str
    track_count: int
    overwritten: bool
    format: str = "rekordbox_xml_1_0_0"
    destination_state: str = "replaced"


@dataclass(frozen=True)
class _PreparedExport:
    playlist_name: str
    imported_source_path: Path
    collection: tuple[RekordboxExportTrack, ...]
    entries: tuple[RekordboxExportTrack, ...]


def serialize_rekordbox_export(snapshot: RekordboxExportSnapshot) -> bytes:
    """Return deterministic UTF-8 bytes for one already-resolved snapshot."""
    prepared = _prepare_snapshot(snapshot)
    return _serialize(prepared)


def preview_rekordbox_export(
    snapshot: RekordboxExportSnapshot,
    destination: Path,
    expected_destination_state: ExpectedDestinationState,
) -> RekordboxExportPreview:
    """Validate an export without creating or changing the destination."""
    expected_state = _expected_destination_state(expected_destination_state)
    prepared = _prepare_snapshot(snapshot)
    _serialize(prepared)
    canonical_destination = _canonical_destination(destination)
    _validate_destination(canonical_destination, prepared.imported_source_path, expected_state)
    return RekordboxExportPreview(prepared.playlist_name, len(prepared.entries), expected_state)


def write_rekordbox_export(
    snapshot: RekordboxExportSnapshot,
    destination: Path,
    expected_destination_state: ExpectedDestinationState,
) -> RekordboxExportResult:
    """Validate, independently reparse, and atomically finalize one XML export."""
    expected_state = _expected_destination_state(expected_destination_state)
    prepared = _prepare_snapshot(snapshot)
    canonical_destination = _canonical_destination(destination)
    _validate_destination(canonical_destination, prepared.imported_source_path, expected_state)
    document = _serialize(prepared)

    descriptor: int | None = None
    temporary_path: Path | None = None
    try:
        descriptor, temporary_name = tempfile.mkstemp(
            dir=canonical_destination.parent,
            prefix=f".{canonical_destination.name}.",
            suffix=".tmp",
        )
        temporary_path = Path(temporary_name)
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            descriptor = None
            handle.write(document)
            handle.flush()
            os.fsync(handle.fileno())

        _reparse_and_compare(temporary_path, prepared)
        _validate_destination(canonical_destination, prepared.imported_source_path, expected_state)
        try:
            os.replace(temporary_path, canonical_destination)
        except Exception as exc:
            raise RekordboxExportError(
                "finalize_failed",
                "The Rekordbox XML destination may have changed while finalizing the export.",
                destination_state="unknown",
            ) from exc
        temporary_path = None
        return RekordboxExportResult(
            playlist_name=prepared.playlist_name,
            track_count=len(prepared.entries),
            overwritten=expected_state == "regular_file",
        )
    except RekordboxExportError:
        raise
    except Exception as exc:
        raise RekordboxExportError(
            "export_failed",
            "The Rekordbox XML export could not be written safely.",
        ) from exc
    finally:
        if descriptor is not None:
            try:
                os.close(descriptor)
            except OSError:
                pass
        if temporary_path is not None:
            try:
                temporary_path.unlink()
            except FileNotFoundError:
                pass
            except OSError:
                pass


def _fail(code: str, message: str) -> None:
    raise RekordboxExportError(code, message)


def _expected_destination_state(value: object) -> ExpectedDestinationState:
    if value not in ("absent", "regular_file"):
        _fail("invalid_destination_state", "The expected export destination state is unsupported.")
    return value  # type: ignore[return-value]


def _prepare_snapshot(snapshot: object) -> _PreparedExport:
    if not isinstance(snapshot, RekordboxExportSnapshot):
        _fail("invalid_export_snapshot", "The Rekordbox export snapshot is invalid.")
    playlist_name = _required_text(snapshot.playlist_name, 200, "playlist_name")
    imported_source_path = _absolute_path(snapshot.imported_source_path, "invalid_import_source_path")
    if not isinstance(snapshot.entries, tuple) or len(snapshot.entries) > 100:
        _fail("invalid_export_snapshot", "The Rekordbox export snapshot has an invalid entry list.")

    entries: list[RekordboxExportTrack] = []
    collection: list[RekordboxExportTrack] = []
    collection_by_id: dict[str, RekordboxExportTrack] = {}
    for entry in snapshot.entries:
        if not isinstance(entry, RekordboxExportTrack):
            _fail("unresolved_track", "Every export entry must resolve to a current track.")
        track = _validated_track(entry)
        previous = collection_by_id.get(track.external_id)
        if previous is None:
            collection_by_id[track.external_id] = track
            collection.append(track)
        elif previous != track:
            _fail("conflicting_track", "Repeated export TrackID values must resolve to the same track data.")
        entries.append(track)
    return _PreparedExport(
        playlist_name=playlist_name,
        imported_source_path=imported_source_path,
        collection=tuple(collection),
        entries=tuple(entries),
    )


def _validated_track(track: RekordboxExportTrack) -> RekordboxExportTrack:
    external_id = _required_text(track.external_id, 128, "external_id")
    if not all("0" <= character <= "9" for character in external_id):
        _fail("invalid_external_id", "Every export track must have a numeric Rekordbox TrackID.")
    if track.availability != "available":
        _fail("unavailable_track", "Every export entry must resolve to an available current track.")
    path = _absolute_path(track.path, "invalid_track_path")
    try:
        source_status = path.stat()
    except FileNotFoundError as exc:
        raise RekordboxExportError(
            "track_source_missing",
            "An export track source file is missing.",
        ) from exc
    except OSError as exc:
        raise RekordboxExportError(
            "track_source_unreadable",
            "An export track source file cannot be inspected.",
        ) from exc
    if not stat.S_ISREG(source_status.st_mode):
        _fail("invalid_track_path", "Every export track source must be a regular file.")
    if not os.access(path, os.R_OK):
        _fail("track_source_unreadable", "An export track source file cannot be read.")

    bpm_milli = _optional_integer(track.bpm_milli, minimum=1, label="bpm_milli")
    duration_ms = _optional_integer(track.duration_ms, minimum=0, label="duration_ms")
    return RekordboxExportTrack(
        external_id=external_id,
        title=_optional_text(track.title, 1_000, "title"),
        artist=_optional_text(track.artist, 1_000, "artist"),
        album=_optional_text(track.album, 1_000, "album"),
        genre=_optional_text(track.genre, 1_000, "genre"),
        bpm_milli=bpm_milli,
        musical_key=_optional_text(track.musical_key, 64, "musical_key"),
        duration_ms=duration_ms,
        path=str(path),
        availability="available",
    )


def _required_text(value: object, maximum: int, label: str) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum or not _is_xml_text(value):
        _fail("invalid_export_snapshot", f"The export {label} value is invalid.")
    return value


def _optional_text(value: object, maximum: int, label: str) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str) or len(value) > maximum or not _is_xml_text(value):
        _fail("invalid_track_metadata", f"The export track {label} value is invalid.")
    return value


def _optional_integer(value: object, *, minimum: int, label: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        _fail("invalid_track_metadata", f"The export track {label} value is invalid.")
    return value


def _is_xml_text(value: str) -> bool:
    return all(
        character in "\t\n\r"
        or 0x20 <= ord(character) <= 0xD7FF
        or 0xE000 <= ord(character) <= 0xFFFD
        or 0x10000 <= ord(character) <= 0x10FFFF
        for character in value
    )


def _absolute_path(value: object, code: str) -> Path:
    if not isinstance(value, str) or not value or "\x00" in value or len(value) > 32_768:
        _fail(code, "The export path is invalid.")
    path = Path(value)
    if not path.is_absolute():
        _fail(code, "The export path must be absolute.")
    return path


def _serialize(prepared: _PreparedExport) -> bytes:
    try:
        root = ElementTree.Element("DJ_PLAYLISTS", {"Version": "1.0.0"})
        ElementTree.SubElement(root, "PRODUCT", {"Name": "DJ Copilot", "Version": "0.1.0"})
        collection_element = ElementTree.SubElement(
            root,
            "COLLECTION",
            {"Entries": str(len(prepared.collection))},
        )
        for track in prepared.collection:
            attributes = {"TrackID": track.external_id}
            _put_optional(attributes, "Name", track.title)
            _put_optional(attributes, "Artist", track.artist)
            _put_optional(attributes, "Album", track.album)
            _put_optional(attributes, "Genre", track.genre)
            if track.bpm_milli is not None:
                attributes["AverageBpm"] = _format_millis(track.bpm_milli)
            _put_optional(attributes, "Tonality", track.musical_key)
            if track.duration_ms is not None:
                attributes["TotalTime"] = _format_millis(track.duration_ms)
            attributes["Location"] = Path(track.path).as_uri()
            ElementTree.SubElement(collection_element, "TRACK", attributes)

        playlists_element = ElementTree.SubElement(root, "PLAYLISTS")
        root_node = ElementTree.SubElement(
            playlists_element,
            "NODE",
            {"Type": "0", "Name": "ROOT", "Count": "1"},
        )
        leaf = ElementTree.SubElement(
            root_node,
            "NODE",
            {
                "Type": "1",
                "Name": prepared.playlist_name,
                "KeyType": "0",
                "Entries": str(len(prepared.entries)),
            },
        )
        for track in prepared.entries:
            ElementTree.SubElement(leaf, "TRACK", {"Key": track.external_id})
        ElementTree.indent(root, space="  ")
        return ElementTree.tostring(
            root,
            encoding="utf-8",
            xml_declaration=True,
            short_empty_elements=True,
        ) + b"\n"
    except RekordboxExportError:
        raise
    except Exception as exc:
        raise RekordboxExportError(
            "serialization_failed",
            "The Rekordbox XML document could not be serialized.",
        ) from exc


def _put_optional(attributes: dict[str, str], key: str, value: str | None) -> None:
    if value is not None:
        attributes[key] = value


def _format_millis(value: int) -> str:
    whole, fraction = divmod(value, 1_000)
    if fraction == 0:
        return str(whole)
    return f"{whole}.{fraction:03d}".rstrip("0")


def _canonical_destination(destination: object) -> Path:
    try:
        raw_destination = os.fspath(destination)
    except TypeError as exc:
        raise RekordboxExportError(
            "invalid_destination_path",
            "The Rekordbox XML destination path is invalid.",
        ) from exc
    if not isinstance(raw_destination, str) or "\x00" in raw_destination:
        _fail("invalid_destination_path", "The Rekordbox XML destination path is invalid.")
    selected = Path(raw_destination)
    if not selected.is_absolute():
        _fail("destination_not_absolute", "The Rekordbox XML destination must be an absolute path.")
    if selected.suffix.casefold() != ".xml":
        _fail("destination_not_xml", "The Rekordbox XML destination must use the .xml extension.")
    try:
        canonical_parent = selected.parent.resolve(strict=True)
        parent_status = canonical_parent.stat()
    except (OSError, RuntimeError) as exc:
        raise RekordboxExportError(
            "destination_parent_invalid",
            "The Rekordbox XML destination directory does not exist or cannot be inspected.",
        ) from exc
    if not stat.S_ISDIR(parent_status.st_mode):
        _fail("destination_parent_invalid", "The Rekordbox XML destination parent must be a directory.")
    return canonical_parent / selected.name


def _validate_destination(
    destination: Path,
    imported_source_path: Path,
    expected_state: ExpectedDestinationState,
) -> None:
    actual_state = _destination_state(destination)
    if actual_state != expected_state:
        _fail("destination_state_changed", "The Rekordbox XML destination state changed before export.")

    source_resolved = _resolve_without_requiring_existence(imported_source_path, "invalid_import_source_path")
    if actual_state == "regular_file":
        try:
            aliases_source = os.path.samefile(destination, imported_source_path)
        except FileNotFoundError:
            aliases_source = _resolve_without_requiring_existence(
                destination,
                "destination_uninspectable",
            ) == source_resolved
        except OSError as exc:
            raise RekordboxExportError(
                "source_alias_check_failed",
                "The imported Rekordbox source alias check could not be completed.",
            ) from exc
    else:
        aliases_source = destination == source_resolved
    if aliases_source:
        _fail("source_alias", "The export destination cannot alias the imported Rekordbox XML source.")

    if _destination_state(destination) != expected_state:
        _fail("destination_state_changed", "The Rekordbox XML destination state changed before export.")


def _destination_state(destination: Path) -> ExpectedDestinationState:
    try:
        destination_status = destination.lstat()
    except FileNotFoundError:
        return "absent"
    except OSError as exc:
        raise RekordboxExportError(
            "destination_uninspectable",
            "The Rekordbox XML destination cannot be inspected.",
        ) from exc
    if stat.S_ISLNK(destination_status.st_mode):
        _fail("destination_symlink", "A Rekordbox XML destination cannot be a symbolic link.")
    if not stat.S_ISREG(destination_status.st_mode):
        _fail("destination_not_regular", "An existing Rekordbox XML destination must be a regular file.")
    return "regular_file"


def _resolve_without_requiring_existence(path: Path, code: str) -> Path:
    try:
        return path.resolve(strict=False)
    except (OSError, RuntimeError) as exc:
        raise RekordboxExportError(code, "The export path cannot be resolved safely.") from exc


def _reparse_and_compare(temporary_path: Path, prepared: _PreparedExport) -> None:
    try:
        imported = parse_rekordbox_xml(temporary_path)
    except RekordboxImportError as exc:
        raise RekordboxExportError(
            "semantic_validation_failed",
            "The serialized Rekordbox XML failed independent parser validation.",
        ) from exc
    if not _semantically_matches(imported, prepared):
        _fail("semantic_validation_failed", "The serialized Rekordbox XML does not match the export snapshot.")


def _semantically_matches(imported: RekordboxImport, prepared: _PreparedExport) -> bool:
    expected_tracks = tuple(
        (
            track.external_id,
            track.title,
            track.artist,
            track.album,
            track.genre,
            track.bpm_milli,
            track.musical_key,
            track.duration_ms,
            track.path,
            track.availability,
        )
        for track in prepared.collection
    )
    actual_tracks = tuple(
        (
            track.external_id,
            track.title,
            track.artist,
            track.album,
            track.genre,
            track.bpm_milli,
            track.musical_key,
            track.duration_ms,
            track.path,
            track.availability,
        )
        for track in imported.tracks
    )
    if actual_tracks != expected_tracks or len(imported.playlists) != 2:
        return False
    root, leaf = imported.playlists
    return (
        root.import_key == "0"
        and root.parent_import_key is None
        and root.name == "ROOT"
        and root.kind == "folder"
        and root.order == 0
        and root.track_external_ids == ()
        and leaf.import_key == "0/0"
        and leaf.parent_import_key == "0"
        and leaf.name == prepared.playlist_name
        and leaf.kind == "playlist"
        and leaf.order == 0
        and leaf.track_external_ids == tuple(track.external_id for track in prepared.entries)
    )
