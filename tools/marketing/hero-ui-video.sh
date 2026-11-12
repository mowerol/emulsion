#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Cuts the hero loop from a take recorded by tools/marketing/hero-ui.mjs (take-raw.mov, 2x
# Retina, 60 fps): drops the still lead-in, crossfades the end back into the opening frame so the
# loop has no jump, and writes hero-ui.mp4 (H.264) and hero-ui.webm (AV1) at 1920 x 1200, the same
# at 2x (hero-ui@2x.*, for a hero that fills a Retina screen: interface text stays sharp), and
# hero-ui-poster.jpg and .webp (the opening frame; the site uses the WebP).
# Usage: tools/marketing/hero-ui-video.sh <take-raw.mov> <out folder>
set -euo pipefail
raw=$1 out=$2
START=${START:-1.2} FADE=${FADE:-0.6}
mkdir -p "$out"
total=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$raw")
len=$(echo "$total - $START" | bc -l)
off=$(echo "$len - $FADE" | bc -l)
tags=(-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv)
for size in 1920x1200 2464x1540; do
  w=${size%x*} h=${size#*x}
  name=hero-ui; [ "$w" = 2464 ] && name=hero-ui@2x
  # The opening frame, held for the closing fade; both streams scaled alike (the take is 2464 x 1538).
  chain="[0:v]trim=start=$START,setpts=PTS-STARTPTS,scale=$w:$h:flags=lanczos,split[v][f];"
  chain+="[f]trim=end_frame=1,loop=loop=-1:size=1,trim=duration=$FADE,setpts=PTS-STARTPTS[first];"
  chain+="[v][first]xfade=transition=fade:duration=$FADE:offset=$off,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[o]"
  ffmpeg -v error -y -i "$raw" -filter_complex "$chain" -map '[o]' -r 60 -an \
    -c:v libx264 -preset slow -crf "${CRF264:-23}" -profile:v high "${tags[@]}" -movflags +faststart "$out/$name.mp4"
  ffmpeg -v error -y -i "$raw" -filter_complex "$chain" -map '[o]' -r 60 -an \
    -c:v libsvtav1 -preset 5 -crf "${CRFAV1:-36}" "${tags[@]}" "$out/$name.webm" 2>&1 | grep -v '^Svt\[' || true
done
ffmpeg -v error -y -ss "$START" -i "$raw" -frames:v 1 -vf scale=1920:1200:flags=lanczos -q:v 2 "$out/hero-ui-poster.jpg"
cwebp -quiet -q 82 -m 6 "$out/hero-ui-poster.jpg" -o "$out/hero-ui-poster.webp"
ls -la "$out"
