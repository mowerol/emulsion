# Handoff

Rewritten at the end of each session. Last updated 2026-10-30.

## Just finished

Committed on `main`, **not yet pushed** (local is 5 commits ahead of `origin`):

- `9b48663` Point tone curve (darktable monotone spline), master and per channel.
- `a7f2e93` White balance: Temperature/Tint by CAT16 from the RAW's as-shot white, presets, eyedropper.
- `2524188` Film grain from the Boolean grain model's statistics (Newson et al. 2017); ISO presets set Size and Roughness.
- `1167959` Zoom and pan (full resolution loads on demand), clipping overlay (J), pinned histogram, folding panel sections, one-line sliders; fix for texture-unit binds that put a grey patch on lifted curve highlights.
- `49242ee` Undo/redo with history, Before toggle and split view (Y), per-section Reset, custom macOS menu (undo wasn't reaching the app), Neutral stock as the default.

## In progress

Nothing half-done. `CLAUDE.md` and this file are new and uncommitted.

## Known issues and open questions

- **Shadows slider feels weak** (Oli). Suspect: it drives tone-equalizer bands -8 to -5 EV of the brightness map, but with the -1.57 EV exposure boost typical shadows sit nearer -4/-5, so they get little lift. Measure on real photos before retuning.
- **Blown RAW highlights render light grey (~87% white)**: sigmoid rolls off instead of clipping. Whites fixes it per photo; RAW highlight recovery is the planned fix.
- **Grain was tuned on synthetic ramps**; strength per ISO and colour share still need Oli's judgement on real photos at 100%.
- **Untested by Claude** (needs the real app): zoom/pan/pinch interactions, the custom menu's Undo/Redo/Select All, the split divider while zoomed.
- RAW brightness (`BASELINE_GAIN` 1.8 in `src-tauri/src/raw.rs`) is a per-photo-noisy average; a per-camera baseline is on the roadmap.

## Next

Oli chooses between:

1. **Batch 3:** crop and straighten with aspect presets (3:2, 4:5, 1:1), then user presets (save and apply looks).
2. **Shadows slider fix** (see above).
3. Later: **Batch 4** — ratings, flags and filtering in the library; an EXIF info overlay.
