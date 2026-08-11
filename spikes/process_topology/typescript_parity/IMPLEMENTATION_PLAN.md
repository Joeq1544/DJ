# Core Protocol TypeScript Parity Spike Implementation Plan

> **For agentic workers:** Execute inline with strict red-green TDD. Do not edit
> the authoritative Python protocol or files outside this directory.

**Goal:** Prove the safely interoperable subset of the private core protocol and
surface any contract changes required before Phase 1.

**Architecture:** A standalone TypeScript codec is exercised against a local
Python subprocess oracle that imports the existing implementation unchanged.
No runtime dependency is added; only exact, locked TypeScript development tools
are used.

**Tech Stack:** Node.js built-in test runner, TypeScript strict mode, Python 3
standard library, SHA-256 from `node:crypto`.

## Global constraints

- All writes stay under `spikes/process_topology/typescript_parity/`.
- The Python oracle is test-only and local; production behavior may not shell
  out to Python to obtain parity.
- Tests must verify identical float rejection and exact-integer version checks.
- No Git staging, commits, or branch operations.

### Task 1: Executable parity contract

**Files:**

- Create: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`
- Create: `oracle.py`
- Test: `tests/protocol.test.ts`
- Create after red evidence: `src/protocol.ts`

**Interfaces:**

- `canonicalJson(value: unknown): Buffer`
- `canonicalHash(value: unknown): string`
- `encodeFrame(value: JsonObject): Buffer`
- `decodePayload(payload: Uint8Array): JsonObject`
- `FrameDecoder.feed(chunk): JsonObject[]` and `finish(): void`
- `validateHandshake(value)` and `validateRequest(value)`

- [x] Write focused tests with literal expected bytes/codes and Python-oracle
  comparisons for canonical data, bounds, hostile input, schemas, and envelopes.
- [x] Run the tests and confirm they fail because `src/protocol.ts` is absent.
- [x] Implement the smallest independent codec and validators that satisfy the
  tested integer-only contract and fail closed on unsupported floats.
- [x] Run all focused tests and strict typechecking.
- [x] Record exact red/green commands, counts, limitations, and recommendations
  in `EVIDENCE.md` and `README.md`.

### Task 2: Corrected shared numeric and version contract

**Files:**

- Modify: `oracle.py`, `tests/protocol.test.ts`, `src/protocol.ts`
- Modify: `DESIGN.md`, `README.md`, `EVIDENCE.md`

- [x] Convert float and boolean-version blocker tests into Python parity tests.
- [x] Observe the focused test fail on the old TypeScript float error message.
- [x] Align both TypeScript float rejection paths with the Python contract.
- [x] Exercise integer `delay_ms` framing and representative `ttl_ms` request
  canonicalization against the Python oracle.
- [x] Rerun focused tests, the complete suite, typecheck, and Python protocol
  tests; record remaining high/medium findings.
