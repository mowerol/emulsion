#!/usr/bin/env python3
"""Build the pinned, actual darktable spatial C reference and emit optics fixtures.

No Python dependencies. Requires a C11 compiler. See README.md for binary input
and output used to compare arbitrary GPU images with the reference.
"""

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import urllib.request


ROOT = Path(__file__).resolve().parents[2]
COMMIT = "c96cf1d0de8fff468e9eddee28621e91f83bdf1a"
PYTHON_COMMIT = "3bb2c2d2801ff68b92019cf1dbcbb133d60832bc"
BUILD = ROOT / ".scratch" / "optics-reference"
SOURCES = (
    "src/common/spektra_core.c",
    "src/common/spektra_core.h",
    "src/common/gaussian.c",
)


def fetch(url, destination):
    if not destination.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(urllib.request.urlopen(url).read())
    return destination.read_text()


def section(source, start, end):
    return source[source.index(start):source.index(end)]


def build():
    BUILD.mkdir(parents=True, exist_ok=True)
    source = {}
    hashes = {}
    for name in SOURCES:
        url = f"https://raw.githubusercontent.com/darktable-org/darktable/{COMMIT}/{name}"
        path = BUILD / COMMIT / Path(name).name
        source[name] = fetch(url, path)
        hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    core, header, gaussian = (source[name] for name in SOURCES)
    preset_source = fetch(
        "https://raw.githubusercontent.com/andreavolpato/spektrafilm/"
        f"{PYTHON_COMMIT}/src/spektrafilm/runtime/params_builder.py",
        BUILD / PYTHON_COMMIT / "params_builder.py",
    )
    preset = None
    for node in ast.parse(preset_source).body:
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            if node.target.id == "_HALATION_PRESETS":
                preset = ast.literal_eval(node.value)
    assert preset is not None
    # Small shim for allocation, copy and scheduling only. All spatial maths,
    # blur branches, kernels and plan helpers below are unmodified source slices.
    shim = """
#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define DT_OMP_FOR()
#define MAX(a,b) ((a) > (b) ? (a) : (b))
#define MIN(a,b) ((a) < (b) ? (a) : (b))
static float *dt_alloc_align_float(size_t n) { return malloc(n * sizeof(float)); }
static void dt_free_align(void *p) { free(p); }
static void dt_iop_image_copy(float *dst, const float *src, size_t n)
{ memcpy(dst, src, n * sizeof(float)); }
"""
    constants = []
    for line in header.splitlines():
        if line.startswith(("#define SF_GAUSS_", "#define SF_WIDE_BLUR_")):
            constants.append(line)
    generated = (
        core[:core.index("/* spektrafilm")]
        + "\n/* Gaussian helper copyright retained from gaussian.c: */\n"
        + gaussian[:gaussian.index("#include")]
        + shim
        + "\n".join(constants)
        + "\n"
        + section(header, "#define SF_DIFFUSION_MAX_BANK", "/* Fill `plan` for the given")
        + section(gaussian, "void dt_gaussian_yvv_coeffs(", "void dt_gaussian_free(")
        + section(core, "void sf_gauss_yvv_coeffs(", "/* Multiplicative unsharp mask")
        + section(core, "static void _blur_per_channel(", "/* Apply halation + scatter")
        + section(core, "void sf_halation(", "/* ---------------- diffusion filter")
        + core[core.index("#define SF_DIFFUSION_MAX_COMP"):]
    )
    (BUILD / "upstream.inc").write_text(generated)
    (BUILD / "main.c").write_text((Path(__file__).parent / "main.c").read_text())
    executable = BUILD / "reference"
    subprocess.run(
        [os.environ.get("CC", "cc"), "-std=c11", "-O2", "-ffp-contract=off",
         str(BUILD / "main.c"), "-lm", "-o", str(executable)], check=True
    )
    return executable, preset, hashes


def run_json(executable, *args):
    return json.loads(subprocess.check_output([str(executable), *map(str, args)]))


def image(executable, command, w, h, args, pattern):
    values = [0.0] * (w * h * 3)
    rgb = [16.0, 8.0, 4.0]
    if pattern == "impulse":
        index = ((h // 2) * w + w // 2) * 3
        values[index:index + 3] = rgb
    elif pattern == "step":
        for y in range(h):
            for x in range(w // 2, w):
                index = (y * w + x) * 3
                values[index:index + 3] = rgb
    else:
        raise ValueError(pattern)
    packed = struct.pack(f"<{len(values)}f", *values)
    output = subprocess.check_output(
        [str(executable), command, str(w), str(h), *map(str, args)], input=packed
    )
    result = struct.unpack(f"<{len(values)}f", output)
    start = (h // 2) * w * 3
    return {
        "command": command, "width": w, "height": h, "args": args,
        "pattern": pattern, "rgb": rgb,
        "centerRow": [list(result[start + 3*x:start + 3*x + 3]) for x in range(w)],
        "sum": [sum(result[c::3]) for c in range(3)],
    }


def generate(executable, preset, hashes, output):
    strengths = [0, .01, .125, .25, .5, 1, 2]
    strength = list(preset[("still", "strong")]["strength"])
    sigma = preset[("still", "strong")]["sigma_h"][0]
    plans = [
        {"strength": s, "warmth": 0, **run_json(executable, "plan", s, 0)}
        for s in strengths
    ]
    mixes = []
    for amount in [0, 1, 8]:
        for raw, blur in [([.2, .4, .8], [2, 3, 4]), ([16, 8, 4], [0, 0, 0])]:
            mixes.append({
                "amount": amount, "raw": raw, "blur": blur,
                "output": run_json(executable, "mix", amount, *strength, *raw, *blur),
            })
    profiles = []
    for s in [.5, 1, 2.9, 3, 5, 10, 30, 100]:
        for pattern in ["impulse", "step"]:
            profiles.append(image(executable, "gaussian", 257, 129, [s], pattern))
    for pixel_um, w, h in [(20, 257, 129), (6, 513, 257)]:
        for pattern in ["impulse", "step"]:
            profiles.append(image(executable, "halation", w, h,
                                  [pixel_um, 8, 1, *strength, sigma], pattern))
            profiles.append(image(executable, "diffusion", w, h,
                                  [pixel_um, .5, 1, 0], pattern))
    fixture = {
        "source": {"project": "darktable", "commit": COMMIT, "sha256": hashes},
        "halation": {
            "presetSource": "spektrafilm src/spektrafilm/runtime/params_builder.py",
            "presetCommit": PYTHON_COMMIT, "preset": ["still", "strong"],
            "strength": strength, "firstSigmaUm": sigma,
            "bounceWeights": [1/1.75, .5/1.75, .25/1.75], "mixes": mixes,
        },
        "diffusion": {"family": "black_pro_mist", "plans": plans},
        "profiles": profiles,
    }
    weak = preset[("still", "weak")]
    fixture["halationWeak"] = {
        "presetSource": fixture["halation"]["presetSource"],
        "presetCommit": PYTHON_COMMIT, "preset": ["still", "weak"],
        "strength": list(weak["strength"]), "firstSigmaUm": weak["sigma_h"][0],
        "mixes": [
            {"amount": m["amount"], "raw": m["raw"], "blur": m["blur"],
             "output": run_json(executable, "mix", m["amount"], *weak["strength"], *m["raw"], *m["blur"])}
            for m in mixes
        ],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(fixture, indent=2) + "\n")
    print(f"Wrote {output.relative_to(ROOT)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-only", action="store_true")
    parser.add_argument("--output", type=Path, default=ROOT / "src/engine/fixtures/optics.json")
    args = parser.parse_args()
    executable, preset, hashes = build()
    if not args.build_only:
        generate(executable, preset, hashes, args.output)
    print(f"Reference executable: {executable}")


if __name__ == "__main__":
    main()
