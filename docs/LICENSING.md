# Licensing and Distribution Strategy

Status: M7 personal-package inventory generated and verified; public redistribution not approved
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
| Official TypeScript Codex SDK | Production AI provider | Apache-2.0 at exact `@openai/codex-sdk@0.147.0`, tag `rust-v0.147.0`, commit `be6e8eac029b183056b7e4402879f15d2c85f61b`, npm integrity `sha512-nJL0maDBZy31uEArs+u46tW22veNdHjfs96AGaFTnI3jF+g8U+a422uaPiDZwEKmyxcNwStTRz6sIh6C7XxGFQ==`; exact matching CLI and Darwin-arm64 package hashes are recorded in M6 evidence | No model weights are redistributed and the model remains unset; ChatGPT/Codex service and authentication terms remain separate | Included in the personal M7 package under ADR-0009/0010; the full non-ASAR SDK/generic-CLI/Darwin-arm64 topology, contained links, exact versions, nested signatures, helper launch, and existing-auth behavior pass package verification and the real smoke |
| MCP TypeScript SDK types | Development-only Codex declaration resolution | MIT at exact `@modelcontextprotocol/sdk@1.24.0`, matching the Codex SDK's published development contract | No model/data assets | Dev dependency only because `@openai/codex-sdk` imports `ContentBlock` in its declarations; no production MCP server/tool/runtime is added |
| Official Python Codex SDK | Single fallback candidate | Apache-2.0 at `openai-codex==0.144.4` / commit `5354e4951a8d10567ab2e43f8e483331f9ffe49e`; includes a pinned CLI binary dependency | No bundled application model assets; service/auth terms remain separate | Deferred; may replace, never accompany, the TypeScript production path if a documented gate forces reconsideration |
| Python MCP SDK | Historical local bounded-tool spike | MIT at `mcp==2.0.0` / commit `6f69a3758ebf2ee55ce050f58b470ce11af71133`; isolated `spikes/codex-mcp/python_mcp/requirements.lock` records the exact 29-package environment inventory | Not applicable | Development/historical only; no production MCP server or Python MCP package is included in the M7 app |
| Electron 43.3.0 | Desktop framework/runtime | MIT; exact npm pin and lockfile are committed | Not applicable | Included in the personal arm64 package; exact version, target architecture, production-only tree, resource hashes, and ad-hoc bundle signature are verified |
| CPython 3.14.3 | Bundled DJ-core runtime | Python Software Foundation License; ADR-0010 supersedes the historical unimplemented 3.12 target for this personal build | Not applicable | Included via the exact arm64 PyInstaller one-directory build; package verification proves the bundled core executable is arm64 and launches without system Python |
| NumPy 2.4.4 | Transparent DSP calculations | PyPI/versioned source declares `BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0`; exact runtime/release pins are committed | No model, weights, or dataset selected | Included in the CPython 3.14.3 one-directory core; exact wheel hash installation, runtime version assertion, component inventory, and packaged analysis flow pass |
| FFmpeg/ffprobe 8.1.2 | Local metadata and streamed audio decode | Official source archive SHA-256 `464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c`; LGPL-2.1-or-later configuration disables GPL, nonfree, network, devices, autodetection, and external codecs | Not applicable | Locally source-built static arm64 tools are included in the personal package and have only system dynamic dependencies; exact versions/configuration/hashes are recorded and the packaged analysis flow passes. The unrelated GPL-configured Homebrew build remains development-only and is not copied |
| Rekordbox XML specification | Implemented import/export interchange | Official developer format document; no source library is copied; M4 parser/writer use the Python standard library only | User-selected metadata remains user data; generated test XML contains no personal data/audio | Allowed personal baseline subject to Rekordbox developer terms; M4 adds no third-party XML/runtime dependency and real Rekordbox import remains Joe's deferred manual check |
| M5 personalization | Local deterministic metadata/preferences and JSON export | Python/SQLite standard library plus existing application dependencies; M5 adds no third-party package or model | Generated tests use invented metadata and marker files; no personal profile/export is committed | Allowed; no new distribution license obligation beyond the existing application/runtime inventory |
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

## Deferred or future distribution work

- No semantic or audio/text embedding model is approved for the default package.
- Essentia code and model terms are incompatible or unresolved for default proprietary-style distribution.
- CLAP/all-in-one/PANNs asset provenance, integrity and executable-deserialization paths need explicit resolution.
- The personal package contains a generated CycloneDX component inventory, resource hash manifest, and concise third-party inventory under `Contents/Resources/release`; these were regenerated from and verified against the actual artifact. They are evidence for this personal build, not a legal sign-off for redistribution.
- Public distribution would still require complete license-text/source-offer review for FFmpeg and every transitive/native component, Developer ID signing/notarization decisions, and a distribution-specific legal review. The GPL-configured Homebrew FFmpeg is not a release artifact.
- Codex SDK/runtime 0.147.0 integrity, non-ASAR topology, contained links, nested signatures, helper launch, and existing-auth behavior are verified for the personal package. Future SDK upgrades or public redistribution require a refreshed inventory and focused smoke.

Research outcomes and rejected candidates are synchronized with `REPO_RESEARCH.md` and the audio-analysis ADR.
