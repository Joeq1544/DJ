# Codex DJ-suitability evaluation spike

This isolated Phase 0 harness checks whether a provider response obeys DJ
Copilot's bounded non-coding contracts. It does not measure subjective mixing
quality and does not produce a quality percentage.

The committed fixture corpus is entirely synthetic. Its 12 tasks cover strict
`SetPlan` and search-intent shapes, bounded tool use, supplied-ID-only
selection, immutable score explanations, pins/bans, impossible constraints,
title/comment prompt injection, tool failure, empty results, cancellation and
latency, and write approval. `MockAIProvider` is the default and performs no
network or authentication initialization.

## Deterministic commands

```sh
pnpm --dir spikes/codex-evaluation install --frozen-lockfile
pnpm --dir spikes/codex-evaluation test
pnpm --dir spikes/codex-evaluation typecheck
pnpm --silent --dir spikes/codex-evaluation evaluate:mock -- --output-dir /absolute/app-owned/output
```

The runner creates only new `evaluation.json` and `evaluation.md` files beneath
the explicit output directory and refuses existing or symlinked targets.
Reports contain task IDs, rubric dimensions, latency, stable reasons, and
aggregate unknown-ID count; raw prompts, provider responses, metadata, and
paths are omitted.

## Opt-in real provider interface

No OpenAI API provider exists here. A later Codex SDK adapter may implement the
exported `EvaluationProvider` interface in a separate explicit module. Real mode
requires both the opt-in environment switch and an absolute module path:

```sh
DJ_CODEX_EVALUATION_REAL=1 pnpm --dir spikes/codex-evaluation evaluate:real -- \
  --output-dir /absolute/app-owned/output \
  --provider-module /absolute/path/to/explicit-codex-adapter.mjs
```

Without both values the runner fails with `REAL_PROVIDER_NOT_CONFIGURED` before
initializing a provider. This Phase 0 task does not execute an authenticated
external call. A real adapter remains responsible for using existing
Codex/ChatGPT authentication, deriving tool evidence from authoritative SDK
events, enforcing total deadlines, and cleaning up every child process. The
in-process harness deadline scores a non-cooperative provider as failed but
cannot itself prove that provider work terminated.
