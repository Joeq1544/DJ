# Phase 0 process topology and trusted approval evidence

Date: 2026-08-09

Status: **P0-013/P0-015 feasible and independently reviewed as bounded
architecture proofs supporting accepted ADR-0003**. This closes the topology,
approval, and codec-decision evidence, not production implementation. A separate
15-test differential/local suite now proves the exercised TypeScript/Python
private wire subset and local JavaScript shape hazards, while source inspection
rejects the current main-broker callback option. Application composition, actual
Codex-to-MCP use, and launcher/packaging constraints remain later executable
gates.

## Proven process and trust graph

```text
trusted-main stand-in ── role capability ──────────────┐
  exact proposal display + decision authority         │ strict framed protocol
                                                       │ private AF_UNIX socket
MCP/model JSON lines → stateless bridge → role cap ────┤ 0700 parent / 0600 node
  bounded stdio         no sqlite / no DB path         │
                                                       ▼
                                             one Python CoreServer
                                             sole SQLite opener
```

The launcher stand-in creates distinct unpredictable capabilities for
`trusted-main` and `mcp-bridge`. The core first filters peers by the measured
macOS UID credential, then validates the claimed role against its own bounded
ASCII URL-safe capability. The MCP bridge receives only its role's credential;
cross-role, absent, malformed, and non-ASCII credentials fail without being
echoed. Secure packaged distribution of those capabilities remains a later
launcher contract.

`mcp_bridge.py` accepts a socket path and its own capability, uses separately
bounded newline-delimited JSON on stdio, and translates to core frames. It does
not import SQLite or accept a database path. Only `core.py` imports
`sqlite3`, opens the app database, owns transactions, and executes the spike's
single harmless mutation.

## Protocol and lifecycle evidence

- Core frames are a four-byte unsigned big-endian length plus a strict UTF-8
  JSON object, with a 65,536-byte payload maximum. Zero/oversized lengths are
  rejected from the header before the declared body is read or allocated.
- Decoding rejects malformed UTF-8/JSON, duplicate keys, non-object roots,
  every floating-point spelling including `NaN`/infinities, unpaired surrogates, excess depth or node count, integers
  outside signed 64-bit range (including 5,000-digit inputs), and incomplete
  trailing frames. The model-facing stdio path reuses the strict decoder and a
  byte-bounded line reader.
- Canonical action bytes use Unicode-code-point-sorted keys, compact separators,
  strict UTF-8, and signed-64 integers only. Durations and expiries cross as
  bounded integer milliseconds. Fractional domain DTOs use schema-named scaled
  integers (`bpm_milli`, unit `*_ppm`, signed penalty `*_signed_ppm`, and
  `*_ms`) with exact-decimal round-half-even quantization and reject-not-saturate
  bounds; embeddings remain typed byte blobs. Stored bindings use SHA-256 of
  exact wire bytes.
- The first logical message is protocol version 1 with a bounded session ID and
  role credential. Split and coalesced physical reads preserve logical order.
  Live duplicate sessions and a second simultaneous trusted main are rejected;
  a fully disconnected session can reconnect cleanly.
- Sessions, concurrent sessions, per-session request history, inflight work,
  handshake/read time, and total session lifetime are bounded. Excess work gets
  a stable `backpressure` terminal. Shutdown closes and joins session handlers
  before workers and SQLite.
- Every accepted request gets at most one terminal state:
  `succeeded`, `failed`, `cancelled`, or `outcome-unknown`. The
  deterministic cancel/result-boundary test proves task state and semaphore
  capacity are released before the terminal becomes visible, then proves a new
  request can use the recovered slot.
- The MCP stand-in uses one monotonic absolute deadline across connect plus
  handshake and a fresh absolute deadline for each request. Remaining time is
  recomputed around every blocking operation and while consuming pending or
  progress frames. Byte-at-a-time handshake and continuous progress-drip tests
  prove traffic cannot reset the deadline; a failed exchange closes.
- `CrashLoopPolicy` deterministically caps retries in a moving window.
  Production supervisor wiring is not part of this spike.

## Socket and database ownership evidence

Before opening SQLite, the core acquires a nonblocking exclusive `flock`
derived from the canonical database path. It also holds a cooperative lock for
the canonical socket path for the server lifetime. Stale cleanup uses `lstat`,
requires an actual Unix socket rather than a final-component symlink, probes for
a live owner, rechecks device/inode identity, and unlinks only the validated
stale inode. Shutdown removes only the socket inode created by that server.
Startup failure rolls back/closes SQLite and releases both locks.

Tests prove a second core cannot open the same database through its canonical
path or alias, cannot take the live socket with a different database, and cannot
race cooperative stale cleanup; the winning owner remains reachable. The real
integration also asserts mode `0700` on the runtime directory, mode `0600`
on the socket, cleanup, one SQLite open, and the current UID from
`getsockopt(0, socket.LOCAL_PEERCRED, 256)`. Missing, malformed, or mismatched
peer credentials fail closed.

The socket-path lock is deliberately a cooperative local-process proof. It does
not claim protection from a malicious same-UID process that ignores the lock and
mutates the private runtime directory.

## Idempotency and trusted approval evidence

Idempotency records bind key, canonical action hash, terminal status, and exact
result. Exact replay returns the durable outcome across a core restart, changed
actions conflict, and fault injection proves partial database mutations roll
back before a safe retry.

The core-owned proposal record stores the non-secret proposal ID, canonical
tool and payload bytes/hash, destination, public creator session, private creator
connection identity, expiry, random core boot epoch, trusted-main app epoch,
approval state, and use state. No unused nonce is stored or claimed.

The MCP create response exposes exactly `proposal_id` and neutral `status`;
tests reject model visibility of hashes, capabilities, creator connection
identity, or decision authority. Only `trusted-main` may retrieve the exact
display fields and approve or reject. Execution checks the original MCP
connection, both epochs, expiry, unused/approved state, tool, destination,
byte-for-byte payload, and hash under the database lock, then inserts and marks
used in one transaction.

Tests reject unapproved execution, replay, rejection, cancellation, expiry,
payload or destination substitution, cross-tool use, another MCP connection,
the same public session after reconnect, core restart, and trusted-main restart.
Fault injection proves a failed execute transaction leaves no row and a
retryable proposal.

## TDD, review, and verification record

Initial red command:

```sh
python3 -m unittest discover -s spikes/process_topology/tests -v
```

Result: exit 1; 21 intentional assertion failures before the required modules
existed. The first green implementation reached 23 tests, after which primary
verification exposed a reconnect/resource warning and an independent reviewer
returned two high and three medium findings.

Four bounded red/green fix rounds added role authentication, exclusive
ownership, hostile-input/resource bounds, lifecycle and transaction cleanup,
trusted-main app epochs, deterministic terminal ordering, cooperative stale
cleanup, and absolute bridge deadlines. Primary counterexamples additionally
closed raw 5,000-digit integer and non-ASCII capability escapes.

Final primary command:

```sh
python3 -B -W error::ResourceWarning -m unittest discover -s spikes/process_topology/tests -v
```

Result: exit 0; **38 tests passed in 4.735 seconds; `OK`**. The managed command
sandbox denies Unix-socket binding, so this command ran with explicit permission
for private local AF_UNIX sockets. It used only temporary directories and
databases and no TCP/network, credentials, audio, or Rekordbox data.

The same fresh reviewer inspected the frozen initial patch and every scoped fix
package. Final verdict: **PASS; no unresolved high- or medium-severity finding**.
The reviewer relied on the primary's independent warning-strict run rather than
duplicating it.

Cross-language correction evidence followed the original review. Python red
tests first reproduced finite-float acceptance and `true == 1` handshake
acceptance. The contract was narrowed to integer-only JSON, `delay_ms`/`ttl_ms`,
integer epoch expiry, and exact integer version checks; the complete Python
socket/core suite then passed 38/38. The independent TypeScript implementation
uses a real Python oracle and initially passed 14/14 plus strict typechecking,
including byte/hash/error parity for the corrected hazards. Architecture review
then reproduced a sparse-array/node-accounting bypass in the TypeScript encoder.
The indexed-data-property correction rejects holes/accessors without invoking
them and now passes 15/15 plus typecheck. Fresh independent re-review passed with
no High or Medium finding.

## Requirement-to-test summary

| Requirement | Automated evidence |
| --- | --- |
| strict framing/JSON/canonical binding/resource caps | `test_protocol.py`; `test_stdio_is_byte_bounded_and_uses_strict_json` |
| distinct authenticated roles and one DB owner | `test_role_capabilities_reject_missing_wrong_and_cross_role_claims`; `test_two_authenticated_sessions_share_one_database_owner` |
| DB/socket ownership and safe cleanup | `test_second_core_cannot_take_database_or_live_socket`; socket-lock/symlink/start-failure tests |
| bounded lifecycle/backpressure/terminal/cancel behavior | request-history/session/shutdown tests; both cancel/result tests |
| absolute MCP exchange deadlines | silent-stall, partial-handshake-drip, and progress-drip tests |
| durable idempotency and rollback | restart replay/conflict and fault-injected rollback tests |
| approval secrecy and exact trusted binding | all eleven `ApprovalTests` |
| bounded crash policy | `test_crash_loop_policy_is_bounded` |

## Accepted limitations and next action

- The tests use real independent socket connections but instantiate the Python
  server and clients in one test process. Electron, real child processes,
  supervision, codesigning, resource discovery, and packaged crash behavior are
  not proven.
- Capability creation/distribution is a launcher contract. Production must keep
  the trusted-main capability unavailable to the bridge/model; a 0600 file does
  not defend against arbitrary malicious code already running as the same user.
- The measured `LOCAL_PEERCRED` layout and `flock` proof are macOS/POSIX
  specific. Non-cooperating same-UID mutation remains outside the spike.
- Core exchanges have absolute deadlines. Waiting for idle stdio, or a producer
  that neither terminates a line nor reaches the byte cap, is not timed by this
  synchronous stand-in.
- The crash-loop policy is not wired to a supervisor; true death during an
  external side effect still needs operation-specific reconciliation.
- P0-007 and later gates must prove the composed local-only root, selected bridge
  registration in an actual Codex call, secure launcher capability delivery,
  and packaged supervision. ADR-0003 accepts the architecture without treating
  those implementations as complete. Private codec parity, exact MCP 2.0.0
  schemas/annotations, and the main-broker source comparison are local evidence
  rather than open parity questions.
