# DJ Copilot Personal Full-Feature MVP Design

Status: approved by Joe on 2026-08-10
Date: 2026-08-10
Product owner: Joe
Prior specification: `../../../dj-copilot-codex-master-prompt.md`

## Purpose of this amendment

DJ Copilot is a personal macOS tool for one trusted user on a laptop where Codex is already installed, authenticated, and routinely granted access. The product should still deliver the complete DJ workflow described below, but implementation should favor useful software, fast feedback, and fixes driven by real use over commercial-grade assurance work.

The existing master prompt and Phase 0 evidence remain valuable historical design and research material. After this written specification is approved, the project-management documents will be amended so this design governs MVP execution. In particular, the unfinished P0-016 process-observability work will be stopped rather than treated as a prerequisite to the app.

## Product outcome

The MVP is successful when Joe can use one local desktop app to:

1. Import and browse a real Rekordbox XML library without modifying Rekordbox-owned data.
2. Analyze selected local tracks and see useful musical and technical features with progress and recoverable jobs.
3. Search and filter the library, find similar tracks, and receive explainable next-track recommendations.
4. Build, edit, reorder, pin, ban, save, and export sets.
5. Analyze an existing playlist or draft for progression, weak transitions, and organization opportunities.
6. Record preferences and feedback that measurably influence later recommendations and can be reset.
7. Use the official Codex SDK with existing Codex/ChatGPT authentication for natural-language search, planning, and explanations.
8. Recover from common failures without losing app-owned data or corrupting an export.
9. Launch a personal macOS build without needing a commercial release pipeline.

Every item above remains release scope. Codex-enhanced workflows may degrade when Codex is unavailable, but the local library, analysis, search, ranking, set editing, and export workflows must continue to work.

## Product boundaries

- Rekordbox remains the source of truth. DJ Copilot reads user-selected XML and media and writes only app-owned state or a new user-selected XML export.
- Rekordbox databases and source audio files are never modified.
- Raw audio stays local. Codex receives selected metadata, derived features, IDs, draft state, and other bounded text/structured context, not audio bytes.
- Production AI uses the official Codex SDK and the user's existing Codex/ChatGPT authentication. There is no `OPENAI_API_KEY` setup or substitute paid provider.
- Explicit user choices such as pins, bans, ratings, tags, edits, and overrides beat generated recommendations.
- Recommendations and exports must resolve to tracks that exist in the imported library.

## Feature scope

### Library and Rekordbox interchange

The app imports collection tracks, playlist folders, playlists, ordering, Unicode metadata, and compatible file locations from user-selected Rekordbox XML. It reconciles later imports with app-owned track IDs and preserves app metadata. The library UI supports browsing, sorting, filtering, track details, playlist navigation, and clear reporting of missing or unreadable files.

Export creates a new Rekordbox-compatible XML file from selected playlists or set drafts. The app validates and reparses the temporary export before replacing an explicitly selected destination. It never writes Rekordbox's internal database.

### Local audio analysis

The app analyzes selected files locally through resumable jobs. The required baseline is file/codec metadata, duration, BPM and beat evidence, key/mode evidence, loudness and energy statistics, useful rhythm/timbre descriptors, and provenance/confidence for each result. Structure/section evidence and audio embeddings are exposed through versioned provider interfaces and used when an approved provider is available. Unsupported codecs and individual corrupt files fail per track rather than stopping the queue.

Advanced models or additional MIR providers are enhancements, not prerequisites for the first working vertical slice. The app must remain honest when a value is missing or low-confidence.

### Search, similarity, and recommendations

Users can combine text, structured filters, musical features, playlist membership, and similarity. Next-track recommendations apply hard constraints first and then score plausible candidates using understandable components such as tempo, key compatibility, energy, style/tags, recency, and learned preference. The UI exposes the main reasons for each recommendation.

The initial search and ranking implementation should be deterministic and simple enough to tune. Brute-force similarity is acceptable until real library use demonstrates a performance problem.

### Set building and analysis

Users can create a draft from tracks, constraints, a seed track, or natural language. They can reorder it, replace candidates, pin tracks or positions, ban tracks, undo edits, save versions, and export the result. Optimization improves the sequence without violating hard constraints or user edits.

The analyzer evaluates imported playlists and drafts using the same local evidence. It highlights energy/progression shape, suspicious transitions, repetition, missing analysis, and organization suggestions. Suggestions are advisory and remain editable.

### Organization and personalization

The app can propose app-owned tags, groups, playlists, and cleanup ideas without changing Rekordbox-owned data automatically. Feedback such as likes, dislikes, accepted recommendations, skips, ratings, and manual overrides adjusts a small, interpretable preference profile. Users can inspect, export, and reset that profile.

### Codex assistance

Codex translates natural language into validated search or set-building intent, explains app-supplied evidence, and helps revise a draft. It does not invent library IDs or make hidden writes. A small app-owned MCP surface may be used where tool calls materially improve the workflow, with strict schemas and allowlisted operations, but the MVP does not require kernel-level proof that Codex lacks every capability available to the logged-in macOS user.

Codex actions that would change durable app state or write an export are previewed and explicitly confirmed in the trusted UI. A mock provider supports deterministic automated tests; a real existing-auth smoke test is required before claiming the Codex workflow works.

### User experience and diagnostics

The product retains the original primary surfaces:

- Onboarding explains the Rekordbox companion model, shows Codex status, selects XML/media roots and analysis depth, and runs a small readiness check.
- Library and track-detail views provide large-list browsing, saved filters, playlist hierarchy, analysis/error status, Rekordbox-versus-local values, confidence/provenance, tags/notes, structure or energy summaries, similar tracks, and recommendation breakdowns.
- The Copilot view streams responses, supports cancellation, shows concise tool activity and exact track/playlist evidence, and separates explanations from proposed changes.
- Set-builder and analyzer views show duration and segment goals, ordered tracks, progression charts, warnings, alternatives, and transition details while preserving direct editing controls.
- Settings and diagnostics expose Codex/worker/provider status, privacy behavior, app database backup/export, logs, integration mode, analysis-stage rebuilds, preference reset, and a diagnostics bundle that excludes audio and credentials.

Primary workflows support keyboard navigation, visible focus, semantic labels, scalable text, light/dark themes, adequate contrast, and explicit loading, empty, partial, and error states. Accessibility work is verified on the screens being delivered rather than held for a separate commercial audit.

## Architecture

The current three-part architecture remains appropriate without the earlier containment machinery:

1. A sandboxed React renderer presents the UI and calls a small typed preload API.
2. Electron main owns windows, dialogs, lifecycle, typed IPC, worker supervision, and the official Codex SDK integration.
3. One local Python core owns the app database, Rekordbox XML logic, audio jobs, search, ranking, set logic, personalization, and any narrow MCP adapter.

SQLite is app-owned and has one writer through the Python core. Communication uses a versioned, bounded local protocol, but the implementation only needs the contract tests required by actual messages; it does not need exhaustive cross-language parity tests for impossible or unused representations.

The app uses ordinary same-user process trust. It does not attempt to defend against Joe, an already-compromised macOS account, or the normal capabilities of Codex that Joe already accepts. Standard Electron isolation, input validation, fixed commands, path checks, and write confirmations remain because they are inexpensive and prevent common accidents.

## Main data flow

1. Joe selects a Rekordbox XML file and optional media roots.
2. The Python core parses the XML into app-owned SQLite records and reports import issues.
3. Local jobs read selected audio without modifying it and store versioned derived features.
4. Search, similarity, ranking, set building, analysis, and personalization operate on those local records.
5. For a Codex request, Electron main sends only the relevant structured library evidence and validates the returned intent, IDs, or explanation before the app uses it.
6. A confirmed export is written to a temporary file, reparsed, and moved to the selected destination.

## Failure behavior

- An import failure leaves the previous library state usable and explains the affected file or record.
- A bad or unsupported audio file fails only its own job; the queue continues and can resume after restart.
- A Python worker crash produces a visible degraded state and a bounded restart attempt. Persisted jobs resume safely.
- Codex auth, network, SDK, schema, or tool failure disables the requested AI action and preserves the current local workflow and draft.
- Invalid or unknown track IDs are rejected before they affect a recommendation, draft, or export.
- Database migrations create a backup first. Export replacement occurs only after validation succeeds.
- Errors shown to Joe should be useful. Logs avoid credentials and unnecessary raw metadata but do not need enterprise-grade redaction infrastructure.

## Delivery strategy

Work proceeds as thin, usable vertical slices. Shared contracts are introduced only when the next slice needs them. A milestone may fix adjacent structural problems that directly block it, but speculative abstraction and unrelated cleanup are excluded. Each milestone receives its own bounded implementation plan and completion evidence; the whole product is not executed as one enormous plan.

### GitHub checkpoint cadence

The repository has an `origin` remote at `git@github.com:Joeq1544/DJ.git`. After M0 establishes the first coherent green baseline, push small, understandable commits regularly:

- Push after each completed milestone and after substantial self-contained slices within a milestone.
- Also push the latest green checkpoint before ending a long work session.
- Before each push, inspect the status and diff, run the focused checks affected by that commit, and update the relevant project-memory records.
- Do not push knowingly broken intermediate code merely to increase push frequency.
- Keep personal Rekordbox exports, source audio, app databases, credentials, private logs, build caches, and generated analysis data out of Git.
- The primary agent owns commits and pushes so shared documentation and integration remain coherent.

The current all-untracked worktree is not pushed piecemeal during this specification-review gate. M0 will first classify the files, install the required ignore rules, restore the focused green baseline, create an intentional initial project checkpoint, and push it to GitHub.

### M0 — Scope reset and green foundation

- Amend the master plan, task ledger, decisions, known issues, architecture, threat model, privacy, test strategy, and evidence index to reflect this approved personal-use scope.
- Preserve completed Phase 0 research as historical evidence.
- Mark P0-016 and the forensic Codex containment gates as stopped or superseded, not completed.
- Revert the incomplete P0-016 supervisor implementation to the last documented green Codex/MCP spike baseline while retaining its research notes and honest failed/blocked evidence.
- Define the smallest runnable app skeleton and development command.
- Create and push the first reviewed green project checkpoint.

### M1 — App shell and real library slice

- Launch Electron/React with the supervised Python core and app-owned SQLite database.
- Import the generated XML fixture and a user-selected XML file, then browse tracks and playlists in the UI.
- Show actionable import diagnostics and preserve source files.

### M2 — Local analysis slice

- Select tracks, run local analysis, persist progress/results, pause or resume, and display features.
- Isolate per-file failures and verify restart recovery with generated audio fixtures.

### M3 — Discovery and recommendation slice

- Deliver structured/text search, similarity, next-track candidates, score explanations, and useful filters.
- Tune against fixtures and representative personal-library use rather than a mandatory synthetic enterprise benchmark.

### M4 — Set workflow slice

- Create/edit/version drafts, support pins and bans, analyze transitions/progression, suggest organization, and export valid Rekordbox XML.
- Exercise one complete import-to-export flow in the desktop app.

### M5 — Personalization slice

- Record feedback, adjust bounded visible preferences, compare recommendation changes, and support export/reset.

### M6 — Codex-assisted slice

- Connect the official Codex SDK through existing authentication.
- Support natural-language library search, set planning/revision, and explanations using validated local context.
- Add only the MCP tools needed by these flows, confirm durable writes, and run one real opt-in smoke flow in addition to mock tests.

### M7 — Personal release polish

- Fix in-scope defects found through realistic use, complete recovery and migration checks, document setup/limitations, and create a runnable personal macOS build.
- Signing, notarization, multi-user hardening, broad hardware support, and a public distribution pipeline are deferred until Joe wants to share the app.

## Verification standard

A feature is complete when its user-visible behavior works through the relevant integrated flow, not merely when code or UI exists. For each milestone, use:

- focused unit tests for important deterministic rules;
- integration tests for the milestone's main success path and realistic failures;
- the relevant TypeScript/Python type or syntax checks;
- a small generated-fixture desktop flow;
- manual verification for behavior that depends on the actual Rekordbox library, installed codecs, existing Codex authentication, or macOS packaging.

Run broader suites when a shared contract changes or a focused failure suggests wider risk. Property/fuzz matrices, repeated independent reviews, exhaustive hostile-process proofs, exhaustive cross-language parity, performance farms, and commercial release checks are not default milestone gates.

Before a milestone is called complete, record its commands and outcomes, update `TASKS.md`, `DECISIONS.md`, `KNOWN_ISSUES.md`, and relevant docs, inspect the diff, and perform one concise scope/quality review. Known defects that block Joe's normal workflow remain blockers; rare theoretical cases may be documented and deferred.

## Accepted personal-use risks and deferrals

- Codex runs with capabilities comparable to those Joe already accepts in normal Codex use. The app adds validation and confirmation, not a separate hardened security perimeter.
- A malicious track title, XML field, or assistant response may produce confusing text. It must not bypass ID validation or confirmed writes, but exhaustive prompt-injection resistance is deferred.
- Dependency compromise, a compromised macOS account, and malicious local same-user processes are outside the MVP threat model.
- Rekordbox format or codec variants not present in fixtures may require fixes when encountered in Joe's library.
- The first build may be unsigned and arm64-only.
- Performance is tuned for Joe's actual library and laptop. Specialized indexes are added only if measured use needs them.
- Advanced MIR/model accuracy is improved iteratively; missing or uncertain results are shown honestly.
- Codex SDK behavior can change. The app pins a known-working version and treats an upgrade as focused maintenance work.

## Explicitly retired MVP gates

The following work is no longer required before feature development:

- P0-016 supervisor-owned MCP process observability;
- kernel/process-group proof of every Codex and MCP descendant;
- negative-capability sentinels for every readable file, built-in tool, plugin, and network path;
- proof of perfect separation from ambient Codex configuration on the same trusted account;
- repeated independent security reviewers at every phase;
- exhaustive fuzz/property/cross-language test matrices unrelated to a real workflow;
- notarization, redistribution, multi-machine compatibility, and enterprise recovery evidence.

These items are stopped or deferred because they do not materially improve this personal tool enough to justify delaying its features. Existing evidence about them is retained rather than relabeled as a pass.

## Definition of done for the personal MVP

The personal MVP is done when all nine product outcomes can be demonstrated on Joe's Mac, focused automated checks are green, no known defect blocks normal use, common failure/recovery paths work, the current limitations are documented, and the app can be launched again from a clean project setup or personal build.

It is not necessary to prove readiness for hostile users, public distribution, every Rekordbox variant, every codec, every Mac, or every theoretical Codex escape before calling the personal MVP useful and complete.
