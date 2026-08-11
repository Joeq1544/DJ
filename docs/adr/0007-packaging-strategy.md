# ADR-0007: macOS Packaging Strategy

- Status: Accepted
- Date: 2026-08-09
- Owners: primary, architect, release reviewer

## Context

The packaged macOS app must launch the Electron shell and Python worker, find migrations/fixtures/approved model resources without developer paths, support Apple Silicon, and document signing/notarization that may require external credentials.

## Decision

Target direct Developer ID distribution with hardened runtime rather than Mac App
Store delivery for the first release. Start with Apple Silicon arm64;
universal/Intel support requires separate dependency evidence. Use Electron Forge
as the packaging candidate, with exact versions selected and locked in Phase 1.
Do not claim macOS App Sandbox confinement for the first release: Chromium
renderer sandboxing remains mandatory, file access uses explicit open/save
panels plus canonical app-owned approved-root records, and changing this posture
requires a superseding security ADR.

Bundle a reproducible Python core/MCP entrypoint and migrations as real resources
outside ASAR. Application resources are immutable at runtime and must pass the
recorded signature/integrity inventory; mutable data, generated models, and the
dedicated AI workspace belong in Application Support. Bundling the exact Codex
helper is conditional on ADR-0002 accepting that provider path and on service,
authentication, redistribution, version, and signing evidence. If accepted, it
must be a real nested resource selected explicitly (never an ambient CLI
fallback). Optional models are declared integrity/license capabilities, never
implicit downloads. Use manual signed update/download guidance for the first
release; a privileged auto-updater requires a separate security design.

## Alternatives

- Depend on a system Python/environment: simpler development but unacceptable clean-machine reproducibility.
- Separate installer/service: unnecessary operational complexity for a local companion MVP.
- Download runtime/models silently on first launch: rejected due to privacy, integrity, offline, and licensing ambiguity.

## Phase 0 decision evidence required

Current Electron builder support; arm64/universal policy; direct distribution versus App Sandbox constraints; security-scoped selections/bookmarks; least entitlements; Python bundling and nested helper/native-library signing order; app translocation; read-only bundle versus mutable Application Support resources; update policy; and exact Developer ID/notarization prerequisites. A bounded resource-path/helper feasibility check may inform selection, but full packaged launch is not a Phase 0 requirement.

## Current Phase 0 evidence and disposition

Electron officially recommends Forge for packaging. Current Electron ASAR
documentation establishes that spawned helpers and their working directories
need real resource paths outside the read-only archive. Apple primary guidance
requires Developer ID signing, hardened runtime, secure timestamp, valid nested
signatures/entitlements, notarization, and ticket verification for direct
distribution. Apple documents user-selected files, persistent security-scoped
bookmarks, and cross-process bookmark transfer for App Sandbox, but this app's
Electron→Python→Codex/auth chain has no executable proof that those capabilities
remain usable and isolated. The first-release proposal therefore rejects Mac App
Store/App Sandbox as the baseline and records that missing OS-level confinement
as a security posture, not as an invisible implementation detail.

Arm64-only, runtime-immutable and integrity-verified bundle resources, mutable Application Support state,
explicit approved roots, no silent model/runtime downloads, manual updates, and
no ambient-helper fallback are selected boundaries. Exact dependency versions,
resource-path launch, entitlement files, signature order, translocation behavior,
package size, `codesign`/`spctl`/`stapler`, and notarization credentials remain
the later verification listed below. See
`../evidence/phase-0/framework-packaging.md`.

Independent architecture/security review found no high issue and accepted the
no-App-Sandbox direct-distribution posture after runtime immutability, conditional
Codex-helper inclusion, and credential-independent versus credential-dependent
release evidence were made explicit. Acceptance does not claim a package has
been built or signed.

## Later implementation verification

Phase 1 proves development and unpacked process/resource paths. The mandatory,
credential-independent Phase 9 gate builds and launches an unsigned arm64
package; verifies resource/runtime/model discovery, migrations, backups,
translocation-safe paths, integrity inventory, entitlements, and the documented
nested signing order; and records size/launch/memory measurements on the ADR-0001
reference Mac. A separate credential-dependent release gate signs every nested
executable and the containing app, enables hardened runtime, timestamps, submits
for notarization, staples the ticket, and records passing `codesign`, `spctl`,
and `stapler` evidence. When credentials are unavailable, that release gate is
reported as not run and the artifact may not be called signed, notarized, or
release-ready; the unsigned engineering package gate can still be evaluated.

## Consequences

Development and packaged path resolution are explicit and tested. Missing optional providers degrade visibly; no release is called signed/notarized until credentials and verification actually succeed.
