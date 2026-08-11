from __future__ import annotations

import plistlib
import subprocess
import tempfile
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
COLLECTOR = REPOSITORY_ROOT / "scripts" / "collect-phase0-environment.sh"


class EnvironmentCollectorTests(unittest.TestCase):
    def test_writes_redacted_report_when_optional_tools_are_unavailable(self) -> None:
        """Catches a collector that fails closed over absent optional runtimes or leaks home paths."""
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_path = Path(temporary_directory) / "environment.md"
            environment = {
                "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
                "TMPDIR": temporary_directory,
            }
            result = subprocess.run(
                ["/bin/sh", str(COLLECTOR), str(output_path)],
                cwd=REPOSITORY_ROOT,
                env=environment,
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            report = output_path.read_text(encoding="utf-8")

        self.assertIn("## Host", report)
        self.assertIn("## Toolchain", report)
        self.assertIn("## Local applications", report)
        self.assertIn("Codex authentication", report)
        self.assertNotIn(str(Path.home()), report)
        for sensitive_name in ("OPENAI_API_KEY", "CODEX_HOME", "HOME="):
            self.assertNotIn(sensitive_name, report)

    def test_extracts_versions_without_recording_startup_warnings_or_app_paths(self) -> None:
        """Catches first-line parsing and Spotlight metadata failures seen on the Phase 0 host."""
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            fake_bin = temporary_root / "bin"
            fake_bin.mkdir()
            fake_codex = fake_bin / "codex"
            fake_codex.write_text(
                "#!/bin/sh\n"
                'if [ "$1" = "--version" ]; then\n'
                '  echo "WARNING: alias setup denied" >&2\n'
                '  echo "codex-cli 9.9.9"\n'
                "  exit 0\n"
                "fi\n"
                'if [ "$1" = "login" ] && [ "$2" = "status" ]; then exit 0; fi\n'
                "exit 2\n",
                encoding="utf-8",
            )
            fake_codex.chmod(0o755)

            fake_rekordbox = temporary_root / "rekordbox.app"
            contents = fake_rekordbox / "Contents"
            contents.mkdir(parents=True)
            with (contents / "Info.plist").open("wb") as plist_file:
                plistlib.dump({"CFBundleShortVersionString": "7.8.9"}, plist_file)

            output_path = temporary_root / "environment.md"
            environment = {
                "PATH": f"{fake_bin}:/usr/bin:/bin:/usr/sbin:/sbin",
                "TMPDIR": temporary_directory,
            }
            result = subprocess.run(
                ["/bin/sh", str(COLLECTOR), str(output_path), str(fake_rekordbox)],
                cwd=REPOSITORY_ROOT,
                env=environment,
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            report = output_path.read_text(encoding="utf-8")

        self.assertIn("- Codex CLI: codex-cli 9.9.9", report)
        self.assertIn("- Codex authentication: existing login status is available", report)
        self.assertIn("- Rekordbox: 7.8.9", report)
        self.assertNotIn("WARNING:", report)
        self.assertNotIn(str(fake_rekordbox), report)


if __name__ == "__main__":
    unittest.main()
