# Phase 0 Verification Evidence

Historical gate status: superseded on 2026-08-10

The 2026-08-09 deterministic results and blocked commercial-style product gate below remain exact historical evidence. The approved personal-use MVP accepts the recorded Codex limitations and does not reinterpret missing MCP/sentinel/containment evidence as a pass. Current execution status lives in `TASKS.md` and the M0 plan.

Date: 2026-08-09
Host scope: macOS 26.5.1, Apple Silicon arm64
Deterministic gate: **PASS**
Phase 0 product gate: **BLOCKED**

## Integrated deterministic gate

Command:

```text
scripts/verify-phase0.sh
```

Outcome: exit 0 with `phase0-verification: deterministic suites passed`.
The script names every required local suite and fails rather than silently
skipping a missing dependency or test package.

| Suite | Result |
| --- | --- |
| Project structure/environment validators | 11 passed |
| Python process topology, protocol, and approvals | 38 passed |
| TypeScript/Python protocol differential/local suite | 15 passed; typecheck passed |
| Rekordbox XML fixture/parser | 11 passed |
| Generated-audio analysis | 7 passed |
| Portable embedding storage/search | 13 passed |
| Codex SDK/MCP wrapper and actual-helper local gates | 52 passed; typecheck passed |
| Python MCP 2.0 warning-strict transport | 9 passed |
| Codex DJ-suitability mock evaluation | 30 passed; typecheck passed |
| **Total** | **186 tests passed; 0 failed; 3 typechecks passed** |

No authenticated provider request is part of this deterministic command.
The integrated command was run with explicit permission outside Codex's outer
sandbox because macOS rejects the nested Seatbelt setup there with exit 71 and
the fixed `sandbox_apply: Operation not permitted` diagnostic. Outside that
outer restriction, the exact pinned helper reached the product assertion and
returned the required fail-closed exit 134. This execution precondition is not
itself product sandbox evidence.

## Codex permission correction evidence

The final scoped independent review reported PASS with no unresolved High or
Medium finding after two unsafe alternatives were rejected:

1. Built-in `:read-only` parsed but granted root-wide reads.
2. Custom `:minimal` allowed broad macOS system/shared-temp reads and
   shared-temp writes; exact deny entries did not carve those defaults out.

The current strict inline profile contains only workspace-root read and disabled
profile network. On exact macOS arm64 Codex 0.146.0, the model-free sandboxed
child attempt must return 134 with null signal, empty stdout/stderr, and no
workspace/shared-temp markers. This is fail-closed unavailability evidence,
not proof of usable child execution, direct-tool isolation, MCP operation, or a
stable upstream exit-code contract. Any helper, OS, architecture, or design
change must re-baseline the gate.

A later authenticated attempt entered the MCP stage but crashed locally before
the redacted result because timeout cleanup aborted an already-settled SDK child
signal. It receives no lifecycle or MCP credit. The corrected helper aborts only
when the deadline wins; fulfilled and rejected operations still run cleanup but
are not aborted. Independent re-review passed the focused consumer set, a live-
child rejection reproduction, the full 47/47 package, and typecheck.

The next corrected authenticated run returned a sanitized exit-1 result at
`mcp_echo_tool`. That stage is assigned only after `runLifecycle` returns, so it
narrowly proves existing-auth new/resume streamed turns, exact thread-ID reuse,
stream exhaustion, and bounded application-validated structured results. It
does not prove a specific completion event, cancellation, MCP, sentinels,
ambient isolation, or escaped-group cleanup. The old `{category:"service"}` was
an unmatched-error fallback, not an upstream-outage finding. Five later
red/green regressions make opaque/MCP/cleanup errors stable, preserve whether
cleanup followed success/error/timeout, require exact lifecycle values for
future runs, and prevent reasonless rejection from resolving as MCP success.
They do not retroactively prove exact/equal values for the historical run. The
full 52/52 package/typecheck and this 186-test root rerun pass.

## Phase gate disposition

| Gate claim | Disposition | Evidence or blocker |
| --- | --- | --- |
| Intended-process SDK with existing auth | Pass, scoped | Exact 0.146.0 completed authenticated new/resumed streams with bounded validated structured results in the Node/Electron-main-compatible probe; packaged Electron remains a later gate |
| Bounded MCP tool called safely by Codex | Blocked | Local TypeScript and real Python stdio contracts pass; the corrected run entered the wrapper but no authenticated Codex-to-MCP event was credited and its exact failure is unknown |
| Negative-capability boundary | Blocked | No authenticated sentinel turn; direct image/audio/file tools, ambient MCP/plugins, hosted tools, and escaped descendants remain unproved |
| Rekordbox XML fixture | Pass | 11/11 deterministic tests; source mutation/hash checks pass |
| Generated local audio fixture | Pass | 7/7 deterministic tests with measured synthetic PCM evidence |
| License blockers known | Pass | Repository/model/code/data decisions recorded in `docs/LICENSING.md` and ADRs |
| Architectural dependency evidence | Blocked | ADR-0002 remains Proposed. Tagged source puts local MCP in a distinct process group; direct MCP call/cleanup plus negative-capability and ambient-isolation evidence remain absent |
| Deterministic root verification | Pass | 186/186 tests and all three typechecks passed |
| Whole-phase independent QA/security audit | Pass | Final read-only audit reproduced 186/186 tests and all three typechecks, identified one Medium documentation contradiction, and verified its correction. No unrecorded High/Medium finding remains; documented Codex/MCP/sentinel/containment findings continue to block the product gate |

## Checkpoint status

No green Phase 0 checkpoint or commit is recorded. The deterministic gate is
green, but the product gate is red under the authoritative stop rule. Phase 1
must not begin until ADR-0002 is accepted through new evidence or a documented,
verified architecture adjustment satisfies the remaining gates.

## M0 baseline revalidation — 2026-08-10

This revalidation belongs to the approved personal-use M0 scope. It preserves
the historical product-gate failures above without using them to block the
personal MVP.

| Check | Result |
| --- | --- |
| Personal-data ignore behavior | `personal-data/library.xml`, `scratch.sqlite3`, and `local-track.mp3` were ignored; the generated Rekordbox fixture remained visible |
| Direct `server.py` rollback RED | Updated direct-registration tests passed 37/46; the expected nine failures rejected the unfinished control-channel implementation |
| Direct `server.py` rollback GREEN | Targeted suite passed 46/46; full Codex/MCP package passed 52/52; package typecheck exited 0 |
| Project structure/environment validators | 11/11 passed |
| Aggregate deterministic baseline | `scripts/verify-phase0.sh` exited 0 with 186/186 tests and all three TypeScript typechecks passing |

The Codex/MCP tests and aggregate command were executed outside the outer Codex
workspace sandbox only because their intentional nested macOS Seatbelt probe is
rejected by the outer sandbox with `sandbox_apply: Operation not permitted`.
No authenticated Codex request, real MCP call, personal-library access, or raw
audio upload occurred. This green baseline therefore does not prove the missing
real MCP, sentinel, ambient-isolation, or escaped-process containment claims
listed in the historical gate.
