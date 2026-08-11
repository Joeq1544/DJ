# ADR-0006: Embedding Storage and Search

- Status: Accepted
- Date: 2026-08-09
- Owners: primary, architect, ranking specialist

## Context

Similarity search must work locally for an MVP-scale library, remain packageable on macOS, preserve model provenance, and avoid a fragile native/vector-database dependency without benchmark need.

## Decision

Store little-endian float32 normalized versioned vectors as bytes in app-owned SQLite with model, version, exact dimensions, dtype/endianness, normalization method/tolerance, and timestamp. Reject dimension mismatch and NaN/Inf; validate L2 norm within the recorded tolerance before search. Use vectorized/brute-force cosine search in Python behind an `EmbeddingIndex` interface. Apply structured filters in the worker. Add ANN only after a documented 10,000-track benchmark shows a user-visible need and the backend passes packaging/license review.

## Alternatives

- Dedicated vector database: operational and packaging cost is unjustified for the initial local scale.
- SQLite vector/native extension: potentially useful later, but requires arm64 packaging and migration evidence.
- Metadata/features only: required fallback when no approved embedding provider exists.

## Phase 0 decision evidence

Define the portable binary contract and test hand-derived cosine cases, zero vector, dimension/dtype/endianness mismatch, NaN/Inf, normalization tolerance, stale-model invalidation, and SQLite migration/backup implications on a small synthetic set. Estimate representative storage from researched model dimensions without claiming a product benchmark.

The independently reviewed standard-library spike in
`../../spikes/embedding_storage/` passes 13 warning-strict tests. It proves exact
little-endian float32 bytes and metadata, encode/decode revalidation, zero/non-
finite/mismatch rejection, true cosine with approximate-unit tolerance and
bounded scores, deterministic ties, exact model/version/dimension filtering, a
bounded retained result set, version-1 STRICT SQLite schema validation, weaker-
schema rejection, transactional failed-DDL rollback, and exact backup/restore.
The first review's raw-dot-product and weak-existing-schema counterexamples were
both reproduced before correction; the fresh re-review found no remaining
high/medium. See `../evidence/phase-0/embedding-storage.md`.

The arithmetic 10,000 × 512 estimate is 20,480,000 raw vector bytes only. It is
not a latency/memory/product benchmark and does not approve a 512-dimensional
model. No embedding model is approved for the default build; metadata/basic-
feature similarity remains the fallback.

## Personal-MVP implementation amendment (M3)

The approved personal MVP does not yet have an embedding producer or model. M3 therefore uses the required metadata/basic-feature fallback directly from the schema-v2 library and successful local analysis rows. Search is bounded casefolded token matching and similarity/ranking is deterministic brute-force Python under `feature-similarity-v1` and `transition-v1`. This adds no vector rows, schema migration, native extension, or model dependency.

A synthetic 10,000-track benchmark is no longer a mandatory milestone gate. Representative use on Joe's library decides whether ordinary bounded search is perceptibly slow; only measured need reopens an embedding-model, vector-storage, or ANN decision. The Phase 0 portable format remains valid evidence for that future option, not an instruction to add unused infrastructure now.

M3 implementation evidence is green at `5a5d59d`, `bb85aaa`, and reviewed closure `1e9d347`: 17 pure ranking tests cover exact integer formulas, half/double tempo, key compatibility, all eight intents, mixed evidence, missing components, stable ties, and bounds; eight repository/service tests cover the single schema-v2 projection, repeated playlist positions, and strict path-free responses; the generated Electron flow exercises playlist-aware filters, Similar, `genre_shift`, explanations, reload, and source immutability. The independent M3 reviewer returned READY after the correction. No embedding table, model, vector dependency, or schema-v3 migration was added.

## Later implementation verification

If a later approved embedding provider is introduced, that slice records the model/license/provenance choice, production migration and backup, representative latency/memory, stale-model behavior, and packaging evidence. M7 verifies the migrations and packaging that actually exist in the personal build.

## Consequences

Provider changes create new versioned rows rather than ambiguous in-place vectors. The portable interface allows future ANN adoption without leaking index details into search/UI contracts.
