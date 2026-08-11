"""Safe, standard-library-only parser for the Phase 0 synthetic XML fixture."""

from dataclasses import dataclass
import hashlib
from pathlib import Path
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET


class RekordboxXMLError(ValueError):
    """A source XML document violates this spike's bounded input contract."""


@dataclass(frozen=True)
class ParseLimits:
    max_bytes: int = 1_000_000
    max_nodes: int = 10_000
    max_text: int = 1_000_000
    max_depth: int = 64
    max_tracks: int = 5_000
    max_playlists: int = 1_000


class RekordboxXMLParser:
    def __init__(self, *, allowed_root=None, limits=None):
        self.allowed_root = Path(allowed_root).resolve() if allowed_root else None
        self.limits = limits or ParseLimits()

    def parse(self, source):
        """Return deterministic JSON-compatible data without mutating ``source``.

        The returned dict/list values remain ordinary mutable Python values; the
        immutability guarantee is source preservation plus canonical serializability.
        """
        source = Path(source)
        raw = source.read_bytes()
        if len(raw) > self.limits.max_bytes:
            raise RekordboxXMLError("byte limit exceeded")
        text = self._decode_utf8_xml(raw)
        if self._has_prohibited_declaration(text):
            raise RekordboxXMLError("DTD or ENTITY is not allowed")
        try:
            root = ET.fromstring(text)
        except ET.ParseError as exc:
            raise RekordboxXMLError("malformed XML") from exc
        self._check_structure(root)
        if root.tag != "DJ_PLAYLISTS":
            raise RekordboxXMLError("unsupported root")
        if root.get("Version") != "1.0.0":
            raise RekordboxXMLError("unsupported version")
        collection = root.find("COLLECTION")
        if collection is None:
            raise RekordboxXMLError("missing collection")
        tracks = self._parse_tracks(collection)
        memberships = self._parse_playlists(root.find("PLAYLISTS"), tracks)
        records = []
        for track_id, track in tracks.items():
            records.append({
                "external_id": track_id,
                "path": track["path"],
                "available": Path(track["path"]).exists(),
                "playlists": memberships.get(track_id, []),
            })
        return {"source_sha256": hashlib.sha256(raw).hexdigest(), "tracks": records}

    @staticmethod
    def _decode_utf8_xml(raw):
        """Accept only UTF-8 (with an optional UTF-8 BOM) before XML parsing."""
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise RekordboxXMLError("unsupported encoding") from exc
        if "\x00" in text:
            raise RekordboxXMLError("unsupported encoding")
        return text

    @staticmethod
    def _has_prohibited_declaration(text):
        upper = text.upper()
        return "<!DOCTYPE" in upper or "<!ENTITY" in upper

    def _check_structure(self, root):
        nodes = 0
        text_size = 0
        stack = [(root, 0)]
        while stack:
            element, depth = stack.pop()
            nodes += 1
            if nodes > self.limits.max_nodes:
                raise RekordboxXMLError("node limit exceeded")
            if depth > self.limits.max_depth:
                raise RekordboxXMLError("depth limit exceeded")
            text_size += len(element.text or "") + len(element.tail or "")
            text_size += sum(len(value) for value in element.attrib.values())
            if text_size > self.limits.max_text:
                raise RekordboxXMLError("text limit exceeded")
            stack.extend((child, depth + 1) for child in element)

    def _parse_tracks(self, collection):
        track_elements = collection.findall("TRACK")
        self._declared_count(collection, "Entries", len(track_elements), "collection")
        if len(track_elements) > self.limits.max_tracks:
            raise RekordboxXMLError("track limit exceeded")
        tracks = {}
        for element in track_elements:
            track_id = element.get("TrackID")
            if not track_id:
                raise RekordboxXMLError("missing track ID")
            if track_id in tracks:
                raise RekordboxXMLError("duplicate track ID")
            tracks[track_id] = {"path": self._location_to_path(element.get("Location"))}
        return tracks

    def _parse_playlists(self, playlists, tracks):
        memberships = {}
        if playlists is None:
            return memberships
        playlist_nodes = sum(1 for node in playlists.iter("NODE") if node.get("Type") == "1")
        if playlist_nodes > self.limits.max_playlists:
            raise RekordboxXMLError("playlist limit exceeded")
        nodes = playlists.findall("NODE")
        for node in nodes:
            self._walk_node(node, [], tracks, memberships)
        return memberships

    def _walk_node(self, node, parents, tracks, memberships):
        name = node.get("Name", "")
        path = parents + [name]
        node_type = node.get("Type")
        child_nodes = node.findall("NODE")
        if node_type == "0":
            self._declared_count(node, "Count", len(child_nodes), "folder")
            for child in child_nodes:
                self._walk_node(child, path, tracks, memberships)
            return
        if node_type != "1":
            raise RekordboxXMLError("unsupported playlist node")
        refs = node.findall("TRACK")
        self._declared_count(node, "Entries", len(refs), "playlist")
        for order, ref in enumerate(refs):
            key_type = ref.get("KeyType")
            key = ref.get("Key")
            if key_type == "TrackID":
                track_id = key
            elif key_type == "Location":
                normalized = self._location_to_path(key)
                track_id = next((item_id for item_id, item in tracks.items() if item["path"] == normalized), None)
            else:
                raise RekordboxXMLError("unsupported playlist key")
            if track_id not in tracks:
                raise RekordboxXMLError("unresolved playlist key")
            memberships.setdefault(track_id, []).append({"path": path, "order": order})

    @staticmethod
    def _declared_count(element, attribute, actual, label):
        try:
            declared = int(element.get(attribute, ""))
        except ValueError as exc:
            raise RekordboxXMLError(f"invalid declared {label} count") from exc
        if declared != actual:
            raise RekordboxXMLError(f"declared {label} count mismatch")

    def _location_to_path(self, location):
        if not location:
            raise RekordboxXMLError("missing location")
        parts = urlsplit(location)
        if parts.scheme != "file" or parts.netloc not in ("", "localhost"):
            raise RekordboxXMLError("non-local file location")
        path = unquote(parts.path)
        if "\x00" in path:
            raise RekordboxXMLError("NUL in path")
        candidate = Path(path)
        if not candidate.is_absolute():
            raise RekordboxXMLError("path escape")
        if self.allowed_root:
            if ".." in candidate.parts:
                raise RekordboxXMLError("path escape")
            resolved = candidate.resolve(strict=False)
            try:
                resolved.relative_to(self.allowed_root)
            except ValueError as exc:
                if any(parent.is_symlink() for parent in candidate.parents):
                    raise RekordboxXMLError("symlink escape") from exc
                raise RekordboxXMLError("path escape") from exc
        return str(candidate)
