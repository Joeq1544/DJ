import importlib
import io
import os
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path


def require_module(test, name):
    try:
        return importlib.import_module(name)
    except ModuleNotFoundError as exc:
        test.fail(f"required spike module is not implemented: {exc.name}")


class Client:
    def __init__(self, protocol, socket_path, role, session_id, capability):
        self.protocol = protocol
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(2)
        self.sock.connect(str(socket_path))
        self.decoder = protocol.FrameDecoder()
        self.pending = []
        self.send({
            "type": "handshake", "version": 1, "role": role,
            "session_id": session_id, "capability": capability,
        })
        try:
            reply = self.recv()
            if reply.get("type") != "handshake-accepted":
                raise AssertionError(reply)
        except BaseException:
            self.close()
            raise

    def send(self, message):
        self.sock.sendall(self.protocol.encode_frame(message))

    def recv(self):
        if self.pending:
            return self.pending.pop(0)
        while True:
            chunk = self.sock.recv(65540)
            if not chunk:
                raise EOFError("core closed socket")
            decoded = self.decoder.feed(chunk)
            if decoded:
                self.pending.extend(decoded[1:])
                return decoded[0]

    def request(self, request_id, operation, payload=None, idempotency_key=None):
        message = {"type": "request", "id": request_id, "operation": operation, "payload": payload or {}}
        if idempotency_key is not None:
            message["idempotency_key"] = idempotency_key
        self.send(message)
        events = []
        while True:
            event = self.recv()
            if event.get("request_id") != request_id:
                self.pending.append(event)
                continue
            events.append(event)
            if event.get("type") == "terminal":
                return event, events

    def close(self):
        self.sock.close()


class TopologyTests(unittest.TestCase):
    def setUp(self):
        self.protocol = require_module(self, "spikes.process_topology.protocol")
        self.core = require_module(self, "spikes.process_topology.core")
        self.bridge = require_module(self, "spikes.process_topology.mcp_bridge")
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.runtime = root / "runtime"
        self.socket_path = self.runtime / "core.sock"
        self.db_path = root / "app.sqlite3"
        self.capabilities = self.core.new_role_capabilities()
        self.server = self.core.CoreServer(
            self.socket_path, self.db_path, role_capabilities=self.capabilities, max_inflight=2,
        )
        self.server.start()

    def tearDown(self):
        if hasattr(self, "server"):
            self.server.stop()
        self.temp.cleanup()

    def client(self, role, session, capability=None):
        return Client(self.protocol, self.socket_path, role, session, capability or self.capabilities[role])

    def test_two_authenticated_sessions_share_one_database_owner(self):
        main = self.client("trusted-main", "main-a")
        mcp = self.client("mcp-bridge", "mcp-a")
        try:
            main_reply, _ = main.request("m1", "ping")
            mcp_reply, _ = mcp.request("x1", "read_count")
            self.assertEqual(main_reply["status"], "succeeded")
            self.assertEqual(mcp_reply["result"]["count"], 0)
            self.assertEqual(self.server.sqlite_open_count, 1)
            self.assertNotIn("sqlite3", vars(self.bridge))
        finally:
            main.close()
            mcp.close()

    def test_runtime_socket_permissions_peer_uid_and_cleanup(self):
        self.assertEqual(os.stat(self.runtime).st_mode & 0o777, 0o700)
        self.assertEqual(os.stat(self.socket_path).st_mode & 0o777, 0o600)
        left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            self.assertEqual(self.core.get_peer_uid(left), os.getuid())
            with self.assertRaises(self.core.PeerCredentialError):
                self.core.enforce_peer_uid(left, os.getuid() + 1)
        finally:
            left.close()
            right.close()
        self.server.stop()
        self.assertFalse(self.socket_path.exists())

    def test_handshake_must_be_first_matching_and_unique_while_connected(self):
        def raw(first):
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.settimeout(2)
            try:
                sock.connect(str(self.socket_path))
                sock.sendall(self.protocol.encode_frame(first))
                decoder = self.protocol.FrameDecoder()
                result = decoder.feed(sock.recv(65540))[0]
                return sock, result
            except BaseException:
                sock.close()
                raise

        for message, code in [
            ({"type": "request", "id": "x", "operation": "ping", "payload": {}}, "handshake_required"),
            ({
                "type": "handshake", "version": 2, "role": "trusted-main", "session_id": "x",
                "capability": self.capabilities["trusted-main"],
            }, "version_mismatch"),
        ]:
            sock, reply = raw(message)
            self.assertEqual(reply["error"]["code"], code)
            sock.close()

        first = self.client("mcp-bridge", "duplicate")
        sock, reply = raw({
            "type": "handshake", "version": 1, "role": "mcp-bridge", "session_id": "duplicate",
            "capability": self.capabilities["mcp-bridge"],
        })
        self.assertEqual(reply["error"]["code"], "duplicate_session")
        first.close()
        sock.close()

    def test_coalesced_handshake_and_request_preserve_first_message_order(self):
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(2)
        sock.connect(str(self.socket_path))
        handshake = {
            "type": "handshake", "version": 1, "role": "trusted-main", "session_id": "coalesced",
            "capability": self.capabilities["trusted-main"],
        }
        request = {"type": "request", "id": "coalesced-r1", "operation": "ping", "payload": {}}
        sock.sendall(self.protocol.encode_frame(handshake) + self.protocol.encode_frame(request))
        decoder = self.protocol.FrameDecoder()
        replies = []
        while len(replies) < 2:
            chunk = sock.recv(65540)
            if not chunk:
                break
            replies.extend(decoder.feed(chunk))
        self.assertEqual(replies[0]["type"], "handshake-accepted")
        self.assertEqual(replies[1]["request_id"], "coalesced-r1")
        self.assertEqual(replies[1]["status"], "succeeded")
        sock.close()

    def test_request_ids_are_unique_and_outcome_unknown_is_terminal(self):
        client = self.client("trusted-main", "unique-ids")
        try:
            first, _ = client.request("same", "ping")
            duplicate, _ = client.request("same", "ping")
            unknown, events = client.request("unknown", "simulate_outcome_unknown")
            self.assertEqual(first["status"], "succeeded")
            self.assertEqual(duplicate["error"]["code"], "duplicate_request_id")
            self.assertEqual(unknown["status"], "outcome-unknown")
            self.assertEqual(len([event for event in events if event["type"] == "terminal"]), 1)
        finally:
            client.close()

    def test_progress_backpressure_and_cancel_result_race_have_one_terminal(self):
        client = self.client("trusted-main", "race-main")
        try:
            for index in range(3):
                client.send({
                    "type": "request", "id": f"slow-{index}", "operation": "delayed_result",
                    "payload": {"delay_ms": 150},
                })
            client.send({
                "type": "request", "id": "cancel-0", "operation": "cancel",
                "payload": {"request_id": "slow-0"},
            })
            events = []
            deadline = time.time() + 3
            while time.time() < deadline:
                event = client.recv()
                events.append(event)
                terminals = [item for item in events if item.get("type") == "terminal"]
                target_ids = {item.get("request_id") for item in terminals}
                if {"slow-0", "slow-1", "slow-2", "cancel-0"}.issubset(target_ids):
                    break
            for request_id in ("slow-0", "slow-1", "slow-2", "cancel-0"):
                self.assertEqual(
                    len([item for item in events if item.get("type") == "terminal" and item.get("request_id") == request_id]),
                    1,
                )
            self.assertTrue(any(item.get("type") == "progress" for item in events))
            self.assertTrue(any(
                item.get("status") == "failed" and item.get("error", {}).get("code") == "backpressure"
                for item in events
            ))
            self.assertIn(
                next(item["status"] for item in events if item.get("request_id") == "slow-0" and item.get("type") == "terminal"),
                {"succeeded", "cancelled"},
            )
        finally:
            client.close()

    def test_idempotency_is_bound_persisted_and_has_one_effect_across_restart(self):
        main = self.client("trusted-main", "idempotency-main")
        first, _ = main.request("a", "idempotent_insert", {"value": "safe"}, "key-1")
        replay, _ = main.request("b", "idempotent_insert", {"value": "safe"}, "key-1")
        conflict, _ = main.request("c", "idempotent_insert", {"value": "other"}, "key-1")
        failed, _ = main.request("bad-a", "idempotent_insert", {"value": ""}, "bad-key")
        failed_replay, _ = main.request("bad-b", "idempotent_insert", {"value": ""}, "bad-key")
        failed_conflict, _ = main.request("bad-c", "idempotent_insert", {"value": "now-valid"}, "bad-key")
        count, _ = main.request("d", "read_count")
        self.assertEqual(first["result"], replay["result"])
        self.assertEqual(count["result"]["count"], 1)
        self.assertEqual(conflict["error"]["code"], "idempotency_conflict")
        self.assertEqual(failed["error"], failed_replay["error"])
        self.assertEqual(failed_conflict["error"]["code"], "idempotency_conflict")
        main.close()

        self.server.stop()
        self.capabilities = self.core.new_role_capabilities()
        self.server = self.core.CoreServer(
            self.socket_path, self.db_path, role_capabilities=self.capabilities, max_inflight=2,
        )
        self.server.start()
        main = self.client("trusted-main", "idempotency-main-2")
        try:
            after_restart, _ = main.request("e", "idempotent_insert", {"value": "safe"}, "key-1")
            count, _ = main.request("f", "read_count")
            self.assertEqual(after_restart["result"], first["result"])
            self.assertEqual(count["result"]["count"], 1)
        finally:
            main.close()

    def test_mcp_bridge_uses_socket_path_and_separate_stdio_json(self):
        bridge = self.bridge.MCPBridge(
            self.socket_path, "bridge-stdio", self.capabilities["mcp-bridge"], timeout_seconds=1,
        )
        try:
            response = bridge.handle_stdio_message({"id": "stdio-1", "operation": "read_count", "payload": {}})
            self.assertEqual(response["id"], "stdio-1")
            self.assertEqual(response["status"], "succeeded")
            self.assertNotIn("type", response)
            self.assertFalse(hasattr(bridge, "db_path"))
        finally:
            bridge.close()

    def test_stdio_is_byte_bounded_and_uses_strict_json(self):
        duplicate = b'{"id":"dup","operation":"read_count","payload":{},"payload":{}}\n'
        nonfinite = b'{"id":"nan","operation":"read_count","payload":{"x":NaN}}\n'
        oversized = b'{' + (b'x' * (self.protocol.MAX_PAYLOAD + 32)) + b'\n'
        valid = b'{"id":"ok","operation":"read_count","payload":{}}\n'
        stdin = io.BytesIO(duplicate + nonfinite + oversized + valid)
        stdout = io.StringIO()
        result = self.bridge.run_stdio(
            self.socket_path, "strict-stdio", self.capabilities["mcp-bridge"], stdin, stdout,
            timeout_seconds=1,
        )
        self.assertEqual(result, 0)
        replies = [self.protocol.decode_payload(line.encode("utf-8")) for line in stdout.getvalue().splitlines()]
        self.assertEqual([reply.get("error", {}).get("code") for reply in replies[:3]], [
            "duplicate_key", "invalid_json_constant", "stdio_line_too_large",
        ])
        self.assertEqual(replies[3]["status"], "succeeded")

    def test_mcp_bridge_handshake_and_request_stalls_are_bounded_and_close(self):
        def fake_core(*, accept_handshake):
            path = self.runtime / ("request-stall.sock" if accept_handshake else "handshake-stall.sock")
            listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            listener.bind(str(path))
            listener.listen(1)
            reached_stall = threading.Event()
            allow_eof_check = threading.Event()
            peer_closed = threading.Event()
            failures = []

            def serve():
                peer = None
                try:
                    peer, _ = listener.accept()
                    peer.settimeout(2)
                    decoder = self.protocol.FrameDecoder()
                    messages = []
                    while not messages:
                        messages.extend(decoder.feed(peer.recv(65540)))
                    if accept_handshake:
                        peer.sendall(self.protocol.encode_frame({
                            "type": "handshake-accepted", "version": 1,
                            "role": "mcp-bridge", "session_id": "stall",
                        }))
                        messages = []
                        while not messages:
                            messages.extend(decoder.feed(peer.recv(65540)))
                    reached_stall.set()
                    if not allow_eof_check.wait(2):
                        raise AssertionError("test did not release silent peer")
                    if peer.recv(1) == b"":
                        peer_closed.set()
                except BaseException as exc:
                    failures.append(exc)
                finally:
                    if peer is not None:
                        peer.close()
                    listener.close()

            thread = threading.Thread(target=serve)
            thread.start()
            return path, reached_stall, allow_eof_check, peer_closed, failures, thread

        path, stalled, release, closed, failures, thread = fake_core(accept_handshake=False)
        started = time.monotonic()
        try:
            with self.assertRaises(TimeoutError):
                self.bridge.MCPBridge(path, "stall", "x" * 43, timeout_seconds=0.05)
            self.assertLess(time.monotonic() - started, 1)
            self.assertTrue(stalled.wait(1))
        finally:
            release.set()
            thread.join(2)
        self.assertTrue(closed.is_set(), "failed bridge constructor leaked its connected socket")
        self.assertEqual(failures, [])

        path, stalled, release, closed, failures, thread = fake_core(accept_handshake=True)
        bridge = self.bridge.MCPBridge(path, "stall", "x" * 43, timeout_seconds=0.05)
        started = time.monotonic()
        try:
            with self.assertRaises(TimeoutError):
                bridge.handle_stdio_message({"id": "silent", "operation": "ping", "payload": {}})
            self.assertLess(time.monotonic() - started, 1)
            self.assertTrue(stalled.wait(1))
        finally:
            bridge.close()
            release.set()
            thread.join(2)
        self.assertTrue(closed.is_set(), "timed-out request socket was not closed by its owner")
        self.assertEqual(failures, [])

    def test_mcp_bridge_partial_handshake_drip_cannot_extend_absolute_deadline(self):
        path = self.runtime / "handshake-drip.sock"
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind(str(path))
        listener.listen(1)
        peer_closed = threading.Event()
        failures = []

        def serve():
            peer = None
            try:
                peer, _ = listener.accept()
                peer.settimeout(2)
                decoder = self.protocol.FrameDecoder()
                messages = []
                while not messages:
                    messages.extend(decoder.feed(peer.recv(65540)))
                reply = self.protocol.encode_frame({
                    "type": "handshake-accepted", "version": 1,
                    "role": "mcp-bridge", "session_id": "handshake-drip",
                })
                for byte in reply:
                    try:
                        peer.sendall(bytes([byte]))
                    except (BrokenPipeError, ConnectionResetError):
                        peer_closed.set()
                        return
                    time.sleep(0.005)
                if peer.recv(1) == b"":
                    peer_closed.set()
            except BaseException as exc:
                failures.append(exc)
            finally:
                if peer is not None:
                    peer.close()
                listener.close()

        thread = threading.Thread(target=serve)
        thread.start()
        bridge = None
        started = time.monotonic()
        try:
            with self.assertRaises(TimeoutError):
                bridge = self.bridge.MCPBridge(
                    path, "handshake-drip", "x" * 43, timeout_seconds=0.06,
                )
            self.assertLess(time.monotonic() - started, 0.25)
            self.assertTrue(peer_closed.wait(1), "handshake timeout did not close the private socket")
        finally:
            if bridge is not None:
                bridge.close()
            thread.join(2)
        self.assertEqual(failures, [])

    def test_mcp_bridge_progress_drip_cannot_extend_request_deadline(self):
        path = self.runtime / "request-drip.sock"
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind(str(path))
        listener.listen(1)
        peer_closed = threading.Event()
        failures = []

        def receive_one(peer, decoder):
            messages = []
            while not messages:
                messages.extend(decoder.feed(peer.recv(65540)))
            return messages[0]

        def serve():
            peer = None
            try:
                peer, _ = listener.accept()
                peer.settimeout(2)
                decoder = self.protocol.FrameDecoder()
                receive_one(peer, decoder)
                peer.sendall(self.protocol.encode_frame({
                    "type": "handshake-accepted", "version": 1,
                    "role": "mcp-bridge", "session_id": "request-drip",
                }))
                receive_one(peer, decoder)
                progress = self.protocol.encode_frame({
                    "type": "progress", "request_id": "drip", "completed": 0, "total": 1,
                })
                stop_drip = time.monotonic() + 0.6
                while time.monotonic() < stop_drip:
                    try:
                        peer.sendall(progress)
                    except (BrokenPipeError, ConnectionResetError):
                        peer_closed.set()
                        return
                    time.sleep(0.005)
                peer.shutdown(socket.SHUT_WR)
                if peer.recv(1) == b"":
                    peer_closed.set()
            except BaseException as exc:
                failures.append(exc)
            finally:
                if peer is not None:
                    peer.close()
                listener.close()

        thread = threading.Thread(target=serve)
        thread.start()
        bridge = self.bridge.MCPBridge(path, "request-drip", "x" * 43, timeout_seconds=0.08)
        started = time.monotonic()
        try:
            with self.assertRaises(TimeoutError):
                bridge.handle_stdio_message({"id": "drip", "operation": "ping", "payload": {}})
            self.assertLess(time.monotonic() - started, 0.3)
            self.assertTrue(peer_closed.wait(1), "request timeout did not close the private socket")
        finally:
            bridge.close()
            thread.join(2)
        self.assertEqual(failures, [])

    def test_second_core_cannot_take_database_or_live_socket(self):
        ownership_error = getattr(self.core, "CoreOwnershipError", RuntimeError)
        other_socket = self.runtime / "other.sock"
        second = self.core.CoreServer(other_socket, self.db_path, role_capabilities=self.core.new_role_capabilities())
        with self.assertRaises(ownership_error):
            second.start()
        self.assertIsNone(second._db)

        alias = Path(self.temp.name) / "database-alias.sqlite3"
        alias.symlink_to(self.db_path)
        alias_contender = self.core.CoreServer(
            self.runtime / "alias.sock", alias, role_capabilities=self.core.new_role_capabilities(),
        )
        try:
            with self.assertRaises(ownership_error):
                alias_contender.start()
        finally:
            alias_contender.stop()

        other_db = Path(self.temp.name) / "other.sqlite3"
        live_socket_contender = self.core.CoreServer(
            self.socket_path, other_db, role_capabilities=self.core.new_role_capabilities(),
        )
        with self.assertRaises(ownership_error):
            live_socket_contender.start()
        self.assertIsNone(live_socket_contender._db)

        main = self.client("trusted-main", "owner-still-live")
        try:
            reply, _ = main.request("owner-ping", "ping")
            self.assertEqual(reply["status"], "succeeded")
        finally:
            main.close()

    def test_socket_path_lock_serializes_stale_cleanup_and_preserves_live_owner(self):
        self.server.stop()
        stale = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        stale.bind(str(self.socket_path))
        stale.close()

        owner_caps = self.core.new_role_capabilities()
        owner = self.core.CoreServer(
            self.socket_path, Path(self.temp.name) / "owner.sqlite3", role_capabilities=owner_caps,
        )
        entered_prepare = threading.Event()
        release_prepare = threading.Event()
        owner_started = threading.Event()
        owner_failures = []
        original_prepare = owner._prepare_socket_path

        def held_prepare():
            entered_prepare.set()
            if not release_prepare.wait(2):
                raise AssertionError("test did not release stale-socket preparation")
            original_prepare()

        owner._prepare_socket_path = held_prepare

        def start_owner():
            try:
                owner.start()
                owner_started.set()
            except BaseException as exc:
                owner_failures.append(exc)

        owner_thread = threading.Thread(target=start_owner)
        owner_thread.start()
        self.assertTrue(entered_prepare.wait(2), "owner did not reach stale-socket validation")
        contender = self.core.CoreServer(
            self.socket_path, Path(self.temp.name) / "contender.sqlite3",
            role_capabilities=self.core.new_role_capabilities(),
        )
        try:
            with self.assertRaises(self.core.CoreOwnershipError):
                contender.start()
        finally:
            contender.stop()
            release_prepare.set()
            owner_thread.join(2)
        self.assertTrue(owner_started.is_set(), f"owner failed to bind after serialization: {owner_failures}")
        self.assertEqual(owner_failures, [])

        live_contender = self.core.CoreServer(
            self.socket_path, Path(self.temp.name) / "live-contender.sqlite3",
            role_capabilities=self.core.new_role_capabilities(),
        )
        try:
            with self.assertRaises(self.core.CoreOwnershipError):
                live_contender.start()
            client = Client(
                self.protocol, self.socket_path, "trusted-main", "serialized-owner",
                owner_caps["trusted-main"],
            )
            try:
                terminal, _ = client.request("still-live", "ping")
                self.assertEqual(terminal["status"], "succeeded")
            finally:
                client.close()
        finally:
            live_contender.stop()
            owner.stop()

    def test_socket_cleanup_rejects_final_symlink_without_unlinking_it(self):
        self.server.stop()
        target = self.runtime / "target.sock"
        stale = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        stale.bind(str(target))
        stale.close()
        self.socket_path.symlink_to(target)
        contender = self.core.CoreServer(
            self.socket_path, Path(self.temp.name) / "symlink.sqlite3",
            role_capabilities=self.core.new_role_capabilities(),
        )
        try:
            with self.assertRaises(self.core.CoreOwnershipError):
                contender.start()
            self.assertTrue(self.socket_path.is_symlink())
            self.assertTrue(target.exists())
        finally:
            contender.stop()

    def test_failed_start_releases_database_ownership(self):
        failing_db = Path(self.temp.name) / "failed-start.sqlite3"
        too_long_socket = self.runtime / ("s" * 180)
        failed = self.core.CoreServer(
            too_long_socket, failing_db, role_capabilities=self.core.new_role_capabilities(),
        )
        with self.assertRaises(OSError):
            failed.start()
        self.assertIsNone(failed._db)
        replacement = self.core.CoreServer(
            self.runtime / "replacement.sock", failing_db, role_capabilities=self.core.new_role_capabilities(),
        )
        replacement.start()
        replacement.stop()

    def test_role_capabilities_reject_missing_wrong_and_cross_role_claims(self):
        def rejected(message):
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.settimeout(2)
            try:
                sock.connect(str(self.socket_path))
                sock.sendall(self.protocol.encode_frame(message))
                decoder = self.protocol.FrameDecoder()
                chunk = sock.recv(65540)
                if not chunk:
                    self.fail("core closed malformed handshake without a stable rejection")
                return decoder.feed(chunk)[0]
            finally:
                sock.close()

        base = {"type": "handshake", "version": 1, "role": "trusted-main", "session_id": "forged-main"}
        cases = [
            (base, "invalid_handshake_capability", None),
            ({**base, "capability": "x" * 43}, "handshake_unauthorized", "x" * 43),
            ({**base, "capability": self.capabilities["mcp-bridge"]}, "handshake_unauthorized", self.capabilities["mcp-bridge"]),
            ({**base, "capability": "é" * 32}, "invalid_handshake_capability", "é" * 32),
        ]
        for message, code, secret in cases:
            with self.subTest(code=code):
                reply = rejected(message)
                self.assertEqual(reply["error"]["code"], code)
                if secret is not None:
                    self.assertNotIn(secret, self.protocol.canonical_json(reply).decode("utf-8"))

    def test_stop_waits_for_session_thread_and_closed_session_cannot_dispatch(self):
        client = self.client("trusted-main", "shutdown-session")
        session = self.server._sessions["shutdown-session"]
        finish_entered = threading.Event()
        release_finish = threading.Event()
        close_entered = threading.Event()
        stop_done = threading.Event()
        original_finish = session.decoder.finish
        original_close = session.close

        def held_finish():
            original_finish()
            finish_entered.set()
            release_finish.wait(2)

        def observed_close():
            close_entered.set()
            original_close()

        session.decoder.finish = held_finish
        session.close = observed_close
        client.close()
        self.assertTrue(finish_entered.wait(2), "session handler did not reach EOF cleanup")
        stopper = threading.Thread(target=lambda: (self.server.stop(), stop_done.set()))
        stopper.start()
        self.assertTrue(close_entered.wait(2), "stop did not close the active session")
        try:
            self.assertFalse(stop_done.wait(0.25), "stop returned before its session thread exited")
        finally:
            release_finish.set()
        self.assertTrue(stop_done.wait(2), "stop did not finish after session cleanup")
        stopper.join(2)

        self.server._dispatch_request(session, {
            "type": "request", "id": "after-stop", "operation": "read_count", "payload": {},
        })
        self.assertNotIn("after-stop", session.request_ids)

    def test_failed_idempotency_write_rolls_back_harmless_row(self):
        main = self.client("trusted-main", "rollback-main")

        def deny_idempotency_insert(action, table, column, database, trigger):
            if action == self.core.sqlite3.SQLITE_INSERT and table == "idempotency":
                return self.core.sqlite3.SQLITE_DENY
            return self.core.sqlite3.SQLITE_OK

        with self.server._db_lock:
            self.server._db.set_authorizer(deny_idempotency_insert)
        try:
            failed, _ = main.request("fault", "idempotent_insert", {"value": "safe"}, "fault-key")
        finally:
            with self.server._db_lock:
                self.server._db.set_authorizer(None)
        self.assertEqual(failed["status"], "outcome-unknown")
        count, _ = main.request("count", "read_count")
        self.assertEqual(count["result"]["count"], 0)
        retried, _ = main.request("retry", "idempotent_insert", {"value": "safe"}, "fault-key")
        self.assertEqual(retried["status"], "succeeded")
        main.close()

    def test_sessions_request_history_and_handshake_time_are_bounded(self):
        self.server.stop()
        self.capabilities = self.core.new_role_capabilities()
        try:
            self.server = self.core.CoreServer(
                self.socket_path, self.db_path, role_capabilities=self.capabilities,
                max_sessions=1, max_requests_per_session=1, handshake_timeout=0.1,
                io_timeout=1, session_lifetime=2,
            )
        except TypeError as exc:
            self.fail(f"bounded lifecycle configuration is missing: {exc}")
        self.server.start()
        first = self.client("trusted-main", "bounded-main")
        reply, _ = first.request("first", "ping")
        self.assertEqual(reply["status"], "succeeded")
        limited, _ = first.request("second", "ping")
        self.assertEqual(limited["error"]["code"], "request_limit")

        second = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        second.settimeout(2)
        try:
            second.connect(str(self.socket_path))
            second.sendall(self.protocol.encode_frame({
                "type": "handshake", "version": 1, "role": "mcp-bridge", "session_id": "too-many",
                "capability": self.capabilities["mcp-bridge"],
            }))
            decoder = self.protocol.FrameDecoder()
            rejected = decoder.feed(second.recv(65540))[0]
            self.assertEqual(rejected["error"]["code"], "server_busy")
        finally:
            second.close()
            first.close()

        self.server.stop()
        self.capabilities = self.core.new_role_capabilities()
        self.server = self.core.CoreServer(
            self.socket_path, self.db_path, role_capabilities=self.capabilities,
            max_sessions=1, handshake_timeout=0.1, io_timeout=1, session_lifetime=2,
        )
        self.server.start()
        idle = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        idle.settimeout(2)
        idle.connect(str(self.socket_path))
        self.assertEqual(idle.recv(1), b"")
        idle.close()

    def test_cancel_at_result_boundary_has_one_terminal_and_recovers_slot(self):
        self.server.stop()
        ready = threading.Event()
        release = threading.Event()
        self.capabilities = self.core.new_role_capabilities()
        try:
            self.server = self.core.CoreServer(
                self.socket_path, self.db_path, role_capabilities=self.capabilities,
                max_inflight=1, delayed_result_barrier=(ready, release),
            )
        except TypeError as exc:
            self.fail(f"deterministic result barrier is missing: {exc}")
        self.server.start()
        slot_release_entered = threading.Event()
        allow_slot_release = threading.Event()
        original_slot_release = self.server._slots.release

        def held_slot_release():
            slot_release_entered.set()
            if not allow_slot_release.wait(2):
                raise AssertionError("test did not release the request slot")
            original_slot_release()

        self.server._slots.release = held_slot_release
        client = self.client("trusted-main", "barrier-main")
        client.send({
            "type": "request", "id": "target", "operation": "delayed_result",
            "payload": {"delay_ms": 0},
        })
        self.assertTrue(ready.wait(2), "operation did not reach result boundary")
        client.send({
            "type": "request", "id": "cancel", "operation": "cancel",
            "payload": {"request_id": "target"},
        })
        observed = []
        while not any(item.get("request_id") == "cancel" and item.get("type") == "terminal" for item in observed):
            observed.append(client.recv())
        release.set()
        self.assertTrue(slot_release_entered.wait(2), "worker did not reach slot cleanup")
        client.sock.settimeout(0.05)
        try:
            with self.assertRaises(TimeoutError, msg="terminal became visible before its request slot was released"):
                client.recv()
        finally:
            client.sock.settimeout(2)
            allow_slot_release.set()
        while not any(item.get("request_id") == "target" and item.get("type") == "terminal" for item in observed):
            observed.append(client.recv())
        target_terminals = [
            item for item in observed if item.get("request_id") == "target" and item.get("type") == "terminal"
        ]
        self.assertEqual(len(target_terminals), 1)
        self.assertEqual(target_terminals[0]["status"], "cancelled")

        client.send({"type": "request", "id": "marker", "operation": "ping", "payload": {}})
        while not any(item.get("request_id") == "marker" and item.get("type") == "terminal" for item in observed):
            observed.append(client.recv())
        self.assertEqual(len([
            item for item in observed if item.get("request_id") == "target" and item.get("type") == "terminal"
        ]), 1)
        marker = next(item for item in observed if item.get("request_id") == "marker" and item.get("type") == "terminal")
        self.assertEqual(marker["status"], "succeeded")
        client.close()


if __name__ == "__main__":
    unittest.main()
