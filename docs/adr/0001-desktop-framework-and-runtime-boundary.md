# ADR-0001: Desktop Framework and Runtime Boundary

- Status: Accepted
- Date: 2026-08-09
- Owners: primary, architect

## Context

DJ Copilot needs a responsive macOS UI, secure local filesystem mediation, worker supervision, packaging, and an environment suitable for the official TypeScript Codex SDK. Audio/DSP, Rekordbox parsing, and app-owned SQLite are best isolated from the UI and need Python ecosystem access.

## Decision

Use Electron + React + strict TypeScript for the desktop shell and a supervised
Python DJ-core service. The selected runtime major lines are Electron's embedded
Node.js 24 LTS line and bundled CPython 3.12; Phase 1 must recheck and lock exact
supported patches and the reproducible arm64 Python build before production code
depends on them. Python 3.12 remains security-supported through October 2028 and
is the newest line explicitly classified by the inspected `pyrekordbox` release,
while avoiding the host's largely unverified Python 3.14 ecosystem. Optional MIR
providers do not become approved merely because they run on that line.

Electron main owns desktop privileges and AI integration; an isolated preload
exposes a fixed typed API. Every renderer window must explicitly set
`contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`, with a
strict CSP, navigation/new-window controls, and sender/origin validation. Any
renderer-sandbox exception requires a superseding security ADR and executable
evidence; compatibility alone is not an exception. Python exclusively owns data
and measurable music logic.

## Alternatives

- Native Swift/SwiftUI: stronger native fit, but adds a bridge to the official SDK/runtime and duplicates cross-language contract work.
- Tauri/webview: smaller shell, but increases Rust/native/plugin/sidecar integration risk for the required SDK and Python worker.
- Single-process Node: simpler packaging, but gives up the preferred MIR/Python boundary and fault isolation.

## Phase 0 decision evidence required

Current supported Electron/Node/macOS versions, official SDK runtime support, isolated preload/CSP/navigation/sender controls, Python sidecar/process-supervision feasibility, renderer sandbox implications, and measured/estimated two-runtime cost must be supported by primary docs or bounded spikes. Record cost/benefit and rejection rationale in `../REPO_RESEARCH.md`.

## Current Phase 0 evidence and disposition

Official Electron evidence records stable 43.2.0 with Node 24.18.0 and a current
support window, while deliberately deferring the exact project patch pin until
Phase 1. The current Electron security checklist directly supports explicit
`contextIsolation`, no renderer Node integration, Chromium renderer sandboxing,
restrictive CSP/navigation/new-window policy, narrow preload exposure, and IPC-
sender validation. Electron's Node-specific `utilityProcess` is not a Python
transport, and its ASAR rules require Python/Codex/native executables and working
directories to be real resources outside the archive.

The independently reviewed P0-013 stand-in proves that the selected supervised
Python/private-socket/sole-SQLite-owner split is feasible at the protocol level;
it does not prove Electron launch or packaging. The two-runtime cost is accepted
as an explicit architecture tradeoff, while its implementation remains budgeted
evidence. Measurements use the Phase 0 reference Mac (`Mac17,2`, Apple M5,
24 GiB RAM, arm64, macOS 26.5.1): Phase 1 records three cold and three warm
development launches plus combined idle RSS after five idle minutes; Phase 9
repeats those measurements for the unsigned packaged app and records
uncompressed app size and compressed distribution size. The provisional
architecture budgets are a median cold interactive-shell launch at or below
5 seconds, median warm launch at or below 2 seconds, combined idle RSS at or
below 750 MiB, an unsigned app bundle at or below 750 MiB, and a compressed
artifact at or below 500 MiB, all excluding unapproved optional model assets.
Exceeding any budget requires an explicit architecture re-review before the
owning phase can close; results may not be hidden by changing the reference Mac.
See `../evidence/phase-0/framework-packaging.md`.

Independent architecture review found no high issue and accepted the framework
direction after the runtime, mandatory renderer-sandbox, and measured-budget
conditions above were made explicit. Acceptance selects the architecture and
major runtime lines; it does not claim an Electron launch, package, or exact
dependency lock exists.

## Later implementation verification

Phase 1 proves development launch, renderer isolation/permission denial, typed IPC, child supervision, and crash recovery. Phase 9 proves packaged helper/resource discovery, runtime footprint, entitlements, signing, and clean-machine behavior. Those tests do not block accepting the Phase 0 framework decision.

## Consequences

Two runtimes and a generated/tested contract boundary are mandatory; renderer work cannot bypass main/worker APIs. Packaging and recovery must test both processes.
