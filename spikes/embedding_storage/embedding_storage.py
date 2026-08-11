from __future__ import annotations

import math
import re
import sqlite3
import struct
import time
from dataclasses import dataclass, field
from typing import Protocol, Sequence


DTYPE = "float32"
ENDIANNESS = "little"
NORMALIZATION = "l2"
MAX_DIMENSIONS = 8_192
MAX_RESULTS = 100
MAX_ESTIMATE_BYTES = (1 << 63) - 1
SCHEMA_VERSION = 1
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")

TABLE_SQL = """
CREATE TABLE track_embeddings (
    track_id TEXT NOT NULL,
    model TEXT NOT NULL,
    version TEXT NOT NULL,
    dimensions INTEGER NOT NULL CHECK (dimensions BETWEEN 1 AND 8192),
    dtype TEXT NOT NULL CHECK (dtype = 'float32'),
    endianness TEXT NOT NULL CHECK (endianness = 'little'),
    normalization TEXT NOT NULL CHECK (normalization = 'l2'),
    tolerance REAL NOT NULL CHECK (tolerance > 0 AND tolerance <= 0.1),
    vector_bytes BLOB NOT NULL CHECK (length(vector_bytes) = dimensions * 4),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    PRIMARY KEY (track_id, model, version)
) STRICT
""".strip()

INDEX_SQL = """
CREATE INDEX track_embeddings_lookup
ON track_embeddings(model, version, dimensions)
""".strip()


@dataclass(frozen=True)
class StoredVector:
    model: str
    version: str
    dimensions: int
    dtype: str
    endianness: str
    normalization: str
    tolerance: float
    vector_bytes: bytes
    created_at_ms: int = field(default_factory=lambda: time.time_ns() // 1_000_000)


class EmbeddingIndex(Protocol):
    def put(self, track_id: str, vector: StoredVector) -> None: ...

    def search(self, query: StoredVector, *, limit: int = 10) -> list[tuple[str, float]]: ...


def encode_normalized_vector(
    values: Sequence[float],
    *,
    model: str,
    version: str,
    tolerance: float = 1e-5,
) -> StoredVector:
    _validate_identifier(model, "model")
    _validate_identifier(version, "version")
    if not isinstance(tolerance, (int, float)) or isinstance(tolerance, bool):
        raise ValueError("invalid normalized vector")
    tolerance = float(tolerance)
    if not math.isfinite(tolerance) or tolerance <= 0 or tolerance > 0.1:
        raise ValueError("invalid normalized vector")
    if isinstance(values, (str, bytes, bytearray)) or not 1 <= len(values) <= MAX_DIMENSIONS:
        raise ValueError("invalid normalized vector")
    try:
        vector = tuple(float(value) for value in values)
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError("invalid normalized vector") from error
    if any(isinstance(value, bool) for value in values):
        raise ValueError("invalid normalized vector")
    _validate_normalized(vector, tolerance, "invalid normalized vector")
    try:
        vector_bytes = struct.pack(f"<{len(vector)}f", *vector)
    except (OverflowError, struct.error) as error:
        raise ValueError("invalid normalized vector") from error
    encoded = struct.unpack(f"<{len(vector)}f", vector_bytes)
    _validate_normalized(encoded, tolerance, "invalid normalized vector")
    return StoredVector(
        model=model,
        version=version,
        dimensions=len(vector),
        dtype=DTYPE,
        endianness=ENDIANNESS,
        normalization=NORMALIZATION,
        tolerance=tolerance,
        vector_bytes=vector_bytes,
    )


def decode_vector(stored: StoredVector) -> tuple[float, ...]:
    try:
        _validate_identifier(stored.model, "model")
        _validate_identifier(stored.version, "version")
        valid_contract = (
            isinstance(stored.dimensions, int)
            and not isinstance(stored.dimensions, bool)
            and 1 <= stored.dimensions <= MAX_DIMENSIONS
            and stored.dtype == DTYPE
            and stored.endianness == ENDIANNESS
            and stored.normalization == NORMALIZATION
            and isinstance(stored.tolerance, (int, float))
            and not isinstance(stored.tolerance, bool)
            and math.isfinite(float(stored.tolerance))
            and 0 < float(stored.tolerance) <= 0.1
            and isinstance(stored.vector_bytes, bytes)
            and len(stored.vector_bytes) == stored.dimensions * 4
            and isinstance(stored.created_at_ms, int)
            and not isinstance(stored.created_at_ms, bool)
            and stored.created_at_ms >= 0
        )
        if not valid_contract:
            raise ValueError
        vector = struct.unpack(f"<{stored.dimensions}f", stored.vector_bytes)
        _validate_normalized(vector, float(stored.tolerance), "invalid stored vector")
        return vector
    except (AttributeError, TypeError, ValueError, struct.error) as error:
        if isinstance(error, ValueError) and str(error) == "invalid stored vector":
            raise
        raise ValueError("invalid stored vector") from error


class SQLiteEmbeddingIndex:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._connection = connection

    def migrate(self) -> None:
        table_exists = self._connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'track_embeddings'"
        ).fetchone() is not None
        version = self._connection.execute("PRAGMA user_version").fetchone()[0]
        if table_exists:
            if version != SCHEMA_VERSION or not self._schema_matches():
                raise RuntimeError("unsupported embedding schema")
            return
        if version != 0:
            raise RuntimeError("unsupported embedding schema")
        if self._connection.in_transaction:
            raise RuntimeError("unsupported embedding schema")
        try:
            self._connection.execute("BEGIN IMMEDIATE")
            self._connection.execute(TABLE_SQL)
            self._connection.execute(INDEX_SQL)
            self._connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
            if not self._schema_matches():
                raise RuntimeError("unsupported embedding schema")
            self._connection.commit()
        except sqlite3.DatabaseError as error:
            self._connection.rollback()
            raise RuntimeError("unsupported embedding schema") from error
        except Exception:
            self._connection.rollback()
            raise

    def _schema_matches(self) -> bool:
        table_row = self._connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'track_embeddings'"
        ).fetchone()
        index_row = self._connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'track_embeddings_lookup'"
        ).fetchone()
        strict_row = self._connection.execute(
            "SELECT strict FROM pragma_table_list WHERE schema = 'main' AND name = 'track_embeddings'"
        ).fetchone()
        return (
            table_row is not None
            and index_row is not None
            and strict_row == (1,)
            and _normalized_sql(table_row[0]) == _normalized_sql(TABLE_SQL)
            and _normalized_sql(index_row[0]) == _normalized_sql(INDEX_SQL)
        )

    def put(self, track_id: str, vector: StoredVector) -> None:
        _validate_identifier(track_id, "track ID")
        decode_vector(vector)
        with self._connection:
            self._connection.execute(
                """
                INSERT INTO track_embeddings (
                    track_id, model, version, dimensions, dtype, endianness,
                    normalization, tolerance, vector_bytes, created_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(track_id, model, version) DO UPDATE SET
                    dimensions = excluded.dimensions,
                    dtype = excluded.dtype,
                    endianness = excluded.endianness,
                    normalization = excluded.normalization,
                    tolerance = excluded.tolerance,
                    vector_bytes = excluded.vector_bytes,
                    created_at_ms = excluded.created_at_ms
                """,
                (
                    track_id,
                    vector.model,
                    vector.version,
                    vector.dimensions,
                    vector.dtype,
                    vector.endianness,
                    vector.normalization,
                    vector.tolerance,
                    vector.vector_bytes,
                    vector.created_at_ms,
                ),
            )

    def search(self, query: StoredVector, *, limit: int = 10) -> list[tuple[str, float]]:
        query_values = decode_vector(query)
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_RESULTS:
            raise ValueError("invalid result limit")
        rows = self._connection.execute(
            """
            SELECT track_id, model, version, dimensions, dtype, endianness,
                   normalization, tolerance, vector_bytes, created_at_ms
            FROM track_embeddings
            WHERE model = ? AND version = ? AND dimensions = ?
              AND dtype = ? AND endianness = ? AND normalization = ?
            """,
            (
                query.model,
                query.version,
                query.dimensions,
                DTYPE,
                ENDIANNESS,
                NORMALIZATION,
            ),
        )
        scored: list[tuple[str, float]] = []
        for row in rows:
            candidate = StoredVector(
                model=row[1],
                version=row[2],
                dimensions=row[3],
                dtype=row[4],
                endianness=row[5],
                normalization=row[6],
                tolerance=row[7],
                vector_bytes=row[8],
                created_at_ms=row[9],
            )
            candidate_values = decode_vector(candidate)
            score = _cosine(query_values, candidate_values)
            scored.append((row[0], score))
            scored.sort(key=lambda item: (-item[1], item[0]))
            if len(scored) > limit:
                scored.pop()
        return scored


def estimate_storage_bytes(*, track_count: int, dimensions: int) -> int:
    if (
        not isinstance(track_count, int)
        or isinstance(track_count, bool)
        or track_count < 0
        or not isinstance(dimensions, int)
        or isinstance(dimensions, bool)
        or not 1 <= dimensions <= MAX_DIMENSIONS
    ):
        raise ValueError("invalid storage estimate")
    size = track_count * dimensions * 4
    if size > MAX_ESTIMATE_BYTES:
        raise ValueError("invalid storage estimate")
    return size


def _validate_identifier(value: object, label: str) -> None:
    if not isinstance(value, str) or IDENTIFIER.fullmatch(value) is None:
        raise ValueError(f"invalid {label}")


def _validate_normalized(values: Sequence[float], tolerance: float, message: str) -> None:
    if not values or any(not math.isfinite(value) for value in values):
        raise ValueError(message)
    norm = math.sqrt(sum(value * value for value in values))
    if norm == 0 or abs(norm - 1.0) > tolerance:
        raise ValueError(message)


def _cosine(left: Sequence[float], right: Sequence[float]) -> float:
    dot = math.fsum(first * second for first, second in zip(left, right, strict=True))
    left_norm = math.sqrt(math.fsum(value * value for value in left))
    right_norm = math.sqrt(math.fsum(value * value for value in right))
    score = dot / (left_norm * right_norm)
    score = min(1.0, max(-1.0, score))
    if abs(score) <= 1e-15:
        return 0.0
    if abs(score - 1.0) <= 1e-12:
        return 1.0
    if abs(score + 1.0) <= 1e-12:
        return -1.0
    return score


def _normalized_sql(value: str) -> str:
    return " ".join(value.split())
