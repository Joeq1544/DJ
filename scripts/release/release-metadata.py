#!/usr/bin/env python3
"""Validate and inventory the fixed personal-release resource tree."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sys
from typing import Any


EXPECTED_NPM = {
    ("@openai/codex", "0.147.0"),
    ("@openai/codex", "0.147.0-darwin-arm64"),
    ("@openai/codex-sdk", "0.147.0"),
}
PRIVACY_NOTICE = (
    "Release metadata contains dependency names, versions, licenses, and resource hashes only; "
    "it contains no audio, library metadata, notes, credentials, paths, logs, or Codex response text."
)


def _json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected an object in {path.name}")
    return value


def _within(root: Path, candidate: Path) -> bool:
    try:
        candidate.resolve(strict=True).relative_to(root.resolve(strict=True))
        return True
    except (FileNotFoundError, ValueError):
        return False


def _walk_resources(resources: Path) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    files: list[dict[str, str]] = []
    links: list[dict[str, str]] = []
    for current, directories, names in os.walk(resources, followlinks=False):
        current_path = Path(current)
        for name in list(directories):
            path = current_path / name
            if path.is_symlink():
                if not _within(resources, path):
                    raise ValueError(f"Escaping resource symlink: {path.relative_to(resources)}")
                links.append({"path": path.relative_to(resources).as_posix(), "target": os.readlink(path)})
                directories.remove(name)
        for name in names:
            path = current_path / name
            relative = path.relative_to(resources).as_posix()
            if relative == "release/RESOURCE_MANIFEST.json":
                continue
            if path.is_symlink():
                if not _within(resources, path):
                    raise ValueError(f"Escaping resource symlink: {relative}")
                links.append({"path": relative, "target": os.readlink(path)})
            elif path.is_file():
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                files.append({"path": relative, "sha256": digest})
            else:
                raise ValueError(f"Unsupported resource entry: {relative}")
    return sorted(files, key=lambda item: item["path"]), sorted(links, key=lambda item: item["path"])


def _npm_components(resources: Path) -> list[dict[str, str]]:
    components: dict[tuple[str, str], dict[str, str]] = {}
    node_modules = resources / "app" / "node_modules"
    for package_path in node_modules.rglob("package.json"):
        try:
            package = _json(package_path)
        except (OSError, ValueError, json.JSONDecodeError):
            continue
        name = package.get("name")
        version = package.get("version")
        if not isinstance(name, str) or not isinstance(version, str):
            continue
        license_value = package.get("license", "NOASSERTION")
        license_name = license_value if isinstance(license_value, str) else "NOASSERTION"
        components[(name, version)] = {
            "type": "library",
            "name": name,
            "version": version,
            "license": license_name,
            "purl": f"pkg:npm/{name.replace('@', '%40')}@{version}",
        }
    return [components[key] for key in sorted(components)]


def normalize_symlinks(application_root: Path, source_root: Path) -> None:
    """Rewrite Packager's staging-path links as internal relative app links."""
    application_root = application_root.resolve(strict=True)
    source_root = source_root.resolve(strict=True)
    for path in sorted(application_root.rglob("*")):
        if not path.is_symlink():
            continue
        target = Path(os.readlink(path))
        candidate = target if target.is_absolute() else path.parent / target
        canonical = candidate.resolve(strict=True)
        try:
            relative_target = canonical.relative_to(source_root)
            packaged_target = application_root / relative_target
        except ValueError:
            if not _within(application_root, canonical):
                raise ValueError(f"Escaping packaged application symlink: {path.relative_to(application_root)}")
            packaged_target = canonical
        packaged_target.resolve(strict=True).relative_to(application_root)
        replacement = os.path.relpath(packaged_target, path.parent)
        path.unlink()
        path.symlink_to(replacement, target_is_directory=packaged_target.is_dir())


def validate(resources: Path) -> None:
    resources = resources.resolve(strict=True)
    expected = [
        resources / "app" / "dist" / "main" / "main.cjs",
        resources / "app" / "dist" / "preload" / "index.cjs",
        resources / "app" / "dist" / "renderer" / "index.html",
        resources / "core" / "dj-copilot-core" / "dj-copilot-core",
        resources / "bin" / "ffmpeg",
        resources / "bin" / "ffprobe",
    ]
    for path in expected:
        if not path.is_file():
            raise ValueError(f"Missing packaged resource: {path.relative_to(resources)}")
    _walk_resources(resources)

    application_root = resources / "app"
    sdk_root = (application_root / "node_modules" / "@openai" / "codex-sdk").resolve(strict=True)
    helper_root = (sdk_root.parent / "codex").resolve(strict=True)
    native_root = (helper_root.parent / "codex-darwin-arm64").resolve(strict=True)
    for root in (sdk_root, helper_root, native_root):
        if not _within(application_root, root):
            raise ValueError("Packaged Codex resolves outside the application")
    exact_codex_packages = (
        (_json(sdk_root / "package.json"), "@openai/codex-sdk", "0.147.0"),
        (_json(helper_root / "package.json"), "@openai/codex", "0.147.0"),
        (_json(native_root / "package.json"), "@openai/codex", "0.147.0-darwin-arm64"),
    )
    for package, name, version in exact_codex_packages:
        if package.get("name") != name or package.get("version") != version:
            raise ValueError(f"Expected packaged runtime {name} {version}")
    if not (native_root / "vendor" / "aarch64-apple-darwin" / "bin" / "codex").is_file():
        raise ValueError("Missing packaged arm64 Codex executable")

    components = _npm_components(resources)
    versions = {(component["name"], component["version"]) for component in components}
    missing = sorted(EXPECTED_NPM - versions)
    if missing:
        expected = ", ".join(f"{name} {version}" for name, version in missing)
        raise ValueError(f"Missing packaged npm component: {expected}")


def generate(resources: Path) -> None:
    validate(resources)
    release = resources / "release"
    release.mkdir(mode=0o755, parents=True, exist_ok=True)
    npm_components = _npm_components(resources)
    fixed = [
        {"type": "application", "name": "Electron", "version": "43.3.0", "license": "MIT", "purl": "pkg:npm/electron@43.3.0"},
        {"type": "application", "name": "CPython", "version": "3.14.3", "license": "PSF-2.0", "purl": "pkg:generic/cpython@3.14.3"},
        {"type": "library", "name": "NumPy", "version": "2.4.4", "license": "BSD-3-Clause", "purl": "pkg:pypi/numpy@2.4.4"},
        {"type": "application", "name": "PyInstaller", "version": "6.21.0", "license": "GPL-2.0-or-later WITH Bootloader-exception", "purl": "pkg:pypi/pyinstaller@6.21.0"},
        {"type": "application", "name": "FFmpeg", "version": "8.1.2", "license": "LGPL-2.1-or-later", "purl": "pkg:generic/ffmpeg@8.1.2"},
    ]
    components = sorted(npm_components + fixed, key=lambda item: (item["name"], item["version"]))
    sbom = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "version": 1,
        "metadata": {"component": {"type": "application", "name": "DJ Copilot", "version": "0.1.0"}},
        "components": [
            {
                "type": component["type"],
                "name": component["name"],
                "version": component["version"],
                "licenses": [{"license": {"name": component["license"]}}],
                "purl": component["purl"],
            }
            for component in components
        ],
    }
    (release / "sbom.cdx.json").write_text(json.dumps(sbom, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    notices = ["DJ Copilot personal arm64 third-party inventory", "", PRIVACY_NOTICE, ""]
    notices.extend(f"- {item['name']} {item['version']} — {item['license']}" for item in components)
    notices.extend(["", "FFmpeg was configured with GPL and nonfree components disabled.", "PyInstaller's bootloader exception permits distribution of the generated executable.", ""])
    (release / "THIRD_PARTY_NOTICES.txt").write_text("\n".join(notices), encoding="utf-8")
    files, links = _walk_resources(resources)
    manifest = {"schemaVersion": 1, "privacy": PRIVACY_NOTICE, "files": files, "symlinks": links}
    (release / "RESOURCE_MANIFEST.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def verify(resources: Path) -> None:
    validate(resources)
    manifest = _json(resources / "release" / "RESOURCE_MANIFEST.json")
    expected_files, expected_links = _walk_resources(resources)
    if manifest != {
        "schemaVersion": 1,
        "privacy": PRIVACY_NOTICE,
        "files": expected_files,
        "symlinks": expected_links,
    }:
        raise ValueError("Packaged resource manifest does not match the application")
    sbom = _json(resources / "release" / "sbom.cdx.json")
    if sbom.get("bomFormat") != "CycloneDX" or sbom.get("specVersion") != "1.6":
        raise ValueError("Invalid packaged CycloneDX inventory")


def main() -> int:
    if len(sys.argv) == 4 and sys.argv[1] == "normalize-symlinks":
        normalize_symlinks(Path(sys.argv[2]), Path(sys.argv[3]))
        return 0
    if len(sys.argv) != 3 or sys.argv[1] not in {"validate", "generate", "verify"}:
        print(
            "usage: release-metadata.py validate|generate|verify RESOURCES\n"
            "       release-metadata.py normalize-symlinks APPLICATION_ROOT SOURCE_ROOT",
            file=sys.stderr,
        )
        return 2
    resources = Path(sys.argv[2])
    {"validate": validate, "generate": generate, "verify": verify}[sys.argv[1]](resources)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
