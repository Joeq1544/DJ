# DJ Copilot Evaluation

Status: deterministic generated-audio and mock Codex engineering evaluations executed; real-music and authenticated Codex suitability not executed
Last updated: 2026-08-11

## Reporting rules

Do not publish invented quality percentages. Every result records dataset/fixture provenance, sample count, environment, exact provider/version, command, raw redacted artifact, and limitations. Engineering correctness and subjective DJ quality are separate.

## Phase 0 Codex suitability rubric

The opt-in harness contains twelve fixture tasks spanning search-intent parsing, set-plan parsing, MCP use, supplied-ID-only behavior, faithful score explanation, user overrides, impossible constraints, malicious metadata, tool errors/empty results, cancellation, and rejection of unconfirmed writes.

Score each task on:

- schema validity;
- hallucinated/unknown track ID count (required total: zero);
- correct bounded tool selection;
- hard/soft constraint adherence;
- prompt-injection resistance;
- explanation fidelity to immutable component data;
- latency, timeout, and cancellation behavior.

Any weak reasoning task moves into deterministic code; Codex remains only for interpretation or grounded explanation. Automated CI uses `MockAIProvider`; a real authenticated report is opt-in and redacted.

## MIR evaluation categories

- Known-BPM click fixtures and half/double-time classification.
- Known amplitude/energy sections and pipeline plumbing.
- Key/structure accuracy only with provenance-labeled legal evaluation material.
- Search precision@k on a hand-labeled fixture query set.
- Transition acceptance on a small user-reviewed set, reported as subjective and sample-limited.
- Set constraint adherence and unknown-ID count.

## Result ledger

| Date | Evaluation | Result | Evidence | Interpretation |
| --- | --- | --- | --- | --- |
| 2026-08-09 | Generated 120-BPM PCM click/energy fixture | Engineering baseline passed: 7 tests twice; exact regenerated hash and sample-derived measurements matched | `evidence/phase-0/audio-analysis.md` | Proves only deterministic fixture generation, bounded measurement/isolation, and rubric plumbing; it is not real-music tempo/MIR accuracy evidence |
| 2026-08-09 | Twelve-task synthetic Codex DJ-suitability rubric with `MockAIProvider` | Primary verification after independent-review corrections: 30/30 tests, typecheck green, 12/12 mock fixture results, aggregate unknown-ID count 0; final independent re-review found no High or Medium issue | `evidence/phase-0/codex-evaluation.md`; `../spikes/codex-evaluation/EVIDENCE.md` | Proves the executable rubric/mock/report boundary only; it is not Codex quality, authenticated integration, authoritative tool telemetry, provider termination, or subjective DJ-quality evidence |
| 2026-08-11 | M2 generated clicks/harmonic/silence/corrupt desktop flow | Post-review aggregate passed 56/56 core and 62/62 desktop tests plus 3/3 Electron flows; 120-BPM clicks and C-major harmonic evidence displayed, silence stayed unknown, corrupt input failed alone, pause survived restart, results survived reload, and all four source hashes stayed exact | `evidence/m2-local-analysis.md` | Proves the development provider, queue, boundary, reimport integrity, dependency degradation, and UI plumbing on generated fixtures; it is not real-music tempo/key accuracy, broad codec, thermal, structure, embedding, or packaged-runtime evidence |
| 2026-08-11 | M3 eight-track generated metadata/feature discovery flow | Post-review aggregate passed 81/81 core and 104/104 desktop tests plus 4/4 Electron flows; playlist-aware text+BPM filtering returned the exact two signals, Similar ranked Double Echo first, `genre_shift` ranked Élan Bridge first, explanations exposed bonus/penalty/missing evidence, reload preserved behavior, generated sources retained their hashes, and repeated playlist positions have a focused regression | `evidence/m3-discovery-recommendations.md` | Proves deterministic search/ranking contracts and production desktop plumbing on a small designed fixture; it is not personal-library relevance, subjective transition quality, visual quality, or large-library performance evidence |
| 2026-08-11 | M4 generated official-XML set workflow | Post-review aggregate passed 119/119 core and 116/116 desktop tests plus 5/5 Electron flows; official numeric-KeyType import preserved a repeated position, structured edits/pins/bans/replacement/goals/optimization/history/versions and playlist/draft inspection crossed the production boundary, cancel/new/overwrite export reparsed through the production importer with exact order, restart preserved the draft, and generated source hashes/runtime cleanup passed | `evidence/m4-set-workflow-export.md` | Proves deterministic set/export engineering behavior on a five-track designed fixture; it is not subjective set quality, real Rekordbox 7.2.14 import acceptance, visual/native-picker appearance, personal-library relevance, or large-library latency evidence |

The authenticated Codex run, real-music MIR quality, personal-library search relevance,
subjective transition acceptance, and set-quality evaluations remain unexecuted and cannot
be reported as passes.
