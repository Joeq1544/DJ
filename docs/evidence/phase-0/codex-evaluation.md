# Phase 0 Codex DJ-Suitability Evaluation Evidence

Date: 2026-08-09
Task: P0-008
Disposition: **deterministic harness and independent review green; real provider pending**

## Boundary

`spikes/codex-evaluation/` contains twelve synthetic tasks and an independent
runtime rubric. The default `MockAIProvider` uses only committed fixture
responses and initializes no authentication, network, MCP server, or real
provider. There is no OpenAI API provider. Real mode requires an explicit
environment opt-in, absolute adapter module, and output directory; no
authenticated call was made.

The tasks cover SetPlan JSON, search filters, tool grounding, supplied-ID-only
behavior, immutable score explanation, user pins/bans, impossible constraints,
hostile title/comment metadata, tool error, empty result, cancellation/latency,
and unapproved writes. Reports expose per-task schema, tool, ID, constraint,
injection, explanation, latency, cancellation, and approval checks plus the
aggregate unknown-ID count; they contain no quality percentage.

## Deterministic result

```text
pnpm --dir spikes/codex-evaluation test
30 tests, 30 passed, 0 failed

pnpm --dir spikes/codex-evaluation typecheck
exit 0

pnpm --silent --dir spikes/codex-evaluation evaluate:mock -- --output-dir <explicit temp directory>
12 tasks, 12 rubric passes, 0 failures, aggregate unknown-ID count 0
```

The primary reproduced the suite, typecheck, and bounded JSON/Markdown report.
The report contains task/rubric results only; prompt/response/metadata bodies and
paths are omitted. The command prints only a stable completion message rather
than the explicit output path.

The specialist's first final package passed 16 tests twice. Primary integration
then reproduced three additional false-clean cases before correction: fixture
track IDs hidden in assistant prose or nested argument arrays were not counted,
a selected known ID need not have appeared in actual tool results, and malformed
provider output could crash before receiving a schema score. Two later red tests
showed that a fabricated ID could be hidden beyond the bounded traversal and a
pre-existing symlinked report file could be followed. A subsequent independent
review found five additional cases involving package-manager path output,
string/node truncation and unsafe ID-shaped values, shallow fixture/response
validation, tool-argument injection canaries, and contradictory SetPlan
selections/segments. Each was reproduced as a failing test before correction.
That re-review confirmed the five corrections but exposed accessor-backed
objects that could execute beyond the node budget and behavior categories that
could omit their claimed stimuli. Both were reproduced before correction. The
second re-review exposed an injection loop that continued descriptor reads
after exhaustion and an ID-array shortcut that invoked accessors; both were
reproduced and corrected. The current 30-test result uses incrementally bounded
data-property-only traversal without invoking object or ID-array accessors,
fails closed on incomplete traversal, retains no arbitrary
malformed ID values, validates closed nested and category-specific contracts,
scans the bounded complete response for canaries, enforces coherent contiguous
SetPlan segments and selection constraints, and uses a tested silent package
command. The final independent re-review reproduced the corrected boundary and
reported no unresolved High or Medium finding.

## Non-claims and external prerequisite

Twelve mock fixture passes measure the rubric and deterministic provider, not
Codex suitability or artistic DJ quality. The real adapter is absent, P0-006 is
blocked, and the execution environment requires separate informed approval
before synthetic probe context is sent to the external Codex service. Until an
authenticated redacted run executes, no real latency, cancellation, injection,
tool-use, or reasoning result can be claimed.

The future adapter must construct tool-call/result evidence from authoritative
SDK events rather than model-authored fields. The in-process harness can abort a
cooperative provider and return a deadline score, but cannot prove that a
non-cooperative provider or its child process stopped; that remains an adapter
and supervisor verification requirement.
