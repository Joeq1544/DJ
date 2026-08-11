# Phase 0 Desktop Runtime and Packaging Evidence

Date: 2026-08-09
ADRs: 0001, 0007
Disposition: **bounded primary-source synthesis; ADR-0001/0007 architecture review accepted**

## Exact current upstream observations

- The official Electron release page identifies 43.2.0 as a stable release with
  Chromium 150.0.7871.129 and Node.js 24.18.0. The support schedule places the
  43 line's end of life on 2027-01-05. This is a current observation, not yet a
  project dependency pin: Phase 1 must recheck and lock one supported patch.
- Electron's current security checklist requires current releases, no renderer
  Node integration, context isolation, renderer sandboxing, restrictive CSP,
  navigation/new-window limits, IPC-sender validation, and a minimal exposed
  API. Context isolation has been the default since Electron 12, but the app
  will still set and test it explicitly.
- Electron's `utilityProcess` runs Node entrypoints and does not provide a
  general stdin channel. It is therefore not the Python-core transport. Electron
  main will spawn the bundled Python entrypoint as an explicit executable and
  supervise the private Unix-socket topology already measured by P0-013.
- Electron documents ASAR as read-only, forbids an ASAR directory as `cwd`, and
  supports only `execFile` for executing an in-archive binary. Python, Codex,
  native libraries, and any process working directory must consequently be real
  signed resource paths outside `app.asar`; mutable data belongs in Application
  Support, never the signed bundle.
- Electron recommends Electron Forge for packaging/distribution. Forge can
  package a macOS application and configure signing/notarization; the exact
  Forge/maker versions and configuration are Phase 1 dependency work, not
  inferred from the documentation.
- ADR-0001 selects Electron's embedded Node 24 major line and bundled CPython
  3.12, while deferring exact supported patch/build locks to Phase 1. Python's
  official lifecycle lists 3.12 in security support through October 2028; its
  lack of new upstream binary installers makes the reproducible arm64 bundled
  build a Phase 1 verification item rather than an ambient-runtime dependency.

Primary sources:

- [Electron 43.2.0 release](https://releases.electronjs.org/release/v43.2.0)
- [Electron support schedule](https://releases.electronjs.org/schedule)
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Electron utility process](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron ASAR limitations](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
- [Electron packaging recommendation](https://www.electronjs.org/docs/latest/tutorial/application-distribution/)
- [Electron Forge packaging tutorial](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging)
- [Python version status](https://devguide.python.org/versions/)
- [Python 3.12.13 release and source-only status](https://www.python.org/downloads/release/python-31213/)

## macOS distribution posture

The first-release candidate is direct Developer ID distribution for Apple
Silicon arm64, with hardened runtime and notarization, rather than Mac App Store
delivery. Apple requires a Developer ID Application certificate, valid signatures
for distributed executables, hardened runtime, secure timestamp, and acceptable
entitlements before notarization; `notarytool`/the Notary API supersede `altool`,
and the returned ticket should be stapled and verified. Signing/notarization
credentials are an external prerequisite and are never committed.

The first release does **not** claim macOS App Sandbox confinement. Apple supports
user-selected files, persistent security-scoped bookmarks, and cross-process
bookmark transfer for sandboxed apps, but the exact Electron → bundled Python →
Codex helper/auth path has not proved bookmark propagation or sandbox-compatible
authentication. Direct distribution therefore uses explicit open/save panels,
canonical app-owned approved-root records, least application privileges, and the
renderer/process boundaries in the threat model. Chromium renderer sandboxing
remains mandatory and is distinct from macOS App Sandbox. A later App Sandbox
decision requires an executable helper/auth/bookmark proof and a new ADR.

Hardened-runtime exceptions are not granted speculatively. Application resources
are treated as runtime-immutable and must be verified against the signature and
integrity inventory; mutable state is never written into the bundle. The packaged build
must enumerate entitlements per executable, justify each one, keep library
validation enabled unless a signed dependency forces a reviewed exception, sign
nested helpers/libraries before the containing app, and verify with `codesign`,
`spctl`, and `stapler`. The release cannot be called signed or notarized until
those credentialed commands actually pass.

Primary sources:

- [Apple Developer ID](https://developer.apple.com/support/developer-id/)
- [Apple notarization requirements](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Apple hardened runtime](https://developer.apple.com/documentation/Security/hardened-runtime)
- [Apple App Sandbox file access and bookmarks](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)

## Cost and deferred measurements

The architecture deliberately accepts an Electron/Chromium/Node runtime plus a
separate Python core because it preserves the official TypeScript SDK option,
isolates measurable music/data logic, and keeps SQLite ownership out of the UI.
No memory, launch-time, compressed-size, or clean-machine cost has been measured
because no application scaffold/package exists. The named reference machine is
the inventoried `Mac17,2` (Apple M5, 24 GiB, arm64, macOS 26.5.1). Phase 1 records
three cold and warm development launches and combined five-minute idle RSS;
Phase 9 repeats those measurements for the unsigned package and records bundle
and compressed sizes. ADR-0001 budgets are 5-second median cold launch, 2-second
median warm launch, 750 MiB combined idle RSS, 750 MiB unsigned bundle, and
500 MiB compressed artifact, excluding unapproved models. Exceeding a budget
forces explicit architecture re-review.

Phase 9 has two distinct evidence lanes. The mandatory credential-independent
lane builds and launches the unsigned app and verifies resource discovery,
integrity inventory, entitlements/signing order, translocation-safe paths,
migrations/backups, clean fixture behavior, and footprint. The external lane
runs actual nested signing, hardened runtime, timestamping, notarization,
stapling, `codesign`, and `spctl` only when credentials exist. An unsigned build
may satisfy the engineering lane but can never be described as signed,
notarized, or release-ready. Codex-helper inclusion is likewise conditional on
ADR-0002 plus service/auth/redistribution/signing approval. Missing implementation
measurements are not represented as passes.
