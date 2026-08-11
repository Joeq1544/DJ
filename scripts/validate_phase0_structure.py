from __future__ import annotations

import argparse
import tomllib
from pathlib import Path


REQUIRED_DOCUMENTS = (
    "AGENTS.md",
    "TASKS.md",
    "DECISIONS.md",
    "KNOWN_ISSUES.md",
    "CHANGELOG.md",
    "docs/PRODUCT_SPEC.md",
    "docs/PHASE_PLAN.md",
    "docs/ARCHITECTURE.md",
    "docs/REPO_RESEARCH.md",
    "docs/TEST_STRATEGY.md",
    "docs/THREAT_MODEL.md",
    "docs/LICENSING.md",
    "docs/EVALUATION.md",
    "docs/RECOVERY.md",
    "docs/USER_GUIDE.md",
    "docs/PRIVACY.md",
    "docs/adr/0001-desktop-framework-and-runtime-boundary.md",
    "docs/adr/0002-codex-sdk-language.md",
    "docs/adr/0003-local-process-protocol.md",
    "docs/adr/0004-rekordbox-integration-boundary.md",
    "docs/adr/0005-audio-analysis-and-licenses.md",
    "docs/adr/0006-embedding-storage-and-search.md",
    "docs/adr/0007-packaging-strategy.md",
)

REQUIRED_AGENTS = {
    "repo-researcher": "read-only",
    "architect": "read-only",
    "rekordbox-specialist": "workspace-write",
    "audio-mir-specialist": "workspace-write",
    "ranking-specialist": "workspace-write",
    "codex-mcp-specialist": "workspace-write",
    "mac-ui-specialist": "workspace-write",
    "qa-reviewer": "read-only",
    "security-reviewer": "read-only",
    "release-reviewer": "read-only",
}

REQUIRED_REKORDBOX_MIR_SOURCES = (
    "https://rekordbox.com/en/support/developer/",
    "https://github.com/dylanljones/pyrekordbox",
    "https://github.com/mir-aidj/all-in-one",
    "https://github.com/ssmall256/all-in-one-mlx",
    "https://github.com/MTG/essentia",
    "https://essentia.upf.edu/models.html",
    "https://github.com/WB2024/Essentia-to-Metadata",
    "https://github.com/LAION-AI/CLAP",
    "https://github.com/qiuqiangkong/panns_inference",
    "https://github.com/perminder-klair/subwave",
    "https://github.com/kckDeepak/AI-DJ-Mixing-System",
    "https://github.com/Marekkon5/onetagger",
    "https://github.com/mir-aidj",
)

REQUIRED_CODEX_MCP_SOURCES = (
    "https://developers.openai.com/codex/sdk/",
    "https://github.com/openai/codex/tree/main/sdk/typescript",
    "https://github.com/openai/codex/tree/main/sdk/python",
    "https://developers.openai.com/codex/subagents/",
    "https://developers.openai.com/codex/mcp/",
    "https://developers.openai.com/codex/guides/agents-md/",
    "https://developers.openai.com/codex/workflows/",
    "https://github.com/modelcontextprotocol/python-sdk",
)


def load_toml(path: Path) -> dict[str, object]:
    with path.open("rb") as configuration_file:
        return tomllib.load(configuration_file)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate DJ Copilot Phase 0 structure.")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    arguments = parser.parse_args()

    root = arguments.root.resolve()
    config_path = root / ".codex" / "config.toml"
    if not config_path.is_file():
        print("missing: .codex/config.toml")
        return 1

    errors = [f"missing: {path}" for path in REQUIRED_DOCUMENTS if not (root / path).is_file()]

    try:
        project_config = load_toml(config_path)
    except (OSError, tomllib.TOMLDecodeError) as error:
        errors.append(f"invalid: .codex/config.toml: {error}")
        project_config = {}

    agents_config = project_config.get("agents")
    concurrency = agents_config.get("max_threads") if isinstance(agents_config, dict) else None
    if concurrency != 4:
        errors.append("invalid: agents.max_threads must equal 4 for the installed Codex CLI")

    discovered_agents: dict[str, tuple[Path, dict[str, object]]] = {}
    for agent_path in sorted((root / ".codex" / "agents").glob("*.toml")):
        try:
            agent_config = load_toml(agent_path)
        except (OSError, tomllib.TOMLDecodeError) as error:
            errors.append(f"invalid: {agent_path.relative_to(root)}: {error}")
            continue
        name = agent_config.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        discovered_agents[name] = (agent_path, agent_config)

    for name in REQUIRED_AGENTS:
        if name not in discovered_agents:
            errors.append(f"missing: custom agent {name}")
            continue
        path, agent_config = discovered_agents[name]
        for key in ("description", "developer_instructions"):
            value = agent_config.get(key)
            if not isinstance(value, str) or not value.strip():
                errors.append(f"invalid: {path.relative_to(root)} missing non-empty {key}")
        expected_sandbox = REQUIRED_AGENTS[name]
        if agent_config.get("sandbox_mode") != expected_sandbox:
            errors.append(
                f"invalid: {path.relative_to(root)} sandbox_mode must equal {expected_sandbox}"
            )
        if "model" in agent_config or "model_reasoning_effort" in agent_config:
            errors.append(f"invalid: {path.relative_to(root)} must inherit model and reasoning effort")

    research_text = "\n".join(
        (root / relative_path).read_text(encoding="utf-8")
        for relative_path in (
            "docs/REPO_RESEARCH.md",
            "docs/evidence/phase-0/research-sources.md",
        )
        if (root / relative_path).is_file()
    ).lower()
    for source_url in REQUIRED_CODEX_MCP_SOURCES + REQUIRED_REKORDBOX_MIR_SOURCES:
        if source_url.lower() not in research_text:
            errors.append(f"missing research source: {source_url}")

    if errors:
        for error in errors:
            print(error)
        return 1

    print(
        "phase0-structure: ok "
        f"(documents={len(REQUIRED_DOCUMENTS)}, agents={len(REQUIRED_AGENTS)}, concurrency={concurrency})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
