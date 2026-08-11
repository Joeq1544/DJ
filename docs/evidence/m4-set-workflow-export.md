# M4 Set Workflow and Rekordbox Export Evidence

- Date: 2026-08-11
- Status: complete; post-review aggregate green, original reviewer READY, and closure checkpoint pushed
- Plan: `docs/superpowers/plans/2026-08-11-m4-set-workflow-export.md`
- XML checkpoint: `3f87261` (pushed to `origin/main`)
- Set-domain/core checkpoint: `abad8c3` (pushed)
- Desktop workspace checkpoint: `82bbf94` (pushed)
- Integrated flow/corrections checkpoint: `dd741d6` (pushed)
- Review-correction/closure checkpoint: `10d2511` (pushed)

## Scope exercised

M4 adds schema-v3 persistent/versioned set drafts, structured creation and editing, exact M3 transition-evidence reuse, bounded alternatives/optimization/inspection, advisory organization suggestions, official numeric-KeyType parser compatibility, and one deterministic self-contained Rekordbox XML export. Local set behavior does not initialize Codex. Renderer data stays path-free; Electron main owns the native destination and single-use confirmation; the Python core alone owns SQLite and private export paths.

## Automated evidence

| Check | Actual result |
| --- | --- |
| Pure discovery/set domain | 32/32 passed: strict immutable snapshots, repeats, hard artist cap, partial constraints, all mutations/pins/bans/goals, exact M3 edge reuse, alternatives, pin-safe non-worsening/idempotent optimization, warnings, organization, and truncation |
| Production parser/writer | 19/19 passed after the official numeric-KeyType reproduction: numeric/text forms, conflict/mixing rejection, Unicode/URI/repeats/determinism, source alias/state races/symlinks, mode-0600 temp, fsync, semantic reparse, atomic replace, failure state, and cleanup |
| Set repository/service | Post-review repository/service regressions passed 13/13; complete core suite passed 119/119, including schema-v3 pre-DDL backup, optimistic revisions, conflict-before-validation behavior, branching undo/redo, identical saved-version restore, saved-version cap/view/restore, repeated playlist evidence, path-free commands, and export snapshots |
| Desktop boundary/renderer | Focused boundary 32/32 and renderer 3/3 after review corrections; complete desktop suite passed 116/116 with strict Zod/IPC/preload, main-owned confirmation, accessible set controls, historical read-only behavior, exact eight intents, creation constraints, playlist/draft inspection, unique repeated-playlist analysis IDs, version viewing, and overwrite disclosure |
| `pnpm typecheck` / `pnpm build` | Passed; Vite emitted the production renderer plus Electron main/preload bundles |
| `pnpm --dir app/desktop test:e2e:m4` | 1/1 passed after saved-head version identity was corrected |
| `pnpm verify:m4` | Post-review pass: shell/prerequisite/tracked-residue checks, 119 core, 116 desktop, strict typecheck, production build, and all 5 M1–M4 Electron flows |
| `git diff --check` | Passed before the implementation checkpoint and current documentation update |

The complete core/desktop suites need permission for temporary local Unix sockets, and Electron flows launch the development app; the identical scoped checks passed with that local permission. No network service, personal library, personal audio, screenshot, or visual inspection was used.

## Review disposition

The single bounded M4 reviewer returned READY after the correction pass, with no unresolved High/Medium normal-workflow issue. Its fresh checks passed 13/13 history/service tests, 12/12 renderer correction tests, and `git diff --check`; it confirmed the synchronized 119-core/116-desktop/5-Electron aggregate. Visual QA remains explicitly deferred.

## Integrated generated-fixture result

The Electron flow generated five small non-audio marker files and an official numeric-KeyType XML under an OS temporary directory. It imported the XML through the production picker/IPC/core path and selected a playlist ordered `(Alpha, Beta, Alpha, Gamma, Delta)`.

- Playlist inspection ran before draft creation and returned progression/transition/organization output without mutation.
- Creating from the playlist retained both Alpha occurrences. The flow moved Beta, exercised a track pin and a separate position pin, banned Delta, replaced Beta, assigned Gamma a closer role and energy goal, optimized, undid/redid, saved/viewed/returned/restored a version, and inspected the resulting draft.
- Export preparation first cancelled cleanly. A second preparation disclosed a new file and confirmed it; the finalized XML reparsed with the production parser to the exact visible draft order, including the repeated Alpha reference. A third preparation disclosed and confirmed overwrite, and the overwritten result reparsed to the same exact order.
- Relaunching the app against the same user-data directory reopened the persisted draft with both Alpha positions.
- SHA-256 values for the generated source XML and all five marker files matched before and after. No export temporary sibling remained, and each supervisor runtime directory disappeared after shutdown. The enclosing temporary fixture/user-data directory was removed by test cleanup.

## Integration corrections

- The first launcher contract test exposed two invalid UI-only intent values. The launcher/workspace now render the exact eight shared intents and creation-time duration/artist constraints; KI-064 records the regression.
- The expanded Electron flow exposed that explicitly viewing a saved version equal to the current head returned `viewingVersion: null`. The service now distinguishes an explicit revision view from an ordinary live read; KI-065 records the focused core and integrated regressions.
- Contract inspection also added the previously absent imported-playlist inspection control and an explicit create-versus-overwrite message before confirmation.
- The bounded milestone review found that historical views could still dispatch shortcuts/export and show stale uncontrolled goal values. Historical mode now blocks mutation/export paths and remounts revision-scoped goal inputs; its renderer regression passes 3/3.
- Repository/service review found that restoring an identical saved head did not append an undoable revision and a stale mutation validated against a newer head before reporting conflict. Both behaviors now have focused regressions in the 13/13 repository/service pass.
- The first post-review aggregate exposed duplicate analysis polling IDs for a repeated playlist and an E2E helper that could accept a stale success message. Polling/queueing now preserve first-seen unique IDs, and mutation announcements include the operation and revision so the integration flow waits for each actual update.

## Current limitations

- No screenshots or visual/native-picker appearance checks were performed, per D-045 and Joe's explicit deferral until all M1–M7 features are implemented.
- The generated five-track flow proves deterministic engineering behavior, not subjective set quality, personal-library relevance, or useful organization labels. Joe's hands-on period owns those judgments.
- The output is production-parser-valid and official-form synthetic XML. A real Rekordbox 7.2.14 import remains unperformed and is not inferred from reparse success.
- Export is intentionally one self-contained collection plus one playlist. It does not merge source XML, edit Rekordbox databases, copy audio, or apply organization suggestions.
