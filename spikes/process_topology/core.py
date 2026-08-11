"""Executable single-owner core candidate for the Phase 0 topology spike.

This is deliberately a bounded proof, not production daemon infrastructure.
Only this module imports sqlite3; every client reaches it through a private
Unix-domain socket.
"""

from __future__ import annotations

import json
import os
import secrets
import select
import socket
import sqlite3
import stat
import struct
import threading
import time
import fcntl
import errno
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from .protocol import (
    FrameDecoder,
    ProtocolError,
    canonical_hash,
    canonical_json,
    encode_frame,
    validate_capability_token,
    validate_handshake,
    validate_request,
)


class PeerCredentialError(RuntimeError):
    pass


class CoreOwnershipError(RuntimeError):
    pass


def new_role_capabilities() -> dict[str, str]:
    """Launcher-owned per-boot credentials; distribute one value to each role."""
    return {
        "trusted-main": secrets.token_urlsafe(32),
        "mcp-bridge": secrets.token_urlsafe(32),
    }


def get_peer_uid(sock: socket.socket) -> int:
    """Read and validate Darwin's xucred returned by LOCAL_PEERCRED.

    On the measured host Python exposes LOCAL_PEERCRED but not SOL_LOCAL or
    getpeereid. Darwin's local protocol level is numeric zero. xucred begins
    with native unsigned cr_version and uid_t cr_uid at offsets 0 and 4.
    """

    option = getattr(socket, "LOCAL_PEERCRED", None)
    if option is None:
        raise PeerCredentialError("LOCAL_PEERCRED is unavailable; refusing unauthenticated peer")
    try:
        raw = sock.getsockopt(0, option, 256)
    except OSError as exc:
        raise PeerCredentialError("LOCAL_PEERCRED lookup failed") from exc
    if not isinstance(raw, bytes) or len(raw) < 8:
        raise PeerCredentialError("LOCAL_PEERCRED returned a truncated xucred")
    version, uid = struct.unpack_from("@II", raw, 0)
    if version != 0:
        raise PeerCredentialError(f"unsupported xucred version: {version}")
    if uid > 0x7FFF_FFFF:
        raise PeerCredentialError("LOCAL_PEERCRED returned an invalid uid")
    return uid


def enforce_peer_uid(sock: socket.socket, expected_uid: int) -> None:
    actual = get_peer_uid(sock)
    if actual != expected_uid:
        raise PeerCredentialError(f"peer uid {actual} does not match expected uid {expected_uid}")


class _TaskState:
    def __init__(self, request_id: str) -> None:
        self.request_id = request_id
        self.cancel_event = threading.Event()
        self.lock = threading.Lock()
        self.terminal = False

    def claim_terminal(self) -> bool:
        with self.lock:
            if self.terminal:
                return False
            self.terminal = True
            return True


class _Session:
    def __init__(self, server: "CoreServer", sock: socket.socket) -> None:
        self.server = server
        self.sock = sock
        self.role = ""
        self.session_id = ""
        self.connection_id = secrets.token_hex(16)
        self.decoder = FrameDecoder()
        self.send_lock = threading.Lock()
        self.close_lock = threading.Lock()
        self.state_lock = threading.Lock()
        self.request_ids: set[str] = set()
        self.tasks: dict[str, _TaskState] = {}
        self.closed = False

    def send(self, value: dict[str, Any]) -> None:
        encoded = encode_frame(value)
        with self.send_lock:
            if not self.closed:
                self.sock.sendall(encoded)

    def terminal(
        self,
        task: _TaskState,
        status: str,
        *,
        result: dict[str, Any] | None = None,
        error: dict[str, str] | None = None,
    ) -> None:
        if not task.claim_terminal():
            return
        message: dict[str, Any] = {"type": "terminal", "request_id": task.request_id, "status": status}
        if result is not None:
            message["result"] = result
        if error is not None:
            message["error"] = error
        try:
            self.send(message)
        except OSError:
            pass

    def close(self) -> None:
        with self.close_lock:
            if self.closed:
                return
            self.closed = True
            with self.state_lock:
                for task in self.tasks.values():
                    task.cancel_event.set()
            with self.send_lock:
                try:
                    self.sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                self.sock.close()


class _OperationError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class CoreServer:
    def __init__(
        self,
        socket_path: str | Path,
        db_path: str | Path,
        *,
        role_capabilities: dict[str, str],
        max_inflight: int = 8,
        max_sessions: int = 16,
        max_requests_per_session: int = 1_024,
        handshake_timeout: float = 1.0,
        io_timeout: float = 2.0,
        session_lifetime: float = 30.0,
        delayed_result_barrier: tuple[threading.Event, threading.Event] | None = None,
        expected_uid: int | None = None,
    ) -> None:
        socket_path = Path(socket_path)
        # Canonicalize aliases in the parent while preserving the final path
        # component so lstat can reject a socket-path symlink itself.
        self.socket_path = socket_path.parent.resolve(strict=False) / socket_path.name
        self.db_path = Path(db_path).resolve(strict=False)
        self.max_inflight = max_inflight
        if min(max_inflight, max_sessions, max_requests_per_session) < 1:
            raise ValueError("session and request bounds must be positive")
        if min(handshake_timeout, io_timeout, session_lifetime) <= 0:
            raise ValueError("protocol deadlines must be positive")
        self.max_sessions = max_sessions
        self.max_requests_per_session = max_requests_per_session
        self.handshake_timeout = handshake_timeout
        self.io_timeout = io_timeout
        self.session_lifetime = session_lifetime
        self._delayed_result_barrier = delayed_result_barrier
        if set(role_capabilities) != {"trusted-main", "mcp-bridge"}:
            raise ValueError("distinct bounded capabilities are required for both roles")
        try:
            for value in role_capabilities.values():
                validate_capability_token(value)
        except ProtocolError as exc:
            raise ValueError("launcher supplied an invalid role capability") from exc
        if role_capabilities["trusted-main"] == role_capabilities["mcp-bridge"]:
            raise ValueError("role capabilities must be distinct")
        self._role_capabilities = dict(role_capabilities)
        self.expected_uid = os.getuid() if expected_uid is None else expected_uid
        self.boot_epoch = secrets.token_hex(16)
        self.sqlite_open_count = 0
        self._db: sqlite3.Connection | None = None
        self._db_lock = threading.RLock()
        self._listen: socket.socket | None = None
        self._accept_thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._sessions_lock = threading.Lock()
        self._sessions: dict[str, _Session] = {}
        self._all_sessions: set[_Session] = set()
        self._workers_lock = threading.Lock()
        self._workers: set[threading.Thread] = set()
        self._session_threads_lock = threading.Lock()
        self._session_threads: set[threading.Thread] = set()
        self._slots = threading.BoundedSemaphore(max_inflight)
        self._owner_lock_fd: int | None = None
        self._owner_lock_path = Path(str(self.db_path) + ".owner.lock")
        self._socket_lock_fd: int | None = None
        self._socket_lock_path = Path(str(self.socket_path) + ".owner.lock")
        self._socket_identity: tuple[int, int] | None = None
        self._trusted_connection_id: str | None = None
        self._app_epoch: str | None = None

    def start(self) -> None:
        if self._listen is not None or self._owner_lock_fd is not None or self._socket_lock_fd is not None:
            return
        try:
            self._acquire_owner_lock()
            self.socket_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.chmod(self.socket_path.parent, 0o700)
            self._acquire_socket_lock()
            self._prepare_socket_path()
            self._db = sqlite3.connect(self.db_path, check_same_thread=False)
            self.sqlite_open_count += 1
            self._initialize_db()
            listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self._listen = listener
            listener.bind(str(self.socket_path))
            socket_stat = os.stat(self.socket_path)
            self._socket_identity = (socket_stat.st_dev, socket_stat.st_ino)
            os.chmod(self.socket_path, 0o600)
            listener.listen(16)
            listener.settimeout(0.1)
            self._stop.clear()
            self._accept_thread = threading.Thread(target=self._accept_loop, name="topology-core", daemon=True)
            self._accept_thread.start()
        except Exception:
            self._cleanup_start_failure()
            raise

    def _acquire_owner_lock(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self._owner_lock_path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            os.close(fd)
            if exc.errno in {errno.EACCES, errno.EAGAIN}:
                raise CoreOwnershipError("another core owns this app database") from exc
            raise
        os.ftruncate(fd, 0)
        os.write(fd, f"pid={os.getpid()} boot={self.boot_epoch}\n".encode("ascii"))
        self._owner_lock_fd = fd

    def _prepare_socket_path(self) -> None:
        try:
            before = os.lstat(self.socket_path)
        except FileNotFoundError:
            return
        if not stat.S_ISSOCK(before.st_mode):
            raise CoreOwnershipError("existing core endpoint is not a Unix socket")
        probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        probe.settimeout(0.2)
        try:
            probe.connect(str(self.socket_path))
        except OSError as exc:
            if exc.errno not in {errno.ECONNREFUSED, errno.ENOENT}:
                raise
        else:
            raise CoreOwnershipError("a live core endpoint already owns this socket path")
        finally:
            probe.close()
        try:
            after = os.lstat(self.socket_path)
        except FileNotFoundError:
            return
        if not stat.S_ISSOCK(after.st_mode) or (after.st_dev, after.st_ino) != (before.st_dev, before.st_ino):
            raise CoreOwnershipError("core endpoint changed during stale-socket validation")
        self.socket_path.unlink()

    def _remove_owned_socket(self) -> None:
        identity, self._socket_identity = self._socket_identity, None
        if identity is None:
            return
        try:
            current = os.lstat(self.socket_path)
        except FileNotFoundError:
            return
        if stat.S_ISSOCK(current.st_mode) and (current.st_dev, current.st_ino) == identity:
            self.socket_path.unlink()

    def _acquire_socket_lock(self) -> None:
        fd = os.open(self._socket_lock_path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            os.close(fd)
            if exc.errno in {errno.EACCES, errno.EAGAIN}:
                raise CoreOwnershipError("another core owns this socket path") from exc
            raise
        os.ftruncate(fd, 0)
        os.write(fd, f"pid={os.getpid()} boot={self.boot_epoch}\n".encode("ascii"))
        self._socket_lock_fd = fd

    def _release_socket_lock(self) -> None:
        fd, self._socket_lock_fd = self._socket_lock_fd, None
        if fd is not None:
            try:
                fcntl.flock(fd, fcntl.LOCK_UN)
            finally:
                os.close(fd)

    def _release_owner_lock(self) -> None:
        fd, self._owner_lock_fd = self._owner_lock_fd, None
        if fd is not None:
            try:
                fcntl.flock(fd, fcntl.LOCK_UN)
            finally:
                os.close(fd)

    def _cleanup_start_failure(self) -> None:
        listener, self._listen = self._listen, None
        if listener is not None:
            listener.close()
        with self._db_lock:
            if self._db is not None:
                self._db.rollback()
                self._db.close()
                self._db = None
        self._remove_owned_socket()
        self._release_socket_lock()
        self._release_owner_lock()

    def stop(self) -> None:
        self._stop.set()
        listener, self._listen = self._listen, None
        if listener is not None:
            listener.close()
        if self._accept_thread is not None:
            self._accept_thread.join(timeout=2)
            self._accept_thread = None
        with self._sessions_lock:
            sessions = list(self._all_sessions)
        for session in sessions:
            session.close()
        with self._session_threads_lock:
            session_threads = list(self._session_threads)
        current = threading.current_thread()
        for session_thread in session_threads:
            if session_thread is not current:
                session_thread.join(timeout=2)
        with self._workers_lock:
            workers = list(self._workers)
        for worker in workers:
            worker.join(timeout=2)
        with self._db_lock:
            if self._db is not None:
                self._db.close()
                self._db = None
        self._remove_owned_socket()
        self._release_socket_lock()
        self._release_owner_lock()

    def _initialize_db(self) -> None:
        assert self._db is not None
        self._db.executescript(
            """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS harmless_rows (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS idempotency (
                key TEXT PRIMARY KEY,
                action_hash TEXT NOT NULL,
                status TEXT NOT NULL,
                result_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS proposals (
                proposal_id TEXT PRIMARY KEY,
                tool TEXT NOT NULL,
                payload_json BLOB NOT NULL,
                payload_hash TEXT NOT NULL,
                destination TEXT NOT NULL,
                creator_session TEXT NOT NULL,
                creator_connection TEXT NOT NULL,
                expires_at_ms INTEGER NOT NULL,
                boot_epoch TEXT NOT NULL,
                app_epoch TEXT NOT NULL,
                approval_state TEXT NOT NULL,
                use_state TEXT NOT NULL
            );
            """
        )
        self._db.commit()

    def _accept_loop(self) -> None:
        while not self._stop.is_set():
            listener = self._listen
            if listener is None:
                return
            try:
                peer, _ = listener.accept()
            except TimeoutError:
                continue
            except OSError:
                return
            try:
                enforce_peer_uid(peer, self.expected_uid)
            except PeerCredentialError:
                peer.close()
                continue
            session = _Session(self, peer)
            with self._sessions_lock:
                if len(self._all_sessions) >= self.max_sessions:
                    busy = True
                else:
                    busy = False
                    self._all_sessions.add(session)
            if busy:
                try:
                    session.send({
                        "type": "handshake-rejected",
                        "error": self._error("server_busy", "session bound reached"),
                    })
                except OSError:
                    pass
                session.close()
                continue
            peer.settimeout(self.handshake_timeout)
            thread = threading.Thread(target=self._serve_session, args=(session,), daemon=True)
            with self._session_threads_lock:
                self._session_threads.add(thread)
            thread.start()

    def _serve_session(self, session: _Session) -> None:
        registered = False
        try:
            first, coalesced = self._receive_initial(session)
            validate_handshake(first)
            expected_capability = self._role_capabilities[first["role"]]
            if not secrets.compare_digest(first["capability"], expected_capability):
                raise ProtocolError("handshake_unauthorized", "role capability was rejected")
            stale_sessions: list[_Session] = []
            with self._sessions_lock:
                if first["session_id"] in self._sessions:
                    existing = self._sessions[first["session_id"]]
                    if not self._peer_is_closed(existing):
                        raise ProtocolError("duplicate_session", "session_id is already connected")
                    stale_sessions.append(existing)
                if first["role"] == "trusted-main":
                    for active in set(self._sessions.values()):
                        if active.role != "trusted-main" or active in stale_sessions:
                            continue
                        if not self._peer_is_closed(active):
                            raise ProtocolError("trusted_main_active", "trusted-main is already connected")
                        stale_sessions.append(active)
                    self._trusted_connection_id = session.connection_id
                    self._app_epoch = secrets.token_hex(16)
                for stale in stale_sessions:
                    if self._sessions.get(stale.session_id) is stale:
                        del self._sessions[stale.session_id]
                session.role = first["role"]
                session.session_id = first["session_id"]
                self._sessions[session.session_id] = session
                registered = True
            for stale_session in stale_sessions:
                stale_session.close()
            session.send({
                "type": "handshake-accepted", "version": 1,
                "role": session.role, "session_id": session.session_id,
            })
            session_deadline = time.monotonic() + self.session_lifetime
            for message in coalesced:
                self._dispatch_request(session, message)
            while not self._stop.is_set():
                remaining = session_deadline - time.monotonic()
                if remaining <= 0:
                    break
                session.sock.settimeout(min(self.io_timeout, remaining))
                chunk = session.sock.recv(65540)
                if not chunk:
                    session.decoder.finish()
                    break
                for message in session.decoder.feed(chunk):
                    self._dispatch_request(session, message)
        except ProtocolError as exc:
            try:
                session.send({"type": "handshake-rejected" if not registered else "protocol-error", "error": exc.as_dict()})
            except OSError:
                pass
        except (OSError, EOFError):
            pass
        finally:
            if registered:
                with self._sessions_lock:
                    if self._sessions.get(session.session_id) is session:
                        del self._sessions[session.session_id]
                    if self._trusted_connection_id == session.connection_id:
                        self._trusted_connection_id = None
                        self._app_epoch = None
            with self._sessions_lock:
                self._all_sessions.discard(session)
            session.close()
            with self._session_threads_lock:
                self._session_threads.discard(threading.current_thread())

    @staticmethod
    def _peer_is_closed(session: _Session) -> bool:
        try:
            readable, _, _ = select.select([session.sock], [], [], 0)
            if not readable:
                return False
            return session.sock.recv(1, socket.MSG_PEEK | socket.MSG_DONTWAIT) == b""
        except BlockingIOError:
            return False
        except OSError:
            return True

    def _receive_initial(self, session: _Session) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        while True:
            chunk = session.sock.recv(65540)
            if not chunk:
                raise EOFError
            messages = session.decoder.feed(chunk)
            if messages:
                return messages[0], messages[1:]

    @staticmethod
    def _error(code: str, message: str) -> dict[str, str]:
        return {"code": code, "message": message}

    def _dispatch_request(self, session: _Session, message: dict[str, Any]) -> None:
        if self._stop.is_set() or session.closed:
            return
        try:
            validate_request(message)
        except ProtocolError as exc:
            request_id = message.get("id") if isinstance(message.get("id"), str) else "invalid"
            task = _TaskState(request_id)
            session.terminal(task, "failed", error=exc.as_dict())
            return
        request_id = message["id"]
        with session.state_lock:
            if request_id in session.request_ids:
                task = _TaskState(request_id)
                session.terminal(task, "failed", error=self._error("duplicate_request_id", "request id was already used"))
                return
            if len(session.request_ids) >= self.max_requests_per_session:
                task = _TaskState(request_id)
                session.terminal(task, "failed", error=self._error("request_limit", "session request-history bound reached"))
                return
            session.request_ids.add(request_id)

        if message["operation"] == "cancel":
            self._cancel_request(session, message)
            return

        task = _TaskState(request_id)
        if not self._slots.acquire(blocking=False):
            session.terminal(task, "failed", error=self._error("backpressure", "active/queued request bound reached"))
            return
        with session.state_lock:
            session.tasks[request_id] = task
        worker = threading.Thread(target=self._run_request, args=(session, task, message), daemon=True)
        with self._workers_lock:
            self._workers.add(worker)
        worker.start()

    def _cancel_request(self, session: _Session, message: dict[str, Any]) -> None:
        cancel_task = _TaskState(message["id"])
        target_id = message["payload"].get("request_id")
        if not isinstance(target_id, str):
            session.terminal(cancel_task, "failed", error=self._error("invalid_cancel_target", "cancel requires request_id"))
            return
        with session.state_lock:
            target = session.tasks.get(target_id)
        if target is None:
            session.terminal(cancel_task, "failed", error=self._error("request_not_active", "target request is not active"))
            return
        target.cancel_event.set()
        session.terminal(cancel_task, "succeeded", result={"cancel_requested": True})

    def _run_request(self, session: _Session, task: _TaskState, message: dict[str, Any]) -> None:
        status: str
        result: dict[str, Any] | None = None
        error: dict[str, str] | None = None
        try:
            result = self._operation(session, task, message)
            if task.cancel_event.is_set():
                status = "cancelled"
                result = {"cancelled": True}
            else:
                status = "succeeded"
        except _OperationError as exc:
            status = "failed"
            error = self._error(exc.code, exc.message)
        except Exception:
            status = "outcome-unknown"
            error = self._error("internal_error", "operation outcome is unknown")
        with session.state_lock:
            session.tasks.pop(task.request_id, None)
        self._slots.release()
        try:
            session.terminal(task, status, result=result, error=error)
        finally:
            with self._workers_lock:
                self._workers.discard(threading.current_thread())

    def _operation(self, session: _Session, task: _TaskState, request: dict[str, Any]) -> dict[str, Any]:
        operation = request["operation"]
        payload = request["payload"]
        if operation == "ping":
            return {"pong": True, "session_id": session.session_id, "role": session.role}
        if operation == "read_count":
            with self._db_lock:
                assert self._db is not None
                count = self._db.execute("SELECT COUNT(*) FROM harmless_rows").fetchone()[0]
            return {"count": count}
        if operation == "delayed_result":
            delay_ms = payload.get("delay_ms")
            if type(delay_ms) is not int or delay_ms < 0 or delay_ms > 1_000:
                raise _OperationError("invalid_delay", "delay_ms must be an integer between 0 and 1000")
            session.send({"type": "progress", "request_id": task.request_id, "completed": 0, "total": 1})
            task.cancel_event.wait(delay_ms / 1_000)
            if self._delayed_result_barrier is not None:
                ready, release = self._delayed_result_barrier
                ready.set()
                if not release.wait(self.io_timeout):
                    raise _OperationError("barrier_timeout", "bounded result barrier timed out")
            return {"finished": not task.cancel_event.is_set()}
        if operation == "simulate_outcome_unknown":
            raise RuntimeError("deliberate bounded-spike crash simulation")
        if operation == "idempotent_insert":
            return self._idempotent_insert(session, request)
        if operation == "create_proposal":
            return self._create_proposal(session, payload)
        if operation == "get_proposal":
            return self._get_proposal(session, payload)
        if operation == "decide_proposal":
            return self._decide_proposal(session, payload)
        if operation == "cancel_proposal":
            return self._cancel_proposal(session, payload)
        if operation == "execute_proposal":
            return self._execute_proposal(session, payload)
        raise _OperationError("unknown_operation", "operation is not supported")

    def _idempotent_insert(self, session: _Session, request: dict[str, Any]) -> dict[str, Any]:
        if session.role != "trusted-main":
            raise _OperationError("forbidden", "only trusted-main may directly run the idempotency probe")
        key = request.get("idempotency_key")
        if not isinstance(key, str):
            raise _OperationError("idempotency_required", "idempotency_key is required")
        value = request["payload"].get("value")
        action_hash = canonical_hash({"operation": request["operation"], "payload": request["payload"]})
        failure: dict[str, str] | None = None
        result: dict[str, Any] | None = None
        with self._db_lock, self._transaction():
            assert self._db is not None
            row = self._db.execute(
                "SELECT action_hash, status, result_json FROM idempotency WHERE key = ?", (key,)
            ).fetchone()
            if row is not None:
                if row[0] != action_hash:
                    raise _OperationError("idempotency_conflict", "idempotency key is bound to another action")
                stored = json.loads(row[2])
                if row[1] == "failed":
                    raise _OperationError(stored["code"], stored["message"])
                return stored
            if not isinstance(value, str) or not value or len(value.encode("utf-8")) > 256:
                failure = {"code": "invalid_value", "message": "value must be a non-empty bounded string"}
                self._db.execute(
                    "INSERT INTO idempotency(key, action_hash, status, result_json) VALUES (?, ?, 'failed', ?)",
                    (key, action_hash, canonical_json(failure).decode("utf-8")),
                )
            else:
                cursor = self._db.execute("INSERT INTO harmless_rows(value) VALUES (?)", (value,))
                result = {"inserted": 1, "row_id": cursor.lastrowid}
                self._db.execute(
                    "INSERT INTO idempotency(key, action_hash, status, result_json) VALUES (?, ?, 'succeeded', ?)",
                    (key, action_hash, canonical_json(result).decode("utf-8")),
                )
        if failure is not None:
            raise _OperationError(failure["code"], failure["message"])
        assert result is not None
        return result

    @contextmanager
    def _transaction(self):
        assert self._db is not None
        self._db.execute("BEGIN IMMEDIATE")
        try:
            yield
            self._db.commit()
        except BaseException:
            self._db.rollback()
            raise

    @staticmethod
    def _proposal_id(payload: dict[str, Any]) -> str:
        proposal_id = payload.get("proposal_id")
        if not isinstance(proposal_id, str) or not proposal_id:
            raise _OperationError("invalid_proposal_id", "proposal_id is required")
        return proposal_id

    def _proposal_row(self, proposal_id: str) -> tuple[Any, ...]:
        assert self._db is not None
        row = self._db.execute(
            """SELECT proposal_id, tool, payload_json, payload_hash, destination,
                      creator_session, creator_connection, expires_at_ms,
                      boot_epoch, app_epoch, approval_state, use_state
               FROM proposals WHERE proposal_id = ?""",
            (proposal_id,),
        ).fetchone()
        if row is None:
            raise _OperationError("proposal_not_found", "proposal does not exist")
        return row

    def _create_proposal(self, session: _Session, payload: dict[str, Any]) -> dict[str, Any]:
        if session.role != "mcp-bridge":
            raise _OperationError("forbidden", "only mcp-bridge may create proposals")
        tool = payload.get("tool")
        proposal_payload = payload.get("payload")
        destination = payload.get("destination")
        ttl_ms = payload.get("ttl_ms", 30_000)
        if not isinstance(tool, str) or not tool or not isinstance(destination, str) or not destination:
            raise _OperationError("invalid_proposal", "tool and destination are required")
        if not isinstance(proposal_payload, dict):
            raise _OperationError("invalid_proposal", "proposal payload must be an object")
        if type(ttl_ms) is not int or ttl_ms <= 0 or ttl_ms > 300_000:
            raise _OperationError("invalid_expiry", "ttl_ms must be an integer greater than 0 and at most 300000")
        proposal_id = secrets.token_urlsafe(18)
        payload_bytes = canonical_json(proposal_payload)
        with self._sessions_lock:
            app_epoch = self._app_epoch
        if app_epoch is None:
            raise _OperationError("trusted_main_unavailable", "trusted-main approval epoch is unavailable")
        with self._db_lock, self._transaction():
            assert self._db is not None
            self._db.execute(
                """INSERT INTO proposals(
                       proposal_id, tool, payload_json, payload_hash, destination,
                       creator_session, creator_connection, expires_at_ms,
                       boot_epoch, app_epoch, approval_state, use_state
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'unused')""",
                (
                    proposal_id, tool, payload_bytes, canonical_hash(proposal_payload), destination,
                    session.session_id, session.connection_id, (time.time_ns() // 1_000_000) + ttl_ms,
                    self.boot_epoch, app_epoch,
                ),
            )
        return {"proposal_id": proposal_id, "status": "pending"}

    def _get_proposal(self, session: _Session, payload: dict[str, Any]) -> dict[str, Any]:
        if session.role != "trusted-main":
            raise _OperationError("forbidden", "only trusted-main may retrieve proposals")
        proposal_id = self._proposal_id(payload)
        with self._db_lock:
            row = self._proposal_row(proposal_id)
        if row[8] != self.boot_epoch:
            raise _OperationError("proposal_epoch_mismatch", "proposal belongs to an earlier core boot")
        with self._sessions_lock:
            current_app_epoch = self._app_epoch
        if row[9] != current_app_epoch:
            raise _OperationError("proposal_app_epoch_mismatch", "proposal belongs to an earlier trusted-main epoch")
        return {
            "proposal_id": row[0], "tool": row[1], "payload": json.loads(row[2]),
            "destination": row[4], "creator_session": row[5], "expires_at_ms": row[7],
            "approval_state": row[10], "use_state": row[11],
        }

    def _decide_proposal(self, session: _Session, payload: dict[str, Any]) -> dict[str, Any]:
        if session.role != "trusted-main":
            raise _OperationError("forbidden", "only trusted-main may decide proposals")
        proposal_id = self._proposal_id(payload)
        decision = payload.get("decision")
        if decision not in {"approve", "reject"}:
            raise _OperationError("invalid_decision", "decision must be approve or reject")
        with self._db_lock, self._transaction():
            row = self._proposal_row(proposal_id)
            if row[8] != self.boot_epoch:
                raise _OperationError("proposal_epoch_mismatch", "proposal belongs to an earlier core boot")
            with self._sessions_lock:
                current_app_epoch = self._app_epoch
            if row[9] != current_app_epoch:
                raise _OperationError("proposal_app_epoch_mismatch", "proposal belongs to an earlier trusted-main epoch")
            if (time.time_ns() // 1_000_000) >= row[7]:
                raise _OperationError("proposal_expired", "proposal has expired")
            if row[10] != "pending":
                raise _OperationError("proposal_already_decided", "proposal is no longer pending")
            state = "approved" if decision == "approve" else "rejected"
            assert self._db is not None
            self._db.execute("UPDATE proposals SET approval_state = ? WHERE proposal_id = ?", (state, proposal_id))
        return {"proposal_id": proposal_id, "status": state}

    def _cancel_proposal(self, session: _Session, payload: dict[str, Any]) -> dict[str, Any]:
        if session.role != "mcp-bridge":
            raise _OperationError("forbidden", "only an MCP creator may cancel its proposal")
        proposal_id = self._proposal_id(payload)
        with self._db_lock, self._transaction():
            row = self._proposal_row(proposal_id)
            if row[8] != self.boot_epoch:
                raise _OperationError("proposal_epoch_mismatch", "proposal belongs to an earlier core boot")
            with self._sessions_lock:
                current_app_epoch = self._app_epoch
            if row[9] != current_app_epoch:
                raise _OperationError("proposal_app_epoch_mismatch", "proposal belongs to an earlier trusted-main epoch")
            if row[6] != session.connection_id:
                raise _OperationError("proposal_session_mismatch", "proposal belongs to another MCP session")
            if row[10] not in {"pending", "approved"} or row[11] != "unused":
                raise _OperationError("proposal_not_cancellable", "proposal cannot be cancelled")
            assert self._db is not None
            self._db.execute("UPDATE proposals SET approval_state = 'cancelled' WHERE proposal_id = ?", (proposal_id,))
        return {"proposal_id": proposal_id, "status": "cancelled"}

    def _execute_proposal(self, session: _Session, payload: dict[str, Any]) -> dict[str, Any]:
        if session.role != "mcp-bridge":
            raise _OperationError("forbidden", "only the creating MCP session may request execution")
        proposal_id = self._proposal_id(payload)
        tool = payload.get("tool")
        proposed_payload = payload.get("payload")
        destination = payload.get("destination")
        if not isinstance(tool, str) or not isinstance(proposed_payload, dict) or not isinstance(destination, str):
            raise _OperationError("invalid_execution", "tool, payload, and destination are required")
        candidate_bytes = canonical_json(proposed_payload)
        with self._db_lock, self._transaction():
            row = self._proposal_row(proposal_id)
            if row[8] != self.boot_epoch:
                raise _OperationError("proposal_epoch_mismatch", "proposal belongs to an earlier core boot")
            with self._sessions_lock:
                current_app_epoch = self._app_epoch
            if row[9] != current_app_epoch:
                raise _OperationError("proposal_app_epoch_mismatch", "proposal belongs to an earlier trusted-main epoch")
            if row[6] != session.connection_id:
                raise _OperationError("proposal_session_mismatch", "proposal belongs to another MCP session")
            if (time.time_ns() // 1_000_000) >= row[7]:
                raise _OperationError("proposal_expired", "proposal has expired")
            if row[11] != "unused":
                raise _OperationError("proposal_used", "proposal is single-use")
            state = row[10]
            if state == "pending":
                raise _OperationError("proposal_not_approved", "proposal has not been approved")
            if state == "rejected":
                raise _OperationError("proposal_rejected", "proposal was rejected")
            if state == "cancelled":
                raise _OperationError("proposal_cancelled", "proposal was cancelled")
            if state != "approved":
                raise _OperationError("proposal_invalid_state", "proposal approval state is invalid")
            if tool != row[1] or destination != row[4] or candidate_bytes != row[2] or canonical_hash(proposed_payload) != row[3]:
                raise _OperationError("proposal_binding_mismatch", "execution is not canonically bound to the proposal")
            if tool != "insert_row" or destination != "app_db.rows":
                raise _OperationError("unsupported_write", "spike permits only harmless app-db insertion")
            value = proposed_payload.get("value")
            if not isinstance(value, str) or not value or len(value.encode("utf-8")) > 256:
                raise _OperationError("invalid_value", "value must be a non-empty bounded string")
            assert self._db is not None
            self._db.execute("INSERT INTO harmless_rows(value) VALUES (?)", (value,))
            self._db.execute("UPDATE proposals SET use_state = 'used' WHERE proposal_id = ?", (proposal_id,))
        return {"inserted": 1, "proposal_id": proposal_id}
