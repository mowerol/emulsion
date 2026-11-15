#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Fit a new look for each converted film simulation folder: verify, tone on DR100, colour on all.
set -u
# Usage (from anywhere): caffeinate -i tools/lookfit/batch.sh "<look id>|<Tag>[|bw|sepia]" ...  (env: PHOTOS, ALL, TEAL)
# A third field fits a black and white look: tone, then HSL brightness per band (its colour filter;
# with sepia also the tint wheels), then both once more, since the curve and the bands share the
# overall brightness.
S="$(cd "$(dirname "$0")" && pwd)"; W="$(cd "$S/../.." && pwd)"
B="${PHOTOS:-/Volumes/Oli External/Photos/2025}"
source ~/.cargo/env; export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-/Users/oli/Dev/emulsion/src-tauri/target}"
cd "$W"
TEAL=$(ls "$B/${TEAL:-X RAW teal set (DR200-400)}" | grep -i '\.raf$' | sed 's/\.RAF$//I' | tr '\n' '|')
# Arguments: "<look id>|<file suffix>", for RAWs named <RAW>_<suffix>.RAF in the all-simulations folder.
D="$B/${ALL:-X RAW all film sims}"
for pair in "$@"; do
  id="${pair%%|*}"; rest="${pair#*|}"; sfx="${rest%%|*}"; mode=""; [ "$rest" != "$sfx" ] && mode="${rest#*|}"; O="$W/.scratch/batch/$id"; mkdir -p "$O"
  echo "== $id ($sfx) $(date +%H:%M)"
  python3 -I $S/verify.py "$D" "_$sfx" > "$O/verify.txt" 2>&1 || { echo "   verify failed"; cat "$O/verify.txt"; continue; }
  tail -1 "$O/verify.txt"
  TONE=(); ALL=()
  for f in "$D"/*_"$sfx".RAF; do n=$(basename "$f" "_$sfx.RAF"); [ "$n" = DSCF6087 ] && continue; [ -e "${f%.RAF}.jpg" ] || continue; ALL+=("$f"); [[ "|$TEAL" == *"|$n|"* ]] || TONE+=("$f"); done
  tone() { # $1 looks file, $2 suffix for the outputs, $3.. extra options
    local from="$1" k="$2"; shift 2
    node tools/lookfit/lookfit.mjs --look "$id" "$@" --looks "$from" "${TONE[@]}" > "$O/tone$k.txt" 2>&1 || { echo "   tone failed"; tail -5 "$O/tone$k.txt"; return 1; }
    cp .scratch/lookfit/report.json "$O/tone$k-report.json"
    python3 -I -c "
import json,sys
l=json.load(open('.scratch/lookfit/$id.fitted.json')); l['settings']['curve']['rgb'][-1]=[1,1]
json.dump(l,open('$O/tone$k-look.json','w'),indent=2)"
  }
  color() { # $1 looks file, $2 suffix for the outputs
    local opt=(); [ -n "$mode" ] && opt=(--"$mode")
    node tools/lookfit/lookfit.mjs --color "${opt[@]}" --look "$id" --looks "$1" "${ALL[@]}" > "$O/color$2.txt" 2>&1 || { echo "   colour failed"; tail -5 "$O/color$2.txt"; return 1; }
    cp .scratch/lookfit/color-report.json "$O/color$2-report.json"; cp ".scratch/lookfit/$id.color-fitted.json" "$O/fitted$2-look.json"
    grep "^Mean" "$O/color$2.txt"
  }
  tone "$O/start.json" "" --flat-tone || continue
  color "$O/tone-look.json" "" || continue
  if [ -n "$mode" ]; then
    tone "$O/fitted-look.json" 2 || continue
    color "$O/tone2-look.json" 2 || continue
    cp "$O/fitted2-look.json" "$O/fitted-look.json"; cp "$O/color2-report.json" "$O/color-report.json"; cp "$O/tone2-report.json" "$O/tone-report.json"
  fi
done
echo "== done $(date +%H:%M)"
