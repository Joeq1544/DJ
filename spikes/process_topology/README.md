# Process topology feasibility spike

This directory is an executable Phase 0 proof of the proposed local process
boundary. It is not production daemon, Electron, or MCP infrastructure.

## Candidate topology

```text
Electron-main stand-in ── core frames / trusted-main session ──┐
                                                               │
MCP host/model ── JSON-lines stdio ── mcp_bridge.py             ├─ private Unix socket
                                      └─ core frames /          │  0700 runtime, 0600 socket
                                         mcp-bridge session ────┘
                                                               │
                                                       long-lived core.py
                                                               │
                                                    app-owned SQLite file
                                                    (only SQLite opener)
```

The core protocol is a 4-byte unsigned big-endian length followed by a strict
UTF-8 JSON object, bounded to 65,536 payload bytes. JSON also has explicit
depth, node-count, signed-integer, finite-number, duplicate-key, and Unicode
bounds. The MCP stand-in's stdio uses separately bounded newline-delimited JSON
and never transports core frames.

The launcher creates distinct unpredictable per-boot capabilities for
`trusted-main` and `mcp-bridge`; a handshake authenticates both the role and
session. The MCP process receives only its own capability. The CLI stand-in
reads it from a mode-0600 capability file rather than argv or model-visible
stdio. Capability creation/distribution by a packaged launcher remains a later
integration contract—giving the bridge the trusted-main capability would erase
the proven role boundary.

An MCP session can create a write proposal and receives only its non-secret ID
and neutral state. A separate `trusted-main` session retrieves the exact
tool/payload/destination for display and decides it. The creating MCP connection
can request execution only after approval, with the exact canonical binding,
before expiry, in the same core boot and trusted-main app epoch, and once. A
trusted-main restart rotates the app epoch and invalidates pending/approved
proposals. The only simulated write inserts a string into a temporary app-owned
table; multi-statement mutations use explicit commit/rollback scopes.

Before SQLite is opened, the core obtains exclusive owner locks derived from
the canonical database and socket paths. A cooperating second core cannot open
the same database, race stale-socket cleanup, or take a live endpoint. Cleanup
uses `lstat`, socket type and device/inode identity, rejects a final-component
symlink, and removes only a socket inode created by that server. Startup failure
closes SQLite and releases both ownership locks. Persistent lock files are not
authority; the lifetime-held `flock` values are.

The bridge requires an explicit timeout. Connect plus handshake share one
monotonic absolute deadline, and every request has a new absolute deadline that
is rechecked around blocking I/O and while consuming progress frames. A failed
framed exchange closes because its correlation state cannot be resumed safely.

## Run

From the repository root:

```sh
python3 -m unittest discover -s spikes/process_topology/tests -v
```

The test suite uses only Python's standard library and temporary directories.
On managed hosts that block Unix-socket creation inside the command sandbox,
the command must be permitted to run with local Unix-socket access. It performs
no TCP/network access and reads no user, audio, credential, or Rekordbox data.

## Bounded-spike limitations

- The tests instantiate the core server in the test process and authenticate
  distinct real socket connections; they do not package or supervise a child
  process or launch Electron.
- `CrashLoopPolicy` proves the restart bound as deterministic state logic but
  is not wired to a platform supervisor.
- The core uses a thread per client/request and one locked SQLite connection.
  Sessions, request history, inflight work, handshake/read/write time, and total
  session lifetime are bounded, and shutdown joins session threads before
  workers and SQLite. Production scheduling, load behavior, IPC discovery,
  codesigning, and update lifecycle remain later-phase work.
- `LOCAL_PEERCRED` is implemented for the measured macOS/Python layout and
  fails closed elsewhere; any additional platform needs its own measured helper.
- The stdio stand-in is synchronous and suppresses core progress frames. It
  exists only to prove physical/logical stream separation and lack of database
  authority. Core exchanges have absolute deadlines; an idle stdin or a
  producer that never terminates a short line is not timed by this stand-in.
- The ownership locks are cooperative macOS/POSIX `flock` proofs. They do not
  defend against a malicious same-UID process that deliberately ignores the
  lock and mutates the runtime directory. Packaged crash recovery must select
  and secure runtime/database directories and capability delivery before
  carrying this mechanism into production.
