#!/bin/sh
# Builds darktable's own src/common/heal.c (CPU part) with small stubs, to make the heal fixture.
# Usage: tools/heal-reference/build.sh <darktable checkout at 20891f6c6fa7be995e5bf9dff9d1ee5062051773>
set -e
DT=${1:?darktable checkout}
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${TMPDIR:-/tmp}/emulsion-heal-reference
mkdir -p "$OUT"
sed -n '1,/^#ifdef HAVE_OPENCL/p' "$DT/src/common/heal.c" | sed '$d' > "$OUT/heal.c"
cc -O0 -std=c99 -I"$HERE/stub" -include "$HERE/stub/dtstub.h" -o "$OUT/heal" "$OUT/heal.c" "$HERE/main.c" -lm
echo "$OUT/heal"
