#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
version="8.1.2"
sha256="464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c"
downloads="$root/.release-work/downloads"
work="$root/.release-work/ffmpeg-$version"
prefix="$root/out/release-deps/ffmpeg"
archive="$downloads/ffmpeg-$version.tar.xz"
source_dir="$work/ffmpeg-$version"

[[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] || {
  echo "The personal FFmpeg release requires macOS arm64." >&2
  exit 1
}

mkdir -p "$downloads"
if [[ ! -f "$archive" ]]; then
  curl -4 --http1.1 --fail --location --proto '=https' --tlsv1.2 \
    --retry 5 --retry-all-errors --connect-timeout 30 \
    --output "$archive" "https://www.ffmpeg.org/releases/ffmpeg-$version.tar.xz"
fi
[[ "$(shasum -a 256 "$archive" | awk '{print $1}')" == "$sha256" ]] || {
  echo "FFmpeg source checksum mismatch." >&2
  exit 1
}

rm -rf "$work" "$prefix"
mkdir -p "$work" "$prefix"
tar -C "$work" -xf "$archive"
cd "$source_dir"
./configure \
  --prefix="$prefix" \
  --arch=arm64 \
  --target-os=darwin \
  --cc=clang \
  --disable-gpl \
  --disable-nonfree \
  --disable-network \
  --disable-devices \
  --disable-doc \
  --disable-debug \
  --disable-ffplay \
  --disable-shared \
  --enable-static \
  --disable-autodetect \
  --enable-ffmpeg \
  --enable-ffprobe
make -j"$(sysctl -n hw.ncpu)"
mkdir -p "$prefix/bin"
install -m 0755 ffmpeg ffprobe "$prefix/bin/"

for name in ffmpeg ffprobe; do
  executable="$prefix/bin/$name"
  test -x "$executable"
  file "$executable" | grep -F "arm64" >/dev/null
  first_line="$("$executable" -version | sed -n '1p')"
  [[ "$first_line" =~ ^${name}[[:space:]]version[[:space:]]8\.1\.2([[:space:]]|$) ]] || {
    echo "Unexpected $name version: $first_line" >&2
    exit 1
  }
  while IFS= read -r dependency; do
    dependency="${dependency%% (*}"
    dependency="${dependency#${dependency%%[![:space:]]*}}"
    [[ -z "$dependency" || "$dependency" == "$executable:" ]] && continue
    case "$dependency" in
      /System/Library/*|/usr/lib/*) ;;
      *) echo "Non-system $name dependency: $dependency" >&2; exit 1 ;;
    esac
  done < <(otool -L "$executable")
done

rm -rf "$work"
echo "Built self-contained LGPL FFmpeg tools: $prefix/bin"
