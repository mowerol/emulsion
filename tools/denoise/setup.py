#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Download pinned RawNIND + ONNX Runtime for the native experiment (stdlib only)."""
import argparse
import hashlib
import json
import pathlib
import platform
import urllib.request
import zipfile
import tarfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
MODEL_URL = "https://github.com/darktable-org/darktable-ai/releases/download/release-5.6.0/rawdenoise-nind.dtmodel"
MODEL_ARCHIVE_SHA = "d71b5f1e727c85a359e6f74dca9e2016c9d8fc3e2f7ac3e9b347d80ceca969af"
MODEL_SHA = "df957efadcc152c007d5d3b0917bdff9e41c0d4a0efe56584ef30b36393cd181"
RUNTIME_URL = "https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/onnxruntime-osx-arm64-1.23.2.tgz"
RUNTIME_SHA = "b4d513ab2b26f088c66891dbbc1408166708773d7cc4163de7bdca0e9bbb7856"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fetch(url, path, expected):
    if path.is_file() and sha(path) == expected:
        return
    print(f"Downloading {url}", flush=True)
    temporary = path.with_suffix(path.suffix + ".part")
    try:
        urllib.request.urlretrieve(url, temporary)
        if sha(temporary) != expected:
            raise RuntimeError(f"Checksum mismatch: {url}")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", type=pathlib.Path, default=ROOT / "src-tauri/target/denoise/assets")
    args = parser.parse_args()
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        parser.error("This first experiment pins the Apple Silicon runtime. The native probe also accepts a manually supplied runtime.json on other platforms.")
    target = args.assets.resolve()
    target.mkdir(parents=True, exist_ok=True)
    archive = target / "rawdenoise-nind.dtmodel"
    fetch(MODEL_URL, archive, MODEL_ARCHIVE_SHA)
    with zipfile.ZipFile(archive) as package:
        for name in ["config.json", "model_linear.onnx"]:
            content = package.read("rawdenoise-nind/" + name)
            if name.endswith(".onnx") and hashlib.sha256(content).hexdigest() != MODEL_SHA:
                raise RuntimeError("Unexpected linear model")
            (target / name).write_bytes(content)
    fetch(RUNTIME_URL, target / "onnxruntime.tgz", RUNTIME_SHA)
    # Extract regular files only, keeping the original runtime licence/notices.
    with tarfile.open(target / "onnxruntime.tgz") as package:
        for member in package.getmembers():
            if not member.isfile():
                continue
            destination = (target / member.name).resolve()
            if not destination.is_relative_to(target):
                raise RuntimeError("Unsafe runtime archive path")
            destination.parent.mkdir(parents=True, exist_ok=True)
            with package.extractfile(member) as stream:
                destination.write_bytes(stream.read())
    library = "onnxruntime-osx-arm64-1.23.2/lib/libonnxruntime.1.23.2.dylib"
    (target / "runtime.json").write_text(json.dumps({
        "version": "1.23.2", "library": library, "archive_sha256": RUNTIME_SHA,
    }, indent=2) + "\n")
    print(f"Ready: {target}\nModel SHA-256: {MODEL_SHA}")


if __name__ == "__main__":
    main()
