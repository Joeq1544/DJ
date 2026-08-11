from __future__ import annotations

import math
import sqlite3
import struct
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path


SPIKE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SPIKE_ROOT))

from embedding_storage import (  # noqa: E402
    SQLiteEmbeddingIndex,
    StoredVector,
    decode_vector,
    encode_normalized_vector,
    estimate_storage_bytes,
)


class PortableVectorContractTests(unittest.TestCase):
    def test_encodes_exact_little_endian_float32_contract(self) -> None:
        stored = encode_normalized_vector(
            [0.6, 0.8], model="fixture-model", version="v1", tolerance=1e-5
        )

        self.assertEqual(struct.pack("<ff", 0.6, 0.8), stored.vector_bytes)
        self.assertEqual(2, stored.dimensions)
        self.assertEqual("float32", stored.dtype)
        self.assertEqual("little", stored.endianness)
        self.assertEqual("l2", stored.normalization)
        self.assertEqual((struct.unpack("<f", struct.pack("<f", 0.6))[0], struct.unpack("<f", struct.pack("<f", 0.8))[0]), decode_vector(stored))

    def test_rejects_zero_nonfinite_or_not_normalized_vectors(self) -> None:
        invalid_vectors = (
            [0.0, 0.0],
            [math.nan, 1.0],
            [math.inf, 1.0],
            [1.0, 1.0],
            [],
        )

        for vector in invalid_vectors:
            with self.subTest(vector=vector):
                with self.assertRaisesRegex(ValueError, "invalid normalized vector"):
                    encode_normalized_vector(vector, model="fixture-model", version="v1")

    def test_decode_rejects_dimension_dtype_endianness_and_byte_mismatch(self) -> None:
        valid = encode_normalized_vector([1.0, 0.0], model="fixture-model", version="v1")
        invalid = (
            replace(valid, dimensions=3),
            replace(valid, dtype="float64"),
            replace(valid, endianness="big"),
            replace(valid, normalization="none"),
            replace(valid, vector_bytes=valid.vector_bytes[:-1]),
        )

        for stored in invalid:
            with self.subTest(stored=stored):
                with self.assertRaisesRegex(ValueError, "invalid stored vector"):
                    decode_vector(stored)

    def test_decode_revalidates_finite_values_and_normalization(self) -> None:
        base = StoredVector(
            model="fixture-model",
            version="v1",
            dimensions=2,
            dtype="float32",
            endianness="little",
            normalization="l2",
            tolerance=1e-5,
            vector_bytes=struct.pack("<ff", math.nan, 1.0),
        )
        with self.assertRaisesRegex(ValueError, "invalid stored vector"):
            decode_vector(base)

        with self.assertRaisesRegex(ValueError, "invalid stored vector"):
            decode_vector(replace(base, vector_bytes=struct.pack("<ff", 0.5, 0.5)))


class SQLiteEmbeddingIndexTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        self.index = SQLiteEmbeddingIndex(self.connection)
        self.index.migrate()

    def tearDown(self) -> None:
        self.connection.close()

    def test_fresh_migration_records_exact_version_and_strict_table(self) -> None:
        self.assertEqual(1, self.connection.execute("PRAGMA user_version").fetchone()[0])
        strict = self.connection.execute(
            "SELECT strict FROM pragma_table_list WHERE name = 'track_embeddings'"
        ).fetchone()
        self.assertEqual((1,), strict)

    def test_hand_derived_cosine_and_deterministic_tie_order(self) -> None:
        vectors = {
            "track-opposite": [-1.0, 0.0],
            "track-orthogonal-b": [0.0, 1.0],
            "track-match": [1.0, 0.0],
            "track-orthogonal-a": [0.0, 1.0],
        }
        for track_id, vector in vectors.items():
            self.index.put(track_id, encode_normalized_vector(vector, model="fixture-model", version="v1"))

        results = self.index.search(
            encode_normalized_vector([1.0, 0.0], model="fixture-model", version="v1"),
            limit=4,
        )

        self.assertEqual(
            [
                ("track-match", 1.0),
                ("track-orthogonal-a", 0.0),
                ("track-orthogonal-b", 0.0),
                ("track-opposite", -1.0),
            ],
            results,
        )

    def test_cosine_divides_by_observed_norms_within_declared_tolerance(self) -> None:
        query = encode_normalized_vector(
            [1.09, 0.0], model="fixture-model", version="v1", tolerance=0.1
        )
        half_norm = 0.91
        higher_cosine = [half_norm * 0.5, half_norm * math.sqrt(1.0 - 0.5**2)]
        lower_cosine = [0.48, math.sqrt(1.0 - 0.48**2)]
        self.index.put(
            "higher-true-cosine",
            encode_normalized_vector(
                higher_cosine, model="fixture-model", version="v1", tolerance=0.1
            ),
        )
        self.index.put(
            "lower-true-cosine",
            encode_normalized_vector(lower_cosine, model="fixture-model", version="v1"),
        )
        self.index.put("self", query)

        results = self.index.search(query, limit=3)

        self.assertEqual("self", results[0][0])
        self.assertAlmostEqual(1.0, results[0][1], places=7)
        self.assertEqual("higher-true-cosine", results[1][0])
        self.assertAlmostEqual(0.5, results[1][1], places=6)
        self.assertEqual("lower-true-cosine", results[2][0])
        self.assertAlmostEqual(0.48, results[2][1], places=6)
        self.assertTrue(all(-1.0 <= score <= 1.0 for _, score in results))

    def test_search_filters_stale_model_version_and_dimension(self) -> None:
        self.index.put("current", encode_normalized_vector([1.0, 0.0], model="fixture-model", version="v2"))
        self.index.put("old-version", encode_normalized_vector([1.0, 0.0], model="fixture-model", version="v1"))
        self.index.put("other-model", encode_normalized_vector([1.0, 0.0], model="other-model", version="v2"))
        self.index.put("other-dimensions", encode_normalized_vector([1.0, 0.0, 0.0], model="fixture-model", version="v2"))

        results = self.index.search(
            encode_normalized_vector([1.0, 0.0], model="fixture-model", version="v2")
        )

        self.assertEqual([("current", 1.0)], results)

    def test_put_rejects_invalid_track_ids_and_limit_is_bounded(self) -> None:
        vector = encode_normalized_vector([1.0, 0.0], model="fixture-model", version="v1")
        for track_id in ("", " track", "x" * 129):
            with self.subTest(track_id=track_id):
                with self.assertRaises(ValueError):
                    self.index.put(track_id, vector)
        for limit in (0, -1, 101):
            with self.subTest(limit=limit):
                with self.assertRaises(ValueError):
                    self.index.search(vector, limit=limit)

    def test_sqlite_backup_preserves_vector_and_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            source_path = Path(temporary_directory) / "source.sqlite3"
            backup_path = Path(temporary_directory) / "backup.sqlite3"
            source = sqlite3.connect(source_path)
            try:
                index = SQLiteEmbeddingIndex(source)
                index.migrate()
                index.put(
                    "track-1",
                    encode_normalized_vector([0.6, 0.8], model="fixture-model", version="v1"),
                )
                source_row = source.execute(
                    "SELECT * FROM track_embeddings WHERE track_id = 'track-1'"
                ).fetchone()
                destination = sqlite3.connect(backup_path)
                try:
                    source.backup(destination)
                finally:
                    destination.close()
            finally:
                source.close()

            restored = sqlite3.connect(backup_path)
            try:
                restored_row = restored.execute(
                    "SELECT * FROM track_embeddings WHERE track_id = 'track-1'"
                ).fetchone()
                restored_version = restored.execute("PRAGMA user_version").fetchone()[0]
                results = SQLiteEmbeddingIndex(restored).search(
                    encode_normalized_vector([0.6, 0.8], model="fixture-model", version="v1")
                )
            finally:
                restored.close()

        self.assertEqual([("track-1", 1.0)], results)
        self.assertEqual(source_row, restored_row)
        self.assertEqual(1, restored_version)

    def test_migration_rejects_a_preexisting_weaker_schema(self) -> None:
        connection = sqlite3.connect(":memory:")
        try:
            connection.execute(
                """
                CREATE TABLE track_embeddings (
                    track_id TEXT,
                    model TEXT,
                    version TEXT,
                    dimensions INTEGER,
                    dtype TEXT,
                    endianness TEXT,
                    normalization TEXT,
                    tolerance REAL,
                    vector_bytes BLOB,
                    created_at_ms INTEGER
                )
                """
            )

            with self.assertRaisesRegex(RuntimeError, "unsupported embedding schema"):
                SQLiteEmbeddingIndex(connection).migrate()
        finally:
            connection.close()

    def test_failed_fresh_migration_rolls_back_without_claiming_a_version(self) -> None:
        connection = sqlite3.connect(":memory:")
        try:
            connection.execute("CREATE TABLE conflicting_index_owner (value TEXT)")
            connection.execute(
                "CREATE INDEX track_embeddings_lookup ON conflicting_index_owner(value)"
            )
            connection.commit()

            with self.assertRaisesRegex(RuntimeError, "unsupported embedding schema"):
                SQLiteEmbeddingIndex(connection).migrate()

            table = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'track_embeddings'"
            ).fetchone()
            self.assertIsNone(table)
            self.assertEqual(0, connection.execute("PRAGMA user_version").fetchone()[0])
        finally:
            connection.close()

    def test_storage_estimate_is_vectors_only_and_overflow_safe(self) -> None:
        self.assertEqual(20_480_000, estimate_storage_bytes(track_count=10_000, dimensions=512))
        for track_count, dimensions in ((-1, 512), (10_000, 0), (10**20, 10**20)):
            with self.subTest(track_count=track_count, dimensions=dimensions):
                with self.assertRaises(ValueError):
                    estimate_storage_bytes(track_count=track_count, dimensions=dimensions)


if __name__ == "__main__":
    unittest.main()
