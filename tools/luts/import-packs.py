#!/usr/bin/env python3
"""Copy the reviewed Cube files unchanged and regenerate the app catalogue.

Usage: python3 tools/luts/import-packs.py /path/to/Film-Luts /path/to/picturefx-legacy-19
See docs/plans/lut-source-verification.md for the pinned sources and license scope.
"""
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# The reviewed manifest is also the lockfile: regeneration cannot silently add or change assets.
LOCK = json.loads((ROOT / "src/film/lut-catalogue.json").read_text())
HASHES = {(r["pack"], r["file"]): r["sha256"] for r in LOCK}
film, picture = map(Path, sys.argv[1:])
CATEGORIES = {"Bw": "Black & white", "Colorslide": "Colour slide",
              "Instant Consumer": "Instant consumer", "Instant Pro": "Instant professional",
              "Negative Color": "Colour negative", "Negative New": "Negative — newer",
              "Negative Old": "Negative — older"}
COMMON = {
    "negative_new/kodak_portra_400.cube": "portra400",
    "negative_new/kodak_portra_160.cube": "portra160",
    "negative_new/fuji_400h.cube": "pro400h",
    "negative_old/fuji_superia_400.cube": "superia400",
    "negative_color/kodak_ektar_100.cube": "ektar100",
    "bw/kodak_tri-x_400.cube": "trix400",
    "bw/ilford_hp_5_plus_400.cube": "hp5",
}
rows = []
def add(pack, source, file, name, category, id=None):
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if HASHES.get((pack, file)) != digest:
        raise ValueError(f"Unreviewed or changed LUT: {pack}/{file}")
    destination = ROOT / "public/looks" / pack / file
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    speed = re.search(r"(?:^| )(25|50|64|80|100|125|160|200|320|400|800|1600|3200)(?:$| |[A-Z])", name)
    rows.append(dict(id=id or f"lut:{pack}:{file.removesuffix('.cube')}", pack=pack,
                     name=name, category=category, file=file,
                     iso=int(speed[1]) if speed else 400,
                     sha256=digest))

for item in json.loads((film / "film_luts.json").read_text())["filmLUTs"]:
    if item["category"] not in CATEGORIES:
        continue
    file = item["lut_file"].removeprefix("luts/")
    add("gmic-film", film / item["lut_file"], file, item["name"], CATEGORIES[item["category"]], COMMON.get(file))
for file in sorted(r["file"] for r in LOCK if r["pack"] == "picturefx"):
    source = picture / file
    family, name = source.stem.split("_", 1)
    title = " ".join(word.upper() if word in {"i", "ii", "iii", "bw"} else word.title() for word in name.split("_"))
    add("picturefx", source, source.name, title, family[:-2].title() + "FX")
if len(rows) != len(LOCK):
    raise ValueError("Source catalogue no longer matches the reviewed file set")
rows.sort(key=lambda x: (x["pack"], x["category"], x["name"], x["file"]))
(ROOT / "src/film/lut-catalogue.json").write_text(json.dumps(rows, indent=2) + "\n")
print(f"Copied {len(rows)} unchanged LUTs")
