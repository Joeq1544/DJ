# ADR-0002: Codex SDK Language

- Status: Accepted
- Date: 2026-08-09
- Owners: primary, codex-mcp specialist

## Context

Production AI must reuse existing Codex/ChatGPT authentication, persist thread identifiers where supported, stream, cancel, enforce timeouts/sandbox/workdir controls, and validate structured outputs. Exactly one production SDK path is allowed.

## Personal-use acceptance — 2026-08-10

Use the official TypeScript Codex SDK in Electron main as the single production AI path. It must reuse existing Codex/ChatGPT authentication; an API-key provider remains prohibited. The app assumes the same logged-in macOS user and the normal Codex capabilities that Joe already accepts are trusted.

Strict structured outputs, validated library IDs, bounded app-owned tools, renderer isolation, path checks, source-data immutability, and trusted-UI confirmation for consequential writes remain required. P0-016, perfect ambient-configuration isolation, complete descendant tracking, and exhaustive negative-capability sentinels are not acceptance conditions for this personal MVP.

The detailed Phase 0 record below remains exact historical evidence. Its missing real MCP, sentinel, and containment results are accepted limitations rather than passes or current feature-development blockers. Revisit the boundary if ordinary M6 use fails, the app is shared publicly, or its threat model expands.

## Decision

Use the official TypeScript Codex SDK in Electron main. Hide it behind `AIProvider`; automated tests and CI use `MockAIProvider`. Do not implement an OpenAI API-key provider. P0-006 will exercise exactly `@openai/codex-sdk@0.146.0` with its matching packaged runtime and lockfile integrity, without upgrading or overriding it with the ambient CLI 0.144.1. This exact spike pin is not production acceptance.

## Alternatives

- Python Codex SDK in the worker: fewer app processes involved in AI-to-MCP calls, but may couple remote reasoning to data/analysis responsibilities and have different auth/lifecycle maturity.
- Codex CLI subprocess without SDK: useful as a diagnostic fallback during the spike, but insufficient as the intended production abstraction unless official SDK limitations force and document an adjustment.

Exact Python 0.144.4 source inspection keeps the first alternative viable but
does not establish safety. Its `CodexConfig` exposes `launch_args_override`, and
its public surface has typed account, start/resume, streaming/interrupt,
structured-output, and deny-all approval operations. However, the low-level
client merges rather than replaces the ambient process environment, keeps a raw
stderr tail for transport exceptions, directly terminates only its app-server
child, and uses an accepting default approval handler if a request reaches that
layer. Any fallback experiment must therefore run in a separate app-owned
sanitized process, provide an explicit always-decline handler in addition to
deny-all mode, redact exceptions before crossing the process boundary, and prove
descendant cleanup. Running it inside the DJ core would violate the intended
raw-media/AI separation unless the overall process topology is revised.

## Historical Phase 0 decision evidence gate

Source/release inspection is complete and favors TypeScript 0.146.0 over the older Python 0.144.4 path, with Python retained as a single fallback only. Executable evidence must still exercise existing auth, new/resumed threads, streaming events, cancellation, structured output, application timeout, working directory, MCP configuration, error semantics, temporary-schema removal, and complete child/grandchild cleanup from the intended process.

The primary blocking experiment is authentication versus configuration isolation. A separate `CODEX_HOME` excludes ambient config/MCP/plugins but does not transparently reuse file or keyring authentication; the real Codex home can reuse auth but recursively inherits ambient configuration, and an empty SDK `mcp_servers` table does not clear it. Direct runtime 0.146.0 supports `codex exec --ignore-user-config --ignore-rules` while retaining auth from the same Codex home, but the stock TypeScript SDK cannot request either flag and exposes no arbitrary-argument/profile option. The spike must prove both existing ChatGPT login reuse and exclusion of an intentionally seeded undeclared MCP/plugin without reading, copying, or symlinking credentials. It may test a narrowly validated app-owned `codexPathOverride` wrapper that injects only those supported flags, but that is an architecture adjustment—not stock SDK behavior—and requires its own argument, helper-version, lifecycle and packaging evidence. Login status must invoke the matching package wrapper, accept only exact exit-0 `Logged in using ChatGPT`, classify every other mode safely, and never log raw stderr because API-key status intentionally contains a partial key.

Do not pass legacy `ThreadOptions.sandboxMode`, `networkAccessEnabled`, or `additionalDirectories` alongside the 0.146.0 permission profile: those are legacy or boundary-expanding paths. The SDK-side diagnostic configuration names custom `dj_read`, workspace-root read, profile network false, approval policy `never`, top-level web search disabled, shell/apps/connectors/MCP apps/plugins/tool suggestion/hosted browser/Computer Use feature flags disabled, and app defaults disabled. Because the SDK flattens the scoped table into an invalid dotted CLI override, the exact-argv shim rewrites only that entry to a strict inline workspace-read table and injects `--strict-config`. Built-in `:read-only` is rejected because tagged source and a model-free probe show root-wide reads. Custom `:minimal` is also rejected: tagged macOS defaults and an exact-profile probe show broad system/shared-temp reads and shared-temp writes, and explicit path denies did not carve those defaults out. Before provider use, the matching helper must report the exact MCP config, reject an unknown-key canary under strict mode, and prove that the no-`:minimal` profile fails sandboxed child startup closed with exact pinned exit 134, empty output, and no workspace/shared-temp markers. This is intentionally a capability blocker, not proof that an inside command can run. Profile network controls only sandboxed local processes, not provider/MCP/hosted transport. Runtime 0.146.0 has no effective switch for direct `apply_patch` or `view_image`, and the public SDK cannot inspect the constructed tool inventory before a turn, so authenticated sentinels must still establish direct-tool denial rather than infer it from the child-start probe. They must cover outside-workspace text/image/audio-shaped reads, symlink aliases, shell and `apply_patch` marker creation, music-root working directories, ambient MCP/plugins, hosted web/browser/app/connector access, and any undeclared filesystem/network capability. No approval/auto-review path may authorize them. If any forbidden capability succeeds, the required MCP cannot run safely, the accepted contract requires unavailable pre-turn absence proof, auth isolation requires credential handling, or cleanup leaves a descendant, ADR-0002 remains blocked and the architecture must change.

Record applicable SDK/service/auth terms separately from the Apache-2.0 source license.

## Historical Phase 0 evidence and disposition

The exact `@openai/codex-sdk@0.146.0` and matching `@openai/codex@0.146.0`
packages are installed under an isolated spike lockfile. Deterministic tests prove
the stock SDK's start argv reaches a narrowly validating app-owned wrapper, the
wrapper injects only `--ignore-user-config --ignore-rules`, helper/login output is
classified without returning raw stderr, legacy expansion options are absent,
workspace paths and structured results fail closed, and application deadlines
and local-only behavior have unit coverage. These results do not accept the
wrapper or this ADR.

The earliest authenticated real probe observed exact ChatGPT auth but exited
during `new_resume_lifecycle` with the old stable category
`sdk_or_service_failure`. A later run exposed the exact custom-profile parse
defect. Those historical runs completed no lifecycle and supply no denial
evidence. They are retained as chronology rather than the current disposition.
The public SDK still cannot supply a complete pre-turn tool inventory, and
ambient user MCP/plugin exclusion cannot be deliberately seeded without
modifying forbidden user state.

The first independent implementation review rejected the evidence package
because PID telemetry could target unrelated processes, TERM escalation could
miss an ignoring grandchild, model self-report could produce false-clean
capability results, official-SDK resume/cancellation evidence was incomplete, and
the TypeScript MCP contract lacked a closed output schema. Bounded TDD repairs
now pass 36/36 deterministic tests and typecheck, and the final independent
review reproduced both with no unresolved high/medium local finding. The
reviewed wrapper proves validated supervisor state, fake official-SDK
start/resume/cancel, closed MCP input/output contracts, and extinction of its
shim plus inherited helper process group. It explicitly reports a descendant
that creates another process group as `proof_unavailable`; it does not claim OS-
level containment.

The candidate now also registers one exact required local Python MCP server and
one allowlisted read-only tool through the validated override. Coherent
started/updated/completed call identity, arguments, result, assistant JSON,
timeouts, duplicates, and cleanup brought the reviewed TypeScript package to
43/43 plus typecheck; the 9/9 Python MCP transport remains green. A later
actual-helper regression exposed the invalid custom-profile serialization. A
first parse-only correction to built-in `:read-only` failed review because it
allowed root-wide reads. A second correction using custom `:minimal` failed a
fresh review because the pinned macOS defaults allow system/shared-temp reads
and shared-temp writes. The strict inline profile now omits `:minimal`; it
passes the exact MCP-config and unknown-key gates, while the actual-helper
child-start probe fails closed at exact exit 134 with no output or markers. The
pre-taxonomy full TypeScript package was 47/47 plus typecheck. This is
fake-service/local-transport, strict-config, and fail-closed unavailability
evidence. It does not prove a usable sandboxed child, real service event
sequence, direct built-in-tool enforcement, ambient environment/config
exclusion, or actual Codex-to-MCP use.

Tagged 0.146.0 source selects `LocalStdioServerLauncher` for a local stdio MCP
registration. It starts the configured server directly as an orchestrator child
in a new process group and attempts process-group termination on transport
close/drop. The model-command sandbox exit-134 preflight therefore neither
proves nor disproves MCP startup, while the shim's inherited-group audit cannot
prove MCP extinction. Direct MCP process/call/cleanup evidence remains required.

One authenticated rerun after the permission correction entered the MCP stage
but produced no redacted result because timeout cleanup aborted an already-
settled SDK child signal and Node raised an unhandled `AbortError`. It receives
stage-reach/crash credit only. A two-step regression correction now aborts only
when the total deadline wins; fulfilled and rejected operations run cleanup
without a late abort. The scoped reviewer reproduced the failure and reported
PASS after the final 47/47 suite/typecheck correction.

The corrected authenticated rerun then returned a sanitized exit-1 result at
`stage=mcp_echo_tool`. That stage is assigned only after `runLifecycle` returns,
so the result narrowly proves that exact 0.146.0 reused existing ChatGPT auth,
completed and exhausted one new and one exact-ID-resumed stream, published a
non-null thread ID, supplied the exact output schema to both, and returned a
bounded application-validated known-ID structured result from each turn. The
historical validator did not compare the two values, so equality or exact
`fixture-1` output is not retroactively credited. A later regression now
requires exact expected IDs from both streams for future runs. `runLifecycle`
does not require a particular
`turn.completed` event, so none is credited. The stage is assigned before
`runRequiredMcpEcho`; that function did not return, and no MCP discovery,
startup, inventory, call, argument, result, or success is credited. The sentinel
turn never began.

The run's `{category:"service"}` value was the old unmatched-error fallback,
not evidence of an upstream outage; the exact MCP-stage cause is unknown. TDD
now reserves `service` for explicit service/upstream messages, falls back to
`unknown`, and emits only allowlisted MCP-stage reasons. Independent correction
review also found and fixed cleanup-error overwrites, historical lifecycle-value
overcredit, and reasonless-rejection false success. Cleanup now reports whether
it followed success/error/timeout; future lifecycle runs require exact expected
IDs from both streams; and `Promise.reject()` cannot resolve as MCP success. The
local package now passes 52/52 plus typecheck and the integrated Phase 0 gate
passes 186/186 plus all three typechecks. Because
0.146.0 remains the official npm `latest` tag inspected on 2026-08-09, another
identical external run is not justified. A future opt-in run requires material
diagnostic, runtime, or containment change.

The intended-process SDK/auth checkbox is therefore met only for the
Node/Electron-main-compatible probe, not packaged Electron. P0-006 remains
blocked on the executable capability boundary, real cancellation, same-auth
ambient isolation, sentinels, and complete descendant containment. P0-007
remains blocked until a real Python MCP 2.0 stdio tool call and authoritative MCP
group cleanup are exercised. The 52-test local evidence does not accept this
ADR.

## Later implementation verification

Phase 5 implements the production provider, mock CI, UI auth lifecycle, adversarial MCP/metadata tests, and opt-in real smoke test. Phase 9 verifies the selected SDK/auth/child behavior from the packaged application. Those later gates validate the implementation rather than select the SDK language.

## Consequences

Electron main is the only production AI integration point. Raw audio and unrestricted user directories remain outside its dedicated Application Support Codex workspace, which receives generated self-contained instructions rather than inheriting repository or music-root instructions. Invalid structured output gets strict application parsing/validation and at most one corrective retry before safe failure. The matching Codex helper is unpacked to a real signed resource path rather than spawned inside ASAR; the provider adds its own timeout, error taxonomy, concurrency control, and descendant cleanup.
