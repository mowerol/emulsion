# Handoff

Rewritten at the end of each session. Last updated 2026-10-30.

## Just finished

This session, in order, all committed and pushed on `main`:

- **Shadows fix** (pushed): Shadows is darktable's colour balance rgb shadows lift (`shadows_Y`, masks at darktable's defaults); Highlights follows darktable's compress preset shape (3:5:5:3 over -3 to 0 EV) and the tone equalizer runs only for Highlights. Measured on 12 of Oli's RAWs first: his "shadows" (20-40% on screen) sat where the old band lift gave 0.8 to 0 EV. Oli tried it: "way better".
- **Crop and straighten** (pushed, Batch 3 part 1): `film/crop.ts` geometry, a crop draft in the store saved as one undo step, `CropOverlay`, a Crop section; R starts it, X turns the frame, Enter keeps, Esc cancels. Grain, vignette, halation and glow stay tied to the uncropped frame; pasted settings keep each frame's own crop.
- **Clarity** (`d978a6b`): darktable's local laplacian (local contrast module; +100 is its clarity preset) after the tone curve. `locallaplacian.ts` reference, `ll*.frag.glsl` passes, cached across view-only renders.
- **Texture** and **double-click a slider's handle to reset it** (`aa5c3ac`): darktable's contrast equalizer ("sharpen" preset, darktable's mix = slider / 100) in scene light; `equalizer.ts`, `eq.frag.glsl` on 32-bit targets; Lab maths shared in `lab.ts` / `stages/lab.glsl`.
- **The porting rule widened** (in `d978a6b`): port whichever open-source tool the community rates best for a job (darktable by default, RawTherapee or ART where stronger) and stay true to its code. See CLAUDE.md and docs/PORTING.md.

## Last commit (`685ad41`), not yet tried by Oli in the app

- **Sharpening**: RawTherapee's capture sharpening, a Sharpening slider (0-100 = iterations; 100 is RawTherapee's 20) after Clarity, RAWs only, alongside the scanners' own sharpness (Oli: keep that; maybe a toggle later). Rust `capture.rs` reads the raw mosaic (new `emu_raw_mosaic` in the shim) for RawTherapee's auto radius (Bayer and X-Trans) and clip mask; `capture_info` command (cached for the last photo). GPU `cs.frag.glsl`, reference `capture.ts`; the sharpened source replaces the source for every later pass. Probe: GPU within 0.1% of the reference, thresholds equal; 0.18 s at preview size, 0.65 s at 20 MP when redone. Measured radius: OM-3 0.43-0.71, X-T30 II 0.71-1.36. Oli asked whether it should be so subtle: yes (pixel-level, mostly visible at 100%); options for more bite are letting the slider go past 20 iterations, or porting RawTherapee's separate output sharpening later.
- **Filmstrip filter**: All / Edited / Unedited with counts above the strip in Develop (`library/filter.ts`, tested). The active photo always stays shown; in Develop the arrow keys step through the shown photos only; the choice is remembered (localStorage).
- **Filmstrip as film**: each frame is a length of film with rounded sprocket holes; developed frames (colour and B&W alike) on `#281f18` with the original amber edge print (Oli chose both after an orange and a grey try he rejected), unedited ones on the dark rebate; the active outline is warm white. Oli hasn't seen the final colour with real thumbnails yet.

## Pushed (`970ceae`)

Committed; Oli has not tried these in the app yet:

- **Filmstrip all on film**: every frame sits on the `#281f18` base now (Oli: "just the brownish colour throughout"). Edited frames show the stock in amber edge print; unedited ones a dimmed "ORIGINAL", as in the Library grid.
- **Workspace colour** on a right-click in Develop (Oli asked for right-click rather than swatches in the zoom bar): Black, Dark grey (the default), Mid grey (18%, sRGB 118), White, as Lightroom offers. `StageMenu.tsx`; remembered in localStorage (`stageColor` in the store); the colour around a straightened photo follows it; status lines get a scrim on light colours.
- **Ratings, colour tags and hearts** (Batch 4, part 1). Oli chose to keep them in the Emulsion sidecar (no XMP). `library/marks.ts` (tested): 0-5 set stars, 6-9 toggle red/yellow/green/blue (Lightroom's keys), H toggles the heart (Oli's addition: a favourite, independent of stars and tag). They apply to the selection, are undoable, and a toggle on a mixed selection gives the mark to all first. The sidecar gains `rating`, `label`, `heart` (skipped when empty; `recipe` may be `null`; old sidecars still read; removed when nothing is left). Shown on Library cells, on the strip's bottom edge, and clickable in the panel under the lab order line (clicking the current star clears it).

## Pushed (`1f5965e`)

- **Filter by stars, heart and colour tags** (Batch 4, part 2). One filter (`library/filter.ts`, tested) for the Library grid and the filmstrip, in a shared `FilterBar`: All / Edited / Unedited, at least N stars (click the chosen star again to turn it off), hearted only, any of the chosen tags; criteria combine. Shows "N of M" and Clear when on. The active photo always stays shown. Arrows (and a grid row down), Home/End, shift-click ranges and Select All work within the shown photos. Remembered as `emulsion.filter` (the old strip choice carries over). Export and "Apply to all" still mean every photo.

## Pushed with this handoff

- **Sharpening** (Oli tried it: "works great") (Oli: capture sharpening was too subtle; keep it, rename it, add a traditional tool). RawTherapee's Sharpening module, unsharp mask (RawTherapee is the stronger tool here; darktable's sharpen is a plain USM). Detail section, new: Texture, Clarity, Sharpening (amount 0-100 = RT amount / 10, its default 200 at 20), Radius (RT's, 0.3-3, default 0.5), Masking (0-100 = RT contrast threshold / 2, default 10), Capture (the old Sharpening slider, now `captureSharpening`; `sharpening` in old sidecars is read as it). Hold ⌥ on Masking to see the mask. `usm.ts` reference (tested), `usm.frag.glsl` (3 passes, 32-bit), `stages/usm.glsl` after Tone and print, before grain. Probe: GPU within 1e-6 of the reference (`out.usm`). Probe photo mode now takes `slider=sharpen` (0 / 20 / 60 at 1:1; at 20 it is clearly crisper on a 3000 px camera JPEG, 60 is crunchy). Needs `--virtual-time-budget` for the photo mode to finish. Deviations recorded in the header and NOTICE: exact Gaussian above sigma 0.6, clamped borders. As in RawTherapee, a radius under 0.25 px at the source's scale does nothing, so the fitted preview shows little; 100% and exports show it all.

## Pushed with this handoff

- **Colour** (HSL): darktable's **color equalizer** (`src/iop/colorequal.c` v4). Oli asked whether anyone does colour editing better than darktable; nobody does (darktable's docs call it the scene-referred replacement for color zones, which is noise- and artifact-prone; RawTherapee's HSV equalizer and ART's Color Equalizer are older display-referred versions). Oli chose Lightroom-style tabs: a Colour section after the Tone curve with Hue / Saturation / Brightness and 8 sliders (red, orange, yellow, green, cyan, blue, lavender, magenta). Recipe `color` (hue ±120 = darktable's ±36°, 0.3° a step: Oli found darktable's ±180° shifted too far, chose Lightroom's reach, then ±120 to differ a little; saturation ±100 = darktable's gain 0.5-1.5, grey to double (Oli saw darktable's ×3 saturate and stop early); brightness ±100 = its gain 0.7-1.3, Oli's call after darktable's full range sent vivid colours to black; null when all 0). The brightness tracks show that reach. Runs after Texture and before colour balance, as in darktable's order.
  - `colorequal.ts` reference (tested): darktable UCS 22 HSB, periodic RBF hue curves (least squares via `choleskySolve`), the chromaticity prefilter and the guided filter of corrections, gamut mapping. Deviations (header and NOTICE): exact Gaussians, clamped borders, logistic evaluated directly; darktable's downsampling path not ported (never used at its default radii).
  - GPU: tap 4 of the develop pass writes U, V, L*, saturation; `ce.frag.glsl` runs 7 passes on 5 RGBA32F targets and writes the finished colour, which `stages/colorequal.glsl` takes in place of the pipeline's. Probe (`out.colorEq`): GPU within about 2e-6 of the reference in all cases. Lesson: each pass must rebind all its input units, or a target still bound from an earlier step makes a feedback loop and WebGL silently drops the draw (cost an hour here).
  - darktable's own behaviour to know: curves through eight nodes at rest ripple about 0.15%, so the stage is skipped when all values are 0; a node's change reaches round to neighbouring hues a little (red saturation +50 gives blue about +2%).
  - Slider tracks (`sliderGradient`): one colour of each node's hue (mid brightness, 60% of the most saturated sRGB shows there) run through process()'s per-pixel formulas at each slider position, so a track shows the real swing. darktable's own GUI gradients (fixed pastel, generic ramp) were tried first and Oli found they did not show the swing. 20 stops, cached per channel and node. The probe's `?tab=Hue|Brightness` opens that tab for a screenshot.
  - Probe photo mode takes `slider=redsat` (red saturation -100 / 0 / +100): on the billboard photo the red letters go grey or vivid, blues and greys stay.
  - Memory: 5 full-size 32-bit targets at 24 MP is about 1.9 GB of GPU memory when zoomed or exporting. Untested at full size on the real app.

- **Speed** (Oli: the Colour part of the editor felt the most sluggish; no algorithm removed):
  - Screen renders are paced by a GPU fence (`Engine.idle`, checked in Develop's render effect): a new frame is drawn only when the last has finished, always with the latest settings, so drags no longer build a queue of 50-150 ms renders. Untested by Claude in the real app; it is likely the biggest felt difference.
  - Each whole-photo map is keyed only on the uniforms of the stages upstream of it, read from the stage shaders (`BEFORE_TEXTURE`, `COLOR_STAGE`, `BEFORE_CLARITY`... in engine.ts), so e.g. a Colour drag no longer remakes Texture, and Grain or Curve no longer remake anything. Probe `out.mapCache`: an engine walking through edits matches a fresh engine's render exactly at every step.
  - The edited photo's filmstrip thumbnail is redeveloped 400 ms after edits pause (`SETTLE_MS` in thumbs.ts), not on every slider step.
  - Stock tiles keep the decoded photo and yield to input between tiles.
  - Colour's prefilter and guided steps each write two targets in one draw (`Gpu.pair`), 5 passes instead of 7; no measurable change at preview size, should help at full size.
  - Probe timings at the app's preview scale (2560 px of a 6000 px original, read-back included, about 55 ms of it): still frame with Texture, Clarity, Sharpening and Colour on 79 ms; Colour drag alone 102 ms; with the others 180 ms (was 324 ms keyed on the whole recipe).
  - Still to consider: the tone equalizer map, highlight pyramid and scanner blur are remade on every render (also when panning); they could be keyed the same way.
- **Filter fix** (Oli's bug): opening a folder under a remembered filter, or setting a filter that hides the active photo, now makes the first matching photo active instead of showing a frame the filter excludes.

## Known issues and open questions

- **Untested by Claude** (needs the real app): how drags feel with the GPU-paced rendering; the filter fix on opening a folder; Colour on real photos, its speed while dragging (the map is redone on every change) and at full size; Sharpening at 100% on real photos and in an export, ⌥ on Masking (does macOS Option on a range input behave?), and full-size speed of the sharpening passes; the filter bar's clicks in Library and Develop, arrow keys and shift-click ranges with a filter on; the right-click workspace menu (and that macOS shows no native menu over it); the 0-9 and H keys in both views and with several frames selected; that a rating on an unedited photo writes a sidecar and survives reopening the folder; Sharpening on a real RAW at 100% and in an export; the filter's buttons and arrow keys with a filter on; the strip with real thumbnails; double-click reset; the crop overlay's drags, keys and Undo while cropping; zoom/pan/pinch; the custom menu's Undo/Redo/Select All.
- **Strength to judge on real photos**: Clarity (+100 = darktable's preset), Texture (+100 doubles the finest detail, probably wants +20 to +50), Sharpening.
- **Full-resolution speed while zoomed**: Clarity and Texture rerun on edits at full size (Clarity about 5x the preview's 70 ms).
- **Deviations from darktable from before the rule** (Oli to decide): the neutral sigmoid uses contrast 1.15, skew 0.11 and black target 0 (darktable: 1.5, 0, 0.0152%); colour balance contrast pivots on 0.18 rather than 0.1845.
- **Blown RAW highlights render light grey (~87% white)**: sigmoid rolls off instead of clipping. RAW highlight recovery is the planned fix.
- **Grain was tuned on synthetic ramps**; strength per ISO still needs Oli's judgement at 100%.
- RAW brightness (`BASELINE_GAIN` 1.8 in `src-tauri/src/raw.rs`) is a per-photo-noisy average; a per-camera baseline is on the roadmap.

## Tools added this session

- The probe's `?img=<file URL of a JPEG>&slider=clarity|texture` mode renders a real photo at -100/0/+100 for a screenshot (make the JPEG with `sips -s format jpeg -Z 2560 file.ORF --out x.jpg`). Real-time timings need `--timeout=60000` instead of `--virtual-time-budget` (virtual time freezes the clock).
- `cargo test --release --lib measure_radius -- --ignored --nocapture` with `EMULSION_RAW_SAMPLES=a.orf:b.raf` prints RawTherapee's auto radius for real files.
- Upstream sources used: darktable at `20891f6c` (sparse clone, was in `/private/tmp/claude-502/darktable-src`), RawTherapee at `b2ee504c` (sparse clone of `rtengine` in the session scratchpad). Both are temporary; re-clone if needed.

## Next

1. Oli tries the speed work in the real app (GPU-paced rendering) and the filter fix.
2. **Batch 3, part 2:** user presets (save and apply looks).
3. Oli's roadmap ideas: right-click the tone curve for preset curves (a subtle S curve first) and save his own curves; export with borders; export several photos on one canvas separated by borders (social media posts); more film stocks; Fuji film simulations and recipes.
4. UX ideas offered and not yet picked: hover a stock to preview it on the main image; slider edits applying to every selected frame; a `?` shortcut sheet.
5. Later: an EXIF info overlay.
