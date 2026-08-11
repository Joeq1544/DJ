#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

required_paths=(
  "app/desktop"
  "core/tests"
  "fixtures/rekordbox/phase0-library.xml"
  "app/desktop/node_modules/.bin/electron"
)

for required_path in "${required_paths[@]}"; do
  if [[ ! -e "$required_path" ]]; then
    echo "M1 verification prerequisite is missing: $required_path" >&2
    exit 1
  fi
done

python3 -B -m unittest discover -s core/tests -v
pnpm --dir app/desktop test
pnpm typecheck
pnpm build
pnpm --dir app/desktop exec playwright test
