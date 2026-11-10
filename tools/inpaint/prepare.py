#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Prepare six reproducible local-photo crops and brush masks, without editing originals."""
import argparse
import json
import pathlib

from PIL import Image, ImageDraw, ImageOps

# Coordinates on the specified long-edge view (1100px by default). Crops are 512px.
# No person is present in this sample set; a bottle provides a sixth whole-object case.
CASES = [
    {"name": "sky-pole", "photo": "1OKK6432.JPG", "crop": [0, 0],
     "stroke": [[201, 0], [199, 65], [196, 132], [191, 212]], "width": 24},
    {"name": "foliage-leaf", "photo": "1OKK6432.JPG", "crop": [588, 221],
     "stroke": [[693, 587], [710, 608], [712, 634]], "width": 58},
    {"name": "stone-mark", "photo": "2026/2026-09-26/P9260580.JPG", "crop": [285, 110],
     "stroke": [[516, 308], [531, 320], [542, 337]], "width": 38},
    {"name": "water-reflection", "photo": "1OKK6433.JPG", "crop": [400, 200],
     "stroke": [[629, 447], [648, 462], [669, 471]], "width": 52},
    {"name": "straight-edge-lamp", "photo": "1OKK6432.JPG", "crop": [588, 0],
     "stroke": [[887, 56], [887, 86], [887, 113]], "width": 20},
    {"name": "whole-object-bottle", "photo": "2026/2026-09-26/P9260576.JPG", "long_edge": 850, "crop": [30, 30],
     "polygon": [[264, 95], [376, 95], [380, 148], [375, 208], [375, 389], [248, 391], [247, 179], [260, 145]]},
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--photos", type=pathlib.Path, default=pathlib.Path.home() / "Pictures")
    parser.add_argument("--output", type=pathlib.Path, required=True, help="New private output directory")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    manifest = []
    for case in CASES:
        with Image.open(args.photos / case["photo"]) as source:
            edge = case.get("long_edge", 1100)
            photo = ImageOps.contain(ImageOps.exif_transpose(source).convert("RGB"), (edge, edge), Image.Resampling.BILINEAR)
        x, y = case["crop"]
        if x + 512 > photo.width or y + 512 > photo.height:
            raise ValueError(f"Crop outside {case['photo']}: {photo.size}")
        crop = photo.crop((x, y, x + 512, y + 512))
        mask = Image.new("L", (512, 512))
        draw = ImageDraw.Draw(mask)
        if "polygon" in case:
            draw.polygon([(px - x, py - y) for px, py in case["polygon"]], fill=255)
        else:
            points = [(px - x, py - y) for px, py in case["stroke"]]
            radius = case["width"] / 2
            draw.line(points, fill=255, width=case["width"], joint="curve")
            for px, py in points:
                draw.ellipse((px - radius, py - radius, px + radius, py + radius), fill=255)
        name = case["name"]
        crop.save(args.output / f"{name}.png")
        mask.save(args.output / f"{name}-mask.png")
        manifest.append({"name": name, "image": f"{name}.png", "mask": f"{name}-mask.png", "preparation": case})
    (args.output / "cases.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(args.output / "cases.json")


if __name__ == "__main__":
    main()
