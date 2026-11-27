#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Fetches the pinned darktable sources and spektrafilm data pack the bake runs on.
# Sources: darktable (GPL-3.0-or-later) and darktable-spektrafilm pack 0.3.3 (CC BY-SA 4.0 data).
set -eu
DT=c247126f9a7a2c3cdfc0f675a7698c24710438ca
PACK=b15cfe18fb35ec15084f78c986b0ebc730338e6e
cd "$(dirname "$0")"
mkdir -p .cache/darktable .cache/pack/profiles
for f in src/common/spektra_sim.c src/common/spektra_sim.h src/common/spektra_core.c src/common/spektra_core.h data/kernels/grain.h src/tests/unittests/common/test_spektra_sim.c; do
  [ -s ".cache/darktable/$(basename $f)" ] || curl -sfL "https://raw.githubusercontent.com/darktable-org/darktable/$DT/$f" -o ".cache/darktable/$(basename $f)"
done
base="https://raw.githubusercontent.com/darktable-org/darktable-spektrafilm/$PACK/packs/0.3.3"
for f in pack.json spectra_lut.f32; do [ -s ".cache/pack/$f" ] || curl -sfL "$base/$f" -o ".cache/pack/$f"; done
gh api "repos/darktable-org/darktable-spektrafilm/git/trees/$PACK?recursive=1" --jq '.tree[].path' | grep '^packs/0.3.3/profiles/.*\.json$' | while read -r p; do
  n=$(basename "$p"); [ -s ".cache/pack/profiles/$n" ] || curl -sfL "$base/profiles/$n" -o ".cache/pack/profiles/$n"
done
echo "darktable $DT, pack $PACK"
