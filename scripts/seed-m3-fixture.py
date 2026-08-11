#!/usr/bin/env python3
"""Seed generated M3 feature evidence into an already imported temporary test database."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "core"))

from dj_copilot.analysis.provider import AnalysisFeatures  # noqa: E402
from dj_copilot.database import LibraryDatabase  # noqa: E402


def seed_fixture(database_path: Path, fixture_path: Path) -> tuple[int, int]:
    if not database_path.is_file():
        raise ValueError("The M3 test database does not exist.")
    document = json.loads(fixture_path.read_text(encoding="utf-8"))
    if not isinstance(document, dict) or document.get("schema_version") != 1:
        raise ValueError("The M3 discovery fixture has an unsupported schema.")
    tracks = document.get("tracks")
    if not isinstance(tracks, list) or not 1 <= len(tracks) <= 20:
        raise ValueError("The M3 discovery fixture track set is invalid.")

    database = LibraryDatabase(database_path)
    seeded = 0
    failed = 0
    try:
        stored_by_external_id = {
            track.external_id: track for track in database.list_tracks(limit=200).items
        }
        fixture_external_ids = {track.get("external_id") for track in tracks if isinstance(track, dict)}
        if fixture_external_ids != set(stored_by_external_id):
            raise ValueError("The imported M3 library does not match the discovery fixture.")
        for track_payload in tracks:
            if not isinstance(track_payload, dict):
                raise ValueError("The M3 discovery fixture contains an invalid track.")
            stored = stored_by_external_id[track_payload["external_id"]]
            analysis = track_payload.get("analysis")
            if analysis is None:
                continue
            if not isinstance(analysis, dict):
                raise ValueError("The M3 discovery fixture contains invalid analysis evidence.")
            features_payload = analysis.get("features")
            features = None
            if features_payload is not None:
                if not isinstance(features_payload, dict):
                    raise ValueError("The M3 discovery fixture contains invalid local features.")
                normalized = dict(features_payload)
                normalized["tempo_candidates_milli"] = tuple(normalized["tempo_candidates_milli"])
                normalized["energy_curve_ppm"] = tuple(normalized["energy_curve_ppm"])
                normalized["limitations"] = tuple(normalized["limitations"])
                features = AnalysisFeatures(**normalized)
            status = analysis.get("status")
            if status not in {"succeeded", "failed"}:
                raise ValueError("The M3 discovery fixture contains an unsupported job state.")
            provider = features.provider if features is not None else "ffmpeg-numpy-basic"
            provider_version = (
                features.provider_version
                if features is not None
                else "ffmpeg 8.1.2; ffprobe 8.1.2; numpy 2.4.4"
            )
            pipeline_version = features.pipeline_version if features is not None else "baseline-v1"
            database.put_analysis_job(
                stored.id,
                status=status,
                progress_ppm=analysis["progress_ppm"],
                attempt_count=analysis["attempt_count"],
                error_code=analysis["error_code"],
                error_message=analysis["error_message"],
                fingerprint=features.fingerprint if features is not None else None,
                provider=provider,
                provider_version=provider_version,
                pipeline_version=pipeline_version,
            )
            if features is not None:
                database.put_track_features(stored.id, features)
                seeded += 1
            if status == "failed":
                failed += 1
    finally:
        database.close()
    return seeded, failed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--fixture", required=True, type=Path)
    arguments = parser.parse_args()
    seeded, failed = seed_fixture(arguments.database, arguments.fixture)
    print(f"Seeded M3 discovery fixture: {seeded} analyzed, {failed} failed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
