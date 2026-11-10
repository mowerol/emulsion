#!/usr/bin/env python3
# Copyright (c) 2024 Picsart AI Research (PAIR)
# Adapter follows scripts/demo.py and scripts/export_inference_model.py at
# Picsart-AI-Research/MI-GAN commit 2b793c5ece43f4253e32d4afc257120a5deed6f5 (MIT).
# Loads the released inference state directly instead of reparameterizing training weights.
# Export uses the official static 512 core, without the published pipeline's extra crop/blend.
# SPDX-License-Identifier: GPL-3.0-or-later
"""Check MI-GAN's static 512 core as the conditional fast Remove candidate."""
import argparse
import html
import importlib.util
import json
import pathlib
import time

import numpy as np
import onnxruntime as ort
import torch

from compare import differences, load_case, save_rgb
from setup import DEFAULT_WORK, fetch, sha

COMMIT = "2b793c5ece43f4253e32d4afc257120a5deed6f5"
SOURCE_URL = f"https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/{COMMIT}/lib/model_zoo/migan_inference.py"
SOURCE_SHA = "1e35a181e516742ae32af935848e6a9a4382f528ea7096db6658f14cd8b9ace0"
WEIGHTS_URL = "https://drive.usercontent.google.com/download?id=1D_YCuCgo20S2256sqpedsmENNm2WMtVY&export=download&confirm=t"
# Computed from the author's linked release, not an independently published checksum.
WEIGHTS_SHA = "1d6087eee0aac8923ad2606be5d8caeb4824d3e4de331995e420c74e124a466a"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=pathlib.Path)
    parser.add_argument("--work", type=pathlib.Path, default=DEFAULT_WORK)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if args.threads < 1:
        parser.error("--threads must be positive")
    cases = json.loads(args.manifest.read_text())
    if not isinstance(cases, list) or len(cases) < 6:
        parser.error("Provide at least six cases")
    inputs = [load_case(c, args.manifest.resolve().parent) for c in cases]
    args.output.mkdir(parents=True, exist_ok=False)
    assets = args.work / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    source, weights = assets / "migan_inference.py", assets / "migan_512_places2.pt"
    fetch(SOURCE_URL, source, SOURCE_SHA)
    fetch(WEIGHTS_URL, weights, WEIGHTS_SHA)
    fetch(f"https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/{COMMIT}/LICENSE-WEIGHTS",
          assets / "migan-LICENSE", "674e33456b8d03693b84ab305aa7372d93c91e68b234651b0adad106d518e6eb")
    spec = importlib.util.spec_from_file_location("migan_reference", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    torch.set_num_threads(args.threads)
    start = time.perf_counter()
    generator = module.Generator(resolution=512).eval().requires_grad_(False)
    generator.load_state_dict(torch.load(weights, map_location="cpu", weights_only=True), strict=True)
    load_time = time.perf_counter() - start
    model = assets / "migan-core-512.onnx"
    torch.onnx.export(generator, torch.zeros(1, 4, 512, 512), model, input_names=["input"],
                      output_names=["output"], opset_version=12, dynamo=False)
    options = ort.SessionOptions()
    options.intra_op_num_threads = args.threads
    options.inter_op_num_threads = 1
    start = time.perf_counter()
    session = ort.InferenceSession(str(model), sess_options=options, providers=["CPUExecutionProvider"])
    report = {"source": {"commit": COMMIT, "sha256": SOURCE_SHA, "url": SOURCE_URL},
              "weights": {"sha256": WEIGHTS_SHA, "url": WEIGHTS_URL, "hash_provenance": "Computed from author's linked release; not independently published"},
              "onnx_sha256": sha(model), "onnx_bytes": model.stat().st_size,
              "reference_load_seconds": load_time, "onnx_load_seconds": time.perf_counter() - start,
              "environment": {"torch": torch.__version__, "onnxruntime": ort.__version__, "numpy": np.__version__,
                              "threads": args.threads, "provider": "CPUExecutionProvider", "opset": 12},
              "visual_review": "pending", "cases": []}
    rows = []
    for i, (case, (image, hole, paths)) in enumerate(zip(cases, inputs)):
        known = 1 - hole
        data = np.ascontiguousarray(np.concatenate((known - 0.5, (image * 2 - 1) * known), axis=1))
        start = time.perf_counter()
        with torch.inference_mode():
            expected_raw = generator(torch.from_numpy(data)).numpy()
        reference_time = time.perf_counter() - start
        start = time.perf_counter()
        actual_raw = session.run(["output"], {"input": data})[0]
        onnx_time = time.perf_counter() - start
        expected = np.clip((expected_raw * 0.5 + 0.5) * 255, 0, 255) * hole + image * 255 * known
        actual = np.clip((actual_raw * 0.5 + 0.5) * 255, 0, 255) * hole + image * 255 * known
        stats = differences(expected, actual, hole)
        result = {"name": case["name"], "image_sha256": sha(paths[0]), "mask_sha256": sha(paths[1]),
                  "difference_8bit": stats, "reference_seconds": reference_time, "onnx_seconds": onnx_time,
                  "numeric_pass": stats["masked"]["p99"] <= 2 and stats["whole"]["p99"] <= 2}
        report["cases"].append(result)
        prefix = f"{i + 1:02}"
        save_rgb(args.output / f"{prefix}-reference.png", expected)
        save_rgb(args.output / f"{prefix}-onnx.png", actual)
        save_rgb(args.output / f"{prefix}-difference-x16.png", np.abs(expected - actual) * 16)
        rows.append(f"<h2>{html.escape(case['name'])}</h2>" + "".join(f'<img src="{prefix}-{p}.png" width="512" height="512">' for p in ("reference", "onnx", "difference-x16")))
        print(json.dumps(result), flush=True)
    report["numeric_pass"] = all(c["numeric_pass"] for c in report["cases"])
    report["warm_pass_2s"] = all(c["onnx_seconds"] <= 2 for c in report["cases"][1:])
    (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    (args.output / "comparison.html").write_text('<!doctype html><html lang="en"><meta charset="utf-8"><title>MI-GAN core fidelity</title><h1>MI-GAN: PyTorch, ONNX, difference ×16</h1>' + "".join(rows) + "</html>")
    print(f"Numeric pass: {report['numeric_pass']}; warm patches under 2s: {report['warm_pass_2s']}")
    return 0 if report["numeric_pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
