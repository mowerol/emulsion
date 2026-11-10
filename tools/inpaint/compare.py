#!/usr/bin/env python3
# Copyright [2021] Samsung Research
# Inference adapter follows saicinpainting/training/trainers/default.py at
# advimman/lama commit 786f5936b27fb3dacd2b1ad799e4de968ea697e7 (Apache-2.0).
# The original generator is imported unchanged; only its inference wrapper is repeated here.
# SPDX-License-Identifier: GPL-3.0-or-later
"""Compare Carve's FP32 ONNX export with unmodified upstream PyTorch big-lama."""
import argparse
import html
import importlib.metadata
import json
import pathlib
import platform
import subprocess
import sys
import time
import zipfile

import numpy as np
from PIL import Image

from setup import DEFAULT_WORK, ONNX_SHA, ONNX_URL, REFERENCE_SHA, REFERENCE_URL, UPSTREAM_COMMIT, sha, verify

SIZE = 512


def checked_output(output):
    output = np.asarray(output)
    if output.shape != (1, 3, SIZE, SIZE) or not np.isfinite(output).all():
        raise ValueError(f"Invalid model output: {output.shape}; expected finite NCHW RGB")
    return output


def differences(reference, actual, mask):
    delta = np.abs(checked_output(reference) - checked_output(actual))
    selected = delta[0, :, mask[0, 0] > 0]
    if not selected.size:
        raise ValueError("The comparison mask must select pixels")

    def stats(values):
        return {"p50": float(np.percentile(values, 50)), "p99": float(np.percentile(values, 99)), "max": float(values.max())}

    # Mask-only numbers prevent unchanged context from hiding a wrong generated fill.
    return {"whole": stats(delta), "masked": stats(selected)}


def load_reference(work, threads):
    import torch
    from omegaconf import OmegaConf

    upstream = work / "lama"
    commit = subprocess.check_output(["git", "-C", str(upstream), "rev-parse", "HEAD"], text=True).strip()
    if commit != UPSTREAM_COMMIT:
        raise ValueError(f"Wrong reference commit: {commit}")
    subprocess.run(["git", "-C", str(upstream), "diff", "--exit-code", "HEAD", "--", "saicinpainting"], check=True)
    archive = work / "assets/big-lama.zip"
    verify(archive, REFERENCE_SHA)
    # Verify extracted bytes too; the hash of a nearby archive does not verify the loaded model.
    with zipfile.ZipFile(archive) as package:
        for name in ["big-lama/config.yaml", "big-lama/models/best.ckpt"]:
            import hashlib
            with package.open(name) as source:
                expected = hashlib.file_digest(source, "sha256").hexdigest()
            verify(work / "assets" / name, expected)
    sys.path.insert(0, str(upstream))
    from saicinpainting.training.modules.ffc import FFCResNetGenerator

    torch.set_num_threads(threads)
    config = OmegaConf.load(work / "assets/big-lama/config.yaml")
    generator_config = OmegaConf.to_container(config.generator, resolve=True)
    if generator_config.pop("kind") != "ffc_resnet" or not config.training_model.concat_mask:
        raise ValueError("Unexpected big-lama inference configuration")
    # Use the original generator, including torch.fft. No export Fourier replacement.
    model = FFCResNetGenerator(**generator_config)
    # This old Lightning checkpoint also pickles training metadata. Its exact bytes were
    # checked against the pinned archive above before enabling the legacy loader.
    checkpoint = torch.load(work / "assets/big-lama/models/best.ckpt", map_location="cpu", weights_only=False)
    state = {k.removeprefix("generator."): v for k, v in checkpoint["state_dict"].items() if k.startswith("generator.")}
    model.load_state_dict(state, strict=True)
    model.eval().requires_grad_(False)

    def run(image, mask):
        with torch.inference_mode():
            rgb, selection = torch.from_numpy(image), torch.from_numpy(mask)
            # DefaultInpaintingTrainingModule.forward, without training-only dependencies.
            prediction = model(torch.cat((rgb * (1 - selection), selection), dim=1))
            return ((prediction * selection + rgb * (1 - selection)) * 255).clamp(0, 255).numpy()

    return run


def load_case(case, directory):
    paths = [directory / case[k] for k in ("image", "mask")]
    with Image.open(paths[0]) as im, Image.open(paths[1]) as selection:
        if im.size != (SIZE, SIZE) or selection.size != (SIZE, SIZE):
            raise ValueError("Cases must already be 512 x 512; no implicit resize")
        rgb = np.asarray(im.convert("RGB"), dtype=np.uint8)
        binary = np.asarray(selection.convert("L")) > 0
    if not binary.any() or binary.all():
        raise ValueError("A case needs both a masked object and visible context")
    image = np.ascontiguousarray(rgb.transpose(2, 0, 1)[None], dtype=np.float32) / np.float32(255)
    mask = np.ascontiguousarray(binary[None, None], dtype=np.float32)
    return image, mask, paths


def save_rgb(path, tensor):
    Image.fromarray(np.rint(checked_output(tensor)[0].transpose(1, 2, 0)).clip(0, 255).astype(np.uint8)).save(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=pathlib.Path, help="JSON array of {name, image, mask}; paths relative to the manifest")
    parser.add_argument("--work", type=pathlib.Path, default=DEFAULT_WORK)
    parser.add_argument("--output", type=pathlib.Path, required=True, help="New directory, outside the tracked repo")
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if args.threads < 1:
        parser.error("--threads must be positive")
    work, output, manifest = args.work.resolve(), args.output.resolve(), args.manifest.resolve()
    cases = json.loads(manifest.read_text())
    if not isinstance(cases, list) or len(cases) < 6:
        parser.error("Provide at least six cases")
    inputs = [load_case(case, manifest.parent) for case in cases]
    verify(work / "assets/lama_fp32.onnx", ONNX_SHA)
    output.mkdir(parents=True, exist_ok=False)
    report = {
        "reference": {"commit": UPSTREAM_COMMIT, "url": REFERENCE_URL, "archive_sha256": REFERENCE_SHA,
                      "checkpoint_sha256": sha(work / "assets/big-lama/models/best.ckpt")},
        "onnx": {"url": ONNX_URL, "sha256": ONNX_SHA},
        "environment": {"platform": platform.platform(), "python": platform.python_version(), "threads": args.threads,
                        **{p: importlib.metadata.version(p) for p in ("torch", "onnxruntime", "numpy", "Pillow")}},
        "threshold_8bit": 2, "visual_review": "pending", "cases": [],
    }
    start = time.perf_counter()
    reference = load_reference(work, args.threads)
    report["reference_load_seconds"] = time.perf_counter() - start
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.intra_op_num_threads = args.threads
    options.inter_op_num_threads = 1
    start = time.perf_counter()
    session = ort.InferenceSession(str(work / "assets/lama_fp32.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
    report["onnx_load_seconds"] = time.perf_counter() - start
    report["onnx"]["inputs"] = [{"name": i.name, "shape": i.shape, "type": i.type} for i in session.get_inputs()]
    report["onnx"]["outputs"] = [{"name": i.name, "shape": i.shape, "type": i.type} for i in session.get_outputs()]
    rows = []
    for i, (case, (image, mask, paths)) in enumerate(zip(cases, inputs)):
        print(f"Comparing {case['name']}…", flush=True)
        start = time.perf_counter()
        expected = reference(image, mask)
        reference_time = time.perf_counter() - start
        start = time.perf_counter()
        actual = session.run(["output"], {"image": image, "mask": mask})[0]
        onnx_time = time.perf_counter() - start
        stats = differences(expected, actual, mask)
        result = {"name": case["name"], "image_sha256": sha(paths[0]), "mask_sha256": sha(paths[1]),
                  "masked_pixels": int(mask.sum()), "difference_8bit": stats,
                  "reference_seconds": reference_time, "onnx_seconds": onnx_time,
                  "numeric_pass": stats["whole"]["p99"] <= 2 and stats["masked"]["p99"] <= 2}
        report["cases"].append(result)
        prefix = f"{i + 1:02}"
        save_rgb(output / f"{prefix}-input.png", image * 255)
        save_rgb(output / f"{prefix}-reference.png", expected)
        save_rgb(output / f"{prefix}-onnx.png", actual)
        delta = np.abs(expected - actual)
        save_rgb(output / f"{prefix}-difference-x16.png", delta * 16)
        # Show exactly which object the model was asked to remove.
        overlay = image * 255 * (1 - mask * 0.5) + np.array([255, 40, 80], dtype=np.float32)[None, :, None, None] * mask * 0.5
        save_rgb(output / f"{prefix}-mask.png", overlay)
        rows.append(f"<h2>{html.escape(case['name'])}</h2><p>Masked p99: {stats['masked']['p99']:.6f}/255; max: {stats['masked']['max']:.6f}/255</p><div>" + "".join(
            f'<figure><figcaption>{label}</figcaption><img src="{prefix}-{file}.png" width="512" height="512"></figure>'
            for file, label in [("mask", "Input and mask"), ("reference", "Original PyTorch"), ("onnx", "ONNX FP32"), ("difference-x16", "Difference ×16")]) + "</div>")
        print(json.dumps(result), flush=True)
    report["numeric_pass"] = all(c["numeric_pass"] for c in report["cases"])
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    (output / "comparison.html").write_text('<!doctype html><html lang="en"><meta charset="utf-8"><title>LaMa fidelity</title><style>body{background:#222;color:#eee;font:16px system-ui}div{display:flex;flex-wrap:wrap;gap:16px}figure{margin:0}img{display:block}figcaption{padding:8px}</style><h1>LaMa: original PyTorch vs ONNX</h1><p>Images shown at 100%. Difference amplified ×16. Numeric units: 8-bit channel values. Visual review is separate from the numeric pass.</p>' + "".join(rows) + "</html>")
    print(f"{'PASS' if report['numeric_pass'] else 'FAIL'} (numeric); visual review required: {output / 'comparison.html'}")
    return 0 if report["numeric_pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
