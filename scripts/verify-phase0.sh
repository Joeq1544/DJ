#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"

require_file() {
  if [ ! -f "$1" ]; then
    echo "phase0-verification: missing required file: $1" >&2
    exit 1
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "phase0-verification: missing required command: $1" >&2
    exit 1
  fi
}

require_command python3
require_command pnpm

require_file scripts/validate_phase0_structure.py
require_file spikes/process_topology/tests/test_topology.py
require_file spikes/process_topology/typescript_parity/package.json
require_file spikes/rekordbox_xml/tests/test_parser.py
require_file spikes/audio_analysis/tests/test_analyze.py
require_file spikes/embedding_storage/tests/test_embedding_storage.py
require_file spikes/codex-mcp/package.json
require_file spikes/codex-mcp/python_mcp/requirements.lock
require_file spikes/codex-mcp/python_mcp/.venv/bin/python
require_file spikes/codex-evaluation/package.json

python3 -B -m unittest discover -s scripts/tests -v
python3 -B -W error::ResourceWarning -m unittest discover -s spikes/process_topology/tests -v
pnpm --dir spikes/process_topology/typescript_parity test
pnpm --dir spikes/process_topology/typescript_parity typecheck
python3 -B -m unittest discover -s spikes/rekordbox_xml/tests -v
python3 -B -m unittest discover -s spikes/audio_analysis/tests -v
python3 -B -W error::ResourceWarning -m unittest discover -s spikes/embedding_storage/tests -v
pnpm --dir spikes/codex-mcp test
pnpm --dir spikes/codex-mcp typecheck
spikes/codex-mcp/python_mcp/.venv/bin/python -B -W error::ResourceWarning -m unittest discover -s spikes/codex-mcp/python_mcp/tests -v
pnpm --dir spikes/codex-evaluation test
pnpm --dir spikes/codex-evaluation typecheck

echo "phase0-verification: deterministic suites passed"
