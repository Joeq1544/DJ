import json
import os
from pathlib import Path
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "fixtures" / "rekordbox" / "phase0-library.xml"
MAX_LINE_BYTES = 1_048_576


class CoreServiceTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        temporary_path = Path(self.temporary_directory.name)
        self.socket_directory = temporary_path / "socket-directory"
        self.socket_directory.mkdir(mode=0o755)
        self.socket_path = self.socket_directory / "core.sock"
        environment = os.environ | {"PYTHONPATH": str(ROOT / "core")}
        self.process = subprocess.Popen(
            [sys.executable, "-B", "-m", "dj_copilot.service", "--socket", str(self.socket_path), "--database", str(temporary_path / "library.sqlite3")],
            cwd=ROOT,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        deadline = time.monotonic() + 5
        while not self.socket_path.exists() and time.monotonic() < deadline and self.process.poll() is None:
            time.sleep(0.02)
        self.assertTrue(self.socket_path.exists(), self._service_error())

    def tearDown(self):
        if self.process.poll() is None:
            self.process.send_signal(signal.SIGTERM)
            self.process.wait(timeout=5)
        if self.process.stdout:
            self.process.stdout.close()
        if self.process.stderr:
            self.process.stderr.close()
        self.temporary_directory.cleanup()

    def test_health_and_socket_permissions(self):
        response = self.request({"version": 1, "id": "health-1", "command": "health", "payload": {}})

        self.assertEqual(response, {"version": 1, "id": "health-1", "ok": True, "result": {"state": "ready"}})
        self.assertEqual(stat.S_IMODE(self.socket_directory.stat().st_mode) & ~0o700, 0)
        self.assertEqual(stat.S_IMODE(self.socket_path.stat().st_mode) & ~0o600, 0)

    def test_import_tree_and_track_page_use_only_public_wire_fields(self):
        imported = self.request(
            {"version": 1, "id": "import-1", "command": "import_library", "payload": {"sourcePath": str(FIXTURE)}}
        )
        tree = self.request({"version": 1, "id": "tree-1", "command": "get_playlist_tree", "payload": {}})
        tracks = self.request({"version": 1, "id": "tracks-1", "command": "list_tracks", "payload": {"limit": 2}})

        self.assertEqual(imported["result"]["success"], True)
        self.assertEqual(imported["result"]["summary"]["importedTracks"], 4)
        self.assertEqual([node["name"] for node in tree["result"]], ["Root", "Warmup", "Opening", "Closer"])
        self.assertEqual(set(tracks["result"].keys()), {"items", "nextCursor"})
        self.assertEqual(
            set(tracks["result"]["items"][0].keys()),
            {"id", "title", "artist", "album", "genre", "bpmMilli", "musicalKey", "durationMs", "availability"},
        )

    def test_malformed_and_unknown_requests_have_bounded_error_envelopes(self):
        malformed = self.raw_request(b"{not json}\n")
        unknown = self.request({"version": 1, "id": "unknown-1", "command": "shell", "payload": {}})

        self.assertEqual((malformed["ok"], malformed["error"]["code"]), (False, "invalid_request"))
        self.assertEqual((unknown["id"], unknown["ok"], unknown["error"]["code"]), ("unknown-1", False, "unknown_command"))
        self.assertLessEqual(len(malformed["error"]["message"]), 500)

    def test_oversized_line_is_rejected_without_processing(self):
        response = self.raw_request(b"{" * (MAX_LINE_BYTES + 1) + b"\n")

        self.assertEqual((response["ok"], response["error"]["code"]), (False, "line_too_large"))

    def test_oversized_success_response_fails_closed_within_protocol_cap(self):
        source = Path(self.temporary_directory.name) / "large-playlist-tree.xml"
        playlist_nodes = "".join(
            f'<NODE Type="1" Name="{index:04d}{"x" * 996}" Entries="0"/>' for index in range(1_100)
        )
        source.write_text(
            '<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="0"/><PLAYLISTS>'
            + playlist_nodes
            + "</PLAYLISTS></DJ_PLAYLISTS>",
            encoding="utf-8",
        )
        imported = self.request(
            {"version": 1, "id": "large-import", "command": "import_library", "payload": {"sourcePath": str(source)}}
        )
        response_line = self.raw_response(
            json.dumps({"version": 1, "id": "large-tree", "command": "get_playlist_tree", "payload": {}}, separators=(",", ":")).encode("utf-8")
            + b"\n"
        )
        response = json.loads(response_line.decode("utf-8"))

        self.assertTrue(imported["result"]["success"])
        self.assertLessEqual(len(response_line), MAX_LINE_BYTES + 1)
        self.assertEqual((response["id"], response["ok"], response["error"]["code"]), ("large-tree", False, "response_too_large"))

    def test_sigterm_removes_its_socket(self):
        self.process.send_signal(signal.SIGTERM)
        self.process.wait(timeout=5)

        self.assertFalse(self.socket_path.exists())

    def request(self, payload):
        return self.raw_request(json.dumps(payload, separators=(",", ":")).encode("utf-8") + b"\n")

    def raw_request(self, line):
        return json.loads(self.raw_response(line).decode("utf-8"))

    def raw_response(self, line):
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(5)
            client.connect(str(self.socket_path))
            client.sendall(line)
            response = bytearray()
            while not response.endswith(b"\n"):
                chunk = client.recv(65_536)
                if not chunk:
                    break
                response.extend(chunk)
        return bytes(response)

    def _service_error(self):
        if self.process.poll() is None:
            return "service did not create its socket"
        stderr = self.process.stderr.read().decode("utf-8", "replace") if self.process.stderr else ""
        return f"service exited {self.process.returncode}: {stderr[-1000:]}"


if __name__ == "__main__":
    unittest.main()
