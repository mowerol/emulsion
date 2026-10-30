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

## In progress

Nothing half-done.

## Known issues and open questions

- **Untested by Claude** (needs the real app): Sharpening on a real RAW at 100% and in an export; the filter's buttons and arrow keys with a filter on; the strip with real thumbnails; double-click reset; the crop overlay's drags, keys and Undo while cropping; zoom/pan/pinch; the custom menu's Undo/Redo/Select All.
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

Oli is focusing on UX and usability now:

1. Oli tries the last commit (Sharpening at 100%, the filter, the strip) and says what to change.
2. More UX and usability improvements, Oli's call. The filmstrip filter was the first.
3. **Batch 3, part 2:** user presets (save and apply looks).
4. Later: **Batch 4**, ratings, flags and filtering in the library; an EXIF info overlay.
