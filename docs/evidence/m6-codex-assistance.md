# M6 Codex Assistance Evidence

- Date: 2026-08-11
- Status: complete and pushed at `fd0984e`
- Plan: `docs/superpowers/plans/2026-08-11-m6-codex-assistance.md`
- ADR: `docs/adr/0009-codex-assistance-orchestration.md`

## Current research evidence

- Official Codex manual refreshed 2026-08-11. Its SDK section documents TypeScript server-side Node 18+, start/continue/resume, and `new Codex()`; its auth section documents cached ChatGPT login reuse and `codex login status`.
- npm `latest` is `@openai/codex-sdk@0.147.0`. Exact source tag `rust-v0.147.0`, commit `be6e8eac029b183056b7e4402879f15d2c85f61b`, SDK integrity `sha512-nJL0maDBZy31uEArs+u46tW22veNdHjfs96AGaFTnI3jF+g8U+a422uaPiDZwEKmyxcNwStTRz6sIh6C7XxGFQ==`, Apache-2.0.
- The 0.147.0 published `dist/index.d.ts` and `dist/index.js` are byte-identical to the local reviewed 0.146.0 wrapper; exact matching CLI/runtime changes from 0.146.0 to 0.147.0.
- The public API supplies `startThread`, `resumeThread`, `runStreamed`, structured lifecycle/item events, output schema, opaque thread IDs, and `AbortSignal`. It does not parse/validate final JSON or provide in-process tool callbacks.
- The initial login check returned `Logged in using ChatGPT`; the completed real smoke below separately proves the production provider path.
- The current OpenAI model resolver returned `gpt-5.6-sol` and current prompt guidance favors concise outcome/success/evidence/output/stop contracts. M6 leaves the Codex model unset to respect entitlement/default behavior and validates the real flow instead of introducing a model picker.

## Implemented boundary

- `CodexProvider` lazy-loads the externalized official ESM SDK, requires the exact matching 0.147.0 helper, accepts only existing ChatGPT authentication, filters provider credential/base-URL overrides before reading their values, and uses one bounded empty read-only workspace with web search disabled.
- Strict output schemas use a root object, closed required properties, nullable optional sentinels, and typed constants as required by the live structured-output endpoint. Application parsing strips only the nullable filter sentinels, revalidates with Zod, and retries one invalid result on the exact same opaque thread.
- The main-owned coordinator exposes only status/login/start/poll/cancel/confirm, retains at most one active request, caps and expires in-memory state, and routes current path-free context through existing local core operations. Search/explanation are read-only; plan and one revision stay single-use proposals until confirmation.
- The renderer exposes Search, Plan set, Revise draft, and Explain in the existing Library screen. Merely opening the app performs no Codex status/helper call: checking status, signing in, or running Copilot is an explicit user action.
- Production contains zero MCP servers or tools. The direct development-only `@modelcontextprotocol/sdk@1.24.0` dependency is present solely because the published Codex SDK declaration imports its `ContentBlock` type without declaring a resolvable package dependency; it does not enter the production dependency graph or add runtime MCP behavior.

## Verification evidence

- Provider tests pass 29/29 across exact auth/helper matching, environment filtering, lazy SDK load, new/resumed streams, strict parsing, one corrective retry, timeouts, cancellation, late-event suppression, and deterministic mock behavior.
- Focused contract/context/prompt/coordinator/renderer tests pass after review corrections. Strict typecheck and the production main/renderer build pass.
- Generated mock Electron flow passes all four workflows: filters/Similar/Next, plan preview then confirmation, one revision preview then confirmation, grounded explanation, cancellation, persistence, immutable source hashes, and runtime cleanup. It first observes `Copilot status not checked` and performs the status lookup explicitly.
- The explicit real smoke passes with exact SDK 0.147.0 and existing ChatGPT authentication: structured search, structured set plan on the exact resumed thread, real AbortSignal cancellation, explicit renderer status check, and production Electron-main search/plan behavior. It records only booleans; response text is not recorded.
- The single bounded reviewer found three Medium normal-workflow defects: implicit status lookup on mount, a safe no-op revision mislabeled invalid, and numeric track-title metadata rejected by grounding. RED/GREEN regressions now make status explicit, return/render `unchanged`, and allow numeric tokens copied from bounded context while continuing to reject invented numbers and unknown IDs. The reviewer also identified and this record corrects the stale MCP type-dependency sentence.
- Final post-review `pnpm verify:m6` passes 151/151 core tests, 219/219 desktop tests, strict TypeScript, the production build, and all seven deterministic Electron flows; the real smoke is intentionally separate and was rerun after the explicit-status correction. The reviewer returned READY with no unresolved High/Medium normal-workflow defect.

No personal library, audio, credential content, authenticated response text, screenshot, or visual QA has been used or claimed. Joe explicitly deferred visual QA until the completed M1–M7 app.

Closure checkpoint `fd0984e` is pushed to `origin/main`.

## Shared-contract checkpoint

- Checkpoint: `38465d3`, pushed to `origin/main`.
- Exact `@openai/codex-sdk@0.147.0` and its matching 0.147.0 runtime are locked. Strict typecheck exposed the SDK declaration's external `ContentBlock` import, so exact development-only `@modelcontextprotocol/sdk@1.24.0` supplies that type contract without adding a production MCP server.
- The CJS Electron main build externalizes the ESM SDK so its complete native runtime remains available for lazy runtime import.
- Strict Zod schemas now cover auth status, four task kinds, local search results, bounded ordered events, plan/revision proposals, cancellation, polling, and single-use confirmation results. The frozen preload exposes six named assistant operations and no generic invoke surface.
- Focused contract/preload verification passed 7/7 tests. Strict TypeScript typecheck and the production main/renderer build passed.
