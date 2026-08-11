# M1 App Shell and Library Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch a sandboxed Electron/React desktop app with a supervised Python/SQLite core, import the generated Rekordbox XML fixture or a file selected through the native dialog, and browse tracks and ordered playlists without modifying the source.

**Architecture:** Electron main owns the window, native file dialog, guarded IPC, and one bounded core restart. A sandboxed preload exposes four named operations. A standard-library Python service owns one SQLite connection and a private Unix-domain socket; it parses an import completely before atomically replacing the active library revision. The renderer consumes display-safe DTOs only.

**Tech Stack:** pnpm 11.16.0; Electron 43.3.0; React/React DOM 19.2.8; TypeScript 7.0.2; Vite 8.2.1; Zod 4.4.3; esbuild 0.28.2; Vitest 4.1.10; Testing Library 16.3.2; Playwright 1.62.1; Python standard library compatible with CPython 3.12+ and exercised on the host CPython 3.14.3.

## Global Constraints

- This implements only M1. Do not add analysis, search/ranking, drafts/export, personalization, Codex/MCP, packaging/signing, `pyrekordbox`, Redux, a generic event bus, or a component library.
- Rekordbox XML and media are read-only. Never write a Rekordbox database or source file.
- Renderer `webPreferences` explicitly set `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`; preload exposes named functions rather than `ipcRenderer` or generic forwarding.
- The renderer never provides an arbitrary import path. Electron main owns the file picker; the fixture override exists only when `DJ_COPILOT_TEST_MODE=1`.
- Python is the sole app-database owner. A failed parse or transaction leaves the previous active revision browsable.
- Shared values are bounded. Core socket lines are at most 1 MiB, track pages are 1–200 rows, string IDs are non-empty and at most 128 characters, and user-safe error messages are at most 500 characters.
- Raw audio is never opened in M1. Missing/unreadable file status is metadata only.
- Subagents edit only explicitly assigned files, never stage/commit/push/switch branches, and do not edit `TASKS.md`, `DECISIONS.md`, `KNOWN_ISSUES.md`, evidence, or changelog files.
- The primary agent owns shared contracts, integration, project memory, Git operations, and pushes a green checkpoint after the core slice and after M1 closes.

---

### Task 1: Workspace, build pipeline, and shared contracts

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Modify: `.gitignore`
- Create: `app/desktop/package.json`
- Create: `app/desktop/tsconfig.json`
- Create: `app/desktop/vite.config.ts`
- Create: `app/desktop/vitest.config.ts`
- Create: `app/desktop/src/shared/contracts.ts`
- Create: `app/desktop/tests/contracts.test.ts`
- Create: `core/dj_copilot/__init__.py`
- Create: `core/tests/__init__.py`

**Interfaces:**
- Produces: Zod-backed `DesktopApi`, `AppStatus`, `ImportResult`, `PlaylistTreeNode`, `TrackListItem`, `TrackPage`, and core request/response schemas used unchanged by later tasks.
- Produces: root `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm typecheck`, and `pnpm verify:m1` entry points.

- [ ] **Step 1: Create the workspace manifests with exact pins**

Root scripts must be:

```json
{
  "dev": "pnpm --dir app/desktop dev",
  "build": "pnpm --dir app/desktop build",
  "test": "pnpm test:core && pnpm test:desktop",
  "test:core": "python3 -B -m unittest discover -s core/tests -v",
  "test:desktop": "pnpm --dir app/desktop test",
  "typecheck": "pnpm --dir app/desktop typecheck",
  "verify:m1": "bash scripts/verify-m1.sh"
}
```

The root manifest is private, declares `packageManager: "pnpm@11.16.0"`, and `engines.node: ">=24 <26"`. The workspace contains only `app/desktop`.

The desktop manifest pins the versions in this plan header plus `@types/node@26.2.0`, `@types/react@19.2.18`, `@types/react-dom@19.2.4`, `@testing-library/jest-dom@7.0.1`, `@testing-library/user-event@14.6.3`, `jsdom@30.0.1`, `concurrently@10.0.4`, and `wait-on@9.1.0`. Its `main` is `dist/main/main.cjs`.

- [ ] **Step 2: Add build and test configuration**

`app/desktop` scripts use Vite for `src/renderer`, and one esbuild command for `src/main/main.ts` plus `src/preload/index.ts` with `--bundle --platform=node --format=cjs --external:electron --outbase=src --outdir=dist --out-extension:.js=.cjs`. Development runs Vite, esbuild watch, and Electron concurrently; Electron starts only after port 5173 and both CJS outputs exist.

`vite.config.ts` fixes the dev host to `127.0.0.1`, emits renderer assets to `dist/renderer`, and never exposes filesystem access. `vitest.config.ts` uses `jsdom`, loads `tests/setup.ts`, and excludes Playwright tests.

- [ ] **Step 3: Write the failing shared-contract tests**

Tests must prove:

```ts
expect(trackPageQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
expect(trackPageQuerySchema.parse({}).limit).toBe(100);
expect(coreRequestSchema.safeParse({ version: 1, id: "r1", command: "shell", payload: {} }).success).toBe(false);
expect(importResultSchema.parse({
  success: false,
  error: { code: "unsafe_xml", message: "DTD is not allowed" },
  preservedPreviousLibrary: true
}).preservedPreviousLibrary).toBe(true);
```

The tests also assert the public API has exactly `system.getStatus`, `library.importXml`, `library.getPlaylistTree`, and `library.listTracks`.

- [ ] **Step 4: Run the tests to verify RED**

Run: `pnpm --dir app/desktop test -- contracts.test.ts`

Expected: failure because the schemas and test setup do not exist yet.

- [ ] **Step 5: Implement the shared schemas**

Use discriminated unions and strict objects. Core envelopes are exactly:

```ts
type CoreRequest = {
  version: 1;
  id: string;
  command: "health" | "import_library" | "get_playlist_tree" | "list_tracks";
  payload: Record<string, unknown>;
};

type CoreResponse =
  | { version: 1; id: string; ok: true; result: unknown }
  | { version: 1; id: string; ok: false; error: { code: string; message: string; preservedPreviousLibrary?: boolean } };
```

The shared public types are exactly:

```ts
type AppStatus = {
  state: "starting" | "ready" | "retrying" | "degraded";
  message: string | null;
};
type TrackListItem = {
  id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  bpmMilli: number | null;
  musicalKey: string | null;
  durationMs: number | null;
  availability: "available" | "missing" | "unreadable";
};
type TrackPage = { items: TrackListItem[]; nextCursor: string | null };
type PlaylistTreeNode = {
  id: string;
  parentId: string | null;
  name: string;
  kind: "folder" | "playlist";
  order: number;
  trackCount: number;
};
type ImportSummary = {
  revision: number;
  sourceSha256: string;
  importedTracks: number;
  importedPlaylists: number;
  unavailableTracks: number;
};
type ImportResult =
  | { success: true; summary: ImportSummary }
  | { success: false; error: { code: string; message: string }; preservedPreviousLibrary: true };
type DesktopApi = {
  system: { getStatus(): Promise<AppStatus> };
  library: {
    importXml(): Promise<ImportResult>;
    getPlaylistTree(): Promise<PlaylistTreeNode[]>;
    listTracks(query?: { playlistId?: string; cursor?: string; limit?: number }): Promise<TrackPage>;
  };
};
```

No renderer DTO contains `normalizedPath`, database paths, or source XML text. `import_library` alone accepts `{ sourcePath: string }` over the main-to-core connection. The other payloads are `{}` or the exact `listTracks` query shape above. Main validates every command-specific result before returning it to preload.

- [ ] **Step 6: Verify and install**

Run: `pnpm install`

Run: `pnpm --dir app/desktop test -- contracts.test.ts`

Run: `pnpm typecheck`

Expected: contract tests pass and strict typecheck exits 0.

---

### Task 2: Atomic Rekordbox import, SQLite repository, and core service

**Files:**
- Create: `core/dj_copilot/models.py`
- Create: `core/dj_copilot/rekordbox_xml.py`
- Create: `core/dj_copilot/database.py`
- Create: `core/dj_copilot/service.py`
- Create: `core/tests/test_rekordbox_xml.py`
- Create: `core/tests/test_database.py`
- Create: `core/tests/test_service.py`

**Interfaces:**
- Consumes: the four command names and DTO field names fixed in Task 1.
- Produces: `parse_rekordbox_xml(Path) -> RekordboxImport`, `LibraryDatabase`, and `python3 -m dj_copilot.service --socket PATH --database PATH`.
- Produces: a one-line JSON socket protocol matching `CoreRequest`/`CoreResponse`, capped at 1 MiB per line.

- [ ] **Step 1: Write parser tests before production parser code**

Using `fixtures/rekordbox/phase0-library.xml`, assert four tracks, title/artist preservation, deterministic SHA-256, unavailable paths, folder/playlist hierarchy, Opening order `2,1`, Closer order `4,3`, and unchanged source bytes.

Add focused rejection tests for UTF-16, DTD/entity declarations, malformed XML, wrong root/version, declared-count mismatch, duplicate TrackID, unresolved playlist reference, non-local file URI, hierarchy depth, total playlist-entry limit, and ambiguous Location references.

Run: `python3 -B -m unittest core.tests.test_rekordbox_xml -v`

Expected: import failure because `rekordbox_xml.py` does not exist.

- [ ] **Step 2: Implement the bounded production importer**

Adapt the proven standard-library spike rather than importing it. Accept UTF-8 and UTF-8 BOM only; deny DTD/entity text before parsing; enforce `DJ_PLAYLISTS` version `1.0.0`; cap bytes, nodes, text, depth, tracks, playlist nodes, and playlist entries. Parse common display fields, convert `AverageBpm` or the first valid `TEMPO Bpm` to half-even `bpm_milli`, convert `TotalTime` seconds to `duration_ms`, normalize local `file://` URIs, and determine availability without opening audio.

Playlist `import_key` is a deterministic structural index path such as `0/1/0`, not a name. Resolve TrackID directly and Location only when exactly one normalized collection location matches. Raise `RekordboxImportError(code, message)` with stable codes and messages capped at 500 characters.

- [ ] **Step 3: Verify parser GREEN**

Run: `python3 -B -m unittest core.tests.test_rekordbox_xml -v`

Expected: all parser tests pass.

- [ ] **Step 4: Write database atomicity and reconciliation tests**

Tests create a temporary SQLite file and assert:

```py
first = database.import_library(valid_import)
assert first.imported_tracks == 4
before = database.list_tracks(limit=100)
with self.assertRaises(RekordboxImportError):
    database.import_path(invalid_path)
self.assertEqual(database.list_tracks(limit=100), before)
```

Reimporting the same fixture must keep every app track/playlist ID stable and increment the library revision exactly once. `list_tracks(playlist_id=opening_id)` preserves membership order. Unknown playlist IDs return `not_found`, never an empty success that hides invalid input.

Run: `python3 -B -m unittest core.tests.test_database -v`

Expected: failure because `LibraryDatabase` does not exist.

- [ ] **Step 5: Implement the sole-owner SQLite repository**

Create `library_state`, `tracks`, `playlists`, and `playlist_tracks` tables. Parse outside the write transaction, reuse existing app UUIDs by external track ID and playlist import key, then use `BEGIN IMMEDIATE` to replace the active rows and increment the revision. Roll back on every exception. All database use stays inside the service process.

Implement cursor pages as a base64url encoding of the last `(sort_order_or_title, id)` tuple; reject malformed cursors. M1 defaults to title/artist order for the collection and membership position for a playlist.

- [ ] **Step 6: Write and implement service integration tests**

Start the service against a temporary socket/database, connect with `socket.socket(AF_UNIX)`, and test health, fixture import, playlist tree, list tracks, malformed request, unknown command, oversized line, and clean SIGTERM shutdown/socket cleanup. Assert socket directory/file permissions do not exceed `0700`/`0600`.

Run: `python3 -B -m unittest discover -s core/tests -v`

Expected after implementation: all core tests pass with no external package.

- [ ] **Step 7: Primary checkpoint**

The primary reviews the diff, updates M1 rows/evidence as `in-progress`, stages only Task 1–2 files, commits `feat: add DJ core library import`, and pushes `main` only after `pnpm test`, `pnpm typecheck`, and `git diff --check` pass.

---

### Task 3: Electron main supervision, guarded IPC, and preload

**Files:**
- Create: `app/desktop/src/main/core-client.ts`
- Create: `app/desktop/src/main/core-supervisor.ts`
- Create: `app/desktop/src/main/window-security.ts`
- Create: `app/desktop/src/main/ipc.ts`
- Create: `app/desktop/src/main/main.ts`
- Create: `app/desktop/src/preload/index.ts`
- Create: `app/desktop/src/renderer/electron.d.ts`
- Create: `app/desktop/tests/core-client.test.ts`
- Create: `app/desktop/tests/core-supervisor.test.ts`
- Create: `app/desktop/tests/main-security.test.ts`
- Create: `app/desktop/tests/preload-contract.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas and Task 2 service entry point.
- Produces: `CoreClient.request(command, payload)`, `CoreSupervisor.start/stop/status`, guarded handlers for the four preload operations, and `window.djCopilot`.

- [ ] **Step 1: Write failing client/supervision tests**

Use temporary Unix sockets and injected process/spawn adapters. Prove request correlation, schema rejection, 1 MiB response cap, connection timeout, pending-request rejection on exit, one automatic restart after unexpected exit, degraded state after the second exit in 30 seconds, and clean shutdown without restart.

Run: `pnpm --dir app/desktop test -- core-client.test.ts core-supervisor.test.ts`

Expected: failure because client/supervisor modules do not exist.

- [ ] **Step 2: Implement the client and supervisor**

Main creates a mode-0700 temporary runtime directory, resolves the development core module from the repository root, selects `DJ_COPILOT_PYTHON` or `python3`, and spawns:

```text
python3 -B -m dj_copilot.service --socket <runtime>/core.sock --database <userData>/dj-copilot.sqlite3
```

Set `PYTHONPATH` to the production `core` directory. Wait up to five seconds for health. Keep stderr bounded in memory for a safe status message. Restart once after unexpected exit, then expose degraded state and a retry action through a fresh app launch. Stop gracefully, then terminate if the worker exceeds two seconds.

- [ ] **Step 3: Write failing window, IPC, and preload tests**

Assert exact BrowserWindow preferences, navigation/window-open denial, strict CSP, trusted sender URL, dialog-owned import path, runtime schema validation, and exact preload keys. An invalid sender, payload, or playlist ID must reject with a stable error.

Run: `pnpm --dir app/desktop test -- main-security.test.ts preload-contract.test.ts`

Expected: failure because main/preload modules do not exist.

- [ ] **Step 4: Implement guarded desktop boundaries**

Create a pure `createWindowOptions(preloadPath)` for testability. Production navigation permits only the packaged renderer file; development permits exactly `http://127.0.0.1:5173`. Deny every new-window request.

`library.importXml()` opens an XML-only native dialog. In test mode only, `DJ_COPILOT_TEST_XML` replaces the dialog result after canonicalizing the path under the repository `fixtures` directory. Register fixed `ipcMain.handle` channels and validate `event.senderFrame.url` before forwarding a validated command to the core. Convert core failures to display-safe `ImportResult`/status DTOs.

Preload uses `contextBridge.exposeInMainWorld("djCopilot", frozenApi)` and exposes no event subscription or generic invoke method.

- [ ] **Step 5: Verify desktop boundary GREEN**

Run: `pnpm --dir app/desktop test -- core-client.test.ts core-supervisor.test.ts main-security.test.ts preload-contract.test.ts`

Run: `pnpm typecheck`

Expected: focused tests pass and strict typecheck exits 0.

---

### Task 4: Accessible macOS-feeling library renderer

**Files:**
- Create: `app/desktop/src/renderer/index.html`
- Create: `app/desktop/src/renderer/src/main.tsx`
- Create: `app/desktop/src/renderer/src/App.tsx`
- Create: `app/desktop/src/renderer/src/styles.css`
- Create: `app/desktop/src/renderer/src/features/library/ImportPanel.tsx`
- Create: `app/desktop/src/renderer/src/features/library/PlaylistTree.tsx`
- Create: `app/desktop/src/renderer/src/features/library/TrackTable.tsx`
- Create: `app/desktop/src/renderer/src/features/library/StatusPanel.tsx`
- Create: `app/desktop/src/renderer/src/features/library/LibraryScreen.tsx`
- Create: `app/desktop/tests/setup.ts`
- Create: `app/desktop/tests/library-screen.test.tsx`

**Interfaces:**
- Consumes: `window.djCopilot` only.
- Produces: a library screen with import, service state, playlist navigation, ordered track table, empty/loading/error/degraded states, and keyboard-accessible controls.

- [ ] **Step 1: Write renderer behavior tests**

With a mock `DesktopApi`, assert initial status/tree/track-page loading, import button behavior, four fixture-like rows, playlist selection calling `listTracks({playlistId})`, Unicode rendering, missing status text and icon, retained rows after an import error, actionable degraded-core state, and empty-library copy.

Keyboard tests cover ArrowUp/ArrowDown tree focus, ArrowRight expansion, ArrowLeft collapse/parent, Enter selection, and reachable table/import controls. Use semantic `navigation`, `tree`, `treeitem`, `table`, column headings, buttons, `aria-live="polite"`, and a newly raised import error with `role="alert"`.

Run: `pnpm --dir app/desktop test -- library-screen.test.tsx`

Expected: failure because the renderer does not exist.

- [ ] **Step 2: Implement the renderer**

Use a restrained sidebar/content layout, macOS system font stack, CSS variables for light/dark modes, visible `:focus-visible`, non-color availability indicators, `rem` sizing, and `prefers-reduced-motion`. Avoid gradients, oversized hero copy, glass cards, and excessive rounded containers.

The toolbar has one primary “Import Rekordbox XML” button. Sidebar begins with “All Tracks” followed by the imported folder/playlist hierarchy. The table shows Title, Artist, BPM, Key, and Status. The status panel distinguishes starting, ready, retrying, degraded, import success, and failure-with-previous-library-preserved.

- [ ] **Step 3: Verify renderer GREEN**

Run: `pnpm --dir app/desktop test -- library-screen.test.tsx`

Run: `pnpm typecheck`

Expected: renderer tests pass and typecheck exits 0.

---

### Task 5: Fixture desktop flow, M1 evidence, and checkpoint

**Files:**
- Create: `app/desktop/playwright.config.ts`
- Create: `app/desktop/e2e/library-flow.spec.ts`
- Create: `scripts/verify-m1.sh`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `TASKS.md`
- Modify: `DECISIONS.md`
- Modify: `KNOWN_ISSUES.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/TEST_STRATEGY.md`
- Modify: `docs/USER_GUIDE.md`
- Create: `docs/evidence/m1-app-shell-library.md`

**Interfaces:**
- Consumes: all M1 components.
- Produces: an automated Electron fixture flow, reproducible M1 verification command, current project memory, launch instructions, and an honest real-library/manual status.

- [x] **Step 1: Write the Electron fixture flow**

Build the app, launch Electron with a temporary user-data directory plus `DJ_COPILOT_TEST_MODE=1` and the canonical fixture path, click “Import Rekordbox XML,” and assert:

```ts
await expect(page.getByRole("row")).toHaveCount(5); // header + four tracks
await page.getByRole("treeitem", { name: "Opening" }).click();
await expect(page.getByRole("row")).toHaveCount(3); // header + two ordered members
await expect(page.getByRole("row").nth(1)).toContainText("Same Title");
await expect(page.getByRole("row").nth(2)).toContainText("Same Title");
await expect(page.getByText(/4 tracks imported/i)).toBeVisible();
```

The database integration test remains the exact order proof because the historical fixture intentionally gives both Opening members the same title and artist. Also force one core exit through a non-enumerable main-process global hook installed only under `DJ_COPILOT_TEST_MODE=1`; Playwright calls it with `electronApp.evaluate`, then asserts the status becomes retrying and ready after one restart with the imported library still visible. The hook is never exposed through preload.

- [x] **Step 2: Add the focused verification script**

`scripts/verify-m1.sh` uses `set -euo pipefail` and runs, in order: core tests, desktop Vitest tests, TypeScript typecheck, production build, and Playwright Electron flow. It fails if a command or required directory is missing.

Root `pnpm verify:m1` invokes this script rather than duplicating its commands.

- [x] **Step 3: Run the complete M1 gate**

Run: `pnpm verify:m1`

Expected: all Python and desktop tests pass, typecheck passes, build succeeds, and Electron fixture import/browse/restart flow passes.

Run: `git diff --check`

Expected: exit 0.

- [x] **Step 4: Defer visual interaction to the completed app by explicit user direction**

Run: `pnpm dev` and verify that the window launches, the import button opens the native XML picker, cancel is harmless, selecting `fixtures/rekordbox/phase0-library.xml` imports four tracks, Opening and Closer preserve order, and the source hash remains unchanged. Record the actual result; do not infer it from the automated test.

If no personal Rekordbox export is explicitly selected, record the real-library check as `not run — personal input not supplied`, not passed. Do not copy personal XML, paths, or track metadata into Git.

Actual disposition (2026-08-11): development launch behavior was exercised and recorded, while native-picker visual interaction was not. Joe explicitly deferred all visual QA until every feature is implemented. The native-picker check remains deferred, not passed, and no longer blocks M1.

- [x] **Step 5: Update durable records**

Add M1 task rows with linked commands/outcomes and checkpoint. Record the Electron/runtime pin and development-Python decision in `DECISIONS.md`; record any reproducible in-scope defect in `KNOWN_ISSUES.md`. Update architecture, testing, user guide, README, changelog, and evidence with implemented behavior and honest limitations.

- [x] **Step 6: One final scope/quality review**

Use one read-only reviewer for the complete M1 diff. Resolve High/Medium or normal-workflow findings; record rare theoretical limitations rather than starting repeated review loops. Re-run only the focused checks affected by fixes plus `pnpm verify:m1` when a shared boundary changes.

- [x] **Step 7: Commit and push M1**

The primary inspects `git status`, staged manifest, diff, credential/media/database patterns, and `git diff --cached --check`; commits `feat: deliver M1 library desktop slice`; pushes `main`; records both M1 commit hashes and verifies `origin/main...main` is `0 0` with a clean status.

Stop at the M1 boundary only long enough to write the separately bounded M2 local-analysis plan. Do not wait for another continuation prompt.
