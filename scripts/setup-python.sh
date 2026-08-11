#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

ffmpeg_output="$(ffmpeg -version)"
ffmpeg_first_line="${ffmpeg_output%%$'\n'*}"
if [[ "$ffmpeg_first_line" != "ffmpeg version 8.1.2"* ]]; then
  printf 'Expected ffmpeg version 8.1.2, found: %s\n' "$ffmpeg_first_line" >&2
  exit 1
fi

ffprobe_output="$(ffprobe -version)"
ffprobe_first_line="${ffprobe_output%%$'\n'*}"
if [[ "$ffprobe_first_line" != "ffprobe version 8.1.2"* ]]; then
  printf 'Expected ffprobe version 8.1.2, found: %s\n' "$ffprobe_first_line" >&2
  exit 1
fi

python3 -m venv .venv
.venv/bin/python -m pip install -r core/requirements.txt
.venv/bin/python -c 'import numpy; assert numpy.__version__ == "2.4.4", f"expected numpy 2.4.4, found {numpy.__version__}"'
