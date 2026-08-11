#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
python="${DJ_COPILOT_RELEASE_PYTHON:-python3}"
work="$root/.release-work/core"
dist="$root/out/release-deps/core"
venv="$work/venv"

[[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] || {
  echo "The personal core release requires macOS arm64." >&2
  exit 1
}

"$python" -c 'import platform, sys; assert sys.version_info[:3] == (3, 14, 3); assert platform.machine() == "arm64"'
rm -rf "$work" "$dist"
mkdir -p "$work" "$dist"
"$python" -m venv "$venv"
"$venv/bin/python" -m pip install --only-binary=:all: --require-hashes -r "$root/core/requirements-release.txt"
"$venv/bin/python" -c 'import numpy, PyInstaller; assert numpy.__version__ == "2.4.4"; assert PyInstaller.__version__ == "6.21.0"'

PYTHONPATH="$root/core" "$venv/bin/pyinstaller" \
  --noconfirm \
  --clean \
  --onedir \
  --noupx \
  --target-arch arm64 \
  --name dj-copilot-core \
  --distpath "$dist" \
  --workpath "$work/build" \
  --specpath "$work" \
  --paths "$root/core" \
  "$root/core/dj_copilot_core.py"

executable="$dist/dj-copilot-core/dj-copilot-core"
test -x "$executable"
file "$executable" | grep -F "arm64" >/dev/null
"$executable" --help | grep -F -- "--socket" >/dev/null
rm -rf "$work"
echo "Built self-contained core: $dist/dj-copilot-core"
