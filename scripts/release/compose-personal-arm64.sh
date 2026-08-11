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
(
  cd "$desktop"
  node scripts/build-main.mjs
  "$desktop/node_modules/.bin/vite" build
)
CI=true pnpm --filter @dj-copilot/desktop deploy --prod --legacy "$stage"
test -f "$stage/dist/main/main.cjs"
test ! -e "$stage/src"
test ! -e "$stage/tests"

# Legacy deploy is isolated from the workspace install, but pnpm can leave
# hoisted links for packages omitted by --prod. Remove only dangling links in
# the generated virtual-store index; all required runtime packages are checked
# immediately below and again from the final app bundle.
find -L "$stage/node_modules/.pnpm/node_modules" -type l -print0 |
  while IFS= read -r -d '' dangling_link; do
    rm -- "$dangling_link"
  done
workspace_self_link="$stage/node_modules/.pnpm/node_modules/@dj-copilot/desktop"
if [[ -L "$workspace_self_link" ]]; then
  rm -- "$workspace_self_link"
fi
if find -L "$stage" -type l -print -quit | grep -q .; then
  echo "The production staging tree contains a dangling symlink." >&2
  find -L "$stage" -type l -print >&2
  exit 1
fi
for package_metadata in \
  "$stage/node_modules/@openai/codex-sdk/package.json" \
  "$stage/node_modules/.pnpm/node_modules/@openai/codex/package.json" \
  "$stage/node_modules/.pnpm/node_modules/@openai/codex-darwin-arm64/package.json"; do
  test -f "$package_metadata"
done

"$desktop/node_modules/.bin/electron-packager" \
  "$stage" \
  "DJ Copilot" \
  --platform=darwin \
  --arch=arm64 \
  --electron-version=43.3.0 \
  --app-bundle-id=com.joe.dj-copilot \
  --out="$root/out" \
  --overwrite \
  --no-asar \
  --no-deref-symlinks \
  --no-prune

resources="$app/Contents/Resources"
test -d "$resources/app"
python3 "$root/scripts/release/release-metadata.py" normalize-symlinks \
  "$resources/app" \
  "$stage"
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
