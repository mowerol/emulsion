#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Builds the website's hero loop from 1920 x 1200 frames, one per look in order, each with a
# full-frame transparent label PNG. Each look holds HOLD s and crossfades over FADE s; its label
# fades out in the first half of the crossfade and the next fades in over the second half, so two
# labels never overlap. The loop ends on the first frame so it repeats without a seam.
# Writes hero.mp4 (H.264), hero.webm (AV1) and hero-poster.jpg (the first frame with its label).
# Usage: tools/marketing/hero-video.sh <out folder> <frame.png>:<label.png>...
set -euo pipefail
out=$1; shift
HOLD=${HOLD:-1.6} FADE=${FADE:-0.5} FPS=${FPS:-30}
mkdir -p "$out"
calc() { echo "$1" | bc -l | sed 's/^\./0./'; }
n=$#
seg=$(calc "$HOLD + $FADE") total=$(calc "$n * $seg") half=$(calc "$FADE / 2")
frames=() labels=()
for pair in "$@"; do frames+=("${pair%%:*}"); labels+=("${pair#*:}"); done
frames+=("${frames[0]}"); labels+=("${labels[0]}")

args=() chain='' prev='0'
for i in $(seq 0 "$n"); do
  # Every look shows for HOLD plus a fade at each end; the closing copy of the first is the last fade only.
  if [ "$i" -lt "$n" ]; then t=$(calc "$HOLD + 2 * $FADE"); else t=$FADE; fi
  args+=(-framerate "$FPS" -loop 1 -t "$t" -i "${frames[$i]}")
  if [ "$i" -gt 0 ]; then
    chain+="[$prev][$i]xfade=transition=fade:duration=$FADE:offset=$(calc "$i * $seg - $FADE")[x$i];"
    prev="x$i"
  fi
done
for i in $(seq 0 "$n"); do
  args+=(-framerate "$FPS" -loop 1 -t "$total" -i "${labels[$i]}")
  fx="format=rgba"
  [ "$i" -gt 0 ] && fx+=",fade=t=in:st=$(calc "$i * $seg - $half"):d=$half:alpha=1"
  [ "$i" -lt "$n" ] && fx+=",fade=t=out:st=$(calc "$i * $seg + $HOLD"):d=$half:alpha=1"
  chain+="[$((n + 1 + i))]$fx[l$i];[$prev][l$i]overlay=format=auto[o$i];"
  prev="o$i"
done
chain+="[$prev]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]"
tags=(-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv)
ffmpeg -v error -y "${args[@]}" -filter_complex "$chain" -map '[v]' -r "$FPS" -t "$total" -an \
  -c:v libx264 -preset veryslow -crf "${CRF264:-20}" -profile:v high "${tags[@]}" -movflags +faststart "$out/hero.mp4"
ffmpeg -v error -y "${args[@]}" -filter_complex "$chain" -map '[v]' -r "$FPS" -t "$total" -an \
  -c:v libsvtav1 -preset 4 -crf "${CRFAV1:-34}" -svtav1-params tune=0 "${tags[@]}" "$out/hero.webm" 2>&1 | grep -v '^Svt\[info\]' || true
ffmpeg -v error -y -i "${frames[0]}" -i "${labels[0]}" -filter_complex overlay -q:v 2 "$out/hero-poster.jpg"
ls -la "$out"
