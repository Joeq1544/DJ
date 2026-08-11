# Python MCP 2.0 local stdio evidence

This bounded Phase 0 spike exercises exactly `mcp==2.0.0` with its low-level
`Server` API through a real stdio client/server subprocess. It uses generated
fixture IDs only and does not invoke Codex, authenticate, access user media, or
make a phase-gate or ADR claim.

## Isolated environment

`requirements.in` pins the direct dependency. `requirements.lock` is the full
exact inventory derived from the isolated environment with `pip freeze --all`.

```sh
cd spikes/codex-mcp/python_mcp
python3 -m venv .venv
./.venv/bin/python -m pip install -r requirements.lock
./.venv/bin/python -c 'from importlib.metadata import version; assert version("mcp") == "2.0.0"; print(version("mcp"))'
```

The evidence environment independently reported distribution version `2.0.0`.
No other MCP version is accepted by `client.py`.

## Evidence commands

```sh
./.venv/bin/python -W error -m unittest discover -s tests -v
./.venv/bin/python -W error client.py
./.venv/bin/python -W error client.py --local-only
```

The real probe starts `server.py` via `mcp.client.stdio.stdio_client`, performs
the handshake with `ClientSession`, inspects the exact one-tool listing before
calling it, and independently validates the returned text and structured
content. The server uses constructor handlers on
`mcp.server.lowlevel.Server` and `mcp.server.stdio.stdio_server`; it never calls
the handler in process for transport evidence. Server stdout is reserved for
newline-delimited MCP JSON-RPC. Tool/input failures are stable and sanitized;
the standalone client's SDK child diagnostics are not a production redaction
boundary and can disclose local paths on startup failure (KI-025).

`echo_library_ids` publishes closed input and output schemas, accepts at most
five IDs from the six-value app-owned fixture set, and repeats strict validation
inside the call handler. It advertises read-only, non-destructive, idempotent,
closed-world annotations. Success is capped at 512 serialized UTF-8 bytes and
contains one compact JSON text block exactly equivalent to structured content.
Invalid input returns only `invalid echo_library_ids input` and never echoes
caller data.

The local-only command returns before constructing stdio server parameters. A
test runs a copied client where `server.py` is absent to prove this boundary.

## TDD evidence

- Contract RED: 4 tests failed with `contract module is unavailable` before
  `contract.py` existed; the focused green then passed 4/4 warning-strict.
- Stdio RED: 3 tests failed because `client.py`/`server.py` were absent; the
  focused green then passed 3/3 warning-strict over real subprocess transport.
- Cleanup RED: local-only returned argument rejection and the slow stdio fixture
  connection closed because the fixture was absent; after implementation both
  focused tests passed twice warning-strict.
- Final warning-strict verification ran the complete 9-test suite twice: 9/9
  passed in 1.516 seconds, then 9/9 passed in 1.491 seconds, with no warnings.
- The final stdio probe, local-only command, and independent distribution
  version assertion each exited 0 and emitted only the bounded JSON/version
  evidence shown by the commands above.

## Limits

The timeout evidence records the test-only slow server's exact PID, times out a
real `ClientSession.call_tool`, exits the official stdio transport, and accepts
cleanup only when `os.kill(pid, 0)` raises `ProcessLookupError` under a bounded
deadline. It performs no PID scanning. This proves cleanup of that direct stdio
server PID only; it does not prove cleanup of arbitrary escaped descendants or
process groups.

This remains fully local fake-data evidence. It is not a real Codex MCP tool
call, real-service evidence, or proof about ambient user MCP/plugin isolation.
The standalone client also has no overall timeout, rejected bytes have no
pre-parse transport cap, the inventory has exact versions but no hashes, and
local-only mode imports MCP modules before creating no transport/network state.
