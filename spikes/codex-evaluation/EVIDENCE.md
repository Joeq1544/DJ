# Phase 0 Codex DJ-suitability harness evidence

Date: 2026-08-09
Scope: deterministic evaluation harness only; no Phase 0 gate or ADR claim

## Implemented boundary

- Twelve generated fixture tasks cover strict `SetPlan` JSON, search filters,
  bounded MCP use and supplied IDs, immutable transition-score explanations,
  user pins/bans, impossible constraints, hostile title/comment metadata, tool
  errors, empty results, cancellation/latency, and write approval.
- The independent rubric returns per-task schema, tool, ID, constraint,
  injection, explanation, latency, cancellation, and approval checks. It also
  records exact unknown IDs and an aggregate unknown-ID count; it computes no
  quality percentage.
- Mutation tests prove rejection of fabricated IDs in selections and tool
  arguments, changed immutable scores, rewritten SetPlan constraints,
  pin/ban/count violations, unapproved write calls, metadata canaries,
  forbidden metadata-directed tools, bad schemas, wrong tool choice, and missed
  cancellation/deadlines.
- `MockAIProvider` is deterministic and initializes no network, authentication,
  or real-provider adapter.
- The real-provider command fails closed unless the caller supplies both
  `DJ_CODEX_EVALUATION_REAL=1` and an absolute explicit provider module. There
  is no OpenAI API provider in this spike.
- Reports contain rubric results rather than prompts/provider responses and
  write only `evaluation.json` and `evaluation.md` beneath an explicit output
  directory. The CLI does not print that path.

## TDD evidence

1. Initial `pnpm --dir spikes/codex-evaluation test` exited 1 because the
   intentionally absent `src/rubric.ts` made the boundary unimplemented.
2. The first implementation run executed 12 tests: 11 passed and one failed on
   insufficiently specific constraint evidence; the reason was made explicit.
3. Three added adversarial regressions failed before their fixes: hidden MCP
   argument IDs, rewritten SetPlan constraints, and an output-path disclosure.
4. The documented pnpm command then reproduced a literal-separator parsing bug
   as `INVALID_CLI_ARGUMENT`; the CLI test was changed to the exact invocation
   before the parser accepted the single separator.

## Deterministic results

- Exact test command: `pnpm --dir spikes/codex-evaluation test`
- Exact typecheck command: `pnpm --dir spikes/codex-evaluation typecheck`
- Mock report command: `pnpm --silent --dir spikes/codex-evaluation evaluate:mock -- --output-dir <explicit-directory>`
- Implementer verification reached 16/16 twice. Primary integration then
  reproduced three false-clean counterexamples as failing tests: a track ID in
  assistant prose/nested argument arrays was invisible, a known but unreturned
  tool ID could be selected, and a malformed provider response crashed before
  schema scoring. The bounded correction scans fixture-ID tokens through
  bounded/cycle-safe response traversal, requires selected IDs to come from
  observed successful tool results when a tool is required, and gates semantic
  checks behind runtime schema validity.
- Two further adversarial regressions first reproduced a depth-bound scan that
  could miss a hidden ID and a symlinked report file that could overwrite its
  target. The scanner now marks any depth/node truncation as a failed ID check,
  and both named report files must be absent and are created exclusively.
- An independent follow-up review then reproduced five more false-clean or
  disclosure cases: the documented package command echoed its output path;
  bounded scans silently truncated long strings and retained arbitrary values
  under ID-shaped keys; fixture/response schemas were shallow; injection
  canaries in tool arguments were ignored; and SetPlan selections could
  contradict exclusions or publish incoherent segment ranges. All five were
  added as failing regressions before correction. The rubric now uses the
  genuinely silent package command, validates complete fixture/response/tool
  shapes, fails closed without retaining malformed ID-shaped values, scans the
  complete bounded response for canaries independently of schema validity, and
  cross-checks selections plus contiguous segments against the plan duration.
- The first re-review confirmed those five corrections and found two remaining
  gaps: `Object.entries` invoked every getter before the traversal budget could
  stop, and behavior categories could omit the stimuli/assertions they claimed
  to cover. New red tests now require data-property-only incremental traversal
  that never invokes accessors and category-specific evidence for grounding,
  explanation, overrides, impossible/error/empty outcomes, injection,
  cancellation, and write approval.
- A second re-review found two narrower traversal branches: injection object
  iteration continued reading descriptors after its node counter reached zero,
  and the ID-shaped-array shortcut used `slice`, which invoked accessors. Both
  now have red/green regressions; object iteration checks its remaining budget
  before descriptor access, and ID arrays are inspected only through bounded
  data-property descriptors without invoking getters.
- Fresh primary counts after correction: 30 tests, 30 passed, 0 failed;
  typecheck exit 0; 12 evaluated tasks, 12 rubric passes, 0 failures, aggregate
  unknown-ID count 0. The final independent re-review reproduced the corrected
  boundary and reported no unresolved High or Medium finding.
- Dependency lock: `typescript==6.0.2`, `@types/node==25.0.3`, with package
  integrity in the spike-local `pnpm-lock.yaml`.

## Classification and limits

- Fully automated: fixture loading, mock execution, every rubric dimension,
  mutation rejection, cooperative mock cancellation signaling, bounded runner
  deadline scoring, report redaction/exclusive output confinement, real-mode
  fail-closed behavior, and TypeScript checking.
- Authenticated external: not run and not claimed. A later explicit Codex SDK
  adapter must be supplied before these tasks measure real provider behavior;
  it must derive tool evidence from authoritative SDK events and prove provider
  process termination because an in-process promise deadline cannot do so.
- Subjective DJ quality: intentionally not evaluated. Passing means the mock
  response satisfies the encoded engineering contract, not that a set or
  transition is artistically good.
- Injection coverage is canary- and forbidden-tool-based for these synthetic
  fixtures; broader paraphrase/adversarial coverage belongs in later real and
  deterministic evaluation expansion.
- No user paths, music, Rekordbox data, credentials, or authenticated provider
  calls were accessed.
