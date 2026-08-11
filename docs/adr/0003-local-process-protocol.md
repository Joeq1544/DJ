# ADR-0003: Local Process Communication Protocol

- Status: Accepted
- Date: 2026-08-09
- Owners: primary, architect

## Context

Electron main must supervise a Python service without exposing a network port, while supporting request/response, progress events, cancellation, health, bounded payloads, and restart/resume behavior. Worker logs cannot corrupt protocol frames.

## Proposed decision

Use one supervised Python DJ core service as the sole SQLite owner. Electron main and a stateless MCP bridge require independent client sessions; therefore carry forward a private Unix domain socket in a mode-0700 per-user runtime directory as the core-protocol candidate, with peer-UID filtering, distinct launcher-created role capabilities, canonical database/socket ownership locks, and framed versioned RPC/events. The Codex SDK communicates with a Python MCP 2.0.0 low-level `Server` adapter over that bridge's dedicated MCP stdio only. The bridge never opens SQLite, never receives the trusted-main capability, and never multiplexes core frames onto MCP stdio. Accept a verified main-process broker instead only if the current TypeScript SDK supports it without exposing a network listener or weakening the same invariants.

Every client performs a version/role-capability handshake. Requests have unique IDs, canonical payloads, pre-allocation and JSON-resource limits, monotonic absolute exchange deadlines, optional idempotency keys, bounded session/history/queue behavior, and exactly one terminal state published after task/capacity cleanup. Mutations use explicit transactions; mutation/export outcomes are durable so crash recovery can reconcile outcome-unknown without replay. Approval is core-owned, single-use, and bound to exact action, creator connection, expiry, core boot epoch, and trusted-main app epoch. Main caps restarts and reports crash loops.

The shared wire-number contract is signed-64 integers only; JSON floats are
rejected with a stable error and durations/expiries use bounded integer
milliseconds. Canonical object keys sort by Unicode code point. TypeScript uses
`bigint` outside its safe-integer range and rejects imprecise direct `number`
inputs.

Fractional domain values use schema-named scaled integers, never an unsuffixed
number or binary float at the encoder. BPM crosses as `bpm_milli`; normalized
confidence, energy, probability, weight, component, and total-score values use
`*_ppm` in `0..1_000_000`; signed penalty components use `*_signed_ppm` in
`-1_000_000..1_000_000`; and time uses `*_ms`. Producers quantize from an exact
decimal representation with round-half-even, reject rather than saturate an
out-of-range value, and preserve the unquantized local measurement plus
provenance in core-owned storage when needed. Float32 embeddings remain bounded
byte blobs with dimension/dtype/endianness/model metadata rather than JSON
number arrays. Any later fractional unit such as loudness must define a suffix,
scale, range, and round-trip contract before it enters a shared DTO.

## Alternatives

- Main-brokered/in-process MCP tools with a single main→worker stdio client: preferred only if verified SDK APIs support it and negative-capability constraints remain enforceable.
- Separate worker stdio plus MCP bridge using the same stream: rejected because unrelated protocols/clients cannot safely share it.
- Loopback TCP: reject by default; consider only with an ephemeral authenticated token and documented packaging/operational need.

## Phase 0 decision evidence required

A bounded topology spike must prove two independent clients, exactly one database opener, framing across split/coalesced reads, version negotiation, schema rejection, pre-allocation caps, backpressure, progress/events, cancel/result races, idempotent mutation outcome, crash/restart/crash-loop behavior, log separation, socket permissions/cleanup, and TypeScript/Python contract parity. The MCP side publishes exact schemas with `additionalProperties: false`, validates raw arguments again in app code, returns bounded structured content, sanitizes stable errors, keeps stdout protocol-only, sets explicit read-only/destructive/idempotent/open-world annotations, and honors shorter host cancellation/timeouts. It must compare the verified main-broker alternative if current SDK evidence makes it viable.

## Current Phase 0 evidence and disposition

P0-013 proves the Python side of this contract with 38 warning-strict tests and
a fresh independent review with no unresolved high/medium finding. The proof
uses distinct real Unix-socket clients, one SQLite opener, canonical
database/socket owner locks, role capabilities, strict bounded framing, session
and request bounds, deterministic cancellation/terminal ordering, absolute
bridge deadlines (including drip traffic), durable idempotency/rollback, and
server-side proposal approval invalidated by MCP, core, or trusted-main restart.
See `docs/evidence/phase-0/process-topology.md` and D-018.

An exact local Python `mcp==2.0.0` low-level `Server` now also runs through the
official stdio client/server subprocess transport. Nine primary-reproduced and
independently reviewed tests
cover its closed schemas/annotations, strict validation, bounded equivalent
results, sanitized errors, changed-listing rejection, local-only transport
avoidance, and exact direct-server-PID timeout cleanup. The review found no
unresolved high/medium issue. An independently reviewed physical
TypeScript-to-Python test also matches the complete published MCP tool listing
and one successful smoke result. It does not establish full MCP behavior parity,
invoke Codex, or connect the bridge to the versioned private core protocol.

A separate 14-test TypeScript/Python differential suite now compares canonical
UTF-8 bytes and SHA-256, Unicode code-point ordering, exact signed-64 integers,
framing/split/coalesced reads, hostile inputs, handshake/request validation,
integer `delay_ms`/`ttl_ms`, and representative progress/all terminal envelopes
against the actual Python module. Red tests exposed Python float canonicalization
and boolean-version acceptance; the shared contract now rejects both exactly.
The full corrected Python socket/core suite remains 38/38 green. No high/medium
incompatibility is known within the exercised private wire contract.

The architecture re-review then found that the TypeScript serializer skipped
sparse array slots, bypassing node accounting and emitting JSON its own decoder
rejected. The defect was reproduced before correction. Indexed own data
descriptors are now required, holes/accessors fail without getter execution,
and the remaining node budget is checked before output construction. The
differential/local suite is now 15/15 plus typecheck. The scaled-integer rules
above resolve the review's domain-fraction design follow-up; their concrete
Phase 1 DTO implementations still require cross-language tests.

Direct inspection of the pinned SDK public declarations settles the main-broker
comparison: 0.146.0 can pass CLI configuration and observe MCP events but has no
in-process tool-registration callback. Its tagged config schema supports the
required local STDIO server fields, so this ADR retains a separate bridge.

This ADR is **Accepted as the local process/protocol architecture**, not as an
implemented application boundary. The independently reviewed topology,
approval, Python MCP transport, main-broker comparison, and corrected 15-test
differential/local codec evidence are sufficient to choose one core owner, a
private authenticated Unix socket, and a separate stateless MCP stdio bridge.
P0-007 still must prove local-only behavior at the application composition root
and selected bridge registration in an actual Codex call. Phase 1/5/9 must prove
secure launcher/packaged capability distribution, a real supervisor/resource
path, and packaged behavior; escaped-descendant containment remains an ADR-0002
and release security blocker. The socket-path advisory lock is a cooperative
POSIX proof, not a defense against deliberate same-UID mutation.

## Later implementation verification

Phase 1 implements production supervision, typed IPC/core contracts, health and restart tests. Phase 3 proves durable job resume under real analysis load. Phase 9 verifies socket/helper/resource behavior after packaging. These later tests do not block the Phase 0 protocol/topology choice.

## Consequences

The core remains private and main-supervised. Main owns health/restart policy while the core owns durable outcomes. A second process is accepted only as a stateless MCP adapter; persisted state, not in-memory transport state, drives recovery.
