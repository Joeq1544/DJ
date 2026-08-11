# Phase 0 Research Source Ledger

Inspection date: 2026-08-09
Status: Codex/MCP and Rekordbox/MIR research lanes complete; executable feasibility gates remain open

## Codex and MCP lane

The read-only research agent inspected the mandatory live documentation, exact tagged source, package/release metadata, configuration schema, authentication storage and merge behavior, tool construction, lifecycle tests, MCP low-level server implementation, and Electron ASAR guidance. No dependency was installed; the ambient Codex CLI, authentication store, global configuration, plugins, and MCP servers were not changed or read for credentials.

| Resource | Primary inspected references | Revision/release evidence |
| --- | --- | --- |
| Codex SDK overview | `https://developers.openai.com/codex/sdk/`; `https://learn.chatgpt.com/docs/codex-sdk` | Live docs cross-checked with exact tagged source rather than used as package-identity proof |
| TypeScript Codex SDK | `https://github.com/openai/codex/tree/main/sdk/typescript`; `https://www.npmjs.com/package/%40openai/codex-sdk?activeTab=versions`; `https://github.com/openai/codex/releases/tag/rust-v0.146.0`; commit `e363b08c9175ac1cbe5893615dd2cb9ddf95043b` | npm/runtime 0.146.0, released 2026-07-29 and still reported under npm's `latest` tag when rechecked 2026-08-09; isolated lockfile/integrity verified by the spike |
| Python Codex SDK | `https://github.com/openai/codex/tree/main/sdk/python`; `https://pypi.org/project/openai-codex/`; commit `5354e4951a8d10567ab2e43f8e483331f9ffe49e` | `openai-codex==0.144.4`, tag `python-v0.144.4`, released 2026-07-17 |
| Subagents/project agents | `https://developers.openai.com/codex/subagents/`; `https://learn.chatgpt.com/docs/subagents` | Live docs plus installed CLI 0.144.1 project-config load measurement |
| MCP configuration | `https://developers.openai.com/codex/mcp/`; `https://learn.chatgpt.com/docs/mcp`; tagged configuration source at commit `e363b08c9175ac1cbe5893615dd2cb9ddf95043b` | Runtime 0.146.0 recursive merge behavior; executable isolation proof remains open |
| `AGENTS.md` discovery | `https://developers.openai.com/codex/guides/agents-md/`; `https://learn.chatgpt.com/docs/agents-md` | Live docs; dedicated Application Support workspace must receive generated self-contained instructions |
| Codex workflows | `https://developers.openai.com/codex/workflows/` | Live guide used only for development/CI reference; it does not authorize API-key CI for this product |
| Python MCP SDK | `https://github.com/modelcontextprotocol/python-sdk`; `https://github.com/modelcontextprotocol/python-sdk/releases/tag/v2.0.0`; commit `6f69a3758ebf2ee55ce050f58b470ce11af71133` | `mcp==2.0.0`, released 2026-07-28; low-level adapter selected for the spike |
| Codex 0.146.0 MCP configuration schema | `https://raw.githubusercontent.com/openai/codex/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/core/config.schema.json` | Tagged schema directly exposes local `mcp_servers` command/args/cwd, required/enabled tool lists, timeouts, and approval policy; pinned TypeScript SDK declarations expose configuration plus MCP events but no in-process tool-registration callback |
| Authentication/config source | `https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/cli/src/login.rs`; `https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/storage.rs`; `https://github.com/openai/codex/blob/main/codex-rs/config/src/merge.rs` | Exact release login behavior plus current storage/merge source inspected 2026-08-09 |
| SDK isolation/argument boundary | `https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/exec/src/cli.rs`; `https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/exec/src/lib.rs`; `https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/sdk/typescript/src/exec.ts`; `https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/config/src/loader/mod.rs` | Direct CLI exposes same-auth ignore flags; stock SDK does not expose them or an alternate isolated config-file/profile mechanism |
| Permission/tool source | `https://learn.chatgpt.com/docs/permissions`; `https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/features/src/lib.rs`; `https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/core/src/tools/spec_plan.rs`; `https://raw.githubusercontent.com/openai/codex/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/core/src/config/permissions.rs`; `https://raw.githubusercontent.com/openai/codex/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/sandboxing/src/restricted_read_only_platform_defaults.sbpl`; `https://raw.githubusercontent.com/openai/codex/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/core/config.schema.json`; `https://github.com/openai/codex/issues/29049`; `https://github.com/openai/codex/issues/35437` | Exact 0.146.0 built-in/custom profile, broad `:minimal` macOS defaults, no-minimal child-start failure, network, tool, and config behavior, not newer-manual assumptions |
| Local MCP process placement | `https://raw.githubusercontent.com/openai/codex/rust-v0.146.0/codex-rs/codex-mcp/src/rmcp_client.rs`; `https://raw.githubusercontent.com/openai/codex/rust-v0.146.0/codex-rs/rmcp-client/src/stdio_server_launcher.rs` | Exact 0.146.0 selects the local launcher, spawns stdio MCP directly as an orchestrator child in a new Unix process group, and attempts group termination on close/drop. This constrains supervision design but is not executable call/cleanup evidence |
| Electron helper packaging | `https://www.npmjs.com/package/electron?activeTab=versions`; `https://www.electronjs.org/docs/latest/tutorial/asar-archives` | Electron 43.2.0 observed, not selected; spawned helpers require a real unpacked/signed path |
| Electron runtime/security/packaging | `https://releases.electronjs.org/release/v43.2.0`; `https://releases.electronjs.org/schedule`; `https://www.electronjs.org/docs/latest/tutorial/security`; `https://www.electronjs.org/docs/latest/tutorial/context-isolation`; `https://www.electronjs.org/docs/latest/api/utility-process`; `https://www.electronjs.org/docs/latest/tutorial/application-distribution/`; `https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging` | Stable 43.2.0 embeds Node 24.18.0; Forge is recommended; explicit renderer controls and real non-ASAR helper paths remain mandatory |
| CPython runtime line | `https://devguide.python.org/versions/`; `https://www.python.org/downloads/release/python-31213/` | ADR-0001 selects bundled CPython 3.12; security support runs through 2028-10, but upstream releases are source-only, so an exact current patch and reproducible arm64 bundle remain Phase 1 evidence |
| Apple direct distribution/sandbox | `https://developer.apple.com/support/developer-id/`; `https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution`; `https://developer.apple.com/documentation/Security/hardened-runtime`; `https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox` | Direct Developer ID requires signing, hardened runtime, timestamp and notarization; first-release no-App-Sandbox posture awaits independent review and later packaged verification |

### Codex/MCP measured stop conditions

- Provisionally test `@openai/codex-sdk@0.146.0` only in an isolated spike with its matching packaged runtime; do not upgrade or override it with the ambient CLI 0.144.1.
- A separate `CODEX_HOME` isolates ambient config/MCP/plugins but does not transparently reuse file/keyring authentication. The real Codex home can reuse auth but recursively inherits ambient configuration, and `config: {mcp_servers: {}}` does not clear it. Credential copying, inspection, or symlinking is not an acceptable workaround.
- Direct 0.146.0 `codex exec --ignore-user-config --ignore-rules` retains authentication from the same Codex home, but stock TypeScript SDK 0.146.0 cannot emit those flags, select an isolated config file/profile, or pass arbitrary arguments. A `codexPathOverride` argument-injecting shim is only a candidate architecture adjustment and must validate the exact `exec` invocation, matching helper version and lifecycle before use.
- Do not combine the 0.146.0 permission profile with `ThreadOptions.sandboxMode`; the legacy `--sandbox read-only` path permits broad reads and cannot establish the project boundary.
- The narrow diagnostic uses a named permission profile with only `:workspace_roots`/`.` read access and disabled profile network; `approvalPolicy: "never"`; disabled top-level web search, shell, apps/connectors/MCP apps/plugins/tool suggestion, hosted browser and Computer Use flags; no `sandboxMode`, legacy network option or additional directory. Profile network applies only to local commands, not service/MCP/hosted transport.
- The SDK has no complete built-in-tool allowlist or pre-turn inventory event. Runtime 0.146.0 has no effective disable for direct `apply_patch` or `view_image`. The spike must test actual denial of shell/process, both marker paths, out-of-workspace/symlink text-image-audio reads, music-root cwd, undeclared network/browser/app/connector tools, and ambient MCP/plugin capabilities rather than infer safety from configuration.
- Resolve the matching `@openai/codex@0.146.0` wrapper from the installed SDK package, require its `--version` to match, and classify `login status` without logging raw stderr: only exact exit-0 `Logged in using ChatGPT` is accepted; API-key/token/Bedrock modes are `other_auth`, not-logged-in is `signed_out`, and every other output/config/exit/signal is `status_error`.
- The TypeScript SDK supplies thread start/resume, streamed turns, `AbortSignal`, and output schemas, but application code must add timeout, strict JSON parsing/validation, error normalization, concurrency policy, and verified process-tree/temp-file cleanup.
- The corrected authenticated probe directly establishes existing-ChatGPT-auth new/resume streamed turns and bounded application-validated structured results in the Node/Electron-main-compatible harness. It establishes no specific completion event, real cancellation, MCP behavior, sentinel denial, packaged Electron behavior, ambient isolation, or complete cleanup.
- Local stdio MCP is a direct orchestrator child in its own process group under tagged 0.146.0. Do not infer its startup or failure from the model-command sandbox preflight; require direct MCP group/call/cleanup evidence.
- Use the Python MCP SDK 2.0.0 low-level `Server` API with exact schemas and `additionalProperties: false`, a second strict app-owned validation layer, bounded structured results, sanitized stable errors, protocol-only stdout, explicit annotations, and cancellation-aware handlers.
- Any successful forbidden read/write/tool/network action, ambient tool exposure, need to copy credentials, or surviving child process blocks ADR-0002 rather than being documented as accepted risk.

### Exact 0.146.0 diagnostic configuration

The TypeScript SDK still emits the exact flat custom-profile keys below. Its
serializer cannot preserve the nested special-path table, so the narrow shim
validates that complete SDK argv and rewrites only the filesystem entry to the
fail-closed inline table shown after it. Built-in `:read-only` is rejected: it
grants root-wide reads under tagged 0.146.0. Custom `:minimal` is also rejected
for its broad macOS platform defaults. The matching helper must parse the exact
registration, reject an unknown strict-config canary, and enforce the
model-free child-start gate before a provider turn.

SDK-side exact input:

```text
default_permissions="dj_read"
permissions.dj_read.filesystem.":workspace_roots"."."="read"
permissions.dj_read.network.enabled=false
features.shell_tool=false
features.apps=false
features.connectors=false
features.enable_mcp_apps=false
features.plugins=false
features.tool_suggest=false
apps._default.enabled=false
features.standalone_web_search=false
features.in_app_browser=false
features.browser_use=false
features.browser_use_full_cdp_access=false
features.browser_use_external=false
features.computer_use=false
```

Shim-side runtime rewrite of the filesystem entry:

```text
permissions.dj_read.filesystem={":workspace_roots"={"."="read"}}
```

The shim also injects `--strict-config`. The earlier `:minimal` correction is
rejected rather than described as narrow: pinned macOS source grants broad
system/shared-temp reads and shared-temp writes, and the exact-profile probe
reproduced `/etc/hosts` plus synthetic `/tmp` read/write access. With
`:minimal` absent, exact pinned sandboxed child startup returns 134 before the
trusted probe can emit output or create workspace/shared-temp markers. That is
fail-closed evidence and an explicit feasibility blocker, not a usable command
sandbox or MCP result.

The thread uses only the app-owned `workingDirectory`,
`skipGitRepoCheck: true`, `approvalPolicy: "never"`, and
`webSearchMode: "disabled"`. Exact SDK serialization also emits
`web_search="disabled"` and `approval_policy="never"`. It must not set
`sandboxMode`, `networkAccessEnabled`, `webSearchEnabled`, or
`additionalDirectories`.

## Rekordbox and MIR lane

The read-only research agent inspected official documentation, exact repository commits/releases, license/model-card files, workflows/manifests/loaders/tests, and model-host records. No dependency/model was installed and no user library/audio/ANLZ/database was accessed. The normalized decision matrix is in `../../REPO_RESEARCH.md`; distribution consequences are in `../../LICENSING.md`.

| Resource | Primary inspected references | Revision/release evidence |
| --- | --- | --- |
| Rekordbox XML | `https://rekordbox.com/en/support/developer/`; `https://cdn.rekordbox.com/files/20200410160904/xml_format_list.pdf` | Live support page and XML format `1.0.0` |
| pyrekordbox | `https://github.com/dylanljones/pyrekordbox`; commit `f695541827cc488af267d6ca8a8e0052598d85a0` | Release 0.4.4; compatibility/test/source/license files |
| all-in-one | `https://github.com/mir-aidj/all-in-one`; commit `18e78903c0365147a2c5d4e5e57ebf88cb7d800e`; `https://huggingface.co/taejunkim/allinone/tree/379e5fd010b3fdd0ee8381ff8cbcfa51d70b5c19` | v1.1.0 plus pinned checkpoint tree/card |
| all-in-one-mlx | `https://github.com/ssmall256/all-in-one-mlx`; commit `da5f3474503fde41860b454a48bc9e7899cd5dfa` | v1.0.5; package/workflow/weight lookup |
| Essentia | `https://github.com/MTG/essentia`; commit `b9fa6cb674ca43dfb94d28d293aeda441c6745db`; `https://essentia.upf.edu/models.html`; `https://essentia.upf.edu/licensing_information.html` | Runtime/PyPI activity plus conflicting official model-license pages |
| Essentia-to-Metadata | `https://github.com/WB2024/Essentia-to-Metadata`; commit `fe6b0946cdf547dd3281af10459e6cccc5d254fd` | Source/license/download/tag-write behavior |
| CLAP | `https://github.com/LAION-AI/CLAP`; commit `1fd4c37df5ffbfcfbad5415c170bc66cf94c9994`; `https://huggingface.co/lukewys/laion_clap/tree/b3708341862f581175dba5c356a4ebf74a9b6651` | PyPI 1.1.7; source/license/loader/checkpoint card |
| PANNs inference | `https://github.com/qiuqiangkong/panns_inference`; commit `f673f604ec6f4805a61c5b3be087e24776ec5fda`; `https://zenodo.org/records/3987831` | Source/license/loader and CC BY 4.0 checkpoint record |
| Subwave | `https://github.com/perminder-klair/subwave`; commit `50fdb23cbd79371d9c0bdada423e92409d0dad31` | v1.6.0; runtime/workflows/providers/analyzers |
| AI-DJ-Mixing-System | `https://github.com/kckDeepak/AI-DJ-Mixing-System`; commit `d56bd28c772f713ae39fc9ac33d0b555b98e1ce4` | Source/license/dependency/service/audio-upload paths |
| OneTagger | `https://github.com/Marekkon5/onetagger`; commit `36523f71f2d9a5947912f3cb930f1a31fcb2e3ee` | GPL license, macOS workflow, provider/source-tag behavior |
| mir-aidj organization | `https://github.com/mir-aidj` | Ten repositories surveyed individually; no organization-wide contract |

## Exact fixture recommendations

### Rekordbox XML

Generate four synthetic tracks under `DJ_PLAYLISTS Version="1.0.0"`, including duplicate title/artist but distinct IDs/locations, composed Unicode/special/percent-encoded paths, repeated tempo/cue children, nested folder/playlist order, TrackID and Location playlist key modes, and one missing file. Assert immutable normalized JSON and source SHA-256, deterministic second parse, declared counts, DTD/entity rejection, malformed/root/version/duplicate/unresolved rejection, non-local host/NUL/root escape denial, and injectable byte/node/text/depth/count limits. Never open audio.

### Generated WAV

Generate with `wave`, `struct`, and `math`: 16-second 48 kHz mono signed-16-bit PCM with 32 ten-millisecond clicks at `0.25 + n × 0.5` seconds, amplitude 0.25 then 0.50; plus two-second silence and truncated corrupt WAV. Measure streaming format/duration/peak/RMS/half-energy/onsets/median interval/BPM/interval regularity. Expected duration `16.0 ± 1/48000`, peak `0.50 ± 1/32768`, interval `0.500 ± 1/48000`, BPM `120.00 ± 0.05`, and second/first energy near `4.0`; corrupt input fails per-file while valid items complete and hashes remain unchanged.

## Unresolved evidence

- Existing ChatGPT authentication reuse has not yet been reconciled with exclusion of ambient Codex configuration, MCP servers, plugins, and built-in tools.
- Exact 0.146.0 helper/config/permission behavior and scoped inherited-group cleanup have been exercised locally, and authenticated new/resume lifecycle is measured. Direct built-in-tool inventory/denial, authenticated MCP call, MCP-group extinction, escaped descendants, ambient isolation, and packaged Electron behavior remain unresolved.
- No user-authorized Rekordbox 7.2.14 XML export has been inspected.
- Apple Silicon performance/quality claims are unmeasured locally.
- Python 3.14 falls outside most candidates' tested matrices.
- Essentia model terms conflict; CLAP/all-in-one training or asset provenance and PANNs code attribution remain unresolved.
- Model safe serialization/checksums, transitive native licenses, SBOM and packaging behavior remain later decision/implementation gates.
