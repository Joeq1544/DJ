# Python MCP 2.0 stdio evidence design

## Scope

Build fully local evidence for exactly `mcp==2.0.0`. The evidence exercises a
low-level `Server` in a separate process over the package's real stdio client
transport. It does not invoke Codex, authenticate, access media, or claim a
Phase 0 gate.

## Architecture

- `contract.py` owns the exact closed input/output schemas, six known fixture
  IDs, the five-ID limit, stable sanitized error result, bounded serialization,
  strict app-side validation, and exact text/structured equivalence check.
- `server.py` constructs `mcp.server.lowlevel.Server` with constructor-provided
  `on_list_tools` and `on_call_tool` handlers, then runs it with
  `mcp.server.stdio.stdio_server`. Stdout is reserved for MCP JSON-RPC.
- `client.py` verifies the installed `mcp` distribution is exactly `2.0.0`,
  starts the server with `stdio_client`, initializes `ClientSession`, inspects
  the listed tool's exact metadata/schema/annotations, calls it, independently
  validates the returned result, and prints only bounded local evidence. Its
  local-only mode returns before creating server parameters or transport state.
- `tests/slow_server_fixture.py` is test-only instrumentation. It writes its
  exact PID to a supplied file, serves a deliberately delayed tool call over
  the same low-level stdio stack, and enables a timeout test to verify that one
  known spawned PID is gone. No PID scanning is used.

## Contract and errors

`echo_library_ids` accepts exactly one object property, `ids`, containing one
to five strings from the app-owned fixture set. The listed tool publishes exact
closed input/output JSON schemas and explicit read-only, non-destructive,
idempotent, closed-world annotations. The call handler repeats strict
app-owned validation rather than trusting schema enforcement.

Success returns one text block containing compact JSON plus identical
structured content. The independent client validator rejects extra fields,
unknown IDs, over-limit IDs, malformed content, errors, and text/structured
mismatch. Serialized successful results are capped at 512 UTF-8 bytes. Invalid
tool inputs return one stable sanitized error text with no echoed input or
structured content.

## Testing and evidence

Use standard-library `unittest` under `-W error`, with AnyIO only because it is
already an exact transitive dependency of `mcp==2.0.0`. Tests first cover the
missing contract and server/client behavior, then implementation proceeds in
small red-green steps. Integration tests spawn the actual server executable
through `stdio_client`; successful parsing proves stdout stayed protocol-only.
The timeout test cancels a real stdio request and asserts the exact recorded
fixture PID reaches `ESRCH` under a bounded deadline.

`requirements.in` keeps the direct `mcp==2.0.0` pin. `requirements.lock`
records the complete exact installed inventory from `pip freeze --all`.
`README.md` records reproduction commands, red/green evidence, and limitations.

## Limitations

The transport cleanup assertion covers the exact direct server PID exposed by
the 2.0 stdio client lifecycle. It does not claim cleanup of arbitrary escaped
process groups or descendants. This is local fake-data MCP evidence only, not
a Codex MCP call or real-service proof.
