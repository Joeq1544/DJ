# Python MCP 2.0 stdio evidence implementation plan

> **For agentic workers:** Execute inline with `superpowers:executing-plans` and
> use `superpowers:test-driven-development` for every behavior. Git operations
> are forbidden for this bounded task.

**Goal:** Produce deterministic, fully local evidence that exactly
`mcp==2.0.0` serves the reviewed `echo_library_ids` contract through a real
low-level stdio client/server process.

**Architecture:** A pure contract module performs strict server-side and
client-side validation. A low-level server executable reserves stdout for MCP,
and an official stdio client executable verifies package version, listed tool
metadata, and returned data. Standard-library tests exercise real subprocesses;
a test-only slow server exposes only its exact PID for bounded cleanup proof.

**Tech stack:** Python 3.14, `mcp==2.0.0`, `mcp-types`, AnyIO, stdlib
`unittest`, `importlib.metadata`, JSON, subprocess signaling.

## Global constraints

- Edit only `spikes/codex-mcp/python_mcp/**`; never hand-edit `.venv`.
- Use `spikes/codex-mcp/python_mcp/.venv/bin/python` for all evidence.
- Verify the imported distribution version is exactly `2.0.0`.
- Use the low-level `Server` API over the package's real stdio transport.
- Never emit diagnostics on the server's stdout.
- Use no network, Codex, credentials, user configuration, media, PID scanning,
  Git operation, gate claim, or ADR claim.

---

### Task 1: Strict contract

**Files:**

- Create: `spikes/codex-mcp/python_mcp/tests/test_contract.py`
- Create: `spikes/codex-mcp/python_mcp/contract.py`
- Create: `spikes/codex-mcp/python_mcp/tests/__init__.py`

**Interfaces:**

- Produces `tool_definition() -> mcp.types.Tool`,
  `call_echo_library_ids(arguments: object) -> mcp.types.CallToolResult`, and
  `validate_echo_library_ids_result(result: object) -> dict[str, list[str]]`.

- [ ] Write tests with literal expected schemas/annotations for a one-tool
  listing; successful known IDs; unknown, extra, empty, and six-ID inputs;
  512-byte cap; stable redacted errors; and independent rejection of malformed,
  extra, unknown, over-limit, or mismatched text/structured results.
- [ ] Run `./.venv/bin/python -W error -m unittest tests.test_contract -v` and
  record assertion failures caused by the absent contract.
- [ ] Implement constants, strict exact-key validation, compact JSON, exact
  Pydantic MCP results, output-size check, and independent result validation.
- [ ] Rerun the focused test until it passes without warnings.

### Task 2: Real low-level stdio server/client exchange

**Files:**

- Create: `spikes/codex-mcp/python_mcp/server.py`
- Create: `spikes/codex-mcp/python_mcp/client.py`
- Create: `spikes/codex-mcp/python_mcp/tests/test_stdio.py`

**Interfaces:**

- `server.build_server(call_delay_seconds: float = 0) -> Server` registers
  constructor handlers and `server.main()` runs `stdio_server()`.
- `client.run_probe() -> dict[str, object]` verifies version `2.0.0`, launches
  `server.py` via `StdioServerParameters`, initializes `ClientSession`, lists
  and validates the one tool, calls it with `fixture-2`/`fixture-1`, validates
  the result independently, and returns bounded evidence.
- `client.run_local_only() -> {"mode": "local_only"}` touches no transport.

- [ ] Add a subprocess integration test that executes `client.py`, requires
  exit 0, parses one bounded JSON evidence line, and asserts exact version,
  server implementation, listed schema/annotations, and validated IDs.
- [ ] Add invalid-input stdio calls through `ClientSession` and assert exact
  stable errors without echoed malicious input; success itself proves every
  server stdout line was valid MCP JSON-RPC.
- [ ] Run `./.venv/bin/python -W error -m unittest tests.test_stdio -v` and
  record failures because the executables are absent.
- [ ] Implement the minimal low-level handlers, protocol-only server entrypoint,
  version/list/result checks, and bounded client evidence.
- [ ] Rerun the focused test until it passes without warnings.

### Task 3: Local-only and timeout cleanup

**Files:**

- Create: `spikes/codex-mcp/python_mcp/tests/slow_server_fixture.py`
- Extend: `spikes/codex-mcp/python_mcp/tests/test_stdio.py`
- Extend: `spikes/codex-mcp/python_mcp/server.py`
- Extend: `spikes/codex-mcp/python_mcp/client.py`

**Interfaces:**

- The fixture records `os.getpid()` at one explicit test path, builds the same
  server with a delayed call, and runs stdio.
- Test helper `wait_for_pid_esrch(pid: int, deadline: float) -> None` probes only
  that exact PID with `os.kill(pid, 0)` and accepts only `ProcessLookupError`.

- [ ] Add a local-only subprocess test with an impossible server path and a PID
  marker assertion; it must return exact local-only evidence without spawning.
- [ ] Add an AnyIO stdio timeout test using `read_timeout_seconds`, exit the
  transport context under cancellation, and assert the fixture's exact PID
  reaches `ESRCH` within the bounded deadline.
- [ ] Run the focused tests and record the expected missing-path/cleanup failure.
- [ ] Add only the minimal local-only branch and delayed server construction
  needed for the tests; keep PID-file behavior solely in the fixture.
- [ ] Rerun the focused tests twice to detect cleanup flakiness.

### Task 4: Reproducible dependency and handoff evidence

**Files:**

- Create: `spikes/codex-mcp/python_mcp/requirements.lock`
- Create: `spikes/codex-mcp/python_mcp/README.md`

**Interfaces:**

- `requirements.lock` is the exact sorted output inventory from
  `.venv/bin/python -m pip freeze --all` and retains `mcp==2.0.0`.
- README contains install, version, warning-strict test, probe, local-only,
  red/green evidence, and limitation commands/results.

- [ ] Capture the exact installed inventory and add it without changing `.venv`.
- [ ] Document commands, sanitized evidence, and direct-PID-only cleanup limits.
- [ ] Run the full warning-strict suite twice and require zero failures/warnings.
- [ ] Run the real local probe and local-only command; verify bounded JSON only.
- [ ] Recheck distribution version, file scope, and the complete requirement
  checklist; report unresolved limitations without a completion/gate claim.
