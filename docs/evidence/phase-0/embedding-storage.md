# Phase 0 Portable Embedding Storage Evidence

Date: 2026-08-09
Task: ADR-0006 bounded decision evidence
Disposition: **accepted bounded architecture evidence; local implementation reviewed**

## Boundary

The standard-library spike at `spikes/embedding_storage/` stores only generated
normalized vectors in a temporary or in-memory app-owned SQLite database. It
does not load audio, models, user files, third-party vector extensions, or a
network service. No embedding provider or model asset is approved by this work.

## Contract exercised

- Portable bytes are exactly little-endian IEEE-754 float32.
- Each row carries model, version, dimensions, dtype, endianness, L2
  normalization/tolerance, vector bytes, and creation time.
- Both encode and decode reject zero, non-finite, non-normalized, mismatched, or
  malformed vectors before search.
- Search uses exact model/version/dimension filtering, true cosine calculated
  from observed norms, a 1–100 result cap, bounded retained top-k state, and
  deterministic track-ID tie ordering.
- A version-1 STRICT SQLite schema is installed transactionally, rejects unknown
  or weaker pre-existing schemas, rolls back failed DDL without claiming a
  version, and preserves exact vector metadata/bytes/version through backup.

## Deterministic result

```text
python3 -B -W error::ResourceWarning -m unittest discover -s spikes/embedding_storage/tests -v
13 tests, 13 passed, 0 failed (primary final run; independent reviewer reproduced)
```

The command ran twice after correction on the recorded Phase 0 host (macOS
arm64, Python 3.14.3, SQLite 3.50.4): once by the primary and once by the fresh
read-only reviewer. The reviewer reported PASS with no remaining high/medium.

The first review had found two medium counterexamples: accepted approximate-unit
vectors were scored by raw dot product, producing scores above 1 and wrong
ordering, and `CREATE TABLE IF NOT EXISTS` silently accepted a weaker existing
schema. Both were reproduced as failing tests. The correction computes true
cosine with stable summation/observed norms, decouples tiny score canonicalization
from normalization tolerance, validates exact schema/version, rolls back failed
fresh DDL, and streams candidates while retaining only bounded top-k state.

## Capacity estimate and non-claims

For 10,000 tracks at an illustrative 512 dimensions, raw vector payload is
20,480,000 bytes (19.53125 MiB). This arithmetic is not a product benchmark and
excludes SQLite overhead, indexes, row metadata, process memory, query buffers,
and model/runtime cost. Phase 4 must measure a synthetic 10,000-track database
before deciding whether brute-force cosine meets latency/memory targets or an
ANN backend is justified.
