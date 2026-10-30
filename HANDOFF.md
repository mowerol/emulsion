# Handoff

Rewritten at the end of each session. Last updated 2026-10-30.

## Just finished

Committed on `main`, not pushed: "Move Shadows to darktable's shadows lift; match Highlights to darktable", which Oli tried and liked:

- **Shadows is now darktable's colour balance rgb shadows lift** (`shadows_Y`, masks at darktable's defaults), in `colorbalance.ts`/`.glsl`. Measured on 12 of Oli's RAWs: the tones he calls shadows (20-40% on screen) sat at -4.9 and -4.1 EV on the tone equalizer's map, where the compress preset gives 0.8 to 0 EV. The lift gives about +0.9 EV in deep shadows, +0.75 at 25%, +0.6 at 35% and +0.32 at middle grey at +100. Old sidecars with Shadows set will render differently.
- **Highlights follows darktable's compress preset shape**: 3:5:5:3 over -3, -2, -1 and 0 EV (it was 3:5:5 over -2 to 0). The tone equalizer now runs only for Highlights.
- New rule in CLAUDE.md and PORTING.md: stay true to darktable's code for tones; deviations need Oli's agreement.

Committed and pushed on `main`:

- `9b48663` Point tone curve (darktable monotone spline), master and per channel.
- `a7f2e93` White balance: Temperature/Tint by CAT16 from the RAW's as-shot white, presets, eyedropper.
- `2524188` Film grain from the Boolean grain model's statistics (Newson et al. 2017); ISO presets set Size and Roughness.
- `1167959` Zoom and pan (full resolution loads on demand), clipping overlay (J), pinned histogram, folding panel sections, one-line sliders; fix for texture-unit binds that put a grey patch on lifted curve highlights.
- `49242ee` Undo/redo with history, Before toggle and split view (Y), per-section Reset, custom macOS menu (undo wasn't reaching the app), Neutral stock as the default.

## In progress

Nothing half-done.

## Known issues and open questions

- **Deviations from darktable from before the rule** (Oli to decide): the neutral sigmoid uses contrast 1.15, skew 0.11 and black target 0 (darktable: 1.5, 0, 0.0152%); colour balance contrast pivots on 0.18 rather than 0.1845.
- **Blown RAW highlights render light grey (~87% white)**: sigmoid rolls off instead of clipping. Whites fixes it per photo; RAW highlight recovery is the planned fix.
- **Grain was tuned on synthetic ramps**; strength per ISO and colour share still need Oli's judgement on real photos at 100%.
- **Untested by Claude** (needs the real app): zoom/pan/pinch interactions, the custom menu's Undo/Redo/Select All, the split divider while zoomed.
- RAW brightness (`BASELINE_GAIN` 1.8 in `src-tauri/src/raw.rs`) is a per-photo-noisy average; a per-camera baseline is on the roadmap.

## Next

Oli chooses between:

1. **Batch 3:** crop and straighten with aspect presets (3:2, 4:5, 1:1), then user presets (save and apply looks).
3. Later: **Batch 4** — ratings, flags and filtering in the library; an EXIF info overlay.
