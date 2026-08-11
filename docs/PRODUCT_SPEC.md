# DJ Copilot Product Specification

Status: Personal full-feature MVP approved 2026-08-10
Authoritative MVP design: `superpowers/specs/2026-08-10-personal-full-feature-mvp-design.md`
Detailed product source: `../dj-copilot-codex-master-prompt.md`

## Mission

DJ Copilot is a local-first macOS companion for Joe's real Rekordbox library. It analyzes local music, makes discovery and transition work easier, helps build and evaluate sets, and adds Codex-powered natural-language assistance without replacing Rekordbox.

## Personal full-feature MVP

The personal MVP retains the complete intended workflow:

- import, reconcile, browse, and safely export Rekordbox XML;
- analyze selected local audio with resumable jobs, progress, provenance, confidence, and per-file failures;
- browse a large library with track details, playlist hierarchy, filters, saved views, diagnostics, and accessible states;
- run text, structured, and similarity search;
- receive deterministic, explainable next-track and transition recommendations;
- create, edit, reorder, pin, ban, version, analyze, save, and export set drafts;
- propose non-destructive library organization;
- learn from explicit feedback through visible, resettable preferences;
- use the official Codex SDK for natural-language search, set planning/revision, and evidence-grounded explanations;
- recover app-owned data and launch a personal macOS build.

Codex-enhanced actions may be unavailable when auth or the service is unavailable. Local library, analysis, discovery, ranking, draft editing, and export remain useful without Codex.

## Product invariants

1. Rekordbox remains the source of truth; DJ Copilot never writes Rekordbox databases.
2. Source audio is read-only and raw audio never goes to Codex.
3. Production AI uses the official Codex SDK with existing Codex/ChatGPT auth and no `OPENAI_API_KEY` flow.
4. Recommendations, drafts, and exports contain only validated IDs from the imported library.
5. Deterministic local code owns measurable features, constraints, candidate retrieval, scoring, and sequence optimization.
6. Pins, bans, tags, notes, ratings, edits, and other explicit user choices outrank predictions.
7. Consequential app-state changes and exports require a trusted-UI preview and confirmation.

## User-visible scope

Primary surfaces are onboarding, library, track detail, Copilot, set builder, set analyzer, organization suggestions, settings, and diagnostics. Normal workflows include keyboard navigation, visible focus, semantic controls, scalable text, light/dark themes, and explicit loading, empty, partial, and error states.

Common failures—bad XML, missing files, unsupported codecs, worker crashes, Codex errors, invalid IDs, migration problems, and invalid exports—must preserve the last usable state and provide a useful recovery path.

## Deferred commercial work

The personal MVP does not require hostile same-user process containment, exhaustive Codex capability-denial proof, repeated independent reviewers, exhaustive fuzz/parity matrices unrelated to real workflows, notarization, public distribution, multi-user support, broad Mac compatibility, or support for every Rekordbox/codec variant.

These are deferrals, not removed user features. Revisit them if the app is shared, gains remote/multi-user surfaces, or real use exposes a related defect.

## Completion rule

A feature is complete only when its integrated behavior works through a focused automated or documented manual flow. The personal MVP is complete when every retained workflow can be demonstrated on Joe's Mac, focused checks are green, no known defect blocks normal use, recovery works for common failures, limitations are documented, and the personal build launches from a clean project setup.
