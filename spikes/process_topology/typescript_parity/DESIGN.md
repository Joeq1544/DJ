# TypeScript/Python core-protocol parity spike

## Scope

This Phase 0 spike compares a dependency-free TypeScript implementation with
the existing `spikes.process_topology.protocol` Python module. It is evidence
for the Electron-main/Python-core boundary, not a production protocol package.

## Design

- `src/protocol.ts` independently implements canonical bytes/hashing, strict
  decoding, four-byte big-endian framing, streaming frame assembly, and the
  handshake/request validators.
- `oracle.py` is test-only. It imports the existing Python protocol and exposes
  a line-delimited local subprocess oracle. The TypeScript tests compare real
  bytes, hashes, decoded error codes, and validation results with that oracle.
- TypeScript uses `bigint` for decoded integers outside JavaScript's safe range,
  so every signed-64 integer remains exact. Unsafe `number` inputs fail closed.
- Object keys use Unicode code-point ordering rather than JavaScript's default
  UTF-16-code-unit ordering.
- Finite JSON floats fail closed in both codecs with
  `float_contract_unsupported`. This avoids CPython/ECMAScript differences in
  integer/float kinds, negative zero, and exponent formatting. Time values cross
  the wire as bounded integer milliseconds (`delay_ms` and `ttl_ms`).
- Fractional domain DTOs use schema-named scaled integers (`bpm_milli`, unit
  `*_ppm`, signed penalty `*_signed_ppm`, and `*_ms`) with exact-decimal
  round-half-even quantization and reject-not-saturate bounds. Embeddings remain
  typed byte blobs.

## Corrected interoperability hazards

1. Both implementations reject every finite JSON float with the same stable
   error code and message; nonfinite numbers remain `invalid_json_constant`.
2. Both handshake validators reject JSON `true` as a protocol version with
   `version_mismatch` and require the integer value `1`.
3. Signed-64 values are parsed lexically; TypeScript returns `bigint` outside
   JavaScript's safe-integer range and refuses imprecise direct `number` input.
4. TypeScript rejects oversized sparse arrays before construction and rejects
   holes/accessors through indexed own data descriptors without invoking them.

Differential tests exercise each correction against the real Python module.

## Stop conditions

The spike is complete when focused tests and strict TypeScript checking pass and
all requested integer-only/framing/schema cases are physically compared with
the Python oracle. Any future incompatibility must remain visible rather than
being normalized away in the test harness.
