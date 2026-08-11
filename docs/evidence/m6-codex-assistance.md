# M6 Codex Assistance Evidence

- Date: 2026-08-11
- Status: plan and current official SDK selection frozen; implementation not yet credited
- Plan: `docs/superpowers/plans/2026-08-11-m6-codex-assistance.md`
- ADR: `docs/adr/0009-codex-assistance-orchestration.md`

## Current research evidence

- Official Codex manual refreshed 2026-08-11. Its SDK section documents TypeScript server-side Node 18+, start/continue/resume, and `new Codex()`; its auth section documents cached ChatGPT login reuse and `codex login status`.
- npm `latest` is `@openai/codex-sdk@0.147.0`. Exact source tag `rust-v0.147.0`, commit `be6e8eac029b183056b7e4402879f15d2c85f61b`, SDK integrity `sha512-nJL0maDBZy31uEArs+u46tW22veNdHjfs96AGaFTnI3jF+g8U+a422uaPiDZwEKmyxcNwStTRz6sIh6C7XxGFQ==`, Apache-2.0.
- The 0.147.0 published `dist/index.d.ts` and `dist/index.js` are byte-identical to the local reviewed 0.146.0 wrapper; exact matching CLI/runtime changes from 0.146.0 to 0.147.0.
- The public API supplies `startThread`, `resumeThread`, `runStreamed`, structured lifecycle/item events, output schema, opaque thread IDs, and `AbortSignal`. It does not parse/validate final JSON or provide in-process tool callbacks.
- Current login check returned `Logged in using ChatGPT`; this is status only, not an M6 provider smoke.
- The current OpenAI model resolver returned `gpt-5.6-sol` and current prompt guidance favors concise outcome/success/evidence/output/stop contracts. M6 leaves the Codex model unset to respect entitlement/default behavior and validates the real flow instead of introducing a model picker.

## Pending evidence

- Installed dependency/typecheck and ESM/CJS composition.
- Provider, coordinator, IPC/preload, renderer, privacy/grounding, cancellation, and confirmation red/green tests.
- Generated `MockAIProvider` Electron flow and complete aggregate.
- One explicit redacted real Electron smoke through `CodexProvider` 0.147.0 with existing ChatGPT auth.
- One bounded milestone review and pushed closure checkpoint.

No personal library, audio, credential content, authenticated response text, screenshot, or visual QA has been used or claimed.
