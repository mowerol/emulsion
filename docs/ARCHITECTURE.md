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
| Input | `input.glsl` | scene | Bring any source into scene-linear Rec.2020 | |
| Sharpen | `optics.glsl` | scene | Scanner sharpness, a log-domain unsharp mask | |
| Exposure | `exposure.glsl` | scene | White balance (CAT16 from the as-shot white to the chosen one, **ported from darktable**), exposure, and black level (Blacks below zero, as darktable's exposure module) | |
| Masks (exposure) | `masks.glsl` | scene | Each mask's exposure and white balance, blended in by its value: darktable's drawn masks (gradient, ellipse, groups) evaluated per source pixel at the top of the pass (`computeMasks`). **Ported from darktable masks** (see [masks plan](plans/masks.md)) | |
| Tone equalizer | `toneequalizer.glsl` | scene | Highlights: exposure by brightness band through an edge-aware brightness map, in the shape of darktable's compress shadows/highlights presets. **Ported from darktable tone equalizer** | |
| Texture | `texture.glsl` | scene | Texture: darktable's contrast equalizer (its "sharpen" preset, with darktable's mix as the slider) on CIE L*, from a map the `eq` passes make over the whole photo; keeps Lab a and b. **Ported from darktable contrast equalizer** | |
| Colour | `colorequal.glsl` | scene | Colour: hue, saturation and brightness for eight colours, red to magenta, from a map the `ce` passes make over the whole photo (darktable's two guided filters keep the changes even across an area and off greys). Skipped when every value is 0. **Ported from darktable color equalizer** | |
| Colour balance | `colorbalance.glsl` | scene | A saved creative profile's hidden instance first (`stageProfileColorBalance`, scaled by the profile's Amount; `film/creative.ts`), then the photo's own: contrast, vibrance, saturation and shadows plus the recipe's Colour Grading: four hue/chroma/luminance wheels, chroma/saturation/brilliance by tone, hue shift and mask/contrast fulcrums. Shared controls feed one instance; `film/grading.ts` normalises additional recipe fields. **Ported from darktable colour balance rgb** | |
| Masks (colour) | `masks.glsl` | scene | Each mask's colour balance instance (contrast, shadows, vibrance, saturation), after the photo's own, blended in by its value | |
| Creative vignette | `lens.glsl` | scene | Manual light falloff, separate from embedded lens correction | |
| Optics | `optics.glsl` | scene | Halation and glow, added back from blurred highlights | |
| Profile tone | `dcp.glsl`, `tone.glsl` | scene to print | RawTherapee DCP baseline exposure/look/Adobe tone curve, or the neutral darktable sigmoid per channel (**ported from darktable sigmoid**) when the profile has no curve. Whites/positive Blacks set display targets. | |
| Look | `lut.glsl` | print | Optional creative LUT (a bundled pack's, or a custom look's: its own LUT file or the system look it refers to; `library/userlooks.ts`, `src-tauri/src/user_looks.rs`) on the camera profile’s print, with Blend Normal or Colour (darktable's color blend mode, `engine/blend.ts`: the LUT's hue and saturation, the print's lightness): convert to sRGB, tetrahedral lookup, blend by Amount, return to print encoding. Never supplies the base rendering. **Ported from darktable lut3d** | |
| Clarity | `clarity.glsl` | print | Clarity: darktable's local laplacian filter (its local contrast module's clarity preset) on CIE lightness, from a map the `ll*` passes make over the whole photo; keeps Lab a and b. **Ported from darktable local contrast** | |
| Sharpening | `usm.glsl` | print | Sharpening, Radius, Masking: RawTherapee's unsharp mask on CIE lightness of the finished print, from a map the `usm` passes make over the whole photo; keeps Lab a and b. Runs after Tone and Clarity, before grain. **Ported from RawTherapee sharpening** | |
| Grain | `grain.glsl` | print | Grain, Size (ISO), Mid-tones: darktable's grain on CIE lightness of the finished print, after Sharpening and before output: three octaves of simplex noise fitted to real grain scans, sized by film speed relative to the frame (pushing doubles the speed per stop), through darktable's paper response so it fades in shadows and highlights; away from 1:1 it averages 21 samples per pixel. **Ported from darktable grain** | |
| Output | `output.glsl` | print to display | Rec.2020 to sRGB | Colour-managed output |
| Scanner | `scanner.glsl` | display | Levels, colour cast, contrast and saturation of the scan | |
| Curve | `curve.glsl` | display | Point curve: master, then red, green and blue, from a 256-step lookup table sampled in `film/curve.ts` (darktable's monotone spline); a saved profile's curve is composed in front of the photo's own into the same table (`composedCurveTable`) | |
| Finish | `finish.glsl` | display | Matte fade and dither | |

The neutral sigmoid’s maths is mirrored in `engine/tone.ts` so it can be unit-tested; the shader receives its constants from there. Emulsion's neutral curve uses sigmoid contrast 1.15 and skew 0.11 rather than darktable's 1.5 and 0, fitted to the curve the stocks were first tuned on, and a display black of 0 so the inverse is exact. Without a DCP tone curve, the base renders the neutral curve per channel, the exact inverse of the display-referred input stage. A DCP uses its own tone curve for both the edited photo and Compare.

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

The tone equalizer's map holds each pixel's brightness and its square, so the blur yields the local mean and variance its edge-aware filter needs. It is halved down to the halation level (at most 256 wide) and blurred there with a sigma of 2.5% of the long edge, darktable's default smoothing; it uses 32-bit float targets where the GPU can filter them, because the variance is a small difference of large numbers. Without float targets the stage falls back to a plain per-pixel correction, darktable's "no detail preservation" mode.

Clarity runs the develop pass once more over the whole source, stopping at the tone curve to write CIE lightness, then darktable's local laplacian filter: six remapped images in two RGBA pyramids (the second also carries the lightness's own Gaussian pyramid), collapsed coarse to fine into a map of the change in lightness per source pixel, which the develop pass adds after the tone stage. The map is kept until the recipe or the photo changes, so panning, zooming and the split view reuse it. It costs about 70 ms at preview size. Like darktable's, its finest levels are in pixels, so at full resolution (zoomed in, or in an export) clarity reaches finer detail than in the fitted preview.

Texture works the same way one stage earlier: the develop pass writes the scene's L* after the tone equalizer, and darktable's contrast equalizer runs one edge-avoiding à-trous pass per detail size (up to eight, from 5 px at full resolution to about 20% of the frame) in two 32-bit targets, keeping the coarse residue, the boosted detail and the starting L* in one texture. Its sizes are tied to the photo, not to pixels, so the preview shows the same bands as full resolution minus the finest. Its map is kept like clarity's; an edit costs about 50 ms at preview size. The clarity pass's input includes texture.

Sharpening (RawTherapee's unsharp mask) taps the develop pass after Clarity for the print's lightness at every source pixel, then three passes on two 32-bit targets make RawTherapee's contrast mask (blurred by 2 px) and the lightness blurred by the radius, and write the change in lightness and the mask. The develop pass adds the change before output and grain, so grain is never sharpened. The radius is in full-resolution pixels and follows RawTherapee's gaussianBlur: under 0.25 px at the source's scale there is no blur and so no sharpening, which means the fitted preview shows little and 100% and exports show it all, as in RawTherapee. Holding ⌥ on the Masking slider makes the develop pass draw the mask instead (white is sharpened). The map is kept like clarity's.

Colour (darktable's color equalizer) taps the develop pass after Texture for darktable UCS U, V, L* and RGB saturation at every source pixel, then seven passes on five 32-bit targets run darktable's chromaticity prefilter and its guided filter of the corrections (Gaussian means as exact 2D kernels of at most 7 × 7; at its default radii darktable never downsamples) and write the finished scene colour, which the develop pass takes in place of its own before colour balance. Each pass rebinds all four of its input units, since a target left bound from an earlier step makes a feedback loop and WebGL silently drops the draw. darktable's curves through eight nodes at rest ripple by about 0.15%, so the stage is skipped entirely when every value is 0. The map is kept like clarity's.

Capture sharpening runs before everything, and only for RAWs. Rust reads the raw mosaic once per photo (`capture_info`, cached for the last photo) for RawTherapee's auto radius and its clip mask, which comes to the webview oriented and resampled to the decoded size, with the matrix back to camera RGB. On the GPU, `cs.frag` makes luminance and lightness, the contrast mask (its threshold measured once per source from a read-back of the lightness), and runs the Richardson-Lucy iterations on one-channel 32-bit images, with the early stop checked per 32 px tile in two passes. The sharpened source (half floats, with mipmaps) is kept until the photo or the Sharpening value changes. The radius is in sensor pixels, so the half-size preview sees half of it and the effect shows at 100% and in exports. About 0.2 s at preview size and 0.65 s at 20 MP when it has to be redone.

Halation and glow are blurred on small, fixed-size levels of a downsample pyramid (`engine/pyramid.ts`), with taps no more than one texel apart. That keeps the halos smooth, cheap, and the same relative size in the preview and in a full-size export. Passes are skipped when their amounts are zero.

### Crop and straighten

A recipe's `crop` (`film/crop.ts`) turns the photo about its centre by `angle`, then cuts a rectangle from it, measured in units of the source's width and height (so with no rotation it is the ordinary crop in image coordinates). The develop pass maps each frame pixel to the source with one affine map (`uGeoU`, `uGeoV`); every other pass (tone equalizer map, highlight pyramid, sharpening) still works on the whole source, which the develop pass samples at the mapped point. Grain, vignette, halation and glow belong to the film, so they stay tied to the uncropped frame and cropping enlarges them, as it would a negative. While cropping, the canvas shows the whole straightened photo (`bounds`) with the stage colour around it, and `CropOverlay` edits a draft in the store that is saved as one undo step when cropping ends. Everything that sizes a render (export, thumbnails, stock tiles, histogram) uses `framePixels`. Pasted settings keep each frame's own crop.

### Preview and export

The develop view decodes a 2560 px preview; while it loads, the cached thumbnail is shown through the same pipeline. Export decodes at full size (up to the GPU's maximum texture size), develops into an offscreen target, reads the pixels back and hands them to Rust to encode. Grain and blur sizes are relative to the frame, so the export matches the preview.

## RAW files

LibRaw 0.22.3 is vendored in `src-tauri/vendor/libraw` and compiled into the app by `build.rs`, always optimised and without OpenMP, LCMS or libjpeg, so the app needs no extra libraries at run time. `native/raw_shim.cpp` is a small C interface over it; `raw.rs` calls it.

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

Writes are debounced in the webview and atomic in Rust (write to a temporary file, then rename). Reset photo removes the recipe; ratings, tags and hearts can still keep a sidecar. Choosing LUT None only disables the creative LUT and retains the camera profile and adjustments.

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

`ui/workspace.ts` owns application preferences for Workflow/Classic, one/two image columns and the selected control stage. These are outside photo recipes and sidecars. The three Workflow tabs (Develop, Colour Grading, Refine) use stable section IDs; a keyed registry follows their membership/order while keeping module view state mounted. They change presentation rather than image-processing order. Workflow separates White balance and Vibrance/Saturation from the classic Adjustments panel, with independent reset field sets.

The same Develop component and canvas remain mounted across layout switches. Develop owns zoom, before/split and crop state in both layouts; its toolbar sits over the photo column in Workflow. Masks are edited on the photo (`MaskOverlay`) while the Masks tab is open (always in Classic); which mask is selected and the armed tool live in `ui/maskui.ts`, outside the recipe. Classic restores the bottom filmstrip, floating zoom controls and right-panel crop section. A fixed bar below the Workflow photo holds frame/file details and heart/stars/colour tags; the right pane is reserved for editing controls. The Images browser shares the existing thumbnail, filtering, marking, RAW+JPEG folding and selection operations. Changing columns affects the sidebar grid and up/down navigation stride, not recipes or selection. CropControls is shared between the classic panel and the toolbar popover.
