#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

bash -n scripts/setup-python.sh scripts/verify-m1.sh scripts/verify-m2.sh scripts/verify-m3.sh

forbidden_tracked="$(git ls-files '*.aiff' '*.db' '*.flac' '*.log' '*.mp3' '*.pyc' '*.sqlite' '*.sqlite3' '*.wav')"
if [[ -n "$forbidden_tracked" ]]; then
  printf 'Forbidden generated or personal files are tracked:\n%s\n' "$forbidden_tracked" >&2
  exit 1
fi

while IFS= read -r tracked_xml; do
  if [[ "$tracked_xml" != "fixtures/rekordbox/phase0-library.xml" ]]; then
    printf 'Unapproved XML fixture is tracked: %s\n' "$tracked_xml" >&2
    exit 1
  fi
done < <(git ls-files '*.xml')

python_executable="${repository_root}/.venv/bin/python"
if [[ ! -x "$python_executable" ]]; then
  python_executable="python3"
fi

"$python_executable" -c 'import numpy; assert numpy.__version__ == "2.4.4", f"expected numpy 2.4.4, found {numpy.__version__}"'

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

"$python_executable" -B -m unittest discover -s core/tests -v
pnpm --dir app/desktop test
pnpm typecheck
pnpm build
pnpm --dir app/desktop exec playwright test
git diff --check
