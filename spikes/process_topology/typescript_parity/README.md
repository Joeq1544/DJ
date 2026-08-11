# TypeScript/Python private core-protocol parity spike

This bounded Phase 0 spike independently implements the current integer-only
wire contract from `spikes/process_topology/protocol.py` in TypeScript and
compares it against that exact Python module through a local test-only oracle.

## Run

From this directory:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
```

The tests use only local subprocesses and generated fixtures. They make no
network calls and read no audio, credentials, Rekordbox data, or user library.
Runtime code uses only Node built-ins. Development dependencies are exactly
locked to TypeScript 6.0.2, `@types/node` 25.0.3, and its transitive
`undici-types` 7.16.0.

## What the spike proves

For the exercised integer-only fixtures, TypeScript and Python produce the same
canonical UTF-8 bytes, SHA-256 digest, four-byte big-endian frames, split and
coalesced decoding, size-limit errors, hostile-input error codes, handshake and
request validation results, role/capability bounds, finite-float rejection, and
representative progress and terminal envelopes. Signed-64 wire integers remain
exact by decoding unsafe values to TypeScript `bigint`. Unicode object keys sort
by code point as Python does, rather than by JavaScript's default UTF-16
code-unit order.

## Corrected hazards

- Both codecs reject finite float spellings—including `1.0`, `-0.0`, and
  exponent forms—with identical `float_contract_unsupported` code/message.
- Both handshake validators reject boolean protocol versions with identical
  `version_mismatch` code/message.
- Representative `delayed_result` and `create_proposal` requests use integer
  `delay_ms` and `ttl_ms` values and match Python canonical/frame bytes.
- Direct unsafe JavaScript integral `number` input still fails closed with
  `integer_precision_loss`; callers use `bigint` for exact signed-64 values.
- Sparse arrays, array holes, and accessor-backed elements fail before framing;
  the encoder checks remaining node capacity and never invokes array getters.
- Fractional domain schemas use explicit scaled integers such as `bpm_milli`,
  unit `*_ppm`, signed penalty `*_signed_ppm`, and `*_ms`; embeddings remain
  typed bytes rather than JSON number arrays.

## Not proved

- Exhaustive equivalence for every combination of multiple simultaneous syntax
  errors; tests compare each required hostile-input class independently.
- A strict server-envelope validator. The current Python module defines emitted
  progress/terminal shapes but provides validators only for handshake/request;
  this spike proves representative envelope bytes and frame round trips.
- Electron integration, sockets, subprocess supervision, packaging, or the
  production generated-contract mechanism.
- A clean dependency install without registry access on this host. The frozen
  offline install could not find the TypeScript tarball, so verification reused
  the adjacent evaluation spike's already-installed copies of the same exact
  locked versions. No network access was granted or used.

No high/medium incompatibility remains known in the exercised shared wire
contract.
