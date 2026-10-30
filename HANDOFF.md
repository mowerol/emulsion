# Handoff

Rewritten at the end of each session. Last updated 2026-10-30.

## Just finished

Committed, not pushed:

- **Clarity**: darktable's local laplacian (local contrast module; +100 is its clarity preset) as a Clarity slider after Blacks. GPU passes in `engine.ts` (`clarityMap`, cached across view-only renders), reference in `locallaplacian.ts`; the probe checks it within 0.0013 lightness, and has a `?img=` mode that renders a real JPEG at Clarity -100/0/+100 for a screenshot. About 70 ms per edit at preview size; strength and full-resolution speed still to be judged by Oli in the app.

Committed and pushed on `main`:

- **Crop and straighten** (Batch 3, part 1): `film/crop.ts` geometry, a crop draft in the store saved as one undo step, `CropOverlay`, a Crop section in the panel; R starts it, X turns the frame, Enter keeps, Esc cancels. Film effects (grain, vignette, halation, glow) stay tied to the uncropped frame; pasted settings keep each frame's own crop.

Also pushed: "Move Shadows to darktable's shadows lift; match Highlights to darktable", which Oli tried and liked:

- **Shadows is now darktable's colour balance rgb shadows lift** (`shadows_Y`, masks at darktable's defaults), in `colorbalance.ts`/`.glsl`. Measured on 12 of Oli's RAWs: the tones he calls shadows (20-40% on screen) sat at -4.9 and -4.1 EV on the tone equalizer's map, where the compress preset gives 0.8 to 0 EV. The lift gives about +0.9 EV in deep shadows, +0.75 at 25%, +0.6 at 35% and +0.32 at middle grey at +100. Old sidecars with Shadows set will render differently.
- **Highlights follows darktable's compress preset shape**: 3:5:5:3 over -3, -2, -1 and 0 EV (it was 3:5:5 over -2 to 0). The tone equalizer now runs only for Highlights.
- New rule in CLAUDE.md and PORTING.md: stay true to darktable's code for tones; deviations need Oli's agreement. (Widened later, uncommitted: port whichever open-source tool the community rates best for the job, darktable or RawTherapee/ART.)

Earlier, also pushed:

- `9b48663` Point tone curve (darktable monotone spline), master and per channel.
- `a7f2e93` White balance: Temperature/Tint by CAT16 from the RAW's as-shot white, presets, eyedropper.
- `2524188` Film grain from the Boolean grain model's statistics (Newson et al. 2017); ISO presets set Size and Roughness.
- `1167959` Zoom and pan (full resolution loads on demand), clipping overlay (J), pinned histogram, folding panel sections, one-line sliders; fix for texture-unit binds that put a grey patch on lifted curve highlights.
- `49242ee` Undo/redo with history, Before toggle and split view (Y), per-section Reset, custom macOS menu (undo wasn't reaching the app), Neutral stock as the default.

## In progress

Nothing half-done. Next is Texture (darktable's contrast equalizer).

## Known issues and open questions

- **Deviations from darktable from before the rule** (Oli to decide): the neutral sigmoid uses contrast 1.15, skew 0.11 and black target 0 (darktable: 1.5, 0, 0.0152%); colour balance contrast pivots on 0.18 rather than 0.1845.
- **Blown RAW highlights render light grey (~87% white)**: sigmoid rolls off instead of clipping. Whites fixes it per photo; RAW highlight recovery is the planned fix.
- **Grain was tuned on synthetic ramps**; strength per ISO and colour share still need Oli's judgement on real photos at 100%.
- **Untested by Claude** (needs the real app): the crop overlay's drags, its keys and Undo while cropping; zoom/pan/pinch interactions, the custom menu's Undo/Redo/Select All, the split divider while zoomed.
- RAW brightness (`BASELINE_GAIN` 1.8 in `src-tauri/src/raw.rs`) is a per-photo-noisy average; a per-camera baseline is on the roadmap.

## Next

Oli chooses between:

1. **Texture/micro-contrast**, then **sharpening**, in that order after Clarity (Oli). Texture: darktable's contrast equalizer (à-trous wavelets, like RawTherapee's wavelet levels), unless Oli wants RawTherapee's own. RawTherapee's capture sharpening (RL deconvolution) is fair game under the updated rule (port the community's best, not only darktable) as a replacement for Emulsion's own unsharp-mask Sharpen.
2. **Batch 3, part 2:** user presets (save and apply looks).
3. **Filter the filmstrip to edited photos** in Develop (Oli asked for it).
4. Later: **Batch 4** — ratings, flags and filtering in the library; an EXIF info overlay.
