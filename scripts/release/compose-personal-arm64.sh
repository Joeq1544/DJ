#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
desktop="$root/app/desktop"
stage="$root/.release-work/desktop-stage"
release_parent="$root/out/DJ Copilot-darwin-arm64"
app="$release_parent/DJ Copilot.app"
core="$root/out/release-deps/core/dj-copilot-core"
ffmpeg="$root/out/release-deps/ffmpeg/bin"

[[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] || {
  echo "The personal release requires macOS arm64." >&2
  exit 1
}
test -x "$core/dj-copilot-core"
test -x "$ffmpeg/ffmpeg"
test -x "$ffmpeg/ffprobe"

rm -rf "$stage" "$release_parent"
mkdir -p "$stage"
CI=true pnpm --dir "$desktop" build
CI=true pnpm --filter @dj-copilot/desktop deploy --prod --legacy "$stage"
test -f "$stage/dist/main/main.cjs"
test ! -e "$stage/src"
test ! -e "$stage/tests"

CI=true pnpm --dir "$desktop" exec electron-packager \
  "$stage" \
  "DJ Copilot" \
  --platform=darwin \
  --arch=arm64 \
  --electron-version=43.3.0 \
  --app-bundle-id=com.joe.dj-copilot \
  --out="$root/out" \
  --overwrite \
  --asar=false \
  --prune=false

resources="$app/Contents/Resources"
test -d "$resources/app"
mkdir -p "$resources/core" "$resources/bin" "$resources/release"
cp -R "$core" "$resources/core/dj-copilot-core"
install -m 0755 "$ffmpeg/ffmpeg" "$ffmpeg/ffprobe" "$resources/bin/"

for executable in \
  "$resources/bin/ffmpeg" \
  "$resources/bin/ffprobe" \
  "$resources/core/dj-copilot-core/dj-copilot-core"; do
  file "$executable" | grep -F arm64 >/dev/null
done

python3 "$root/scripts/release/release-metadata.py" validate "$resources"

# Re-sign every nested Mach-O after copying npm/Python/FFmpeg resources. The
# second outer-only signature incorporates the generated release metadata.
codesign --force --deep --sign - "$app"
python3 "$root/scripts/release/release-metadata.py" generate "$resources"
codesign --force --sign - "$app"

bash "$root/scripts/release/verify-personal-arm64.sh" "$app"
echo "Packaged personal app: $app"
