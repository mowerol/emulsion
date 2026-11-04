# Architecture

Emulsion has two halves. The Rust core (`src-tauri/`) owns the file system: it scans folders, decodes photos, caches thumbnails, reads and writes sidecars, and encodes exports. The webview (`src/`) owns the interface and the image pipeline, which runs on the GPU through WebGL2.

```
 Rust core (src-tauri/src)                    Webview (src)
 ─────────────────────────                    ─────────────
 library.rs   scan_folder ──── entries ─────▶ library/store.ts   folder, photos, recipes, selection
 thumbs.rs    thumbnail   ──── JPEG bytes ──▶ library/thumbs.ts  grid and filmstrip thumbnails
 decode.rs    load_image  ──── RGBA half ───▶ engine/            develop on the GPU
 sidecar.rs   write_sidecar ◀─ recipe JSON ── library/sidecars.ts (debounced)
 export.rs    write_export  ◀─ RGBA8 pixels ─ library/export.ts
```

## The film pipeline

### Colour

- **Working space:** scene-linear Rec.2020, the same choice darktable makes. Everything up to the tone stage happens in scene light, where light adds and multiplies physically.
- **Input:** ordinary photos are display-referred, so the input stage expands them into scene light with the inverse of the neutral tone curve. This guarantees that a photo with no look applied (or with Compare held) renders back exactly as it came in. RAW files arrive already scene-linear (input mode 2) and skip the expansion.
- **Output:** the tone stage produces a display-encoded print in Rec.2020 primaries; grain is added to its lightness, then the output stage converts it to sRGB and the scanner works on the display image, like a real scan.

Input modes (`engine/params.ts`, `InputMode`):

| Mode | Meaning | Used for |
| --- | --- | --- |
| 0 | Linear light, sRGB primaries, display-referred | Decoded JPEG, PNG, TIFF, WebP |
| 1 | sRGB-encoded, display-referred | 8-bit thumbnails in the browser |
| 2 | Scene-linear Rec.2020 | Decoded RAW |

### Stages

RAW sources first pass through cached embedded lens correction (`engine/lenscorrection.ts`, `lenscorrect.frag.glsl`), after capture sharpening but before all analysis maps and creative edits. Rust's bounded TIFF/maker-note reader supplies Fuji/Sony/Olympus/DNG profiles in the decoder payload. The pass recovers white-balanced camera RGB with the decoder's matrix, applies source-space vignette gain and per-channel radial bilinear resampling, then returns to Rec.2020. RAW working values retain their sign until after this pass so camera channels can be reconstructed. The correction is on by default, independently switchable per photo; DNG's combined warp has one switch/strength as upstream. Camera JPEG previews are never corrected twice: edited RAW thumbnails and stock previews decode a small RAW instead.

Camera profiles form the base rendering independently of creative film LUTs. RAW
sources carry a separate camera metadata block (payload flag 4, available with or
without flag 2 lens data): make/model, the exact camera-to-working matrix,
as-shot camera neutral and existing exposure gain. `engine/dcp.ts` ports
RawTherapee's DCP processing; `profilegpu.ts` owns the calibration/look/gamma/tone
textures and a cached early profile target. The early pass runs after embedded
lens correction and before every scene analysis map. The late profile pass runs
after scene edits, supplying baseline exposure, an optional look table and tone
curve. A DCP curve replaces the neutral sigmoid; otherwise the neutral sigmoid
renders the base. The optional film LUT is applied to this base print. Amount
zero returns the same base profile. Compare retains the camera rendering.

The user DCP library lives under `app_data_dir()/camera-profiles/`, addressed by
content hash. `profilestore.ts` resolves Auto/Standard and explicit DCP choices,
checks camera binding and coordinates asynchronous loading. Preview, thumbnails,
look tiles and export all prepare the same profile. Explicit missing/wrong-camera
profiles fail rather than exporting a substitute. New photos use Auto with LUT
None and the Straight scanner. No manufacturer camera-matching dataset is
bundled. See [camera profile reference](plans/camera-profiles-reference.md) for
the exact port, processing order and limits.

Each stage is one GLSL file in `src/engine/shaders/stages/`, included into `develop.frag.glsl` in this order. Its parameters come from the recipe through `engine/params.ts`.

| Stage | File | Domain | What it does | Planned replacement |
| --- | --- | --- | --- | --- |
| Capture sharpening | `cs.frag.glsl` (own passes) | scene | Capture (RAWs only): RawTherapee's capture sharpening deconvolves the source's luminance before anything else; the result replaces the source for every later pass. **Ported from RawTherapee** | |
| Retouch | `engine/retouch.ts` (CPU) | scene | Clone and heal spots: darktable's retouch module and heal.c, run on the CPU over the rectangle the spots touch (`Engine.retouched`: a copy of the source, the rectangle read back, retouched, written back), after lens correction and the profile's early pass and before haze removal (darktable runs it after haze removal; agreed deviation). The result replaces the source for every later pass, kept until the spots or the source change. Spots are in source coordinates (`recipe.retouch`, `film/retouch.ts`). **Ported from darktable retouch** | |
| Input | `input.glsl` | scene | Bring any source into scene-linear Rec.2020 | |
| Sharpen | `optics.glsl` | scene | Scanner sharpness, a log-domain unsharp mask | |
| Dehaze | `dehaze.glsl` | scene | darktable's haze removal: (x − A0) / t + A0 with the transmission t from its guided filter (`dehazegf.frag.glsl`) and the ambient light A0 measured per photo; see Haze removal below. **Ported from darktable haze removal** | |
| Exposure | `exposure.glsl` | scene | White balance (CAT16 from the as-shot white to the chosen one, **ported from darktable**), exposure, and black level (Blacks below zero, as darktable's exposure module) | |
| Masks (exposure) | `masks.glsl` | scene | Each mask's exposure and white balance, blended in by its value: darktable's drawn masks (gradient and ellipse evaluated per source pixel at the top of the pass, `computeMasks`; brushes read from layer 0 of the mask stack, a half-float texture array (`maskstack.ts`) that `BrushGpu` draws into with `brush.vert/frag.glsl` and the engine binds to unit 7 just before each masked draw), times darktable's blendif ranges on JzCzhz at this instance's input (`maskAt`). A mask with Refine settings is instead read from its channel in layers 1–2, which `MaskRefineGpu` fills (darktable's blur, guided-filter feathering and mask tone curve, `maskrefine.frag.glsl`) from a tap of this instance's input (`uTap` 6). AI objects (darktable's pixel masks, `film/objectmask.ts`) are resampled by `ObjectGpu` (`object.frag.glsl`) into the stack's layers after all of those (from layer 0 when nothing else needs the stack; `uMaskObjectLayer`), one channel each, at most 8. The value is kept and reused by the mask's later instances (darktable's raster mask). **Ported from darktable masks** (see [masks plan](plans/masks.md)) | |
| Tone equalizer | `toneequalizer.glsl` | scene | Highlights: exposure by brightness band through an edge-aware brightness map, in the shape of darktable's compress shadows/highlights presets. **Ported from darktable tone equalizer** | |
| Masks (tone equalizer) | `masks.glsl` | scene | Each mask's Highlights: a second tone equalizer instance after the photo's own, with the photo's slider mapping and its own brightness map made from its own input (the scene after the photo's instance and the earlier masked ones), blended in by the mask's value. The maps share unit 4 as an atlas, one tile per instance (tile 0 the photo's), built in order by `Engine.toneEqualizerMap` | |
| Texture | `texture.glsl` | scene | Texture: darktable's contrast equalizer (its "sharpen" preset, with darktable's mix as the slider) on CIE L*, from a map the `eq` passes make over the whole photo; keeps Lab a and b. The map is the change in L*: the photo's instance and then each mask's Texture, a masked instance on its own input, blended by the mask (`maskfold.frag.glsl`). **Ported from darktable contrast equalizer** | |
| Colour | `colorequal.glsl` | scene | Colour: hue, saturation and brightness for eight colours, red to magenta, from a map the `ce` passes make over the whole photo (darktable's two guided filters keep the changes even across an area and off greys). A custom look's HSL is a second instance before the photo's own (darktable's multiple instances: the photo's reads the look's output, `ce.frag` mode 7), scaled by the look's Amount like its colour balance instance (`film/creative.ts` `lookColorFor`); its output stays in the lane's sixth colour target while the photo's own HSL changes. Skipped when every value is 0. **Ported from darktable color equalizer** | |
| Colour balance | `colorbalance.glsl` | scene | A saved creative profile's hidden instance first (`stageProfileColorBalance`, scaled by the profile's Amount; `film/creative.ts`), then the photo's own: contrast, vibrance, saturation and shadows plus the recipe's Colour Grading: four hue/chroma/luminance wheels, chroma/saturation/brilliance by tone, hue shift and mask/contrast fulcrums. Shared controls feed one instance; `film/grading.ts` normalises additional recipe fields. **Ported from darktable colour balance rgb** | |
| Masks (colour) | `masks.glsl` | scene | Each mask's colour balance instance (contrast, shadows, vibrance, saturation), after the photo's own, blended in by the value its exposure instance found | |
| Creative vignette | `lens.glsl` | scene | Manual light falloff, separate from embedded lens correction | |
| Optics | `optics.glsl` | scene | Halation and glow, added back from blurred highlights | |
| Profile tone | `dcp.glsl`, `tone.glsl` | scene to print | RawTherapee DCP baseline exposure/look/Adobe tone curve, or the neutral darktable sigmoid per channel (**ported from darktable sigmoid**) when the profile has no curve. Whites/positive Blacks set display targets. | |
| Look | `lut.glsl` | print | Optional creative LUT (a bundled pack's, or a custom look's: its own LUT file or the system look it refers to; `library/userlooks.ts`, `src-tauri/src/user_looks.rs`) on the camera profile’s print, with Blend Normal or Colour (darktable's color blend mode, `engine/blend.ts`: the LUT's hue and saturation, the print's lightness): convert to sRGB, tetrahedral lookup, blend by Amount, return to print encoding. Never supplies the base rendering. **Ported from darktable lut3d** | |
| Clarity | `clarity.glsl` | print | Clarity: darktable's local laplacian filter (its local contrast module's clarity preset) on CIE lightness, from a map the `ll*` passes make over the whole photo; keeps Lab a and b. The map folds in each mask's Clarity the same way as Texture's. **Ported from darktable local contrast** | |
| Sharpening | `usm.glsl` | print | Sharpening, Radius, Masking: RawTherapee's unsharp mask on CIE lightness of the finished print, from a map the `usm` passes make over the whole photo; keeps Lab a and b. Runs after Tone and Clarity, before grain. **Ported from RawTherapee sharpening** | |
| Grain | `grain.glsl` | print | Grain, Size (ISO), Mid-tones: darktable's grain on CIE lightness of the finished print, after Sharpening and before output: three octaves of simplex noise fitted to real grain scans, sized by film speed relative to the frame (pushing doubles the speed per stop), through darktable's paper response so it fades in shadows and highlights; away from 1:1 it averages 21 samples per pixel. **Ported from darktable grain** | |
| Output | `output.glsl` | print to display | Rec.2020 to sRGB | Colour-managed output |
| Scanner | `scanner.glsl` | display | Levels, colour cast, contrast and saturation of the scan | |
| Curve | `curve.glsl` | display | Point curve: master, then red, green and blue, from a 256-step lookup table sampled in `film/curve.ts` (darktable's monotone spline); a saved profile's curve is composed in front of the photo's own into the same table (`composedCurveTable`) | |
| Finish | `finish.glsl` | display | Matte fade and dither | |

The neutral sigmoid’s maths is mirrored in `engine/tone.ts` so it can be unit-tested; the shader receives its constants from there. Emulsion's neutral curve uses sigmoid contrast 1.15 and skew 0.11 rather than darktable's 1.5 and 0, fitted to the curve the stocks were first tuned on, and a display black of 0 so the inverse is exact. Without a DCP tone curve, the base renders the neutral curve per channel, the exact inverse of the display-referred input stage. A DCP uses its own tone curve for both the edited photo and Compare.

### Haze removal

Dehaze is darktable's haze removal (`hazeremoval.c`, He et al.'s dark channel prior and guided filter), in darktable's place: on the scene-linear input, after lens correction and the camera profile's early pass, before exposure (`stageDehaze`, also in the tone equalizer map and highlight extraction passes). `engine/dehaze.ts` is the reference.

- **Ambient light and depth** (`Engine.dehazeAmbient`): the module's input drawn at most 1280 px across, read back, and darktable's `_ambient_light` run on it: the most hazy 5% by dark channel, the brightest 5% of those, their mean colour as A0, and the depth from the haze level at the 95% quantile. darktable's darkroom takes these from its small preview pipe; Emulsion always does, so the preview and an export agree. Kept per source.
- **Transmission** (`dehazegf.frag.glsl`, `Engine.dehazeMap`): the module's input at the source's size (`dehaze.frag.glsl`), darktable's transition map, its box maximum then box minimum, then darktable's colour guided filter (Cramer's rule, eps 0.025). Box windows are separable passes truncated at the edges, scaled by darktable's adaptive w1 = 2 + ⌈4s⌉ and w2 = 3 + ⌈6s⌉, where s is the source's width over the full image's. The guide's means are kept per source. The transition map and filter run for a strength of ±1 and are kept until the sign or A0 changes: with strength s = σk, 1 − s·m = (1 − k) + k(1 − σm), the box maximum and minimum commute with that increasing map and the guided filter is linear and keeps constants, so mode 7 takes t = (1 − k) + k(a · I + b) (`uGfScale`) and a Dehaze drag redoes one pass instead of ten (exact up to float rounding; probe ≤ 9e-7 against `dehaze.ts`, which stays darktable's literal order). Each instance is (x − A0) / max(t, tmin) + A0, with tmin from Distance; that is affine per pixel, so mode 7 folds it into one (β, α) image and the develop pass applies αx + β (unit 12).
- **Masks' Dehaze** (`Engine.dehazeMap`): darktable's second instance after the photo's, one per mask, each on its own input (the source through the instances before it, mode 8), with its own ambient light (measured on that input, mode 9), transition map and guided filter, blended normally by its mask and folded into the same (β, α) image. The mask is evaluated at the instance's input (develop tap 10: drawn × ranges there); a mask with Refine settings is refined there too (tap 9, into mask stack layers 3–4), as darktable refines each instance's mask at its own input. Distance is the photo's.
- An amount-only masked Dehaze edit reuses the unchanged instance input and mask;
  only its fold changes. The mask cache excludes its own amount but includes upstream
  input, geometry and refinement. Transmission rebuilding invalidates the mask because
  the filter reuses its scratch target; source/input changes invalidate the guide too.
- **Memory:** nine 32-bit images per instance at the source's size (six RGBA, three single-channel), about 450 MB per instance at the 2560 px preview, freed with the export buffers.
- **Checks:** probe `out.dehaze` (ambient light and depth equal to the reference, transmission within 1e-6, the stage within 4e-6) and `node tools/browser-tests/treatment-filters.mjs dehaze` (with a synthetic DCP on the shared unit 12, cache reuse, cleanup). Unit 12 is free in develop because DCP calibration runs in a separate early pass.

### Transform geometry

`recipe.transform` is null for legacy/unaltered geometry, otherwise stores camera
rotation, vertical pitch, horizontal yaw (degrees), 35mm-equivalent focal length
and `autoCrop`. It stays local to each photo when copying settings or applying
presets, and is preserved by Reset sliders. Reset Transform clears it in one
undo step.

`library/perspective.ts` renders a 900px neutral, lens-corrected, uncropped source
preview; `auto_perspective` sends binary RGBA8 through Tauri to a bounded Rust
boundary and RawTherapee's native LSD → RANSAC → Nelder-Mead fitter on a blocking
worker. Requests are discarded if the active frame or recipe changes. RAW and
JPEG 35mm-equivalent focal length is read from camera metadata when available;
missing metadata uses upstream's generic 28mm camera model, editable in the UI.

`engine/perspective.ts` ports the same native homography, re-centers it on the
source center, and optionally scales a centered rectangle to keep every corner
inside the photo. The inverse is composed with the crop affine. The final GPU
pass divides `uGeoU/V` by `uGeoW`; analysis taps explicitly reset all three rows
to identity so masks and detail maps stay in source coordinates. Full sensor
aspect keeps geometry consistent across preview and export sizes. CPU mask
handles and white-balance picking share this projective map. Compare retains
geometry, as it retains crop. See `tools/probe/perspective-reference/README.md`
for independent native, GPU and browser checks, and NOTICE for upstream licences.

### Passes

`engine/engine.ts` runs these passes per render:

```
source ─┬─ tone eq map (1/4 res) ─ down ─ ... ─ blur ── tone equalizer ─┐   (only with Highlights)
        ├─ (develop to the scene's L*) ─ wavelet scales ─ texture ─┤   (only with Texture)
        ├─ (develop to the scene after texture, analysed) ─ ce ×7 ─ colour ─┤   (only with Colour)
        ├─ (develop to the print's lightness) ─ local laplacian pyramids ─ clarity ─┤   (only with Clarity)
        ├─ (develop to the finished print's lightness) ─ usm ×3 ─ sharpening ─┤   (only with Sharpening)
        ├─ extract (1/4 res) ─ down ─ down ─ ...      highlight pyramid
        │        └─ blur at ≤256 px wide ──────────── halation ─┐
        │        └─ blur at ≤128 px wide ──────────── glow ─────┤
        ├─ down (1/2 res) ─ blur ───────────────────── sharpen ──┤
        └───────────────────────────────────────────────────── develop ─▶ screen or export
```

The tone equalizer's map holds each pixel's brightness and its square (one map per instance: the photo's, then each mask's Highlights, side by side in one atlas texture), so the blur yields the local mean and variance its edge-aware filter needs. It is halved down to the halation level (at most 256 wide) and blurred there with a sigma of 2.5% of the long edge, darktable's default smoothing; it uses 32-bit float targets where the GPU can filter them, because the variance is a small difference of large numbers. Without float targets the stage falls back to a plain per-pixel correction, darktable's "no detail preservation" mode.

Clarity runs the develop pass once more over the whole source, stopping at the tone curve to write CIE lightness, then darktable's local laplacian filter: six remapped images in two RGBA pyramids (the second also carries the lightness's own Gaussian pyramid), collapsed coarse to fine into a map of the change in lightness per source pixel, which the develop pass adds after the tone stage. The map is kept until the recipe or the photo changes, so panning, zooming and the split view reuse it. It costs about 70 ms at preview size. Without masked instances the photo's map is not made again when only the Clarity amount moves on the same side of zero: darktable's curve is affine in its shadows, highlights and detail, which the slider moves linearly from the identity at 0, and the pyramids, the interpolation weights (from the input's own Gaussian pyramid) and the collapse are linear, so the change is exactly proportional to the amount (`clarityScale`, tested in `locallaplacian.test.ts`). The whole-photo map is made at ±100 and the develop pass multiplies it by `uClarityScale` (amount / 100), so the half-float map's rounding only shrinks; its key holds the amount's sign only (Sharpening's still holds the amount). The levels kept for region views store their change from the input's Gaussian beside it (`llkeep.frag`), so `llboundary` scales them to the current amount too. A region's own map is not proportional (its preview boundary contributes a change at any amount): it is made at the amount, scaled only during a live drag (`inexact`), and made again at the settle. A Clarity drag at 100% with Texture and Dehaze on went from 35 to 14 ms a frame. Like darktable's, its finest levels are in pixels, so at full resolution (zoomed in, or in an export) clarity reaches finer detail than in the fitted preview.

Texture works the same way one stage earlier: the develop pass writes the scene's L* after the tone equalizer, and darktable's contrast equalizer runs one edge-avoiding à-trous pass per detail size (up to eight, from 5 px at full resolution to about 20% of the frame) in two 32-bit targets, keeping the coarse residue, the boosted detail and the starting L* in one texture. Its sizes are tied to the photo, not to pixels, so the preview shows the same bands as full resolution minus the finest. Its map is kept like clarity's. The Texture amount (darktable's mix) moves the preset's L curve linearly and leaves the flat sharpness curve, and so the edge weights, as they are, so each band's boost is (1 + 2·mix·g)² and the change in L* is exactly mix·A + mix²·B: the passes keep A and B (`equalizer.ts` `amountScales`, `equalizeParts`; `eq.frag` .g and .b), the photo's own decomposition is kept on each lane without its amount (`eqPhoto`), and a Texture drag only folds it again (one pass, `maskfold.frag` `uMix`). A masked instance's input carries the sum so far, so it is made again. An edit before Texture still costs the 6–7 passes. The clarity pass's input includes texture.

A mask's Texture or Clarity is darktable's second instance after the photo's own. Both modules change only Lab L, so a masked instance blended normally adds m · ΔL, and every instance folds into the stage's one map of the change in lightness (`Engine.textureDelta`, `Engine.clarityDelta`, `maskfold.frag.glsl`; two single-channel targets in turn). Each masked instance's input is a develop tap after the stage with the sum so far applied (uTap 7 for Texture, 8 for Clarity), which also writes the mask's value; the mask rides through the filter's passes in a spare channel (`eq.frag` .a, `llcurve.frag` B[0].a) to the fold. Each costs one more filter run when its inputs change. Probe `out.maskDetail`.

Sharpening (RawTherapee's unsharp mask) taps the develop pass after Clarity for the print's lightness at every source pixel, then three passes on two 32-bit targets make RawTherapee's contrast mask (blurred by 2 px) and the lightness blurred by the radius, and write the change in lightness and the mask. The develop pass adds the change before output and grain, so grain is never sharpened. The radius is in full-resolution pixels and follows RawTherapee's gaussianBlur: under 0.25 px at the source's scale there is no blur and so no sharpening, which means the fitted preview shows little and 100% and exports show it all, as in RawTherapee. Holding ⌥ on the Masking slider makes the develop pass draw the mask instead (white is sharpened). The map is kept like clarity's.

Colour (darktable's color equalizer) taps the develop pass after Texture for darktable UCS U, V, L* and RGB saturation at every source pixel, then seven passes on five 32-bit targets run darktable's chromaticity prefilter and its guided filter of the corrections (Gaussian means as exact 2D kernels of at most 7 × 7; at its default radii darktable never downsamples) and write the finished scene colour, which the develop pass takes in place of its own before colour balance. Each pass rebinds all four of its input units, since a target left bound from an earlier step makes a feedback loop and WebGL silently drops the draw. darktable's curves through eight nodes at rest ripple by about 0.15%, so the stage is skipped entirely when every value is 0. The map is kept like clarity's.

Capture sharpening runs before everything, and only for RAWs. Its metadata arrives asynchronously: attaching or replacing it invalidates any region copied before it and any cached capture result. Regions retain the contrast threshold measured over the whole full-resolution source. The native 0/1 clip mask is expanded to 0/255 with an indexed loop; a callback per pixel stalled a 26 MP zoom for about half a second. Rust reads the raw mosaic once per photo (`capture_info`, cached for the last photo) for RawTherapee's auto radius and its clip mask, which comes to the webview oriented and resampled to the decoded size, with the matrix back to camera RGB. On the GPU, `cs.frag` makes luminance and lightness, the contrast mask (its threshold measured once per source from a read-back of the lightness), and runs the Richardson-Lucy iterations on one-channel 32-bit images, with the early stop checked per 32 px tile in two passes. Each render lane retains its latest sharpened source (half floats, with mipmaps). The active full-resolution source additionally owns one result independent of these lanes, so preview and histogram work cannot overwrite it. The radius is in sensor pixels, so the half-size preview sees half of it and the effect shows at 100% and in exports. About 0.2 s at preview size and 0.65 s at 20 MP when it has to be redone.

The full-resolution capture cache admits sources whose base RGBA16F payload is at most 256 MiB. After the immediate background decode, Develop uploads an eligible active RAW without changing Fit, shares capture metadata requests with foreground zoom, and asks the worker to prepare capture in bounded idle batches. One preparation generator is keyed by source/capture metadata, noise input/amount and capture iterations. Zoom, pan and downstream edits preserve its unfinished output and scratch, pausing its bounded batches while foreground rendering or interaction needs the GPU; navigation or changed capture inputs cancels it and frees scratch. Foreground regional and whole-source fallbacks use their own lanes while it is unfinished, and independent MessageChannel continuations keep either schedule from replacing the other. Source/capture metadata, noise input/amount and capture iterations invalidate the result; zoom, pan and downstream edits retain it. A ready result is copied into regions before lens/profile/creative processing, with a flag preventing capture or noise from being applied twice. Early zoom uses the existing regional path while the cache is unavailable. The original four-source GPU LRU and 512 MiB decoded cache remain bounded; background and foreground uploads share the same full-source entry. The retained result includes mipmaps (~265 MiB for 6246×4170), with additional source and temporary storage. Native timing and logical peak-memory measurements are in [zoom-detail.md](research/zoom-detail.md#whole-photo-capture-cache-2026-11-04). `VITE_CAPTURE_CACHE=0` retains the decode-only preparation and regional capture path for comparison.

Halation and glow are blurred on small, fixed-size levels of a downsample pyramid (`engine/pyramid.ts`), with taps no more than one texel apart. That keeps the halos smooth, cheap, and the same relative size in the preview and in a full-size export. Passes are skipped when their amounts are zero.

### Crop and straighten

A recipe's `crop` (`film/crop.ts`) turns the photo about its centre by `angle`, then cuts a rectangle from it, measured in units of the source's width and height (so with no rotation it is the ordinary crop in image coordinates). The develop pass composes crop with perspective and maps each frame pixel to the source with one projective map (`uGeoU`, `uGeoV`, `uGeoW`); every other pass (tone equalizer map, highlight pyramid, sharpening) still works on the whole source, which the develop pass samples at the mapped point. Grain, vignette, halation and glow belong to the film, so they stay tied to the uncropped frame and cropping enlarges them, as it would a negative. While cropping, the canvas shows the whole straightened photo (`bounds`) with the stage colour around it, and `CropOverlay` edits a draft in the store that is saved as one undo step when cropping ends. Everything that sizes a render (export, thumbnails, stock tiles, histogram) uses `framePixels`. Pasted settings keep each frame's own crop.

### Preview and export

Settled regional rendering retains full source density for the spatial effects at every zoom.
The earlier display-density settled-map candidate lost fine stone and foliage texture;
`docs/research/continuous-zoom.md` records its rejection and the faithful replacement.
For held drags below 1:1, the current candidate samples preview Dehaze, Texture, Clarity and
Sharpening maps directly at the sharp region's whole-photo coordinates
(`stages/previewmap.glsl`), avoiding a regional copy or reduced-source allocation on activation.
Colour keeps its bounded signed RGB change. Live preview Sharpening derives its radius from
display density when the physical preview kernel would be disabled; settled Sharpening keeps
the original sensor-pixel radius. These interaction approximations await final native timing
and visual review. They are independent of the UI zoom preset list.

Motion uses existing faithful regional maps or the preview when the region must be rebuilt.
Preview re-decode waits for the view to stop, including while its requested size is capped.
`Engine.render` synchronously drains the same generator that `Engine.prepareFrame` advances
between GPU fences for interactive settling. Region copies, capture deconvolution, working
allocations and later spatial filters yield between submissions, including Sharpening.
Develop cancels the generator when a newer input arrives; scratch targets are released and
cache certificates for partly overwritten maps are invalidated. The last finished screen stays
visible while preparation runs. Pending release tracking handles the final input committed
after pointer-up even if the previous live frame was exact. A held pointer waits for release;
pointer-up, blur and cancellation resume preparation. Histograms wait for settling and use
pixel pack buffers/fences; developed thumbnails use the same asynchronous readback approach.
Idle allocation preparation pauses while rendering is pending or a pointer is held.

The implementation is WIP: correctness checks pass, while final screen-gap, first-pan memory
and prepared-zoom latency checks remain open. Whole-photo capture-threshold readback and
views outside regional admission still need bounded-work investigation.

The develop view decodes a preview at the size the photo is shown at (`ui/previewsize.ts`): the whole photo's long edge on screen in device pixels, rounded up to 128 px, at least 1536 (the object selector's encode size) and at most 2560. Every slider frame develops all of the preview's pixels and the map filters (Texture's seven à-trous passes, haze removal's guided filter) run over all of them, so a preview larger than the screen only costs time: at fit on a 1552 px wide canvas, the 2560 px preview made a Texture frame 37 ms on the GPU, a 1664 px one 15 ms. darktable's darkroom likewise processes at the scale it displays. A zoom, crop or layout change that leaves the preview too small (or a quarter larger than needed) decodes it again at the new size once the view has been still for 360 ms; past what a 2560 px preview holds, the full resolution loads as before. While it loads, the cached thumbnail is shown through the same pipeline. Once the full resolution is on screen the preview follows the size the whole photo fits at, not the zoom (the full resolution is then what is shown; the preview gives the whole photo's maps, the histogram and a moving pinch's stand-in), since zoomed in every slider frame rebuilds those maps as well as the region's: a 2560 px preview made a Texture frame at 100% cost 65 ms, and Lightcraft's loupe likewise renders the whole frame at canvas size under its zoomed window. While the full resolution loads, the preview grows with the zoom as before. Haze removal's ambient light is measured for each photo shortly after it shows (`Engine.measureAhead`), so the first Dehaze drag doesn't pay the read back. After it, the working targets a first Texture or Dehaze drag would make (16 float targets at preview size, ~320 MB at 1664 × 1111) are made one per idle moment (`Engine.prepareSteps`, `Gpu.reserve`): ANGLE on Metal allocates a large float target at the next sync point and the GPU's first writes to it are slow, so made in the drag's first frame they froze it 100–240 ms. `Gpu.target` hands out a reserved target of the same size and format before making one. Only the whole-photo lane is prepared; the region lane (zoomed in) still makes its own in its first frame. Export decodes at full size (up to the GPU's maximum texture size), develops into an offscreen target, reads the pixels back and hands them to Rust to encode. Grain and blur sizes are relative to the frame, so the export matches the preview.

While a pointer is held (a slider drag, a brush stroke, any drag) and full-size frames keep missing the display's pace (three in a row over 25 ms), `Develop` asks for a draft (`render`'s `draft`, the scale that would fit a 16 ms frame, at least 1/devicePixelRatio): the frame is developed into a target that size and scaled onto the canvas, as Lightroom drafts while dragging. Every choice that depends on the shown size (preview or full source, the region, retouch's scale) is made for the canvas size (`shown`), so a draft reuses what the full-size render made and leaves it for the full-size render `Develop` draws once nothing has changed for `VIEW_SETTLE_MS`. The same settle follows a zoom gesture's stand-in (`moving`, `stoodIn`).

Zoomed past the preview, the view loads the full size and develops only the region on screen (`engine/region.ts`, plan in [plans/roi.md](plans/roi.md)), as darktable's full pipe processes only its region of interest. The region is the visible rectangle mapped back through crop and perspective, grown by every active stage's reach (darktable's tiling overlaps) and a panning margin, with its origin on capture sharpening's tile grid. It is copied out of the full source and developed exactly as a whole source, on the engine's second `Lane` of caches, so the preview's maps survive. Whole-photo values come from the preview, as darktable's come from its preview pipe: the tone equalizer map, halation and glow, haze removal's ambient light, and the histogram and pickers. The develop pass reads the source and its maps at the region's coordinates (`uRoi`) and places masks, vignette, grain and the whole-photo maps by the whole photo's. Clarity combines four fine regional levels with per-instance reconstructed preview output levels; Texture computes fine bands locally and takes broader changes from per-instance preview maps (the approved approximation is recorded in NOTICE). Refined mask rasters and masked Dehaze ambient estimates come from the whole lane. Ordinary retouch grows the region to include full Heal destinations, remote source patches and their dependencies. Wavelet retouch, the scale viewer, split Compare, or regions covering most of the photo still use the whole source. Broad effects from the preview can differ slightly from a full-resolution export. Region maps and handoff copies are freed with their lane or source-size buffers. The per-edit maps (haze removal, Texture, the colour equalizer, Clarity, Sharpening) are each made only over the view grown by the reach of that stage and the stages after it in the develop pass (`stageReach`), plus a 5% pan margin: Sharpening's input needs a few pixels around the view, Texture's ~200. With Clarity and Sharpening both on, Clarity's tap also writes the print it measured into Sharpening's spare target (`printMade`), and Sharpening's input resumes from it (develop.frag tap 11: the clarity step alone, the same operations on the same values) instead of a second develop pass. Texture's à-trous reads its 25 taps from a one-channel copy of each scale's image (`eq.ia/ib`). On trial (off by default, the Detail section's checkbox, `Engine.detailOrder`): Texture and Clarity measured in log lightness before Exposure (`detaillog.ts`), so Texture's map is keyed only on the stages before Exposure (`BEFORE_TEXTURE_LOG`) and Clarity's on Texture's (`textureKey`), while the colour equalizer and Sharpening still key on everything up to them (`sceneKey`, `ceKey`). Clarity's input is develop.frag tap 12 (13 for a masked instance), its pyramids hold ten levels (`LOG_GAMMAS`, a third image `Ll.C`, the `LL_LOG` build of `llcollapse`), its change is applied in scene light before the camera profile (`stageClarityLog`), and Sharpening's input is the full tap 3 (there is no print tap to resume from). While a slider or brush is dragged (`render`'s `live`), maps already made at this place are remade over the view only, without the reach (as darktable's full pipe, which never pads its region): pixels within the reach of the view's edges may be slightly off (≤ 3/255 measured) until the settle render remakes every map exactly. A live render that would remake the region's Texture or Clarity map instead (an edit before them, such as Dehaze or Exposure in darktable's order, or a masked instance) shows the preview's finished map read at the region's place (`mapFromPreview`, `maskfold.frag` kind 2, Clarity's times its scale; `Products.textureMap`, `clarityMap`), so it lacks the finest detail the preview doesn't hold; `regionFromPreview` makes `inexact` true and the settle remakes everything from Texture on. A Texture drag still folds the region's own decomposition and a Clarity drag still scales the region's map. The fold reads the preview's maps with a bilinear made from four `texelFetch`, exact where the hardware filter's weights are 8-bit. At 100% on a 26 MP RAF with Texture, Dehaze and Clarity on, GPU ms per frame: Dehaze drag 62 → 42, Exposure (darktable order) 55 → 35, Texture 36 → 27 (it no longer remakes Clarity). Checked by `region-detail`'s `previewMaps_*` (both orders, masked too: the region's map equals the preview's there within half-float rounding, the settle equals a fresh build 0/255). Before any of that, a live render (at fit or zoomed) holds Texture's, Clarity's and Sharpening's maps as made before the drag while their own settings are unchanged, though an edit before them moved (`holds` in `Engine.render`; each map's `own` key: its stage's uniforms, its masked instances, and for those the masks' shapes, ranges, opacities, rasters and refinement, not their exposure). The maps hold changes in lightness, so the stages after the dragged one keep their change, as Capture One does while a slider moves; the dragged stage's own map stays live, Colour and the tone equalizer (maps of the picture itself) are never held, and `mapsHeld` makes `inexact` true so the settle remakes them exactly. The preview's stand-ins are used only where the region has no map of its own yet. At 100% on 1OKK6432.RAF with Texture 40, Dehaze 30, Clarity 30, GPU ms per frame: Exposure 35 → 12, Texture 27 → 11, Dehaze 42 → 9, Clarity 15 → 10 (all 52–58 fps); drag against settle on the synthetic ≤ 4/255. Checked by `region-detail`'s `held_*` (region and fit: which maps are held, the settle equals a fresh build 0/255).

A stage turned on from 0 has no map to hold or scale, so its first frame used to build it from scratch (at 100% twice: the preview's and the region's). When the pointer rests 80 ms on the slider of a stage that is off (Dehaze, Texture, Clarity, an HSL colour), `Develop` calls `Engine.warm`: the screen render's own options, with the stage on (`warm.ts`'s `warmRecipe`: Dehaze 50, Texture 50, Clarity +100, one HSL saturation), stopped right after that stage (`render`'s `warm`), so it draws nothing and leaves every map after the stage as it was. What it builds is the part of the map that doesn't depend on the value: Dehaze's guide means, transition map and guided filter for a positive strength (the click redoes the fold), Texture's decomposition (`eqPhoto`; the click folds it), the colour equalizer's scene analysis (`ceScene`; the click runs 3 of 5 passes), Clarity's map at +100 (`llMade`; the click scales it, and at 100% the region's is scaled while the pointer is held and remade at the settle). Nothing is warmed while a pointer is held, when the stage is on, or when a mask has its own instance of it. At 100% a stage turned on can widen the region's clip (its reach), which remakes the region's maps, as the click would. The histogram is not read while a pointer is held (its `readPixels` waits on the GPU); it counts 120 ms after the release. On 1OKK6432.RAF (`inapp.mjs firstclick`), worst screen freeze, ms, from 0 cold / hovered first / already on: at 100% Dehaze 187/61/74, HSL 185/55/59, Texture 107/49/39, Clarity 111/55/43; at fit HSL 85/41/44, Dehaze 40/35/32. Checked by `region-detail`'s `warm_*` (fit and region: the other maps unchanged, the warmed map made, the click draws fewer passes, its settle equals the cold click's 0/255).

During a live regional drag, Colour also borrows the preview's effect. The preview makes its colour equalizer output and a signed RGB change from its input at at most 1024 pixels on the long edge, with the filter radii scaled to that size (`develop` tap 14, `Lane.ceDelta`); the regional develop pass adds that change to its own sharp input at the whole-photo coordinates (`uCeOn` 2, `uCeRoi`). It does not enlarge the preview's finished RGB pixels. An unchanged exact regional colour map can still be reused. Live colour needs no regional filter padding or colour targets, so enabling HSL need not widen the region and invalidate its other maps on the first click. Colour hover warming prepares only the preview lane. The release restores the normal regional reach and exact colour processing, invalidating the preview's colour analysis too because it may have read held Texture maps. The bounded colour working images have their own cache (`Lane.ceDraft`), so a settled preview or histogram does not resize and reallocate them before the next drag. They and the extra bounded RGB target are freed with the lane; no zoom-percentage switch chooses this approximation.

## The develop engine's thread

The develop view's engine runs in a worker (`engine/develop.worker.ts`) on the canvas's
OffscreenCanvas, so the controls keep the display's pace whatever a photo costs (Oli,
2026-11-04: sliders and knobs never below 60 fps even when the photo drops to 30; measurements
in [research/engine-worker.md](research/engine-worker.md)). `engine/developloop.ts` holds what
`Develop` used to do with the engine: its sources (by key), the render loop (frame skipping,
drafts, stand-ins while the view moves, `prepareFrame` stepping, release and settle), idle
preparation, warming and the histogram. `ui/developclient.ts` is the main thread's handle:
`Develop` sends the latest view state and pointer presses and releases, uploads sources
(`SourceRef`s mirror what layout reads), and asks for pickers and the object encoder's pixels
by promise. Camera profiles and LUTs load on the main thread (they need the app's IPC) and the
client sends them to the worker's copies of the stores (`profileSnapshot`, `provideLut`).

- **Short GPU submissions:** WebKit paints the page through the same GPU, and one long
  submission held the controls' painting for its whole length (Capture Sharpening at 50%: 430 ms
  frames, controls at 2.7 fps). In the worker `Gpu.flushEach` flushes after every draw and draws
  a pass over more than 1 MP in scissored bands of rows (`BAND_PIXELS`), each flushed; each
  fragment writes only its own pixel, so the result is unchanged.
- **Exact-detail preparation:** cancellable message tasks advance at most four passes
  or 4 ms of CPU submission before waiting for the GPU; busy polling uses a timer.
  This avoids a nested timer delay for every pass. Measurements and the remaining
  first-zoom costs are in [zoom-detail.md](research/zoom-detail.md).
- **`localStorage['emulsion.engine'] = 'main'`** (or `VITE_ENGINE=main`) runs the same loop on
  the main thread. The browser-test runners default to it, since those pages patch
  `Engine.prototype`; the perf driver reads frames from the client in worker mode, and its
  draw counts, texture memory and pass timings need main mode.
- **Still on the main thread:** the shared offscreen engine (`library/thumbs.ts`:
  thumbnails, tile renders, export, perspective). Its WebGL work would queue behind the
  worker's GPU work; it waits for edits to pause, but it is the next to move.

## RAW files

RAW noise reduction runs locally through RawNIND/ONNX Runtime on demand, before
capture sharpening and lens correction. `noise_cache.rs` serializes inference,
retains one full-resolution source/result pair in memory and bounds its disk cache
to 2 GiB. Identity includes canonical source path, size, nanosecond mtime, decode
version/baseline and pinned model hash; amount and virtual-copy identity do not
rerun inference. CoreML falls back to CPU on initialization or inference failure.
The runtime session is explicitly released on application exit.

When requested, decoder payload flag 8 appends a second RGBA16F pixel array after
the original pixels. Both arrays derive from the same full-resolution decode and
retain camera/lens/white-point metadata. `Engine.noiseReduced` blends them using
the recipe's `noiseReduction.amount` in a cached source pass; fresh texture identity
invalidates downstream analysis maps. Before bypasses it; Split composites two
finished frames. Develop's preview/full caches distinguish enabled/disabled
sources, while amount changes only render. Thumbnails, look previews and export
request the same pair. Export errors instead of substituting an undenoised source.
The setting is off for legacy/new photos, RAW only, and travels with Detail presets,
copy/paste, undo/redo and sidecars. The enabled amount starts at 50.

Assets are resolved from `EMULSION_DENOISE_ASSETS`, `app_data_dir()/denoise`,
`resource_dir()/denoise`, or the development probe assets directory. Runtime/model
are never loaded for ordinary decoding. See [setup and probe](../tools/denoise/README.md)
and [measured findings](research/ai-noise-reduction.md).

LibRaw 0.22.3 is vendored in `src-tauri/vendor/libraw` and compiled into the app by `build.rs`, always optimised and without LCMS or libjpeg. On macOS the build enables LibRaw's existing OpenMP loops when LLVM's runtime is installed (see README), links it statically, and caps each decode at four threads; no extra runtime installation is needed. A missing runtime warns and falls back to serial decoding; `EMULSION_LIBRAW_SERIAL=1` forces that reference build. `native/raw_shim.cpp` is a small C interface over it; `raw.rs` calls it. The `image` dependency is also optimized in development: otherwise preview resizing competes with full-resolution decoding for seconds. Measured zoom-to-detail stages and the remaining latency are in [zoom-detail.md](research/zoom-detail.md).

- **Preparing zoom detail:** as soon as the active Develop preview is available, `prepareFullImage` prepares its exact ordinary decode in the existing 512 MiB payload cache without changing Fit. For an eligible RAW with capture sharpening enabled, its completion also uploads the active full source and starts the independent idle capture cache described above. Only one background decode runs and only the latest photo can wait; foreground zoom shares its keyed request or starts immediately. Pending work is cancelled on navigation/edit/unmount; already-running LibRaw calls finish. Payloads over 256 MiB and noise-reduction decodes are not prepared speculatively. `ImageLoadCache` generations prevent old completions after a clear from repopulating the cache or removing newer requests.
- **Decoding:** LibRaw demosaics, applies the white balance as shot and returns 16-bit linear camera RGB, oriented. Previews (2560 px and under) use LibRaw's half-size mode, which skips the demosaic and is several times faster; export decodes at full size.
- **Colour:** `raw.rs` converts camera RGB to Rec.2020 from the camera's XYZ matrix, the same way dcraw converts to sRGB (a test checks it reproduces LibRaw's sRGB matrix). Cameras LibRaw reads but has no colour data for can borrow a same-sensor camera's matrix from `SAME_SENSOR`; the OM-3 uses the OM-1's.
- **Exposure:** LibRaw's output has sensor clipping at 1.0. `BASELINE_GAIN` (1.8) scales it so a RAW lands at about the brightness of the camera's own JPEG; the ignored test `calibrate_baseline_gain` measures this over sample files.
- **Thumbnails** come from the camera's embedded preview, so the grid shows the camera's rendering until a frame is developed.

To update LibRaw, replace `src`, `libraw` and `internal` in the vendor folder from a release tarball, check its checksum, and rerun the RAW tests and calibration.

## White balance

Every source carries its as-shot white point (CIE xy): LibRaw's camera multipliers through the camera matrix for RAWs (`raw.rs`, sent in the decode header and read for the whole folder in the background by `white_points`), and D65 for everything else. A recipe's white balance is an absolute temperature and tint; `engine/whitebalance.ts` turns it into a white point (darktable's daylight and blackbody formulas, tint at right angles to the locus) and the exposure stage applies CAT16 from the as-shot white to it, which is the identity when nothing changes. Thumbnails and stock tiles use the same white point as the develop view, and the developed-thumbnail cache is keyed on it. The eyedropper averages a small patch of scene light before white balance (`Engine.sampleScene`) and solves for the white that makes it neutral.

## Recipes

A recipe (`film/recipe.ts`) is everything about how one frame is developed: stock, push or pull, scanner, and the slider values. `normalizeRecipe` validates anything read from disk: unknown stocks fall back to the default and out-of-range values are clamped, so an old or hand-edited sidecar can never break the app.

## Sidecars

`<photo file name>.emulsion.json`, next to the photo:

```json
{
  "format": "emulsion",
  "version": 1,
  "updated": 1793302849059,
  "recipe": {
    "v": 1,
    "stock": "cinestill800t",
    "push": 1,
    "scanner": "frontier",
    "exposure": 0,
    "contrast": 0,
    "saturation": 0,
    "warmth": 0,
    "tint": 0,
    "fade": 0,
    "halation": 80,
    "glow": 15,
    "vignette": 20,
    "grain": 46,
    "grainSize": 115
  }
}
```

Version 2 adds an optional `copies` array to this envelope. Each copy has a permanent `id`, a user-visible `name`, and independent `recipe`, `rating`, `label` and `heart` values. The top-level values still describe the original frame; version 1 files read unchanged. An unedited, unrated virtual copy still keeps its entry, and any copies keep the sidecar even if the original is reset. Removing the final copy removes the sidecar only when the original also has no edits or marks.

`library/copies.ts` separates frame identity (`photoId`: source path plus copy id) from source identity (`Photo.path`). Selection, recipe and mark edits, undo history, crop drafts, histogram ownership, custom-look drafts, React keys and developed thumbnails use frame identity. Decode caches, original thumbnails, EXIF and camera/lens metadata use the shared source path; the grain seed is retained so a new copy initially renders identically. Import choices continue to select source files and bring in all their versions. RAW+JPEG folding ignores copies when finding pairs and keeps a JPEG with virtual copies visible.

Writes are debounced in the webview and atomic in Rust (write to a temporary file, then rename). Every save snapshots the original and all its copies together; writes for a source are serialized, and flushing waits for in-flight saves. Reset photo removes that frame's recipe; ratings, tags, hearts and copies can still keep a sidecar.

**Edit history.** A sidecar also keeps earlier states of the edits (`history`: recipe and copies, oldest first, at most 20 and 4 MB), as darktable keeps the history stack in its XMP. A state is kept when it is replaced at a checkpoint: a reset, a paste, an edit of several photos, removing a copy, restoring an earlier edit (the webview passes `checkpoint` with the write), or the first change 30 minutes after the last checkpoint (`checkpoint` time in the file). Stars, tags and hearts never make history. A photo with history keeps its sidecar after a reset. The panel's ⋯ menu → Earlier edits lists them (`sidecar_history`).

**Auto profile fallback.** With `profile: 'auto'`, the saved recipe also records `autoProfile`, the DCP Auto chose here (`withAutoProfile` in `profilestore.ts`, applied on save). Auto still follows the camera's default; `autoProfile` is used only where that default isn't set, so a photo renders the same on another computer.

## App data and backups

The app data folder holds `looks/`, `presets/`, `camera-profiles/` and `settings.json`. The last holds what the webview used to keep in localStorage and matters beyond one window: per-camera default profiles, preset and look favourites, preset collections, imports and photo collections (`library/appsettings.ts`, keys in `APP_SETTING_KEYS`; moved from localStorage once). `main.tsx` reads it before importing the app, so stores read it synchronously. Interface preferences and the folder index cache stay in localStorage.

`src-tauri/src/app_data.rs` snapshots those four into `backups/<local date>/` on the first launch of each day (15 kept) and into `backups/before-<new>-from-<old>/` on a version change (5 kept), as darktable snapshots `data.db`. LUTs and DCPs are hard-linked, so every writer in those folders must replace files by rename, never rewrite in place. The app menu has Export Settings (a zip, `.emulsion-settings`), Import Settings, Restore Settings from Backup and Show Backups in Finder (`library/backups.ts`). Import and restore merge (files added or replaced, never deleted; settings key by key), snapshot what was there first (`before-restore-…`), then reload the window. Choosing LUT None only disables the creative LUT and retains the camera profile and adjustments.

## Adding or replacing a stage

1. Write a TypeScript reference of the maths with unit tests, like `engine/tone.ts`.
2. Add or edit the GLSL file in `shaders/stages/` and its call in `develop.frag.glsl`.
3. Map recipe values to uniforms in `engine/params.ts` and test them in `params.test.ts`.
4. If the stage needs new recipe fields, add them to `Recipe`, `defaultRecipe` and `SLIDERS`. Bump `RECIPE_VERSION` only if old sidecars need migrating.
5. Check the result numerically with the engine probe (below).

## Testing

- `npm test`: unit tests for the tone curve, colour balance, colour matrices, uniforms, recipes, shader assembly, blur geometry and the image payload.
- `cargo test` in `src-tauri`: scanning, sidecars, decoding (8 and 16-bit), RAW colour conversion, thumbnail caching and export.
- **Engine probe** (`tools/probe`): renders a synthetic frame through the real engine in any browser and reports pixel values for the original, a look with effects off, halation and glow. Build it with `npm run probe`, serve `tools/probe/dist` over HTTP and open it; results are on `window.result`. Use it to check that a ported module matches its reference numerically. It also runs single stages over test colours at 32-bit float precision and reports their largest relative error against the TypeScript references: colour balance (`result.colorBalance`, under 0.03% at the port), tone (`result.tone`, under 0.001%), tone equalizer per pixel and edge-aware (`result.toneEqualizer`) and the input-to-original round trip (`result.roundTrip`). Without a server, run `chrome --headless --allow-file-access-from-files --virtual-time-budget=20000 --dump-dom tools/probe/dist/index.html` and read the JSON in `<pre id="result">`.


## Workspace presentation

`ui/workspace.ts` owns application preferences for one/two image columns and the selected control stage. Workflow is the only workspace; older Classic preferences normalize to Workflow while retaining columns and stage. These preferences are outside photo recipes and sidecars. The control tabs use stable section IDs; a keyed registry follows their membership/order while keeping module view state mounted. They change presentation rather than image-processing order. White balance, Exposure and HDR have independent reset field sets.

Develop owns zoom, before/split and crop state; its toolbar sits over the photo column. Masks are edited on the photo (`MaskOverlay`) while the Masks tab is open; which mask is selected and the armed tool live in `ui/maskui.ts`, outside the recipe. A fixed bar below the photo holds frame/file details and heart/stars/colour tags; the right pane is reserved for editing controls. The Images browser shares the existing thumbnail, filtering, marking, RAW+JPEG folding and selection operations. Changing columns affects the sidebar grid and up/down navigation stride, not recipes or selection.
