import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[2]
GENERATOR = ROOT / "scripts" / "generate-audio-fixtures.py"


class AnalysisServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.audio_directory = tempfile.TemporaryDirectory()
        cls.audio_root = Path(cls.audio_directory.name)
        subprocess.run(
            [sys.executable, str(GENERATOR), "--output", str(cls.audio_root)],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        cls.ffmpeg = shutil.which("ffmpeg")
        cls.ffprobe = shutil.which("ffprobe")
        if cls.ffmpeg is None or cls.ffprobe is None:
            raise RuntimeError("FFmpeg and ffprobe 8.1.2 are required")
        ffmpeg_version = subprocess.run(
            [cls.ffmpeg, "-version"], check=True, capture_output=True, text=True
        ).stdout.splitlines()[0]
        ffprobe_version = subprocess.run(
            [cls.ffprobe, "-version"], check=True, capture_output=True, text=True
        ).stdout.splitlines()[0]
        if not ffmpeg_version.startswith("ffmpeg version 8.1.2"):
            raise RuntimeError(f"Unexpected FFmpeg version: {ffmpeg_version}")
        if not ffprobe_version.startswith("ffprobe version 8.1.2"):
            raise RuntimeError(f"Unexpected ffprobe version: {ffprobe_version}")

    @classmethod
    def tearDownClass(cls):
        cls.audio_directory.cleanup()

    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.socket_path = self.root / "runtime" / "core.sock"
        self.database_path = self.root / "library.sqlite3"
        self.xml_path = self.root / "generated-library.xml"
        self.xml_path.write_text(
            """<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <COLLECTION Entries="2">
    <TRACK TrackID="harmonic" Name="Harmonic" Artist="Generated" Location="%s"/>
    <TRACK TrackID="silence" Name="Silence" Artist="Generated" Location="%s"/>
  </COLLECTION>
  <PLAYLISTS/>
</DJ_PLAYLISTS>
"""
            % ((self.audio_root / "harmonic.wav").as_uri(), (self.audio_root / "silence.wav").as_uri()),
            encoding="utf-8",
        )
        self.process = None
        self._start_service(self.ffmpeg, self.ffprobe)
        imported = self.request(
            "import-1", "import_library", {"sourcePath": str(self.xml_path)}
        )
        self.assertTrue(imported["ok"], imported)
        tracks = self.request("tracks-1", "list_tracks", {"limit": 10})
        self.track_ids = {
            item["title"]: item["id"] for item in tracks["result"]["items"]
        }

    def tearDown(self):
        self._stop_service()
        self.temporary_directory.cleanup()

    def test_real_service_queues_pauses_resumes_and_returns_path_free_analysis(self):
        initial = self.request("status-1", "get_analysis_status", {})
        self.assertEqual(initial["result"]["state"], "idle")
        self.assertEqual(initial["result"]["items"], [])
        self.assertEqual(
            initial["result"]["capabilities"],
            {
                "available": True,
                "provider": "ffmpeg-numpy-basic",
                "providerVersion": "ffmpeg 8.1.2; ffprobe 8.1.2; numpy 2.4.4",
                "pipelineVersion": "baseline-v1",
                "availableStages": ["metadata", "basic_features"],
                "unavailableStages": ["structure", "embeddings"],
                "unavailableReason": None,
            },
        )
        paused = self.request("pause-1", "pause_analysis", {})
        self.assertEqual(paused["result"]["state"], "paused")

        requested = [self.track_ids["Harmonic"], self.track_ids["Silence"]]
        queued = self.request("queue-1", "queue_analysis", {"trackIds": requested})
        self.assertEqual(queued["result"]["state"], "paused")
        self.assertEqual(
            [item["trackId"] for item in queued["result"]["items"]], requested
        )
        selected = self.request(
            "status-2", "get_analysis_status", {"trackIds": list(reversed(requested))}
        )
        self.assertEqual(
            [item["trackId"] for item in selected["result"]["items"]],
            list(reversed(requested)),
        )
        self.assertEqual(selected["result"]["queued"], 2)

        resumed = self.request("resume-1", "resume_analysis", {})
        self.assertEqual(resumed["result"]["state"], "running")
        finished = self._wait_for_status(requested, succeeded=2)
        self.assertEqual((finished["queued"], finished["running"], finished["failed"]), (0, 0, 0))
        self.assertEqual(finished["progressPpm"], 1_000_000)
        harmonic = finished["items"][0]
        self.assertEqual(harmonic["status"], "succeeded")
        self.assertEqual(harmonic["features"]["bpmMilli"], 120_000)
        self.assertEqual(harmonic["features"]["musicalKey"], "C")
        self.assertEqual(harmonic["features"]["mode"], "major")

        tracks = self.request("tracks-2", "list_tracks", {"limit": 10})["result"]
        by_id = {item["id"]: item for item in tracks["items"]}
        self.assertEqual(by_id[requested[0]]["analysis"]["status"], "succeeded")
        self._assert_path_free(initial["result"])
        self._assert_path_free(finished)
        self._assert_path_free(tracks)

    def test_diagnostics_and_online_backup_are_exact_path_free_core_results(self):
        """Private paths, content, incomplete snapshots, or unverifiable backups must fail."""
        diagnostics = self.request("diagnostics-1", "get_diagnostics", {})
        self.assertTrue(diagnostics["ok"], diagnostics)
        self.assertEqual(
            diagnostics["result"],
            {
                "coreVersion": "0.1.0",
                "schemaVersion": 4,
                "databaseIntegrity": "ok",
                "analysis": {
                    "available": True,
                    "provider": "ffmpeg-numpy-basic",
                    "providerVersion": "ffmpeg 8.1.2; ffprobe 8.1.2; numpy 2.4.4",
                    "pipelineVersion": "baseline-v1",
                    "availableStages": ["metadata", "basic_features"],
                    "unavailableStages": ["structure", "embeddings"],
                    "unavailableReason": None,
                },
            },
        )
        destination = self.root / "DJ Copilot Backup.sqlite3"
        backed_up = self.request(
            "backup-1",
            "backup_database",
            {"destinationPath": str(destination)},
        )
        self.assertTrue(backed_up["ok"], backed_up)
        result = backed_up["result"]
        self.assertEqual(
            set(result),
            {"status", "schemaVersion", "integrity", "sizeBytes", "createdAt"},
        )
        self.assertEqual(result["status"], "backed_up")
        self.assertEqual(result["schemaVersion"], 4)
        self.assertEqual(result["integrity"], "ok")
        self.assertEqual(result["sizeBytes"], destination.stat().st_size)
        self.assertRegex(result["createdAt"], r"^\d{4}-\d{2}-\d{2}T.*Z$")
        backup = sqlite3.connect(destination)
        try:
            self.assertEqual(backup.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(backup.execute("PRAGMA user_version").fetchone()[0], 4)
            self.assertEqual(backup.execute("SELECT COUNT(*) FROM tracks").fetchone()[0], 2)
        finally:
            backup.close()
        self._assert_path_free(diagnostics["result"])
        self._assert_path_free(result)

        missing_parent = self.root / "missing" / "DJ Copilot Backup.sqlite3"
        rejected = self.request(
            "backup-missing-parent",
            "backup_database",
            {"destinationPath": str(missing_parent)},
        )
        self.assertEqual(
            (rejected["ok"], rejected["error"]),
            (
                False,
                {
                    "code": "invalid_request",
                    "message": "The database backup destination is invalid.",
                },
            ),
        )

    def test_selected_rebuild_removes_cached_evidence_and_reanalyzes_without_source_writes(self):
        """Rebuild must not reuse selected features, disturb other tracks, or edit source audio."""
        selected = self.track_ids["Harmonic"]
        retained = self.track_ids["Silence"]
        source_paths = (
            self.audio_root / "harmonic.wav",
            self.audio_root / "silence.wav",
        )
        source_hashes = {
            path.name: hashlib.sha256(path.read_bytes()).hexdigest()
            for path in source_paths
        }
        queued = self.request(
            "queue-before-rebuild",
            "queue_analysis",
            {"trackIds": [selected, retained]},
        )
        self.assertTrue(queued["ok"], queued)
        self._wait_for_status([selected, retained], succeeded=2)
        paused = self.request("pause-before-rebuild", "pause_analysis", {})
        self.assertEqual(paused["result"]["state"], "paused")

        rebuilt = self.request(
            "rebuild-1",
            "rebuild_analysis",
            {"trackIds": [selected]},
        )

        self.assertTrue(rebuilt["ok"], rebuilt)
        self.assertEqual(rebuilt["result"]["state"], "paused")
        self.assertEqual(
            (rebuilt["result"]["queued"], rebuilt["result"]["succeeded"]),
            (1, 1),
        )
        self.assertEqual(len(rebuilt["result"]["items"]), 1)
        self.assertEqual(rebuilt["result"]["items"][0]["trackId"], selected)
        self.assertEqual(rebuilt["result"]["items"][0]["status"], "queued")
        self.assertIsNone(rebuilt["result"]["items"][0]["features"])
        tracks = self.request(
            "tracks-after-rebuild", "list_tracks", {"limit": 10}
        )["result"]
        by_id = {item["id"]: item for item in tracks["items"]}
        self.assertEqual(by_id[selected]["analysis"]["status"], "queued")
        self.assertIsNone(by_id[selected]["analysis"]["features"])
        self.assertEqual(by_id[retained]["analysis"]["status"], "succeeded")
        self.assertIsNotNone(by_id[retained]["analysis"]["features"])

        self.request("resume-after-rebuild", "resume_analysis", {})
        finished = self._wait_for_status([selected], succeeded=2)
        self.assertEqual(finished["items"][0]["status"], "succeeded")
        self.assertIsNotNone(finished["items"][0]["features"])
        self.assertEqual(
            {
                path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                for path in source_paths
            },
            source_hashes,
        )

    def test_analysis_commands_reject_ambiguous_or_unbounded_payloads(self):
        known = self.track_ids["Harmonic"]
        invalid_queue_payloads = (
            {},
            {"trackIds": []},
            {"trackIds": [known, known]},
            {"trackIds": ["unknown-track"]},
            {"trackIds": "not-a-list"},
            {"trackIds": [1]},
            {"trackIds": [f"track-{index}" for index in range(201)]},
            {"trackIds": [known], "extra": True},
        )
        for index, payload in enumerate(invalid_queue_payloads):
            with self.subTest(command="queue_analysis", payload=payload):
                response = self.request(f"bad-queue-{index}", "queue_analysis", payload)
                self.assertEqual((response["ok"], response["error"]["code"]), (False, "invalid_request"))

        self.assertTrue(self.request("status-empty", "get_analysis_status", {})["ok"])
        self.assertTrue(
            self.request("status-known", "get_analysis_status", {"trackIds": [known]})["ok"]
        )
        invalid_status_payloads = (
            {"trackIds": []},
            {"trackIds": [known, known]},
            {"trackIds": ["unknown-track"]},
            {"trackIds": [known], "extra": True},
        )
        for index, payload in enumerate(invalid_status_payloads):
            with self.subTest(command="get_analysis_status", payload=payload):
                response = self.request(f"bad-status-{index}", "get_analysis_status", payload)
                self.assertEqual((response["ok"], response["error"]["code"]), (False, "invalid_request"))

        for command in ("pause_analysis", "resume_analysis"):
            response = self.request(f"bad-{command}", command, {"unexpected": True})
            self.assertEqual((response["ok"], response["error"]["code"]), (False, "invalid_request"))

        invalid_rebuild_payloads = (
            {},
            {"trackIds": []},
            {"trackIds": [known, known]},
            {"trackIds": ["unknown-track"]},
            {"trackIds": [known], "extra": True},
        )
        for index, payload in enumerate(invalid_rebuild_payloads):
            with self.subTest(command="rebuild_analysis", payload=payload):
                response = self.request(
                    f"bad-rebuild-{index}", "rebuild_analysis", payload
                )
                self.assertEqual(
                    (response["ok"], response["error"]["code"]),
                    (False, "invalid_request"),
                )

        invalid_backup_payloads = (
            {},
            {"destinationPath": ""},
            {"destinationPath": "relative.sqlite3"},
            {"destinationPath": str(self.root / "backup.sqlite3"), "extra": True},
        )
        for index, payload in enumerate(invalid_backup_payloads):
            with self.subTest(command="backup_database", payload=payload):
                response = self.request(
                    f"bad-backup-{index}", "backup_database", payload
                )
                self.assertEqual(
                    (response["ok"], response["error"]["code"]),
                    (False, "invalid_request"),
                )
        response = self.request(
            "bad-diagnostics", "get_diagnostics", {"unexpected": True}
        )
        self.assertEqual(
            (response["ok"], response["error"]["code"]),
            (False, "invalid_request"),
        )

    def test_unavailable_provider_keeps_health_and_library_ready(self):
        self._stop_service()
        missing = self.root / "missing-ffmpeg"
        self._start_service(missing, self.ffprobe)

        health = self.request("health-unavailable", "health", {})
        tracks = self.request("tracks-unavailable", "list_tracks", {"limit": 10})
        status = self.request("status-unavailable", "get_analysis_status", {})

        self.assertEqual(health["result"], {"state": "ready"})
        self.assertEqual(len(tracks["result"]["items"]), 2)
        self.assertFalse(status["result"]["capabilities"]["available"])
        self.assertIsNone(status["result"]["capabilities"]["providerVersion"])
        self._assert_path_free(status["result"])

    def test_missing_numpy_keeps_health_and_existing_library_ready(self):
        """Importing the provider without NumPy must not take down the core service."""
        self._stop_service()
        self._start_service(self.ffmpeg, self.ffprobe, without_site_packages=True)

        health = self.request("health-no-numpy", "health", {})
        tracks = self.request("tracks-no-numpy", "list_tracks", {"limit": 10})
        status = self.request("status-no-numpy", "get_analysis_status", {})

        self.assertEqual(health["result"], {"state": "ready"})
        self.assertEqual(
            {item["title"] for item in tracks["result"]["items"]},
            {"Harmonic", "Silence"},
        )
        capabilities = status["result"]["capabilities"]
        self.assertFalse(capabilities["available"])
        self.assertIsNone(capabilities["providerVersion"])
        self.assertEqual(
            capabilities["unavailableReason"],
            "Local audio analysis prerequisites are unavailable.",
        )
        self.assertLessEqual(len(capabilities["unavailableReason"]), 100)
        self._assert_path_free(status["result"])

    def test_missing_numpy_has_a_bounded_provider_reason(self):
        """A missing NumPy install must produce a useful internal capability reason."""
        environment = os.environ | {"PYTHONPATH": str(ROOT / "core")}
        script = (
            "import json\n"
            "from dj_copilot.analysis.provider import FfmpegNumpyProvider\n"
            f"provider = FfmpegNumpyProvider(ffmpeg_path={self.ffmpeg!r}, "
            f"ffprobe_path={self.ffprobe!r})\n"
            "capabilities = provider.capabilities()\n"
            "print(json.dumps({\n"
            "    'available': capabilities.available,\n"
            "    'providerVersion': capabilities.provider_version,\n"
            "    'reason': capabilities.unavailable_reason,\n"
            "}))\n"
        )
        completed = subprocess.run(
            [sys.executable, "-S", "-B", "-c", script],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr[-1_000:])
        capabilities = json.loads(completed.stdout)
        self.assertFalse(capabilities["available"])
        self.assertIsNone(capabilities["providerVersion"])
        self.assertIn("numpy", capabilities["reason"].lower())
        self.assertIn("2.4.4", capabilities["reason"])
        self.assertLessEqual(len(capabilities["reason"]), 200)

    def test_sigterm_requeues_running_analysis_before_database_and_socket_close(self):
        self._stop_service()
        slow_ffprobe = self._slow_wrapper("slow-ffprobe", self.ffprobe)
        self._start_service(self.ffmpeg, slow_ffprobe)
        track_id = self.track_ids["Harmonic"]
        queued = self.request("queue-slow", "queue_analysis", {"trackIds": [track_id]})
        self.assertTrue(queued["ok"], queued)
        self._wait_for_status([track_id], running=1)

        self.process.send_signal(signal.SIGTERM)
        self.process.wait(timeout=5)

        self.assertEqual(self.process.returncode, 0, self._service_error())
        self.assertFalse(self.socket_path.exists())
        database = sqlite3.connect(self.database_path)
        try:
            status = database.execute(
                "SELECT status FROM analysis_jobs WHERE track_id = ?", (track_id,)
            ).fetchone()[0]
        finally:
            database.close()
        self.assertEqual(status, "queued")

    def request(self, request_id, command, payload):
        envelope = {"version": 1, "id": request_id, "command": command, "payload": payload}
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(5)
            client.connect(str(self.socket_path))
            client.sendall(json.dumps(envelope, separators=(",", ":")).encode("utf-8") + b"\n")
            response = bytearray()
            while not response.endswith(b"\n"):
                chunk = client.recv(65_536)
                if not chunk:
                    break
                response.extend(chunk)
        return json.loads(response)

    def _start_service(self, ffmpeg, ffprobe, *, without_site_packages=False):
        environment = os.environ | {
            "PYTHONPATH": str(ROOT / "core"),
            "DJ_COPILOT_FFMPEG": str(ffmpeg),
            "DJ_COPILOT_FFPROBE": str(ffprobe),
        }
        python_arguments = [sys.executable, "-B"]
        if without_site_packages:
            python_arguments.append("-S")
        self.process = subprocess.Popen(
            [
                *python_arguments,
                "-m",
                "dj_copilot.service",
                "--socket",
                str(self.socket_path),
                "--database",
                str(self.database_path),
            ],
            cwd=ROOT,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        deadline = time.monotonic() + 5
        while not self.socket_path.exists() and time.monotonic() < deadline and self.process.poll() is None:
            time.sleep(0.02)
        self.assertTrue(self.socket_path.exists(), self._service_error())

    def _stop_service(self):
        if self.process is not None and self.process.poll() is None:
            self.process.send_signal(signal.SIGTERM)
            self.process.wait(timeout=5)
        if self.process is not None and self.process.stdout:
            self.process.stdout.close()
        if self.process is not None and self.process.stderr:
            self.process.stderr.close()

    def _wait_for_status(self, track_ids, **expected_count):
        deadline = time.monotonic() + 8
        last = None
        while time.monotonic() < deadline:
            response = self.request(
                "status-poll", "get_analysis_status", {"trackIds": track_ids}
            )
            self.assertTrue(response["ok"], response)
            last = response["result"]
            if all(last[key] == value for key, value in expected_count.items()):
                return last
            time.sleep(0.01)
        self.fail(f"timed out waiting for {expected_count}: {last}")

    def _assert_path_free(self, value):
        if isinstance(value, dict):
            for key, child in value.items():
                self.assertNotIn("path", key.lower())
                self._assert_path_free(child)
        elif isinstance(value, list):
            for child in value:
                self._assert_path_free(child)
        elif isinstance(value, str):
            self.assertNotIn(str(self.root), value)
            self.assertNotIn(str(self.audio_root), value)

    def _slow_wrapper(self, name, executable):
        wrapper = self.root / name
        wrapper.write_text(
            f"#!{sys.executable}\n"
            "import os\n"
            "import sys\n"
            "import time\n"
            f"executable = {str(executable)!r}\n"
            "if sys.argv[1:] != ['-version']:\n"
            "    time.sleep(30)\n"
            "os.execv(executable, [executable, *sys.argv[1:]])\n",
            encoding="utf-8",
        )
        wrapper.chmod(0o700)
        return wrapper

    def _service_error(self):
        if self.process is None or self.process.poll() is None:
            return "service did not create its socket"
        stderr = self.process.stderr.read().decode("utf-8", "replace") if self.process.stderr else ""
        return f"service exited {self.process.returncode}: {stderr[-1000:]}"


if __name__ == "__main__":
    unittest.main()
