# Portable embedding-storage feasibility spike

This Phase 0 spike tests only the portable storage/search contract proposed by
ADR-0006. It uses the Python standard library and synthetic vectors; it does not
select an embedding model, implement production migrations, run an ANN backend,
or claim a 10,000-track latency benchmark.

## Reproduce

```sh
python3 -B -W error::ResourceWarning -m unittest discover -s spikes/embedding_storage/tests -v
```

The thirteen tests cover:

- exact little-endian float32 bytes with model, version, dimensions,
  normalization method/tolerance, and timestamp metadata;
- rejection of empty, zero, non-finite, non-normalized, malformed-length,
  dtype, endianness, dimension, and normalization mismatches;
- hand-derived cosine values with deterministic track-ID tie ordering;
- exact model/version/dimension filtering so stale embeddings are not mixed;
- bounded result limits and validated fixture track IDs;
- exact schema version/STRICT constraints, incompatible-schema rejection,
  transactional failed-migration rollback, and backup/restore preservation; and
- overflow-safe vector-payload estimates.

The 10,000 × 512 estimate is 20,480,000 bytes (19.53125 MiB) for vector bytes
alone. It excludes SQLite pages, indexes, row metadata, process memory, query
buffers, and model/runtime cost. The dimension is illustrative because Phase 0
approved no embedding model.

## Limits

This proof uses a tiny synthetic set and scalar Python cosine. Phase 4 still owns
the fixed-seed 10,000-track latency/memory benchmark, representative filtering,
and any evidence-based ANN decision. Phase 1/4 own the production schema and
migration integration; Phase 9 owns clean-package backup/resource verification.
