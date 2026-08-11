# Codex SDK lifecycle and MCP contract spike

This isolated Phase 0 spike pins `@openai/codex-sdk@0.146.0` and its matching
`@openai/codex@0.146.0` helper. It never uses the ambient PATH Codex CLI and
does not implement an API-key provider.

## Commands

```sh
pnpm --dir spikes/codex-mcp test
pnpm --dir spikes/codex-mcp typecheck
pnpm --dir spikes/codex-mcp test:real
```

The first two commands are deterministic and local. `test:real` is opt-in. It
resolves the helper from the installed SDK package, requires exact version
`0.146.0`, and invokes only `login status` before deciding whether a model turn
is eligible. Only exit 0 plus exact trimmed stderr `Logged in using ChatGPT`
continues. After the new/resume lifecycle, the runner requires one completed,
validated `echo_library_ids` MCP event and a matching structured assistant
result before reporting MCP credit. All auth classifications and failures are
redacted. Local preflight now asks the matching packaged helper to report the
exact MCP configuration, prove strict rejection of an unknown key, and require
the no-`:minimal` model-free child-start attempt to fail closed before any
provider turn.

## Isolation candidate

The stock SDK cannot emit `--ignore-user-config --ignore-rules`. The executable
`src/codex-isolation-shim.mjs` is a narrow candidate adjustment: it accepts only
the SDK's expected `exec --experimental-json` shape, checks every config/thread
argument, injects those two flags plus `--strict-config`, rewrites SDK
`--config` spellings to literal `-c` and one validated inline permissions table,
resolves the matching packaged helper, and performs bounded
TERM-to-KILL process-group cleanup. Resume invocations require a supervisor-
bound original thread ID; malformed, changed, or duplicate resume arguments
are rejected before the helper starts.

The same exact-argv boundary requires one app-owned local stdio MCP server,
`dj_copilot_fixture`. Its command is the reviewed
`python_mcp/.venv/bin/python`; its script and cwd are the adjacent app-owned
`server.py` and `python_mcp/` directory; and its argv includes `-B -W error`.
The server is enabled and required, startup/tool timeouts are five/three
seconds, `enabled_tools` contains only `echo_library_ids`, configured `env` is
empty, and `env_vars` is empty. The shim receives the three expected paths from
the supervisor, rejects a missing expectation, checks their canonical layout
and filesystem types before spawning Codex, and accepts registration fields in
one exact order. Changed or extra servers, remote URLs, environment forwarding,
tools, fields, duplicates, and reordering fail closed.

The approval value is
`default_tools_approval_mode="approve"` only for that exact closed-world,
read-only, non-destructive allowlisted tool. This value and the local stdio,
required/enabled-tool, and timeout fields are present in the pinned Codex
[0.146.0 tagged configuration schema](https://raw.githubusercontent.com/openai/codex/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/core/config.schema.json).
Tool annotations remain descriptive metadata; the exact server/tool allowlist
is the authorization boundary.

The SDK configuration names `default_permissions="dj_read"` and emits the exact
flat workspace-read/network-off proposal. Because the SDK flattener cannot
encode the scoped table in a form the CLI accepts, the shim validates the input
then rewrites only its filesystem override to
`{":workspace_roots"={"."="read"}}`. It also injects `--strict-config` and
sets all required shell, app/connector/plugin, hosted-browser/web-search,
MCP-app, tool-suggestion, and Computer Use feature flags false. Built-in
`:read-only` is explicitly rejected because it permits root-wide reads. Custom
`:minimal` is also rejected because pinned macOS defaults permit broad
system/shared-temp reads and shared-temp writes. Thread options contain only the validated
app-owned working directory, `skipGitRepoCheck: true`, `approvalPolicy:
"never"`, and `webSearchMode: "disabled"`. Legacy sandbox/network/web-search
booleans and additional directories are omitted.

## Supervisor control boundary

Process telemetry is never placed in the model-readable AI workspace. Beneath
an already-existing, real, owned, non-writable-by-group/other parent outside
the workspace, the supervisor exclusively creates a new control directory at
mode `0700` and a new control file with `O_CREAT|O_EXCL|O_NOFOLLOW`. It sets and
verifies file mode `0600` through the open handle; it never recursively creates
or path-chmods an existing target. Pre-existing directories, control-directory
symlinks, and parents resolving into the workspace are rejected without
changing target permissions or content.

The shim opens the existing file with `O_NOFOLLOW`, verifies regular-file
ownership/mode and the external directory boundary, and appends an exact
`started` event only after it has a positive child PID. Each event carries run,
parent, invocation, shim/child PID, and time identity. It appends the matching
`completed` event (`natural` or `cancelled`) only after the direct helper has
settled and a POSIX `kill(-pgid, 0)` probe reports `ESRCH`. The audit validates
the append-only state machine, rejects
duplicate/out-of-order/conflicting events, skips completed invocations without
signaling their possibly reused PIDs, and signals at most one coherent active
invocation. For an active invocation it terminates the distinct shim PID and
the helper process group, verifies that both are extinct, and appends a
`supervisor` completion only if the terminated shim could not do so. Missing,
partial, malformed, stale, unrelated, non-positive/null-
PID, extra-field, or symlink telemetry fails closed before any PID is signaled.
OS-level spawn failure timing is nondeterministic, so deterministic coverage is
at the record-construction boundary: no `started` event can be built or
serialized without a positive child PID, and the executable shim checks the
spawned PID before appending.

The same-run/parent/freshness/state binding is designed for the product
threat—model-controlled activity confined by the workspace boundary—not an
arbitrary malicious process already running as the same OS user.

The helper preflight, shim, and supervisor share one injectable bounded
termination state machine. Cleanup sends TERM, escalates to KILL when scoped
processes remain, and stops at an absolute post-KILL deadline. Success requires
both direct-child settlement and an explicit process-group-extinction probe;
non-`ESRCH` signaling/probe errors fail closed. Deterministic tests cover a
cooperative wrapper with a TERM-ignoring same-group helper, fully ignoring
groups, direct-wrapper exit with a live group, SDK AbortSignal cancellation,
and a simulated no-exit path.

Negative-capability results use only out-of-band markers and observable SDK
events. Model-returned booleans are never accepted as proof of denial. Any
capability without a complete observable attempt/result trace—including direct
text, symlink, image/audio-shaped-byte reads—remains `proof_unavailable` and a
blocker.

## Scope and blockers

The TypeScript `echo_library_ids` implementation is a deterministic contract
model: closed input and output schemas, app-owned known-ID validation, five-ID
limit, content/structured-result equivalence, bounded result, sanitized errors,
and explicit read-only/non-destructive/idempotent/closed-world annotations. The
adjacent `python_mcp/` spike mirrors that contract with exact `mcp==2.0.0`, a
low-level `Server`, and a real official stdio client/server subprocess call;
its own README records the local evidence and direct-PID cleanup limit.

Deterministic official-SDK tests capture the exact generated registration argv
through the executable shim. Separate stream tests require exactly one
completed event for the expected server/tool/arguments, exact successful
status/result shape, equivalent text and structured content, exact known-ID
order, zero unknown IDs, and one matching structured assistant result. Failed,
duplicate, malformed, mismatched, and timed-out calls receive no credit;
timeout aborts the SDK stream and always invokes scoped cleanup. This proves
local composition and fail-closed credit logic with a fake packaged helper. It
is not an authenticated Codex-to-MCP service call or packaged
TypeScript/Python core-protocol parity proof, so P0-007 remains blocked.

The real probe safely seeds an app-workspace `AGENTS.md` marker but does not
modify the user's Codex home, config, MCP servers, plugins, credentials, or
keychain. Consequently it cannot prove exclusion of ambient user MCP/plugin
configuration while retaining the same auth. That is a hard architecture
blocker, not an accepted caveat. Synthetic audio-shaped bytes are never passed
as SDK image input; a path instruction alone cannot prove whether bytes moved,
so the report labels that observation narrowly.

Process-group cleanup proves only the recorded shim PID and helper process
group. A descendant that deliberately creates a different process group can
escape that scope. The deterministic escape fixture proves this limitation,
then explicitly kills and reaps the escaped fixture during test teardown. No
PID scanning is used. Real output therefore reports
`escaped_descendant_cleanup_unproven` and `proof_unavailable` as a blocker; it
does not make a generic descendant-survival claim.

The official-SDK executable tests use a local fake packaged helper only. They
prove exact start/resume/MCP-registration argv and AbortSignal cleanup at the
app boundary, not real service behavior. The corrected real runner reports
separate `lifecycle_start`, `lifecycle_resume`, `mcp_echo_tool`, negative-turn,
and descendant-audit stages and a fixed redacted category (`shim`, `config`,
`protocol`, `network`, `service`, `timeout`, `mcp` with an allowlisted reason, or
`cleanup` with `after_success`/`after_error`/`after_timeout`, or `unknown`).
`service` is emitted only when the local error explicitly identifies a
service/upstream failure; unmatched errors fail closed as `unknown`. A pre-fix
approved authenticated run stopped at `lifecycle_start` with category `config`;
it observed no MCP or sentinel turn and no surviving scoped shim/helper process.
The exact helper
regression reproduced the invalid SDK-flattened custom filesystem override. An
initial built-in `:read-only` correction parsed but failed independent review
because it allowed outside-workspace reads. A later custom `:minimal`
correction also failed review because it allowed broad system/shared-temp reads
and shared-temp writes. The final local correction uses the strict custom inline
profile without `:minimal` and requires exact MCP JSON, an unknown-key
strictness canary, and a model-free child-start probe. The exact pinned macOS
helper must return 134 with empty output and no workspace/shared-temp markers
before provider construction. This is a deliberate fail-closed capability
blocker: it does not prove a usable sandboxed command, direct built-in-tool
enforcement, or MCP execution. A post-permission authenticated run later reached
the MCP stage but crashed locally when timeout cleanup aborted an already-settled
SDK child signal. The corrected timeout helper aborts only when its deadline
wins; fulfilled and rejected operations run cleanup without a late abort. That
run supplies stage-reach/crash evidence only and receives no lifecycle or MCP
credit. A later corrected authenticated run returned a redacted exit-1 result at
`mcp_echo_tool`. Because that stage is assigned only after `runLifecycle`
returns, it narrowly credits existing-auth new/resume streams, exact thread-ID
reuse, stream exhaustion, and bounded known-ID application-validated structured
output after exact schemas were supplied. The historical validator did not
compare values, so exact/equal values are not credited. It does not credit a
specific completion event, cancellation, MCP, sentinels, ambient isolation, or
escaped-group cleanup. Its old `service` label was the unmatched fallback, so
the exact MCP-stage cause is unknown. Prospective runs now require exact IDs from
both lifecycle streams, preserve cleanup timing, and cannot treat a rejection
with no reason as success. The current deterministic package is 52/52 plus
typecheck.

Tagged Codex 0.146.0 source starts local stdio MCP servers directly from the
orchestrator in a distinct process group and attempts group termination when the
transport closes or drops. The exit-134 model-command preflight is therefore not
MCP launch evidence in either direction, and the shim's inherited-group audit
cannot prove MCP extinction. Another opt-in run requires material diagnostic,
runtime, or containment change rather than repeating the same probe.
