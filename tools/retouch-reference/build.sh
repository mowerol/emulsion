#!/bin/sh
# Builds darktable's own bilateral grid (src/common/bilateral.c), wavelet decomposition
# (src/common/dwt.c, its CPU path) and ellipse mask maths
# (src/develop/masks/ellipse.c: _bounding_box, _fill_mask, _ellipse_points_to_transform) with small
# stubs, to make the retouch fixture.
# Usage: tools/retouch-reference/build.sh <darktable checkout at 20891f6c6fa7be995e5bf9dff9d1ee5062051773>
set -e
DT=${1:?darktable checkout}
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${TMPDIR:-/tmp}/emulsion-retouch-reference
mkdir -p "$OUT/common"
cp "$DT/src/common/bilateral.h" "$OUT/common/bilateral.h"
grep -v '#pragma GCC optimize' "$DT/src/common/bilateral.c" > "$OUT/bilateral.c"
cp "$DT/src/common/dwt.h" "$OUT/dwt.h"
sed -n '1,/^#ifdef HAVE_OPENCL/p' "$DT/src/common/dwt.c" | sed '$d' > "$OUT/dwt.c"
# The three static functions, from their first line to the closing brace at column 0.
for fn in '_bounding_box' '_fill_mask' '_ellipse_points_to_transform'; do
  awk -v fn="$fn" 'index($0, fn "(") && /^static/ {on=1} on {print} on && /^}/ {on=0}' "$DT/src/develop/masks/ellipse.c"
done > "$OUT/ellipse_parts.c"
cc -O0 -std=gnu99 -I"$OUT" -I"$HERE/stub" -include "$HERE/stub/dtstub.h" -o "$OUT/retouch-ref" "$OUT/bilateral.c" "$OUT/dwt.c" "$HERE/main.c" -lm
echo "$OUT/retouch-ref"
