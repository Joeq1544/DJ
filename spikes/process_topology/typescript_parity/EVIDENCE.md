# Phase 0 TypeScript/Python protocol parity evidence

## TDD record

Initial red command:

```sh
node --test tests/*.test.ts
```

Observed: exit 1, 0 passed/1 failed at suite load with
`ERR_MODULE_NOT_FOUND` for the intentionally absent `src/protocol.ts`.

During implementation, focused differential tests exposed and drove fixes for:

- Node strip-only TypeScript syntax (constructor parameter property rejected);
- Python oracle import-root propagation;
- decoded null-prototype objects differing from normal JSON object shape;
- a stateful assertion helper that invoked decoder input twice; and
- UTF-8 BOM handling (`invalid_json` in Python, initially accepted by Node).

The BOM regression was independently observed red with:

```sh
node --test --test-name-pattern=hostile tests/*.test.ts
```

Observed before the fix: exit 1, 0 passed/1 failed because TypeScript accepted
the BOM-prefixed object. Observed after the fix: exit 0, 1 passed/0 failed.

After the shared Python contract was corrected, the former blocker tests were
converted to strict parity checks. Focused command:

```sh
node --test --test-name-pattern='float|boolean|delay_ms' tests/*.test.ts
```

Observed red before the TypeScript message change: exit 1, 2 passed/1 failed;
both codecs returned `float_contract_unsupported`, but their messages differed.
Observed after the fix: exit 0, 3 passed/0 failed. The same slice proves exact
boolean-version rejection and byte-for-byte framing of integer `delay_ms`.

Architecture review later reproduced a sparse-array bypass: a 5,000-slot array
passed request validation, skipped node accounting, and encoded `[,,,,]` bytes
that the same decoder rejected. The new regression failed before correction.
The encoder now checks remaining node capacity before output allocation and
iterates indexed own data descriptors, rejecting holes/accessors without getter
execution.

## Green evidence

Fresh final commands were run on 2026-08-09:

```sh
pnpm test
pnpm typecheck
python3 -B -m unittest spikes.process_topology.tests.test_protocol -v
```

- `pnpm test`: exit 0; 15 passed, 0 failed, 0 skipped.
- `pnpm typecheck`: exit 0; TypeScript strict checking emitted no diagnostics.
- Python protocol suite: exit 0; 6 passed, 0 failed.
- Trailing-whitespace scan: no matches outside ignored `node_modules`.
- Scope inspection: the only new visible path is
  `spikes/process_topology/typescript_parity/`; no Git operation was performed.

Latest primary rerun tools: Node 25.8.1, Python 3.14.3, pnpm 11.16.0, and
TypeScript 6.0.2.
Each oracle-backed case starts a real local Python subprocess whose module
search path points at the repository root; `oracle.py` imports
`spikes.process_topology.protocol` rather than duplicating its logic.

## Claim ledger

| Claim | Evidence | Result |
|---|---|---|
| Canonical UTF-8 bytes and SHA-256 | Literal fixture plus Python oracle | Proved for exercised integer/string fixture |
| Unicode key sorting | BMP private-use key versus astral emoji | Proved for code-point/UTF-16 hazard fixture |
| Signed-64 integers | Both boundaries, safe boundary, unsafe `number`, out-of-range `bigint` | Proved with `bigint` representation |
| Four-byte big-endian frame and 65,536 cap | Maximum exact frame compared byte-for-byte with Python | Proved |
| Split/coalesced decoding | Same two chunks decoded by both implementations | Proved |
| Hostile input classes | UTF-8, BOM, duplicate/escaped duplicate, NaN/overflow, surrogate, depth, nodes, integers, syntax | Proved for listed fixtures/error codes |
| Handshake/request schemas and bounds | Accepted and rejected matrices, boolean version, `delay_ms`, and `ttl_ms` compared with Python | Proved for exercised fixtures |
| Progress/terminal envelopes | Progress and four terminal statuses framed and decoded | Representative byte parity proved; schema validation not proved |
| Float transport | Four finite spellings rejected by both codecs with identical code/message | Parity proved for exercised hazards |
| Boolean version | Both validators reject JSON `true` with identical code/message | Parity proved |
| JavaScript array shape | Oversized sparse, small-hole, and accessor-backed arrays | Fails closed before framing; accessors are not invoked |

## Remaining high/medium findings

None known within the exercised shared wire contract. Full socket/core behavior
and packaged integration remain outside this parity spike's claim boundary.
