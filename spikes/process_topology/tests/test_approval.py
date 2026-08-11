import importlib
import socket
import tempfile
import threading
import unittest
from pathlib import Path


def require_module(test, name):
    try:
        return importlib.import_module(name)
    except ModuleNotFoundError as exc:
        test.fail(f"required spike module is not implemented: {exc.name}")


class Client:
    def __init__(self, protocol, path, role, session_id, capability):
        self.protocol = protocol
        self.socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.socket.settimeout(2)
        self.socket.connect(str(path))
        self.decoder = protocol.FrameDecoder()
        self.pending = []
        self.send({
            "type": "handshake", "version": 1, "role": role,
            "session_id": session_id, "capability": capability,
        })
        try:
            self.assert_handshake(self.recv())
        except BaseException:
            self.close()
            raise

    @staticmethod
    def assert_handshake(reply):
        if reply.get("type") != "handshake-accepted":
            raise AssertionError(reply)

    def send(self, message):
        self.socket.sendall(self.protocol.encode_frame(message))

    def recv(self):
        if self.pending:
            return self.pending.pop(0)
        while True:
            values = self.decoder.feed(self.socket.recv(65540))
            if values:
                self.pending.extend(values[1:])
                return values[0]

    def request(self, request_id, operation, payload):
        self.send({"type": "request", "id": request_id, "operation": operation, "payload": payload})
        while True:
            reply = self.recv()
            if reply.get("request_id") == request_id and reply.get("type") == "terminal":
                return reply
            self.pending.append(reply)

    def close(self):
        self.socket.close()


class ApprovalTests(unittest.TestCase):
    def setUp(self):
        self.protocol = require_module(self, "spikes.process_topology.protocol")
        self.core = require_module(self, "spikes.process_topology.core")
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.path = root / "runtime" / "core.sock"
        self.db = root / "app.sqlite3"
        self.capabilities = self.core.new_role_capabilities()
        self.server = self.core.CoreServer(self.path, self.db, role_capabilities=self.capabilities)
        self.server.start()
        self.main = self.client("trusted-main", "main")
        self.mcp = self.client("mcp-bridge", "mcp")
        self.sequence = 0

    def tearDown(self):
        for name in ("main", "mcp"):
            value = getattr(self, name, None)
            if value:
                value.close()
        self.server.stop()
        self.temp.cleanup()

    def client(self, role, session, capability=None):
        return Client(self.protocol, self.path, role, session, capability or self.capabilities[role])

    def call(self, client, operation, payload):
        self.sequence += 1
        return client.request(f"r-{self.sequence}", operation, payload)

    def proposal(self, value="safe", ttl_ms=30_000):
        reply = self.call(self.mcp, "create_proposal", {
            "tool": "insert_row", "payload": {"value": value},
            "destination": "app_db.rows", "ttl_ms": ttl_ms,
        })
        self.assertEqual(reply["status"], "succeeded")
        return reply

    def approve(self, proposal_id):
        shown = self.call(self.main, "get_proposal", {"proposal_id": proposal_id})
        self.assertEqual(shown["result"]["payload"], {"value": shown["result"]["payload"]["value"]})
        return self.call(self.main, "decide_proposal", {"proposal_id": proposal_id, "decision": "approve"})

    def execute(self, client, proposal_id, value="safe", tool="insert_row", destination="app_db.rows"):
        return self.call(client, "execute_proposal", {
            "proposal_id": proposal_id, "tool": tool,
            "payload": {"value": value}, "destination": destination,
        })

    def assert_error(self, reply, code):
        self.assertEqual(reply["status"], "failed", reply)
        self.assertEqual(reply["error"]["code"], code, reply)

    def test_mcp_response_never_exposes_approval_authority(self):
        reply = self.proposal()
        self.assertEqual(set(reply["result"]), {"proposal_id", "status"})
        encoded = self.protocol.canonical_json(reply).decode("utf-8")
        for forbidden in ("nonce", "hash", "capability", "approve"):
            self.assertNotIn(forbidden, encoded.lower())

    def test_only_trusted_main_can_retrieve_or_decide(self):
        proposal_id = self.proposal()["result"]["proposal_id"]
        self.assert_error(self.call(self.mcp, "get_proposal", {"proposal_id": proposal_id}), "forbidden")
        self.assert_error(
            self.call(self.mcp, "decide_proposal", {"proposal_id": proposal_id, "decision": "approve"}),
            "forbidden",
        )
        shown = self.call(self.main, "get_proposal", {"proposal_id": proposal_id})
        self.assertEqual(shown["result"]["tool"], "insert_row")
        self.assertEqual(shown["result"]["destination"], "app_db.rows")

    def test_approved_exact_binding_executes_once(self):
        proposal_id = self.proposal()["result"]["proposal_id"]
        self.assertEqual(self.approve(proposal_id)["status"], "succeeded")
        executed = self.execute(self.mcp, proposal_id)
        self.assertEqual(executed["status"], "succeeded")
        self.assertEqual(executed["result"]["inserted"], 1)
        self.assert_error(self.execute(self.mcp, proposal_id), "proposal_used")
        count = self.call(self.main, "read_count", {})
        self.assertEqual(count["result"]["count"], 1)

    def test_unapproved_rejected_and_cancelled_cannot_execute(self):
        pending = self.proposal()["result"]["proposal_id"]
        self.assert_error(self.execute(self.mcp, pending), "proposal_not_approved")
        cancelled = self.proposal("cancelled")["result"]["proposal_id"]
        result = self.call(self.mcp, "cancel_proposal", {"proposal_id": cancelled})
        self.assertEqual(result["status"], "succeeded")
        self.assert_error(self.execute(self.mcp, cancelled, "cancelled"), "proposal_cancelled")

    def test_rejected_proposal_cannot_execute(self):
        proposal_id = self.proposal("rejected")["result"]["proposal_id"]
        result = self.call(self.main, "decide_proposal", {"proposal_id": proposal_id, "decision": "reject"})
        self.assertEqual(result["status"], "succeeded")
        self.assert_error(self.execute(self.mcp, proposal_id, "rejected"), "proposal_rejected")

    def test_payload_destination_and_cross_tool_substitution_fail(self):
        attempts = [
            ({"value": "changed"}, "insert_row", "app_db.rows", "proposal_binding_mismatch"),
            ({"value": "safe"}, "insert_row", "app_db.other", "proposal_binding_mismatch"),
            ({"value": "safe"}, "delete_row", "app_db.rows", "proposal_binding_mismatch"),
        ]
        for index, (payload, tool, destination, code) in enumerate(attempts):
            proposal_id = self.proposal()["result"]["proposal_id"]
            self.approve(proposal_id)
            reply = self.call(self.mcp, "execute_proposal", {
                "proposal_id": proposal_id, "tool": tool,
                "payload": payload, "destination": destination,
            })
            with self.subTest(index=index):
                self.assert_error(reply, code)

    def test_expired_proposal_cannot_execute(self):
        proposal_id = self.proposal(ttl_ms=100)["result"]["proposal_id"]
        self.approve(proposal_id)
        import time
        time.sleep(0.15)
        self.assert_error(self.execute(self.mcp, proposal_id), "proposal_expired")

    def test_different_or_restarted_mcp_session_cannot_execute(self):
        proposal_id = self.proposal()["result"]["proposal_id"]
        self.approve(proposal_id)
        other = self.client("mcp-bridge", "other")
        try:
            self.assert_error(self.execute(other, proposal_id), "proposal_session_mismatch")
        finally:
            other.close()

        old_server_session = self.server._sessions["mcp"]
        finish_entered = threading.Event()
        release_finish = threading.Event()
        original_finish = old_server_session.decoder.finish

        def hold_before_unregister():
            original_finish()
            finish_entered.set()
            release_finish.wait(2)

        old_server_session.decoder.finish = hold_before_unregister
        self.mcp.close()
        self.mcp = None
        self.assertTrue(finish_entered.wait(2), "server did not observe immediate disconnect")
        try:
            self.mcp = self.client("mcp-bridge", "mcp")
        finally:
            release_finish.set()
        self.assert_error(self.execute(self.mcp, proposal_id), "proposal_session_mismatch")

    def test_failed_execute_rolls_back_insert_and_leaves_proposal_retryable(self):
        proposal_id = self.proposal()["result"]["proposal_id"]
        self.approve(proposal_id)

        def deny_use_state_update(action, table, column, database, trigger):
            if action == self.core.sqlite3.SQLITE_UPDATE and table == "proposals":
                return self.core.sqlite3.SQLITE_DENY
            return self.core.sqlite3.SQLITE_OK

        with self.server._db_lock:
            self.server._db.set_authorizer(deny_use_state_update)
        try:
            failed = self.execute(self.mcp, proposal_id)
        finally:
            with self.server._db_lock:
                self.server._db.set_authorizer(None)
        self.assertEqual(failed["status"], "outcome-unknown")
        count = self.call(self.main, "read_count", {})
        self.assertEqual(count["result"]["count"], 0)
        retried = self.execute(self.mcp, proposal_id)
        self.assertEqual(retried["status"], "succeeded")
        count = self.call(self.main, "read_count", {})
        self.assertEqual(count["result"]["count"], 1)

    def test_core_restart_invalidates_pending_and_approved_proposals(self):
        pending = self.proposal("pending")["result"]["proposal_id"]
        approved = self.proposal("approved")["result"]["proposal_id"]
        self.approve(approved)
        self.main.close()
        self.mcp.close()
        self.main = None
        self.mcp = None
        self.server.stop()
        self.capabilities = self.core.new_role_capabilities()
        self.server = self.core.CoreServer(self.path, self.db, role_capabilities=self.capabilities)
        self.server.start()
        self.main = self.client("trusted-main", "main-after-restart")
        self.mcp = self.client("mcp-bridge", "mcp-after-restart")
        self.assert_error(self.execute(self.mcp, pending, "pending"), "proposal_epoch_mismatch")
        self.assert_error(self.execute(self.mcp, approved, "approved"), "proposal_epoch_mismatch")

    def test_trusted_main_restart_invalidates_prior_approval_epoch(self):
        proposal_id = self.proposal("main-restart")["result"]["proposal_id"]
        self.approve(proposal_id)
        old_server_session = self.server._sessions["main"]
        finish_entered = threading.Event()
        release_finish = threading.Event()
        original_finish = old_server_session.decoder.finish

        def hold_before_unregister():
            original_finish()
            finish_entered.set()
            release_finish.wait(2)

        old_server_session.decoder.finish = hold_before_unregister
        self.main.close()
        self.main = None
        self.assertTrue(finish_entered.wait(2), "core did not observe trusted-main disconnect")
        try:
            self.main = self.client("trusted-main", "main-restarted")
        finally:
            release_finish.set()
        self.assert_error(self.execute(self.mcp, proposal_id, "main-restart"), "proposal_app_epoch_mismatch")


if __name__ == "__main__":
    unittest.main()
