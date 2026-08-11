#!/usr/bin/env bash
set -euo pipefail

app_input="${1:?Pass the DJ Copilot.app path}"
app="$(cd "$app_input" && pwd -P)"
resources="$app/Contents/Resources"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"

test -f "$resources/release/RESOURCE_MANIFEST.json"
test -f "$resources/release/sbom.cdx.json"
test -f "$resources/release/THIRD_PARTY_NOTICES.txt"
test -f "$resources/app/dist/main/main.cjs"
test ! -e "$resources/app/src"
test ! -e "$resources/app/tests"

for executable in \
  "$resources/bin/ffmpeg" \
  "$resources/bin/ffprobe" \
  "$resources/core/dj-copilot-core/dj-copilot-core"; do
  test -x "$executable"
  file "$executable" | grep -F arm64 >/dev/null
done

python3 "$root/scripts/release/release-metadata.py" verify "$resources"
codesign --verify --deep --strict "$app"
du -sh "$app"
echo "Verified personal arm64 app: $app"
