#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Measure flat-background reconstruction using the app's actual Remove inputs and pinned model."""
import argparse
import importlib.metadata
import json
import pathlib
import subprocess
import time

import numpy as np
import onnxruntime as ort
from PIL import Image

from setup import DEFAULT_WORK, ONNX_SHA, ROOT, sha, verify


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", type=pathlib.Path, default=DEFAULT_WORK)
    parser.add_argument("--output", type=pathlib.Path, required=True, help="New output directory")
    args = parser.parse_args()
    model = args.work.resolve() / "assets/lama_fp32.onnx"
    verify(model, ONNX_SHA)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    subprocess.run(["node", str(ROOT / "tools/inpaint/quality-inputs.mjs"), str(output)], cwd=ROOT, check=True)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(model), sess_options=options, providers=["CPUExecutionProvider"])
    cases = json.loads((output / "cases.json").read_text())
    report = {
        "model_sha256": ONNX_SHA,
        "remove_source_sha256": sha(ROOT / "src/engine/remove.ts"),
        "retouch_source_sha256": sha(ROOT / "src/engine/retouch.ts"),
        "versions": {p: importlib.metadata.version(p) for p in ("onnxruntime", "numpy", "Pillow")},
        "threshold_core_p99_8bit": 10,
        "visual_review": "pending",
        "cases": [],
    }
    yy, xx = np.mgrid[:512, :512]
    for case in cases:
        name = case["name"]
        # A disk well inside the removed object, excluding its feather and unchanged context.
        core = (xx - 256) ** 2 + (yy - 256) ** 2 < case["core_radius"] ** 2
        image = np.fromfile(output / f"{name}.rgba", dtype=np.uint8).reshape(512, 512, 4)[:, :, :3]
        binary = np.fromfile(output / f"{name}.mask", dtype=np.uint8).reshape(512, 512) > 0
        if not binary[core].all() or binary.all():
            raise ValueError(f"{name}: core must be masked with visible context outside")
        start = time.perf_counter()
        patch = session.run(["output"], {
            "image": np.ascontiguousarray(image.transpose(2, 0, 1)[None], dtype=np.float32) / 255,
            "mask": binary[None, None].astype(np.float32),
        })[0][0].transpose(1, 2, 0)
        seconds = time.perf_counter() - start
        if patch.shape != (512, 512, 3) or not np.isfinite(patch).all():
            raise ValueError(f"{name}: invalid model output")
        delta = np.abs(patch[core] - np.array(case["background"]))
        p99 = float(np.percentile(delta, 99))
        result = {**case, "image_sha256": sha(output / f"{name}.rgba"), "mask_sha256": sha(output / f"{name}.mask"),
                  "masked_fraction": float(binary.mean()), "core_mae_8bit": float(delta.mean()),
                  "core_p99_8bit": p99, "seconds": seconds, "numeric_pass": p99 < 10}
        report["cases"].append(result)
        print(json.dumps(result), flush=True)
        Image.fromarray(image).save(output / f"{name}-input.png")
        Image.fromarray(binary.astype(np.uint8) * 255).save(output / f"{name}-mask.png")
        Image.fromarray(np.rint(patch).clip(0, 255).astype(np.uint8)).save(output / f"{name}-output.png")
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    raise SystemExit(0 if all(c["numeric_pass"] for c in report["cases"]) else 1)


if __name__ == "__main__":
    main()
