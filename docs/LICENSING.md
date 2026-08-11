# Licensing and Distribution Strategy

Status: M4 development inventory current; M7 distribution inventory pending
Project license: MIT (`../LICENSE`)

## Default-build policy

- Audit source-code, model-weight, training/data, and generated-asset terms separately.
- A missing, ambiguous, AGPL, non-commercial, research-only, or incompatible share-alike term blocks inclusion in the distributable default build unless a documented legal/licensing decision permits it.
- Optional personal-development adapters must be capability-gated, disabled from release packaging, and labeled with their exact terms and operational risks.
- README quality/performance/license statements are not sufficient evidence; inspect repository license files, model cards/catalog entries, release artifacts, and dependency metadata.
- Release work must produce an SBOM and third-party notices and verify packaged assets against the accepted inventory.

## Current inventory

| Component | Intended role | Code license evidence | Model/data evidence | Distribution status |
| --- | --- | --- | --- | --- |
| DJ Copilot repository | Application source | MIT license committed at `../LICENSE` | No model/data asset is committed | Allowed |
| Official TypeScript Codex SDK | Candidate production AI provider | Apache-2.0 at `@openai/codex-sdk@0.146.0` / Codex commit `e363b08c9175ac1cbe5893615dd2cb9ddf95043b`; exact installed artifact integrity and transitive inventory remain pending | No model weights are selected for local redistribution; ChatGPT/Codex service and authentication terms remain a separate product/legal review | Provisionally allowed for an isolated Phase 0 spike only; default distribution remains blocked on service/auth/tool-isolation and packaged-helper evidence |
| Official Python Codex SDK | Single fallback candidate | Apache-2.0 at `openai-codex==0.144.4` / commit `5354e4951a8d10567ab2e43f8e483331f9ffe49e`; includes a pinned CLI binary dependency | No bundled application model assets; service/auth terms remain separate | Deferred; may replace, never accompany, the TypeScript production path if a documented gate forces reconsideration |
| Python MCP SDK | Local bounded tool transport | MIT at `mcp==2.0.0` / commit `6f69a3758ebf2ee55ce050f58b470ce11af71133`; isolated `spikes/codex-mcp/python_mcp/requirements.lock` records the exact 29-package environment inventory | Not applicable | Independently reviewed for the local Phase 0 adapter; production hashes, bundled-runtime and notices verification remain required before distribution |
| Electron | Accepted desktop framework | MIT; npm 43.2.0 observed, with exact supported patch deferred to Phase 1 | Not applicable | ADR-0001 accepts the framework/Node 24 major line; exact artifact integrity, transitive inventory, notices, and non-ASAR nested-resource signing remain mandatory |
| CPython | Bundled DJ-core runtime | Python Software Foundation License; ADR-0001 selects the 3.12 major line, with an exact current security patch/build deferred to Phase 1 | Not applicable | Reproducible arm64 runtime bundle, standard-library/native inventory, notices, integrity, and signing must be verified before distribution; never depend on system Python |
| NumPy 2.4.4 | M2 transparent DSP calculations | PyPI/versioned source declares `BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0`; exact pin is `core/requirements.txt` | No model, weights, or dataset selected | Allowed in development; M7 must include the complete bundled-component notice inventory and verify the selected CPython 3.12 arm64 wheel/package |
| External FFmpeg/ffprobe 8.1.2 | M2 local metadata and streamed audio decode | FFmpeg is LGPL-2.1-or-later by default, but the measured Homebrew build enables GPL components and reports GPL terms | Not applicable | Joe's existing executable may be invoked for personal development only; it is not copied or bundled. M7 must select a reproducible distributable configuration and satisfy its exact source/configuration/notices obligations |
| Rekordbox XML specification | Implemented import/export interchange | Official developer format document; no source library is copied; M4 parser/writer use the Python standard library only | User-selected metadata remains user data; generated test XML contains no personal data/audio | Allowed personal baseline subject to Rekordbox developer terms; M4 adds no third-party XML/runtime dependency and real Rekordbox import remains Joe's deferred manual check |
| `pyrekordbox` | Later optional snapshot-only reference | MIT at inspected `f695541` | No model assets | Reference only; license is permissive but mutation/version/security behavior is not approved |
| `all-in-one` | Optional structure provider | MIT at inspected `18e7890` | Checkpoint card says MIT; Harmonix annotations MIT, but downloadable audio/spectrogram terms are separate/incompletely surfaced | Not approved for default distribution; experimental adapter only after complete provenance/safe-loading review |
| `all-in-one-mlx` | Optional Apple-Silicon structure provider | MIT at inspected `da5f347` | Converted weights lack a separate card/checksum manifest; upstream card says MIT | Reference only until weight provenance/integrity/parity is resolved |
| Essentia runtime | MIR/DSP/classification candidate | AGPL-3.0; commercial license available; transitive obligations vary | Separate model catalog terms | Rejected from default distributable build absent an explicit commercial-license decision |
| Essentia model catalog | Semantic/model assets | Not applicable | Official pages conflict between CC BY-NC-SA 4.0 and CC BY-NC-ND 4.0; both are noncommercial, with commercial licensing offered | Rejected from default distributable build pending written resolution/rights |
| `Essentia-to-Metadata` | Reference tag mapping | MIT wrapper; Essentia obligations remain | Essentia model restrictions remain | Rejected as dependency; reference ideas only |
| CLAP | Optional future embeddings | CC0 repository; package metadata also has an inconsistent Apache classifier | Inspected checkpoint card says CC0; authors report unreleased training data due to copyright restrictions | Not approved; future opt-in experiment only after immutable artifact, safe loader, data-provenance and arm64 review |
| PANNs inference | Reference tags/embeddings | Repository claims MIT, but shipped license attribution appears unrelated and requires clarification | Zenodo checkpoints are CC BY 4.0 with MD5 | Reference only; ambiguous code provenance and unsafe loading block distribution |
| Subwave | Reference operational patterns | MIT core at inspected revision | Analyzer/provider/model assets are heterogeneous | Reference only; any borrowed pattern must avoid bundled providers/assets |
| AI-DJ-Mixing-System | Related project | MIT | External API/service terms | Rejected for architecture/privacy/auth reasons despite permissive code license |
| OneTagger | Reference normalization/providers | GPL-3.0 | Online provider/data terms vary | Reference only; no code integration in default MIT distribution |
| `mir-aidj` organization | Research survey | Per-repository MIT or unspecified | Per-repository/data asset terms | No organization-wide approval; assess each repository independently |

## Current blockers

- No semantic or audio/text embedding model is approved for the default package.
- Essentia code and model terms are incompatible or unresolved for default proprietary-style distribution.
- CLAP/all-in-one/PANNs asset provenance, integrity and executable-deserialization paths need explicit resolution.
- A distributable FFmpeg/decoder configuration, exact transitive/native codec inventory, and clean signed CPython/NumPy composition remain M7 work; the GPL-configured Homebrew binary is not a release artifact.
- Codex SDK source licensing is known, but ChatGPT/Codex service terms, login UX, ambient-config isolation, exact artifact integrity, transitive packages, and signed helper redistribution remain blockers to default distribution.

Research outcomes and rejected candidates are synchronized with `REPO_RESEARCH.md` and the audio-analysis ADR.
