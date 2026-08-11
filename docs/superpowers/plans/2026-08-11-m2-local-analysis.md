# M2 Local Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Joe select imported tracks, run transparent local analysis, see useful feature evidence and progress, pause/resume a durable queue, and recover unfinished work after a core restart without one bad file stopping the rest.

**Architecture:** The existing Python core remains the only owner of app state. A single background `AnalysisManager` reads persisted jobs, invokes one versioned FFmpeg-plus-NumPy provider at a time, and writes bounded progress/results through the thread-safe repository; the socket loop stays responsive. The renderer receives only validated IDs, job state, scaled feature summaries, provenance, and confidence—never audio bytes or private paths.

**Tech Stack:** CPython 3.12+ standard library, external FFmpeg/ffprobe 8.1.2 development executables, NumPy 2.4.4, SQLite, Electron 43.3.0, React 19.2.8, Zod 4.4.3, Vitest 4.1.10, Playwright 1.62.1.

## Global Constraints

- Rekordbox remains authoritative; never write its database, XML input, or source audio.
- Raw audio stays local and no analysis command accepts a renderer-supplied path.
- Pin `numpy==2.4.4`; require and record external FFmpeg/ffprobe 8.1.2 for M2 evidence.
- Do not bundle the installed Homebrew FFmpeg because its measured build is GPL-configured; M7 owns a separately reviewed distributable decoder.
- Baseline BPM, beat, key/mode, loudness, energy, rhythm, and timbre outputs are heuristic evidence with provider/version/confidence. Low-information audio returns unknown values rather than invented certainty.
- Structure, semantic classifiers, and embeddings remain unavailable capabilities in M2; no model, weights, or implicit download is introduced.
- Persist integers across the core/desktop boundary: milliseconds, milli-BPM, milli-dB, and unit-interval parts per million. No `NaN`, infinity, or raw NumPy scalar crosses storage or JSON.
- One selected request accepts 1–200 known track IDs. A corrupt, missing, unsupported, timed-out, or unavailable-provider item fails only that track.
- Unfinished `running` work becomes `queued` after restart; an explicitly paused queue stays paused. Source fingerprints plus provider/pipeline versions control cache reuse.
- Visual QA is deferred under D-045. M2 still requires focused automated behavior and a generated-fixture Electron restart/resume flow without screenshot claims.
- The primary agent owns shared contracts, integration, project memory, staging, commits, and pushes. Subagents receive disjoint file ownership and perform no Git operations.

---

### Task 1: Generated audio set and versioned baseline provider

**Files:**
- Create: `core/requirements.txt`
- Create: `core/dj_copilot/analysis/__init__.py`
- Create: `core/dj_copilot/analysis/provider.py`
- Create: `core/tests/test_analysis_provider.py`
- Modify: `scripts/generate-audio-fixtures.py`
- Modify: `spikes/audio_analysis/tests/test_analyze.py`

**Interfaces:**
- Consumes: an imported core-owned `Path`, injected executable paths, and a cooperative `should_stop() -> bool` callback.
- Produces:

```python
@dataclass(frozen=True)
class ProviderCapabilities:
    available: bool
    provider: str
    provider_version: str | None
    pipeline_version: str
    available_stages: tuple[str, ...]
    unavailable_stages: tuple[str, ...]
    unavailable_reason: str | None

@dataclass(frozen=True)
class AnalysisFeatures:
    fingerprint: str
    file_size: int
    mtime_ns: int
    codec: str
    container: str
    duration_ms: int
    sample_rate_hz: int
    channels: int
    bpm_milli: int | None
    tempo_confidence_ppm: int
    tempo_candidates_milli: tuple[int, ...]
    onset_count: int
    beat_strength_ppm: int
    musical_key: str | None
    mode: str | None
    key_confidence_ppm: int
    rms_milli_dbfs: int | None
    peak_milli_dbfs: int | None
    crest_factor_milli_db: int | None
    energy_ppm: int
    dynamic_range_milli_db: int | None
    onset_rate_milli_hz: int
    spectral_centroid_hz: int | None
    brightness_ppm: int
    energy_curve_ppm: tuple[int, ...]
    provider: str
    provider_version: str
    pipeline_version: str
    limitations: tuple[str, ...]

class AnalysisProvider(Protocol):
    def capabilities(self) -> ProviderCapabilities: ...
    def fingerprint(self, path: Path) -> tuple[str, int, int]: ...
    def analyze(
        self,
        path: Path,
        *,
        progress: Callable[[int], None],
        should_stop: Callable[[], bool],
    ) -> AnalysisFeatures: ...
```

The selected concrete provider is `FfmpegNumpyProvider`. Its identity is `ffmpeg-numpy-basic`, its pipeline is `baseline-v1`, it requires `numpy.__version__ == "2.4.4"`, and both executable version lines must begin with `ffmpeg version 8.1.2` / `ffprobe version 8.1.2`.

- [x] **Step 1: Write provider and generator tests first**

Add literal generated-fixture expectations covering:

```python
self.assertEqual(features.bpm_milli, 120_000)
self.assertGreaterEqual(features.tempo_confidence_ppm, 850_000)
self.assertEqual((features.musical_key, features.mode), ("C", "major"))
self.assertGreaterEqual(features.key_confidence_ppm, 500_000)
self.assertEqual(len(features.energy_curve_ppm), 16)
self.assertGreater(features.energy_curve_ppm[-1], features.energy_curve_ppm[0])
self.assertEqual(silence.bpm_milli, None)
self.assertEqual((silence.musical_key, silence.mode), (None, None))
```

Also prove source hashes are unchanged, `progress` is monotonic from 0 through 1,000,000, corrupt/missing/no-audio inputs raise stable `AnalysisProviderError` codes, a stop callback raises `AnalysisInterrupted`, executable/version mismatch yields unavailable capabilities, and no decoded PCM file appears on disk. Extend the generator with `harmonic.wav`: a bounded 16-second mono PCM signal containing C-major chord tones plus 120-BPM percussive pulses and a quieter first half. Preserve the historical `clicks.wav` hash and spike assertions.

- [x] **Step 2: Run the tests and confirm the missing provider/harmonic fixture is the failure**

Run:

```bash
python3 -B -m unittest core.tests.test_analysis_provider -v
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s spikes/audio_analysis/tests -v
```

Expected red result: the production analysis package and `harmonic.wav` generator output do not exist; the historical spike remains green after generator compatibility is preserved.

- [x] **Step 3: Add the exact dependency and provider implementation**

Write `core/requirements.txt` as:

```text
numpy==2.4.4
```

Provider behavior:

1. Resolve `DJ_COPILOT_FFMPEG` / `DJ_COPILOT_FFPROBE` or `PATH`, run `-version`, and return an unavailable capability instead of throwing during app startup. The capability advertises `("metadata", "basic_features")` and explicitly lists `("structure", "embeddings")` as unavailable.
2. Run `ffprobe -v error -of json -show_format -show_streams -- <path>`, require exactly one usable first audio stream, reject duration above 7,200 seconds, and bound stdout/stderr to 1 MiB with a 15-second timeout.
3. Decode with `ffmpeg -v error -nostdin -i <path> -map 0:a:0 -ac 1 -ar 22050 -f f32le pipe:1`; consume 262,144-byte chunks, cap job wall time at 600 seconds and stderr at 64 KiB, terminate on stop/timeout, and never retain a full decoded copy or temporary PCM file.
4. Use 2,048-sample Hann-windowed real FFT frames with a 512-sample hop to accumulate half-wave spectral flux, 12-bin chroma, spectral centroid, energy above 3,500 Hz as brightness, zero-crossing/onset evidence, and sixteen duration-normalized RMS buckets. Estimate 60–200 BPM from normalized onset-envelope autocorrelation, merge candidates within 1 BPM, and expose the strongest three. Compare normalized chroma against the literal Krumhansl major profile `(6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88)` and minor profile `(6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17)` across all rotations. Return unknown key/mode below -60 dBFS RMS, below eight covered FFT frames, or below a 0.05 winner/runner-up cosine margin.
5. Convert every result to bounded Python `int`, `str`, or tuple before constructing `AnalysisFeatures`. Include the limitation strings `"Heuristic tempo and beat evidence; not a Rekordbox beat grid."` and `"Heuristic key/mode evidence; verify low-confidence results by ear."`.
6. Compute the fast fingerprint as SHA-256 over a domain separator, file size, nanosecond mtime, and the first/last 64 KiB; return size and mtime alongside it.

- [x] **Step 4: Run focused provider and historical spike checks green**

Run the two Step 2 commands. Expected: all provider tests and all seven historical spike tests pass with no child process or generated file left behind.

---

### Task 2: Durable analysis repository and resumable queue

**Files:**
- Create: `core/dj_copilot/analysis/jobs.py`
- Create: `core/tests/test_analysis_database.py`
- Create: `core/tests/test_analysis_jobs.py`
- Modify: `core/dj_copilot/database.py`
- Modify: `core/dj_copilot/models.py`
- Modify: `core/dj_copilot/rekordbox_xml.py`
- Modify: `core/tests/test_database.py`

**Interfaces:**
- Consumes: Task 1 `AnalysisProvider`; existing stable app track IDs and private imported source paths.
- Produces:

```python
@dataclass(frozen=True)
class AnalysisSummary:
    status: str
    progress_ppm: int
    attempt_count: int
    error_code: str | None
    error_message: str | None
    features: AnalysisFeatures | None

@dataclass(frozen=True)
class AnalysisQueueStatus:
    state: str
    queued: int
    running: int
    paused: int
    succeeded: int
    failed: int
    progress_ppm: int
    capabilities: ProviderCapabilities
    items: tuple[tuple[str, AnalysisSummary], ...]

class AnalysisManager:
    def start(self) -> None: ...
    def stop(self) -> None: ...
    def queue_tracks(self, track_ids: tuple[str, ...]) -> AnalysisQueueStatus: ...
    def pause(self) -> AnalysisQueueStatus: ...
    def resume(self) -> AnalysisQueueStatus: ...
    def status(self, track_ids: tuple[str, ...] | None = None) -> AnalysisQueueStatus: ...
```

- [x] **Step 1: Write failing repository tests**

Tests must prove an existing M1 database is copied to a unique sibling `*.pre-m2.sqlite3` backup before the first schema change and remains readable after upgrade; a brand-new empty database requires no backup; the additive schema stores private `source_path` but omits it from `StoredTrack`; preserves features for a stable ID across reimport; removes orphaned job/features for a removed track; stores exactly one latest job and one latest feature row per track; clamps progress to 0–1,000,000; preserves provider/pipeline/confidence; and converts persisted `running` to `queued` at startup while leaving `paused` unchanged.

Run:

```bash
python3 -B -m unittest core.tests.test_database core.tests.test_analysis_database -v
```

Expected red result: analysis tables/methods and stored source paths do not exist.

- [x] **Step 2: Add the additive schema and thread-safe repository methods**

Open SQLite with `check_same_thread=False` and serialize every public repository operation with one `threading.RLock`. Use `PRAGMA user_version = 2` as the M2 schema marker. When a version-0 database already contains the M1 `tracks` table without `source_path`, use SQLite's online backup API to create the first non-existing sibling named `<stem>.pre-m2.sqlite3`, `<stem>.pre-m2-2.sqlite3`, and so on before executing DDL; expose the chosen path for recovery evidence. A new empty database creates version 2 directly without a backup. Add `source_path TEXT NOT NULL DEFAULT ''` to `tracks` through an idempotent column check. Add:

```sql
CREATE TABLE IF NOT EXISTS analysis_control (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  paused INTEGER NOT NULL CHECK (paused IN (0, 1))
);
CREATE TABLE IF NOT EXISTS analysis_jobs (
  track_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('queued','running','paused','succeeded','failed')),
  progress_ppm INTEGER NOT NULL CHECK (progress_ppm BETWEEN 0 AND 1000000),
  attempt_count INTEGER NOT NULL,
  error_code TEXT,
  error_message TEXT,
  fingerprint TEXT,
  provider TEXT NOT NULL,
  provider_version TEXT,
  pipeline_version TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS track_features (
  track_id TEXT PRIMARY KEY,
  feature_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_version TEXT NOT NULL,
  pipeline_version TEXT NOT NULL,
  generated_at TEXT NOT NULL
);
```

The JSON column contains only the strict `AnalysisFeatures` fields and is decoded through explicit validation, not `pickle`. Import stores each normalized private path, keeps analysis for retained stable IDs, and removes rows whose IDs no longer exist before commit.

- [x] **Step 3: Write failing manager tests with a controllable fake provider**

The fake provider records analyzed IDs, emits literal progress `[100_000, 500_000, 1_000_000]`, blocks on an event for pause/restart tests, returns one `AnalysisFeatures`, and raises stable errors for one path. Tests prove:

- queue order is deterministic and duplicate IDs are rejected;
- pause interrupts the current provider, persists `paused`, and starts no next item;
- resume requeues paused work and reaches completion;
- `stop()` returns running work to `queued`, and a fresh manager completes it;
- one failed item is followed by a successful item;
- matching fingerprint/provider/pipeline reuses cached results, while a changed fingerprint or pipeline reanalyzes;
- `status(track_ids)` reports global bounded aggregate progress plus items for exactly the unique requested known IDs in request order; `None` returns no items and more than 200, duplicate, empty, or unknown IDs is rejected.

Run:

```bash
python3 -B -m unittest core.tests.test_analysis_jobs -v
```

Expected red result: `AnalysisManager` does not exist.

- [x] **Step 4: Implement the single-thread manager and rerun repository/manager tests**

Use one daemon thread plus `threading.Condition`. The manager checks the persisted pause flag before claiming the next queued row, changes one job to `running`, increments attempts, computes the fingerprint, reuses an exact cache match, or calls the provider. Progress callbacks persist only monotonic bounded values. `pause()` sets the control flag and interruption event; `resume()` changes paused rows to queued and notifies; `stop()` interrupts, joins for at most five seconds, and leaves unfinished work queued. Stable error codes are `missing_file`, `unsupported_audio`, `decode_failed`, `analysis_timeout`, `provider_unavailable`, and `analysis_failed`; messages are capped at 500 characters and contain no source path.

Run the Step 1 and Step 3 commands. Expected: all database and manager tests pass.

---

### Task 3: Strict core, IPC, and preload analysis contracts

**Files:**
- Create: `core/tests/test_analysis_service.py`
- Create: `app/desktop/tests/analysis-contracts.test.ts`
- Modify: `core/dj_copilot/service.py`
- Modify: `core/tests/test_service.py`
- Modify: `app/desktop/src/shared/contracts.ts`
- Modify: `app/desktop/src/main/core-supervisor.ts`
- Modify: `app/desktop/src/main/ipc.ts`
- Modify: `app/desktop/src/preload/index.ts`
- Modify: `app/desktop/tests/main-security.test.ts`
- Modify: `app/desktop/tests/preload-contract.test.ts`

**Interfaces:**
- Consumes: Task 2 manager/status DTOs.
- Produces four renderer operations:

```ts
analysis: {
  queue(trackIds: string[]): Promise<AnalysisQueueStatus>;
  getStatus(trackIds?: string[]): Promise<AnalysisQueueStatus>;
  pause(): Promise<AnalysisQueueStatus>;
  resume(): Promise<AnalysisQueueStatus>;
}
```

`AnalysisQueueStatus` is a strict object with `state: "idle" | "running" | "paused"`, five nonnegative counts, `progressPpm`, strict capabilities, and at most 200 strict item objects. Each item contains `trackId`, status/progress/attempt/error fields, and a nullable strict feature object matching Task 1. `TrackListItem` gains `analysis: AnalysisSummary | null`; it still rejects paths and unknown fields. `get_analysis_status` accepts `{}` or `{ trackIds: [...] }`; when IDs are supplied, the response includes exactly those known IDs in request order while aggregate counts remain global.

- [x] **Step 1: Write failing Python service tests**

Start the real service with generated XML/audio and injected exact executables. Verify `queue_analysis`, `get_analysis_status`, `pause_analysis`, and `resume_analysis`; reject empty, duplicate, unknown, malformed, or more than 200 IDs; accept only an optional strict `trackIds` list on status; reject payloads on pause/resume; prove responses contain no path; and prove SIGTERM stops the manager before closing SQLite/socket. A provider-unavailable process must keep health/library commands ready and report unavailable capabilities.

Run:

```bash
python3 -B -m unittest core.tests.test_service core.tests.test_analysis_service -v
```

Expected red result: analysis commands are outside the allowlist.

- [x] **Step 2: Wire manager lifecycle and strict Python commands**

Construct the provider and manager once in `serve`, call `manager.start()` after database recovery, dispatch quick queue/control/status calls, and call `manager.stop()` in `finally` before `database.close()`. Add only `queue_analysis`, `get_analysis_status`, `pause_analysis`, and `resume_analysis`; all DSP remains off the request thread.

- [x] **Step 3: Write failing Zod, IPC, and preload tests**

Use hand-written literal DTOs to prove scaled bounds, nullable low-confidence fields, exact provider/provenance strings, path/unknown-field rejection, max 200 IDs, trusted-sender enforcement, current-client lookup after restart, and exact frozen preload keys. Invoke each fixed channel and assert its returned validated result rather than asserting only that a mock was called.

Run:

```bash
pnpm --dir app/desktop test -- analysis-contracts main-security preload-contract
```

Expected red result: analysis schemas/API/channels do not exist.

- [x] **Step 4: Extend shared schemas, guarded IPC, preload, and development Python selection**

Add the four core request variants and analysis schemas. `registerIpcHandlers` parses every payload and core result. `createDesktopApi` exposes only `system`, `library`, and `analysis`. The supervisor selects `DJ_COPILOT_PYTHON`, then `<repositoryRoot>/.venv/bin/python` when executable, then `python3`; tests cover the order without touching the real filesystem.

- [x] **Step 5: Run the full boundary checks**

Run both Step 1 and Step 3 commands plus:

```bash
pnpm typecheck
```

Expected: Python service tests, desktop boundary tests, and strict TypeScript all pass.

---

### Task 4: Selectable analysis workstation UI

**Files:**
- Create: `app/desktop/src/renderer/src/features/analysis/AnalysisControls.tsx`
- Create: `app/desktop/src/renderer/src/features/analysis/FeatureEvidence.tsx`
- Create: `app/desktop/tests/analysis-screen.test.tsx`
- Modify: `app/desktop/src/renderer/src/features/library/LibraryScreen.tsx`
- Modify: `app/desktop/src/renderer/src/features/library/TrackTable.tsx`
- Modify: `app/desktop/src/renderer/src/styles.css`
- Modify: `app/desktop/tests/library-screen.test.tsx`

**Interfaces:**
- Consumes: Task 3 `DesktopApi.analysis`, queue/status DTOs, and `TrackListItem.analysis`.
- Produces: keyboard-accessible row selection, start/retry, pause/resume, live aggregate progress, per-track status/errors, and a compact feature-evidence surface.

**Design direction:** Preserve the existing cue-sheet workstation. Add one quiet “analysis transport” rail beneath service status; its single signature element is a sixteen-cell energy strip derived from actual stored buckets, echoing a deck waveform without pretending to be one. Existing navy, mist, amber, teal, and rust tokens remain; no new decorative gradient, animation, or generic card grid is introduced.

- [x] **Step 1: Write failing renderer behavior tests**

Tests must prove:

- row and select-all checkboxes have track-specific accessible names and exclude missing/unreadable rows;
- `Analyze 2 selected` sends exactly the known IDs and clears nothing on failure;
- running state exposes an accessible `progressbar` with scaled value and a Pause button;
- paused state exposes Resume and remains paused after a simulated reload response;
- succeeded rows show codec/container, duration/sample-rate/channels, local BPM/key, confidence labels, provider/pipeline, RMS/energy/rhythm/timbre values, limitations, and the sixteen-cell strip;
- failed rows show the stable message and can be selected/requeued without hiding successful rows;
- a provider-unavailable state disables analysis with the returned reason while library browsing remains usable, and available baseline analysis labels structure/embeddings as unavailable rather than silently omitting them;
- one-second polling never overlaps, requests the currently rendered/selected known IDs in stable order (capped at 200 by selection controls), and merges job updates by `trackId` without resetting playlist selection or loaded rows.

Run:

```bash
pnpm --dir app/desktop test -- analysis-screen library-screen
```

Expected red result: the controls, selection, evidence, and API do not exist.

- [x] **Step 2: Implement the bounded UI state and components**

`LibraryScreen` owns `selectedTrackIds`, queue status, one non-overlapping poll ref, and merge-by-ID behavior. `TrackTable` emits selection events and renders imported versus local BPM/key distinctly. `AnalysisControls` names actions by outcome (`Analyze 2 selected`, `Pause analysis`, `Resume analysis`). `FeatureEvidence` formats confidence as whole percentages, milli-dB as one decimal dBFS, and unknown values as `Not enough evidence`; it renders energy buckets as semantic text plus an `aria-hidden` strip.

- [x] **Step 3: Apply the cue-sheet token extension and rerun UI/type checks**

Add visible focus for checkboxes/analysis buttons, minimum 44px controls where practical, narrow-screen horizontal table behavior, dark-theme tokens, and reduced-motion compatibility. Run:

```bash
pnpm --dir app/desktop test -- analysis-screen library-screen
pnpm typecheck
pnpm --dir app/desktop build
```

Expected: focused UI tests, strict typecheck, and renderer build pass. No screenshot or visual-pass claim is made under D-045.

---

### Task 5: Generated-fixture restart flow, evidence, review, and checkpoint

**Files:**
- Create: `app/desktop/e2e/analysis-flow.spec.ts`
- Create: `scripts/verify-m2.sh`
- Create: `scripts/setup-python.sh`
- Create: `docs/evidence/m2-local-analysis.md`
- Modify: `package.json`
- Modify: `app/desktop/package.json`
- Modify: `README.md`
- Modify: `TASKS.md`
- Modify: `DECISIONS.md`
- Modify: `KNOWN_ISSUES.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/TEST_STRATEGY.md`
- Modify: `docs/USER_GUIDE.md`
- Modify: `docs/RECOVERY.md`
- Modify: `docs/REPO_RESEARCH.md`
- Modify: `docs/LICENSING.md`
- Modify: `docs/EVALUATION.md`
- Modify: `docs/adr/0005-audio-analysis-and-licenses.md`

**Interfaces:**
- Consumes: the complete M2 slice.
- Produces: `pnpm verify:m2`, reproducible setup, dependency/license evidence, generated-audio Electron recovery evidence, and a pushed M2 checkpoint.

- [x] **Step 1: Write the Electron flow before adding test-only timing support**

Generate a temporary M2 XML whose four tracks resolve to `clicks.wav`, `harmonic.wav`, `silence.wav`, and `corrupt.wav`. Launch the production build with an isolated user-data directory, exact provider paths, `DJ_COPILOT_TEST_MODE=1`, and `DJ_COPILOT_ANALYSIS_TEST_DELAY_MS=75`. Import, select all, start analysis, wait for visible nonzero progress, pause, force one core exit through the existing main-only hook, wait for ready, prove the queue is still paused, resume, and assert three successes plus one corrupt-file failure. Assert 120 local BPM for clicks, C major for harmonic, unknown BPM/key for silence, provider/pipeline/confidence text, persistence after page reload, unchanged audio hashes, and runtime-directory cleanup after quit.

Run:

```bash
pnpm --dir app/desktop exec playwright test e2e/analysis-flow.spec.ts
```

Expected red result: the M2 flow and test-only delay injection do not exist.

- [x] **Step 2: Add only the bounded integration support needed by the red flow**

Allow `DJ_COPILOT_ANALYSIS_TEST_DELAY_MS` only when `DJ_COPILOT_TEST_MODE=1`, parse an integer from 0–250, and inject it between provider chunks. Do not expose timing controls through preload or normal production requests. Add `scripts/setup-python.sh` with `set -euo pipefail`; run `python3 -m venv .venv`, `.venv/bin/python -m pip install -r core/requirements.txt`, exact NumPy import/version validation, and FFmpeg/ffprobe version validation. Root `pnpm setup` invokes it before Electron installation.

- [x] **Step 3: Add the focused M2 gate and run it**

`scripts/verify-m2.sh` uses `set -euo pipefail`, checks NumPy and FFmpeg/ffprobe prerequisites, then runs:

```bash
python3 -B -m unittest discover -s core/tests -v
pnpm --dir app/desktop test
pnpm typecheck
pnpm build
pnpm --dir app/desktop exec playwright test
```

Root `pnpm verify:m2` invokes the script. Run it, then run `git diff --check`. Expected: every M1 and M2 Python/desktop test, strict typecheck/build, two M1 Electron flows, and the M2 analysis flow pass.

- [x] **Step 4: Update durable records with measured, non-visual evidence**

Record exact host/runtime/provider versions, fixture hashes, feature outputs/tolerances, queue/restart outcomes, per-file failure, unsupported-provider behavior, elapsed time, and the D-045 visual deferral. Record FFmpeg 8.1.2 external-development use, NumPy 2.4.4 licensing/wheel evidence, the GPL Homebrew non-bundling constraint, and the M7 LGPL-build decision. Do not claim real-music accuracy, common-codec breadth beyond measured fixtures, or a visual pass.

- [x] **Step 5: Perform one final read-only M2 scope/quality review**

The reviewer checks the complete M2 diff against this plan and the approved personal-MVP design. Resolve any High/Medium normal-workflow defect with one bounded fix wave and affected tests; do not start repeated security or screenshot review loops.

- [x] **Step 6: Inspect, commit, and push M2**

The primary inspects status, intended manifest, staged diff, credentials, personal metadata, audio, databases, caches, and generated outputs; runs `git diff --cached --check`; commits `feat: add resumable local track analysis`; pushes `main`; records the exact green hash; and verifies `origin/main...main` is `0 0` with a clean worktree.

Stop at the M2 boundary only long enough to write the separate M3 discovery/recommendation plan. Do not request visual QA or wait for another continuation prompt.
