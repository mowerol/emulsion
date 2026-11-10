#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Fetch the pinned LaMa reference and ONNX export for the fidelity experiment."""
import argparse
import hashlib
import pathlib
import subprocess
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_WORK = ROOT / "src-tauri/target/inpaint"
UPSTREAM = "https://github.com/advimman/lama.git"
UPSTREAM_COMMIT = "786f5936b27fb3dacd2b1ad799e4de968ea697e7"
ONNX_REVISION = "c3c0c9e468934d62e79c329e35d82dd09ff8c444"
ONNX_URL = f"https://huggingface.co/Carve/LaMa-ONNX/resolve/{ONNX_REVISION}/lama_fp32.onnx"
ONNX_SHA = "1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6"
REFERENCE_REVISION = "05cb2be7f8dbe6ca7c6e78f4fc827a4b2baaa4a9"
REFERENCE_URL = f"https://huggingface.co/smartywu/big-lama/resolve/{REFERENCE_REVISION}/big-lama.zip"
REFERENCE_SHA = "f1b358ca24093b93a106183b98a3dea6e8ed09f3b43ea7251eb2c81e7b4575f6"


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify(path, expected):
    if sha(path) != expected:
        raise ValueError(f"SHA-256 mismatch: {path}")


def fetch(url, path, expected):
    if path.is_file() and sha(path) == expected:
        return
    temporary = path.with_suffix(path.suffix + ".part")
    print(f"Downloading {url}", flush=True)
    try:
        urllib.request.urlretrieve(url, temporary)
        verify(temporary, expected)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", type=pathlib.Path, default=DEFAULT_WORK)
    args = parser.parse_args()
    work = args.work.resolve()
    assets = work / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    upstream = work / "lama"
    if not upstream.exists():
        subprocess.run(["git", "clone", UPSTREAM, str(upstream)], check=True)
        subprocess.run(["git", "-C", str(upstream), "checkout", "--detach", UPSTREAM_COMMIT], check=True)
    commit = subprocess.check_output(["git", "-C", str(upstream), "rev-parse", "HEAD"], text=True).strip()
    if commit != UPSTREAM_COMMIT:
        raise ValueError(f"Expected reference checkout {UPSTREAM_COMMIT}, got {commit}; use a fresh --work directory")
    fetch(ONNX_URL, assets / "lama_fp32.onnx", ONNX_SHA)
    archive = assets / "big-lama.zip"
    fetch(REFERENCE_URL, archive, REFERENCE_SHA)
    # Extract just the inference files, never arbitrary archive paths or training assets.
    with zipfile.ZipFile(archive) as package:
        for name in ["big-lama/config.yaml", "big-lama/models/best.ckpt"]:
            destination = assets / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            with package.open(name) as source, destination.open("wb") as target:
                import shutil
                shutil.copyfileobj(source, target)
    print(f"Ready: {work}\nReference checkpoint SHA-256: {sha(assets / 'big-lama/models/best.ckpt')}")


if __name__ == "__main__":
    main()
