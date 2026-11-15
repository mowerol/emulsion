#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Fit a new look for each converted film simulation folder: verify, tone on DR100, colour on all.
set -u
# Usage (from anywhere): caffeinate -i tools/lookfit/batch.sh "<look id>|<Tag>" ...  (env: PHOTOS, ALL, TEAL)
S="$(cd "$(dirname "$0")" && pwd)"; W="$(cd "$S/../.." && pwd)"
B="${PHOTOS:-/Volumes/Oli External/Photos/2025}"
source ~/.cargo/env; export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-/Users/oli/Dev/emulsion/src-tauri/target}"
cd "$W"
TEAL=$(ls "$B/${TEAL:-X RAW teal set (DR200-400)}" | grep -i '\.raf$' | sed 's/\.RAF$//I' | tr '\n' '|')
# Arguments: "<look id>|<file suffix>", for RAWs named <RAW>_<suffix>.RAF in the all-simulations folder.
D="$B/${ALL:-X RAW all film sims}"
for pair in "$@"; do
  id="${pair%%|*}"; sfx="${pair#*|}"; O="$W/.scratch/batch/$id"; mkdir -p "$O"
  echo "== $id ($sfx) $(date +%H:%M)"
  python3 -I $S/verify.py "$D" "_$sfx" > "$O/verify.txt" 2>&1 || { echo "   verify failed"; cat "$O/verify.txt"; continue; }
  tail -1 "$O/verify.txt"
  TONE=(); ALL=()
  for f in "$D"/*_"$sfx".RAF; do n=$(basename "$f" "_$sfx.RAF"); [ "$n" = DSCF6087 ] && continue; [ -e "${f%.RAF}.jpg" ] || continue; ALL+=("$f"); [[ "|$TEAL" == *"|$n|"* ]] || TONE+=("$f"); done
  node tools/lookfit/lookfit.mjs --look "$id" --flat-tone --looks "$O/start.json" "${TONE[@]}" > "$O/tone.txt" 2>&1 || { echo "   tone failed"; tail -5 "$O/tone.txt"; continue; }
  cp .scratch/lookfit/report.json "$O/tone-report.json"
  python3 -I -c "
import json,sys
l=json.load(open('.scratch/lookfit/$id.fitted.json')); l['settings']['curve']['rgb'][-1]=[1,1]
json.dump(l,open('$O/tone-look.json','w'),indent=2)"
  node tools/lookfit/lookfit.mjs --color --look "$id" --looks "$O/tone-look.json" "${ALL[@]}" > "$O/color.txt" 2>&1 || { echo "   colour failed"; tail -5 "$O/color.txt"; continue; }
  cp .scratch/lookfit/color-report.json "$O/color-report.json"; cp ".scratch/lookfit/$id.color-fitted.json" "$O/fitted-look.json"
  grep "^Mean" "$O/color.txt"
done
echo "== done $(date +%H:%M)"
