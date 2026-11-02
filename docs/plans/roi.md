# Developing only what is on screen (region of interest)

Oli, 2026-11-02: "Let's do 1, I think we need to keep optimizing for speed." Option 1 was rendering only the visible region at full resolution, as darktable's darkroom does.

## Why

At 100% the view develops the full-size source, and every stage keeps targets the size of the whole photo. On a 40 MP RAF with dehaze, clarity, Colour, Capture and Sharpening that comes to about 10.5 GB of GPU memory (dehaze 6 + 3 targets, Colour 5, Sharpening 2, 32-bit, ~640 MB each, plus 16-bit source copies). WebKit kills the webview above 8 GB and the page reloads onto the Library (see HANDOFF, "Diagnosis"). Every edit at 100% also redoes these maps over 40 MP when the screen shows about 3 MP of it.

## What darktable does

darktable's full pipe processes only the region on screen (`roi_out`). Each module says how far it reaches: its tiling `overlap` (atrous `max_filter_radius`, colorequal `16 + maxradius`, bilat `4σ` or the laplacian radius, hazeremoval 0) and, for a few, `modify_roi_in` (lens: the distorted input; retouch: the spots' sources; toneequal: the guided filter's radius). Whole-photo quantities come from the **preview pipe**:
- hazeremoval's A0 and distance_max (`hazeremoval.c`, "taken from preview pipe"); Emulsion already measures these at ≤1280 px.
- the local laplacian pads the region from the preview buffer and takes its coarsest level from it (`common/locallaplacian.c`, `local_laplacian_boundary_t`).

darktable's own darkroom does not pad atrous or colorequal, so its region edges differ slightly from an export. **We pad each region by the module's own declared overlap**, so the view matches an export. That is a faithful use of darktable's numbers, not a retuning.

## Design

- **Region source.** `Engine.render` gets a region `R` (in full-source pixels) when the view shows the full-size source zoomed in. The region is the visible rectangle mapped back through crop, perspective and lens distortion, plus the reach of every active stage, rounded out to the capture-sharpening tile grid so its early stop sees the same tiles. Stages then run on an `R`-sized source exactly as they run on a whole one today. A `Source` gains `roi: {x, y, w, h}` (normalized whole-source coordinates). Its `w × h` is the region's size, and its `fullW/fullH` stay the photo's.
- **One scale helper.** Every `src.w / src.fullW` becomes `pxScale(src)`, the source's pixels per full-resolution pixel, so a region at 100% has scale 1, not `R.w / fullW`.
- **Coordinates.** The develop pass computes the full-photo `uv` as now, then samples the source and every source-sized map at `(uv − roi.xy) / roi.wh` (`uRoi`). Masks (gradients, ellipses, the mask stack's brushes and objects, which stay whole-photo at ≤3072 px), grain, vignette, halation and glow keep the full `uv`. Analysis taps over a region write region pixels and evaluate masks at the mapped full `uv`.
- **Whole-photo passes come from a whole source.** The tone equalizer map, the highlight pyramid (halation, glow), the dehaze ambient light, refined masks and the capture threshold are low resolution or global. In region mode they run on the photo's preview-size source (its own render, cached as the fit view's is), as darktable takes them from its preview pipe. `Engine.render` takes `opts.whole?: Source`.
- **Caches.** Each map's key gains the region. Panning within the padded region reuses everything. The region is the visible rectangle grown by a margin (half a screen) so small pans don't recompute. A pan beyond it recomputes at region cost (~3–6 MP).
- **Gate.** A recipe that uses a stage not yet region-capable renders whole, as today. Each phase widens the gate.

## Status

- Phase 1: done (2026-11-02), see HANDOFF. Probe `?region`: worst 1/255 against a whole full-size render.
- Phase 2: done for ordinary retouch. The region grows over the spots' destination and source dependency closure in original order (`retouchInputs`, following `rt_compute_roi_in`); a previous region that covers the grown rectangle is kept, so zooming does not rebuild it. Wavelet retouch and its scale viewer still fall back to the whole source.
- Phase 3: done for photo and masked Clarity/Texture, refined masks and masked Dehaze. Per-instance coarse products survive later instances reusing scratch buffers. Odd source dimensions, image edges and switching preview providers are regression cases.
- Zoom path: a previous region is reused while it covers the view, but not when it is more than 3× the tight region (6 MP floor), so a broad zoom's large lane is rebuilt once the view gets much tighter. `chooseRegionWithin` drops the pan margin rather than cross the 60% gate. When no region is worth it, the preview stands in until the frame is shown at 1.5× its pixel width, so the band between the preview's resolution and the region gate no longer develops the full-resolution photo.
- Boundary provenance: the pinned local-laplacian helper has mode 2, but `bilat.c` calls it with a null boundary. Emulsion uses its coarse sampling with a real filter halo instead of LL_FILL padding. The preview result is not promised identical to full-image mode 0; export retains full-size processing.
- Validation and measured limits: [region-detail.md](../research/app-performance/region-detail.md).

## Phases

1. **Mechanism and the RAW defaults.** `pxScale`, `Source.roi`, `uRoi`, region choice in Develop with margin, whole-photo passes from the preview source; region-capable: noise blend, capture sharpening (tile-aligned; threshold from the whole source), lens correction (input region from the distortion, as darktable's `_modify_roi_in_md`), profile early pass, dehaze (A0 from whole; pad w1 + w2 as the box filters reach), Colour (pad `16 + maxradius`), Sharpening (pad the kernel and the 2 px mask blur), masks and refined masks. This covers the crash case and every RAW opened with defaults.
2. **Retouch.** The region grows to include the sources of spots that land in it (darktable's `rt_compute_roi_in`), and the wavelet hats' reach.
3. **Texture and Clarity.**
   - **Clarity** uses the coarse-boundary sampling from darktable's full-pipe helper mode (`common/locallaplacian.c`, `b->mode == 2`): the region's pyramid stops at level `min(4, levels − 1)`, the input is padded by `1 << last_level` px from the preview's padded input (`LL_FILL`, nearest preview pixel), the coarsest output level is the preview's output pyramid resampled trilinearly between the two preview levels whose pixel footprint brackets the region's (`pl = log2(psize)`), and levels 3 to 0 are collapsed from the region's own Laplacians. The products pass therefore runs the preview's Clarity and hands over its output pyramid.
   - **Texture: coarse bands from the preview (Oli, 2026-11-02: "Coarse bands from preview").** A deviation from darktable, whose atrous has no boundary mode; record it in `engine/equalizer.ts`'s header and NOTICE. The change map is Σ (boostᵢ − 1) · detailᵢ. The region computes darktable's bands with spacing ≤ 32 px at full size (reach 2 · 63 px); the preview computes its own decomposition, and the bands whose full-resolution support is larger than the region's last (`(2 · (2 << j) + 1) / previewScale > 129`) give a coarse change map that is resampled at the whole-photo `uv` and added to the region's map in one pass (no extra develop texture unit). The scale count (`maxRoi`) and the bands' boosts come from the whole photo's size, not the region's.
   - Masks' Texture and Clarity instances follow the same split, once the photo's instance works.

## Checks per stage

A probe case per region-capable stage: render a region and the whole photo at full size, and compare the region's visible pixels. They must agree to the stage's existing tolerance (half-float storage), with the region's edges and a region at the photo's corner included. Plus a WebKit memory run (`tools/browser-tests/ai-mask-mem`, `?fixture=` a 40 MP recipe): peak texture memory at 100% must stay roughly constant with photo size.

`tools/browser-tests/region-detail` adds a zoom-step case: 100 → 200 → 400% must reuse the same region, and a Retina-sized canvas with a 26 MP photo must use the preview at 50% rather than the full-resolution source. Results: [region-detail.md](../research/app-performance/region-detail.md).
