from __future__ import annotations

import os
import sys
from pathlib import Path

import anyio


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import build_server, serve  # noqa: E402


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(64)
    pid_file = Path(sys.argv[1])
    if not pid_file.is_absolute() or pid_file.exists():
        raise SystemExit(64)
    pid_file.write_text(str(os.getpid()), encoding="utf-8")
    anyio.run(serve, build_server(call_delay_seconds=5))


if __name__ == "__main__":
    main()
