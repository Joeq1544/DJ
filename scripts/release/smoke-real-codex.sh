#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
desktop="$root/app/desktop"
app="$root/out/DJ Copilot-darwin-arm64/DJ Copilot.app"

bash "$root/scripts/release/verify-personal-arm64.sh" "$app"
(
  cd "$desktop"
  DJ_COPILOT_REAL_SMOKE=1 ./node_modules/.bin/playwright test \
    e2e/release-real-codex-smoke.spec.ts
)
