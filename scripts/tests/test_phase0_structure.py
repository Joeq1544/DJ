from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = REPOSITORY_ROOT / "scripts" / "validate_phase0_structure.py"
PHASE0_VERIFIER = REPOSITORY_ROOT / "scripts" / "verify-phase0.sh"


class Phase0StructureValidatorTests(unittest.TestCase):
    def test_phase0_verifier_names_every_required_deterministic_suite(self) -> None:
        """Catches a root gate that silently skips a missing Phase 0 suite."""
        verifier = PHASE0_VERIFIER.read_text(encoding="utf-8")
        required_fragments = (
            "scripts/tests",
            "spikes/process_topology/tests",
            "pnpm --dir spikes/process_topology/typescript_parity test",
            "pnpm --dir spikes/process_topology/typescript_parity typecheck",
            "spikes/rekordbox_xml/tests",
            "spikes/audio_analysis/tests",
            "spikes/embedding_storage/tests",
            "pnpm --dir spikes/codex-mcp test",
            "pnpm --dir spikes/codex-mcp typecheck",
            "spikes/codex-mcp/python_mcp",
            "pnpm --dir spikes/codex-evaluation test",
            "pnpm --dir spikes/codex-evaluation typecheck",
        )

        for fragment in required_fragments:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, verifier)
        self.assertNotIn("SKIP", verifier.upper())

    def test_reports_missing_project_agent_config(self) -> None:
        """Catches a validator that silently accepts a repository with no agent config."""
        with tempfile.TemporaryDirectory() as temporary_directory:
            result = subprocess.run(
                [sys.executable, str(VALIDATOR), "--root", temporary_directory],
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertEqual(1, result.returncode)
        self.assertIn("missing: .codex/config.toml", result.stdout)

    def test_accepts_the_complete_phase0_project_structure(self) -> None:
        """Catches missing required project records or custom-agent profiles."""
        result = subprocess.run(
            [sys.executable, str(VALIDATOR), "--root", str(REPOSITORY_ROOT)],
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn("phase0-structure: ok (documents=23, agents=10, concurrency=4)", result.stdout)

    def test_rejects_agent_without_required_instructions(self) -> None:
        """Catches a profile that Codex cannot load as a complete custom agent."""
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture_root = Path(temporary_directory) / "repository"
            shutil.copytree(REPOSITORY_ROOT, fixture_root, ignore=shutil.ignore_patterns(".git"))
            broken_agent = fixture_root / ".codex" / "agents" / "qa-reviewer.toml"
            broken_agent.write_text(
                'name = "qa-reviewer"\n'
                'description = "Incomplete reviewer fixture."\n'
                'sandbox_mode = "read-only"\n',
                encoding="utf-8",
            )
            result = subprocess.run(
                [sys.executable, str(VALIDATOR), "--root", str(fixture_root)],
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertEqual(1, result.returncode)
        self.assertIn(
            "invalid: .codex/agents/qa-reviewer.toml missing non-empty developer_instructions",
            result.stdout,
        )

    def test_rejects_a_research_agent_with_write_access(self) -> None:
        """Catches accidental write authority on a profile whose role is read-only."""
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture_root = Path(temporary_directory) / "repository"
            shutil.copytree(REPOSITORY_ROOT, fixture_root, ignore=shutil.ignore_patterns(".git"))
            research_agent = fixture_root / ".codex" / "agents" / "repo-researcher.toml"
            research_agent.write_text(
                research_agent.read_text(encoding="utf-8").replace(
                    'sandbox_mode = "read-only"', 'sandbox_mode = "workspace-write"'
                ),
                encoding="utf-8",
            )
            result = subprocess.run(
                [sys.executable, str(VALIDATOR), "--root", str(fixture_root)],
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertEqual(1, result.returncode)
        self.assertIn(
            "invalid: .codex/agents/repo-researcher.toml sandbox_mode must equal read-only",
            result.stdout,
        )

    def test_rejects_a_pinned_custom_agent_model(self) -> None:
        """Catches a stale model pin that prevents parent/default inheritance."""
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture_root = Path(temporary_directory) / "repository"
            shutil.copytree(REPOSITORY_ROOT, fixture_root, ignore=shutil.ignore_patterns(".git"))
            reviewer = fixture_root / ".codex" / "agents" / "security-reviewer.toml"
            reviewer.write_text(
                reviewer.read_text(encoding="utf-8") + '\nmodel = "stale-model-fixture"\n',
                encoding="utf-8",
            )
            result = subprocess.run(
                [sys.executable, str(VALIDATOR), "--root", str(fixture_root)],
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertEqual(1, result.returncode)
        self.assertIn(
            "invalid: .codex/agents/security-reviewer.toml must inherit model and reasoning effort",
            result.stdout,
        )

    @unittest.skipUnless(shutil.which("codex"), "Codex CLI is not installed on PATH")
    def test_installed_codex_cli_loads_the_project_configuration(self) -> None:
        """Catches project configuration keys unsupported by the installed Codex runtime."""
        result = subprocess.run(
            ["codex", "features", "list"],
            cwd=REPOSITORY_ROOT,
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn("multi_agent", result.stdout)

    def test_rejects_missing_mandatory_rekordbox_mir_research_source(self) -> None:
        """Catches a research synthesis that silently drops a mandatory source."""
        required_url = "https://github.com/dylanljones/pyrekordbox"
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture_root = Path(temporary_directory) / "repository"
            shutil.copytree(REPOSITORY_ROOT, fixture_root, ignore=shutil.ignore_patterns(".git"))
            for relative_path in (
                "docs/REPO_RESEARCH.md",
                "docs/evidence/phase-0/research-sources.md",
            ):
                research_path = fixture_root / relative_path
                research_path.write_text(
                    research_path.read_text(encoding="utf-8").replace(required_url, "missing-source"),
                    encoding="utf-8",
                )
            result = subprocess.run(
                [sys.executable, str(VALIDATOR), "--root", str(fixture_root)],
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertEqual(1, result.returncode)
        self.assertIn(f"missing research source: {required_url}", result.stdout)

    def test_rejects_missing_mandatory_codex_mcp_research_source(self) -> None:
        """Catches a Codex/MCP synthesis that omits a source mandated by the product spec."""
        required_url = "https://github.com/openai/codex/tree/main/sdk/python"
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture_root = Path(temporary_directory) / "repository"
            shutil.copytree(REPOSITORY_ROOT, fixture_root, ignore=shutil.ignore_patterns(".git"))
            for relative_path in (
                "docs/REPO_RESEARCH.md",
                "docs/evidence/phase-0/research-sources.md",
            ):
                research_path = fixture_root / relative_path
                research_path.write_text(
                    research_path.read_text(encoding="utf-8").replace(required_url, "missing-source"),
                    encoding="utf-8",
                )
            result = subprocess.run(
                [sys.executable, str(VALIDATOR), "--root", str(fixture_root)],
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertEqual(1, result.returncode)
        self.assertIn(f"missing research source: {required_url}", result.stdout)


if __name__ == "__main__":
    unittest.main()
