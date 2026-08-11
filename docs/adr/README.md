# Architecture Decision Records

ADRs are immutable decision history once accepted. A change creates a superseding ADR and links the new evidence; it does not silently rewrite the old rationale.

| ADR | Topic | Status |
| --- | --- | --- |
| [0001](0001-desktop-framework-and-runtime-boundary.md) | Desktop framework and runtime boundary | Accepted |
| [0002](0002-codex-sdk-language.md) | TypeScript versus Python Codex SDK | Accepted |
| [0003](0003-local-process-protocol.md) | Local process communication protocol | Accepted |
| [0004](0004-rekordbox-integration-boundary.md) | Rekordbox integration boundary | Accepted |
| [0005](0005-audio-analysis-and-licenses.md) | Audio-analysis providers and license strategy | Accepted |
| [0006](0006-embedding-storage-and-search.md) | Embedding storage/search | Accepted |
| [0007](0007-packaging-strategy.md) | macOS packaging | Accepted |
| [0008](0008-personalization-and-user-metadata.md) | Interpretable personalization and user metadata | Accepted |
| [0009](0009-codex-assistance-orchestration.md) | Bounded Codex assistance without production MCP | Accepted |

Statuses are `Proposed`, `Accepted`, `Rejected`, `Superseded`, or `Deprecated`. Acceptance records an architectural choice, not completion of its implementation. ADR-0002 is accepted for the 2026-08-10 personal-use trust model; its basis intentionally differs from the original commercial Phase 0 evidence gate, whose missing results remain historical limitations.

ADR-0003 is accepted by D-029 from independently reviewed Python topology/
approval, Python MCP transport, main-broker comparison, and corrected
TypeScript/Python codec evidence. Acceptance chooses the architecture; it does
not promote Electron composition, secure packaged capability delivery, real
Codex-to-MCP behavior, or supervisor/resource discovery to implemented facts.
