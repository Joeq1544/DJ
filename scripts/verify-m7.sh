#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
desktop="$root/app/desktop"
app="$root/out/DJ Copilot-darwin-arm64/DJ Copilot.app"

python3 -B -m unittest discover -s "$root/core/tests" -v

(
  cd "$desktop"
  ./node_modules/.bin/vitest run
  ./node_modules/.bin/tsc --noEmit
  node scripts/build-main.mjs
  ./node_modules/.bin/vite build
  for spec in \
    e2e/analysis-flow.spec.ts \
    e2e/assistant-flow.spec.ts \
    e2e/discovery-flow.spec.ts \
    e2e/library-flow.spec.ts \
    e2e/personalization-flow.spec.ts \
    e2e/release-flow.spec.ts \
    e2e/release-missing-helper.spec.ts \
    e2e/set-flow.spec.ts; do
    ./node_modules/.bin/playwright test "$spec"
  done
)

bash "$root/scripts/release/verify-personal-arm64.sh" "$app"

echo "M7 nonvisual verification passed."
