# DJ Copilot Threat Model

Status: Personal-use MVP
Last updated: 2026-08-10

## Personal-use threat model

DJ Copilot is used by one trusted person on his own Mac. Joe already runs Codex and routinely grants it permissions. The MVP protects against common application mistakes, unsafe imported data, bad model output, and accidental destructive writes. It does not treat Joe, his logged-in account, or ordinary Codex same-user access as hostile.

No production runtime exists yet. Controls below are requirements until their milestone records automated or manual evidence.

## Assets worth protecting

- Rekordbox library integrity and playlist ordering.
- Source audio integrity.
- App-owned SQLite data, drafts, preferences, tags, and notes.
- Local paths and music metadata that do not need to leave the Mac.
- Codex credentials and session data.
- Export integrity and the guarantee that referenced tracks exist.
- Joe's time: crashes, stuck analysis, and unexplained recommendations are real product risks.

## Required practical safeguards

- Never write Rekordbox databases or source audio.
- Keep raw audio and decoded samples local.
- Treat XML, tags, filenames, paths, metadata, and Codex output as untrusted data.
- Use safe XML parsing, bounded inputs, canonical path checks, and current-library ID validation.
- Keep the renderer isolated from Node, filesystem, database, and arbitrary IPC.
- Expose only fixed app commands; no generic shell, SQL, or unrestricted filesystem tool.
- Preview and confirm durable changes and exports in the trusted UI.
- Back up app-owned data before migrations and validate temporary exports before replacement.
- Keep credentials and unnecessary private paths/metadata out of prompts, logs, reports, and Git.
- Show missing evidence and low confidence honestly rather than manufacturing a value.

## Accepted risks

- A malicious process already running as Joe can exercise the same-user access Joe granted it.
- The MVP does not prove complete Codex process-tree cleanup, ambient configuration isolation, or denial of every built-in/hosted capability.
- Prompt injection can produce confusing text, but it must not bypass app ID validation or confirmed writes; exhaustive injection matrices are deferred.
- Dependencies are pinned and reviewed proportionally, but public-distribution supply-chain hardening is deferred.
- Rekordbox and codec variants not present in generated fixtures may fail until encountered in Joe's library.
- The first personal build may be unsigned and arm64-only.

KI-022, KI-045, and KI-049 retain the exact historical evidence behind the Codex limitations. Accepting them for personal use does not turn them into security passes.

## Escalation triggers

Revisit and strengthen this threat model if any of the following occurs:

- a real data-loss, credential, privacy, or unconfirmed-write defect;
- the app is shared with another person or distributed publicly;
- remote access, accounts, sync, plugins, or multi-user behavior is added;
- Codex/MCP behavior leaves surviving processes or accesses data in a way that disrupts normal use;
- signing/notarization or a public update channel becomes a product goal.
