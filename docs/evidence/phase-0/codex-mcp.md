# Phase 0 Codex SDK and MCP Evidence

Date: 2026-08-09
Tasks: P0-006, P0-007
Disposition: **blocked; corrected local implementation independently reviewed**

## Exact experiment boundary

- TypeScript SDK: `@openai/codex-sdk@0.146.0`.
- Matching packaged helper: `@openai/codex@0.146.0`.
- Dependency integrity is recorded by `spikes/codex-mcp/pnpm-lock.yaml`; the
  package-local pnpm policy allows only the required `esbuild` install script.
- Candidate integration: official TypeScript SDK in the future Electron main,
  using an app-owned `codexPathOverride` wrapper that accepts one exact SDK argv
  shape and injects only runtime-supported `--ignore-user-config` and
  `--ignore-rules` flags.
- Authentication rule: inspect the matching helper only, accept only exact
  exit-0 ChatGPT status, classify every API-key/token/Bedrock mode as other
  authentication, and never persist or print raw stderr.
- No API-key provider, credential copy/symlink, user-config edit, user-media
  read, or music-root access was performed.

## Deterministic evidence before independent review

The specialist's final pre-review run reported:

```text
pnpm --dir spikes/codex-mcp test
21 tests, 21 passed, 0 failed

pnpm --dir spikes/codex-mcp typecheck
exit 0 (tsc --noEmit)
```

The independent reviewer reproduced both green commands. Covered behavior
included exact start argv serialization through the official SDK and executable
shim; exact helper resolution/version; redacted login classification; strict
workspace realpath validation; strict structured-result and TypeScript MCP input
bounds; application timeout/cancellation units; generated synthetic sentinels;
and a local-only unit path that invokes no supplied SDK, MCP, or network
initializer.

These are partial deterministic results, not real provider or MCP acceptance.

## Authenticated real result before correction

An approved bounded real run used the matching helper and existing host login.
The only retained result was the following sanitized classification:

```json
{"executed":true,"auth":"chatgpt","stage":"new_resume_lifecycle","error":"sdk_or_service_failure","descendantRecords":1,"survivors":0}
```

The command exited 1. No raw CLI stderr, prompt, event, response, credential, or
user path was persisted. The generated temp tree was removed. Because the
lifecycle failed, the negative-capability model turn and all real MCP behavior
were unexecuted and receive no credit.

After the 36-test correction and final local review, the primary requested one
bounded corrected rerun. The execution environment rejected that request before
the command started because sending the synthetic probe inputs and workspace
context to the external Codex service requires separate explicit informed user
approval. No provider request or sentinel attempt occurred. The project will not
route around that disclosure guard or treat the rejected attempt as evidence.

## Authenticated result exposing the exact configuration defect

After explicit informed approval, a later bounded run again used existing
ChatGPT authentication and the matching packaged helper. Its complete retained
result was:

```json
{"mode":"real","executed":true,"auth":"chatgpt","blocker":true,"stage":"lifecycle_start","error":{"category":"config"},"controlAudit":{"status":"ok","invocations":1,"active":0,"observedShimAndGroupSurvivors":0,"escapedDescendantCleanup":"proof_unavailable","blocker":true},"architectureBlockers":["ambient_user_mcp_plugin_isolation_unproven","required_python_mcp_echo_not_observed","escaped_descendant_cleanup_unproven"]}
```

The command exited 1. It reached neither a lifecycle result nor an MCP/sentinel
turn. The scoped audit observed no surviving shim or inherited helper group and
continued to report escaped-descendant proof unavailable.

A local diagnostic then invoked the same pinned helper with the exact generated
configuration and reproduced `FilesystemPermissionToml` rejection. The custom
profile had encoded the scoped `:workspace_roots`/`.` table as one flattened
dotted SDK override, which the CLI override loader does not reconstruct as the
required nested table. A first replacement selected tagged Codex 0.146.0's
built-in `:read-only` profile and passed configuration loading, but independent
review found that this profile grants root-wide reads. A model-free pinned-helper
probe reproduced the outside-workspace read, so that correction and D-030 were
rejected.

The next correction restored named `dj_read`. The shim still required the
complete SDK-flattened input but rewrote only its filesystem entry to a CLI
inline table using `:minimal` plus workspace-root read. It also injected
`--strict-config`. Exact `mcp get --json` validation and an unknown-key canary
fixed the configuration-integrity finding, but a second independent review
found the filesystem claim still unsafe: pinned macOS `:minimal` defaults allow
reads under broad system/config/application/shared-temp paths and writes under
shared temp. The exact profile reproduced `/etc/hosts` plus synthetic `/tmp`
read/write access. Adding exact path denies did not carve those raw defaults
out, so D-031 was rejected.

The current correction removes `:minimal`; the runtime filesystem table grants
only workspace-root read and profile network remains false. Before provider
construction, the matching helper must still pass exact MCP JSON and strict-key
checks. Its model-free child-start gate now requires exact macOS arm64 Codex
0.146.0 exit 134, null signal, empty stdout/stderr, and absence of both
workspace and shared-temp synthetic markers. Focused tests and the full 47/47
suite plus typecheck pass. This is intentionally narrow fail-closed evidence:
the pinned profile cannot start the trusted probe, so it does not prove inside
reads, shell/network operation, MCP execution, direct built-in-tool enforcement,
or an authenticated sentinel turn. KI-045 and ADR-0002 remain blocked.

## Authenticated post-permission stage-reach failure

After fresh informed approval, one bounded authenticated rerun sent only
synthetic fixture IDs, temporary paths, rules, and sentinels. It passed the
local configuration and no-`:minimal` child-start gates and entered
`runRequiredMcpEcho`, but then exited 1 without the runner's redacted JSON. The
local cause was an unhandled Node ChildProcess `AbortError`: `withTotalTimeout`
aborted the SDK signal from `finally` after the underlying operation had already
settled. A later read-only scoped process listing found no matching shim/helper/
MCP process, but that is not authoritative descendant-cleanup evidence.

The run is recorded only as `mcp_echo_tool` stage-reach/crash evidence. It does
not credit lifecycle completion, MCP discovery, invocation, validation, or
success. The first regression proved successful operations were incorrectly
aborted; independent review then reproduced the same Medium failure after a
settled rejection. The final correction aborts only in the deadline callback.
Fulfilled and rejected operations clear the deadline and always execute scoped
cleanup without a late abort. Five focused timeout/settlement tests, the full
47/47 suite, typecheck, and an independent live-child reproduction now pass.

## Corrected authenticated lifecycle and MCP-stage result

After another explicit informed approval, the corrected bounded probe returned
the following complete sanitized result and exited 1:

```json
{"mode":"real","executed":true,"auth":"chatgpt","blocker":true,"stage":"mcp_echo_tool","error":{"category":"service"},"controlAudit":{"status":"ok","invocations":3,"active":0,"observedShimAndGroupSurvivors":0,"escapedDescendantCleanup":"proof_unavailable","blocker":true},"architectureBlockers":["ambient_user_mcp_plugin_isolation_unproven","required_python_mcp_echo_not_observed","escaped_descendant_cleanup_unproven"]}
```

`real-probe.ts` assigns `mcp_echo_tool` only after `runLifecycle` returns.
Control-flow inspection and an independent read-only review therefore credit
only these facts:

- existing ChatGPT authentication was used through the exact official SDK and
  helper;
- one new streamed turn published a non-null thread ID, was consumed to
  exhaustion, and returned a bounded application-validated known-ID result
  after the exact `fixture-1` output schema was supplied;
- that exact thread ID was resumed, its stream was consumed to exhaustion, and
  it returned another bounded application-validated known-ID result after the
  same exact schema was supplied; and
- three shim/helper invocations settled with no active or observed inherited-
  group survivor.

`runLifecycle` does not require a specific `turn.completed` event, so none is
credited. The stage is set before `runRequiredMcpEcho`; that function did not
return. No MCP discovery, server startup, inventory, tool event, argument,
result, or success is credited. No negative-capability sentinel turn began, no
real cancellation path ran, and ambient isolation plus escaped-group cleanup
remain unproved.

The historical runner's generic validator accepted any bounded known fixture ID
and did not compare new/resumed values. The retained result therefore does not
prove exact `fixture-1` values or equality between the two turns. A subsequent
red/green correction passes exact expected IDs into `runLifecycle` and rejects a
wrong-known ID in either stream; that strengthens future runs only and does not
retroactively expand this result.

The recorded `service` category was the then-current unmatched-error fallback.
`runRequiredMcpEcho` had erased its underlying cause, so this is not evidence of
an upstream outage; the exact MCP-stage failure is unknown. A red/green
regression now reserves `service` for explicit service/upstream messages,
classifies opaque errors as `unknown`, and emits only allowlisted stage-local MCP
reasons. Subsequent independent review corrections preserve cleanup outcome,
require exact lifecycle IDs prospectively, and prevent reasonless rejection from
resolving as success. The local package has 52 tests plus a green typecheck; the
integrated rerun is recorded separately in `verification.md`.

Official npm metadata still reported 0.146.0 as the `latest` SDK tag when
inspected on 2026-08-09. Repeating the identical external probe would not add
reliable evidence. Another opt-in call requires a material diagnostic, runtime,
or containment change.

## Tagged local-MCP process-placement evidence

Pinned 0.146.0 source selects `LocalStdioServerLauncher` for local stdio MCP.
That launcher directly spawns the configured command as an orchestrator child,
creates a new Unix process group, and attempts group termination when the
transport closes or drops. Therefore the model-command sandbox exit-134 probe
is not MCP startup evidence in either direction. It also explains why the
current shim/inherited-helper-group audit cannot authoritatively prove MCP-group
extinction. Source inspection is an architecture constraint, not a substitute
for an authenticated tool call or executable cleanup evidence.

## Independent review and corrections

Verdict: **NEEDS_CHANGES**. The reviewer independently passed 21 deterministic
tests and typechecking, did not rerun the authenticated probe, and found:

1. High: model-readable, unvalidated PID telemetry could signal unrelated
   same-user processes, including process-group 0 from a null child PID.
2. Medium: clearing TERM-to-KILL escalation when the direct child exits can
   leave a TERM-ignoring grandchild alive.
3. Medium: model-supplied booleans cannot prove denial of unobservable direct
   file/image/audio reads and can yield a false-clean interpretation.
4. Medium: official-SDK integration covered start argv, while resume and
   cancellation were only separate fake/unit evidence.
5. Medium: the TypeScript MCP contract had no declared closed output schema.

The bounded corrections reached the following final local result:

```text
pnpm --dir spikes/codex-mcp test
36 tests, 36 passed, 0 failed

pnpm --dir spikes/codex-mcp typecheck
exit 0 (tsc --noEmit)
```

The final independent reviewer reproduced both commands and reported **PASS**
with no unresolved high/medium local implementation finding. The corrected
package now uses exclusive no-follow supervisor-owned control state outside
model roots; validates run, parent, invocation, PID, and state bindings; ignores
model self-report as denial evidence; exercises fake official-SDK start/resume
and integrated cancellation; publishes and enforces a closed MCP output schema;
and requires direct-child settlement plus both shim and inherited helper-process-
group extinction under one absolute cleanup deadline. Process-group extinction
is accepted only when `kill(-pgid, 0)` returns `ESRCH`; other signal/probe results
fail closed. The active audit uses distinct shim/helper identities and cannot
report supervisor completion before both scoped groups are extinct.

That PASS is deliberately scoped. A descendant that creates a different process
group is outside this wrapper's authoritative observation and cleanup boundary.
The escape fixture is torn down by the test harness but is classified
`proof_unavailable`, not clean. This is an architectural gate blocker, not an
unresolved defect hidden by the local review.

## Local Python MCP 2.0 stdio result

The isolated `spikes/codex-mcp/python_mcp/` environment imports exactly
`mcp==2.0.0`; `requirements.lock` records the complete installed inventory. Its
low-level `Server` runs in a separate Python process through the official
`stdio_server` and is called through the official `stdio_client` plus
`ClientSession`. The client first inspects the exact single tool definition and
then independently validates the result.

```text
spikes/codex-mcp/python_mcp/.venv/bin/python -B -W error::ResourceWarning \
  -m unittest discover -s spikes/codex-mcp/python_mcp/tests -v
9 tests, 9 passed, 0 failed

spikes/codex-mcp/python_mcp/.venv/bin/python -B -W error \
  spikes/codex-mcp/python_mcp/client.py
exit 0; bounded protocol JSON only

spikes/codex-mcp/python_mcp/.venv/bin/python -B -W error \
  spikes/codex-mcp/python_mcp/client.py --local-only
exit 0; {"mode":"local_only"}
```

The specialist ran the warning-strict suite three times; the primary reproduced
9/9 plus both commands and exact distribution version. A fresh independent
review then reproduced 9/9 warning-strict tests, both bounded command modes, the
exact `mcp==2.0.0` import, an environment inventory equal to
`requirements.lock`, fixed errors for a one-megabyte unknown ID and malformed
shapes, protocol-only stdout on invalid input, and exact recorded-server-PID
reaping to `ESRCH`. It reported no unresolved high/medium finding. The tests cover the
closed input/output schemas, maximum five known IDs, strict second app-owned
validation, read-only/non-destructive/idempotent/closed-world annotations,
bounded equivalent text/structured content, sanitized invalid/tool errors,
protocol-only stdout, changed-listing rejection, and cancellation of a real
slow stdio call. Cleanup records one exact test-server PID and requires `ESRCH`;
it does not scan PIDs or claim escaped-descendant/process-group cleanup. A fresh
TypeScript test also launches this real client and compares its complete
published tool listing with the TypeScript definition, including description,
closed schemas, annotations, exact evidence shape/server identity, and observed
2,048-byte evidence bound. The corrected test independently passed, bringing
the full TypeScript package to 37/37 plus typecheck. It includes one successful
transport smoke payload; it does not prove full behavioral or private core RPC
protocol parity.

Accepted lower limitations are explicit: startup failures from the standalone
probe may relay Python path diagnostics because the SDK child has no separate
error log; the probe itself has no overall timeout; rejected bytes have no
pre-parse transport cap; the exact-version inventory has no package hashes; and
cleanup proves only the direct stdio server PID. Local-only mode imports MCP
modules but creates no transport or network state.

## Main-broker comparison and candidate Codex registration

The pinned TypeScript SDK declaration exposes a `config` object and observable
`mcp_tool_call` events, but no public in-process tool-registration or callback
API. The tagged 0.146.0 config schema directly supports app-specified local
STDIO server command/args/cwd, required/enabled-tool lists, startup/tool
timeouts, and tool approval settings. Therefore an Electron-main callback
broker is not a viable alternative on this exact public surface; the selected
candidate must be one exact app-owned Python STDIO server passed through
validated `mcp_servers` CLI overrides.

The corrected runner now supplies exactly one enabled/required app-owned server,
the reviewed adjacent virtual-environment interpreter and `server.py`, its exact
working directory, `-B -W error`, empty configured `env`/`env_vars`, five/three
second startup/tool timeouts, and only `echo_library_ids`. The narrow shim
requires those fields in one exact order and rejects changed paths, missing or
extra servers/tools/URLs/environment fields, duplicates, or reordering. It uses
`default_tools_approval_mode="approve"` only for this exact independently
validated closed-world read-only/non-destructive tool; annotations alone are
not treated as authority.

Fake official-SDK stream tests require one coherent MCP call identity across
exact started/updated/completed envelopes, validate the expected known-ID
arguments in every observed phase, require one exact successful result plus one
matching structured assistant result and completed turn, and reject malformed,
failed, incomplete, duplicate, differently identified, or timed-out calls.
Timeout aborts the SDK stream and invokes scoped cleanup. An integrated root-gate
run exposed a scheduler-sensitive 100 ms post-KILL reaping window; the bounded
audit now allows 1,000 ms and its exact active path must complete within two
seconds.

The current local result is:

```text
pnpm --dir spikes/codex-mcp test
52 tests, 52 passed, 0 failed

pnpm --dir spikes/codex-mcp typecheck
exit 0 (tsc --noEmit)

Python MCP warning-strict suite
9 tests, 9 passed, 0 failed
```

A fresh independent reviewer reproduced the prior 43-test boundary with the
process-signal test explicitly permitted, reran the real local Python stdio
probe, and reported **PASS with no unresolved High or Medium local finding**.
The reviewed 47-test boundary added the strict exact-config and no-`:minimal`
fail-closed child-start regressions described above. A fresh bounded reviewer
reproduced its focused 2/2 actual-helper checks, full 47/47 suite, and typecheck,
then reported **PASS with no unresolved High or Medium scoped finding**. Five
later regressions add fail-closed unknown/MCP/cleanup classification,
prospective exact lifecycle values, and reasonless-rejection safety; 52/52,
typecheck, and the 186/186 integrated gate are green. The focused independent
correction review reported **PASS with no High or Medium finding**. The
restricted command fails closed when its sandbox denies process-group
signaling; that is not credited as cleanup evidence. Negative executable
integration cases for missing/symlinked/wrong-type MCP paths remain a low
coverage gap: the shim checks them, but the current executable tests cover only
the valid filesystem layout.

This proves strict local configuration parsing, one exact pinned child-start
failure boundary, and credit logic with the real matching helper, fake Codex
service events, and a real local Python transport. It does not prove a usable
sandboxed child, direct built-in image/audio/file-tool enforcement, that the MCP
child receives no ambient environment, or that a real Codex service turn
discovers/calls the tool.

The final reviewer retained Low limitations: exit 134 is an empirical pin/host
observation rather than an official stable contract; every helper, OS, or
architecture change must re-baseline it. The gate now rejects hosts other than
Darwin arm64. The bounded-command collector still finalizes from process exit
rather than formally waiting for pipe-close drainage, and injected wrong-exit,
output, or marker mutations are not separately covered. Those harness
hardenings do not convert the current capability blocker into accepted runtime
evidence.

## Hard blockers

P0-006 remains blocked even if the five review findings are fixed:

- the corrected runner has not exercised real cancellation; its authenticated
  new/resume lifecycle is credited only within the Node/Electron-main-compatible
  probe and not a packaged app;
- no real negative-capability turn ran;
- the narrow no-`:minimal` profile cannot start a sandboxed child on the exact
  macOS 0.146.0 pin; re-enabling child execution with `:minimal` reopens broad
  system/shared-temp read and shared-temp write access;
- direct built-in image/audio/file-read absence still lacks an out-of-band
  observation mechanism;
- descendants that escape to a different process group are not authoritatively
  contained or cleaned up;
- same-auth exclusion of ambient user MCP/plugins is unproved without touching
  user configuration, which this project forbids;
- the runtime exposes no accepted complete pre-turn tool inventory.

P0-007 remains blocked:

- P0-006 is unmet;
- no real Codex-to-local-MCP call ran;
- complete cross-language MCP behavior beyond the reviewed listing/echo subset,
  packaged bridge/application launch, and secure launcher capability delivery
  remain unmeasured;
- direct-server-PID cleanup does not prove escaped-descendant containment.

The correct Phase 0 state is therefore blocked, not complete or conditionally
accepted. ADR-0003 accepts the independently reviewed local protocol topology;
ADR-0002 and the real Codex/security gate remain unresolved.
