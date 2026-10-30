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
- **Output:** the tone stage produces a display-encoded print in Rec.2020 primaries; the output stage converts it to sRGB. Grain and the scanner then work on the display image, like a real scan.

Input modes (`engine/params.ts`, `InputMode`):

| Mode | Meaning | Used for |
| --- | --- | --- |
| 0 | Linear light, sRGB primaries, display-referred | Decoded JPEG, PNG, TIFF, WebP |
| 1 | sRGB-encoded, display-referred | 8-bit thumbnails in the browser |
| 2 | Scene-linear Rec.2020 | Decoded RAW |

### Stages

Each stage is one GLSL file in `src/engine/shaders/stages/`, included into `develop.frag.glsl` in this order. Its parameters come from the recipe through `engine/params.ts`.

| Stage | File | Domain | What it does | Planned replacement |
| --- | --- | --- | --- | --- |
| Input | `input.glsl` | scene | Bring any source into scene-linear Rec.2020 | |
| Sharpen | `optics.glsl` | scene | Scanner sharpness, a log-domain unsharp mask | |
| Exposure | `exposure.glsl` | scene | White balance (CAT16 from the as-shot white to the chosen one, **ported from darktable**), exposure, black level (Blacks below zero, as darktable's exposure module) and the stock's colour balance | |
| Tone equalizer | `toneequalizer.glsl` | scene | Highlights: exposure by brightness band through an edge-aware brightness map, in the shape of darktable's compress shadows/highlights presets. **Ported from darktable tone equalizer** | |
| Texture | `texture.glsl` | scene | Texture: darktable's contrast equalizer (its "sharpen" preset, with darktable's mix as the slider) on CIE L*, from a map the `eq` passes make over the whole photo; keeps Lab a and b. **Ported from darktable contrast equalizer** | |
| Colour balance | `colorbalance.glsl` | scene | Shadows (darktable's shadows lift luminance, with its masks at their defaults), contrast around middle grey, vibrance, saturation with gamut mapping. **Ported from darktable colour balance rgb** | |
| Lens | `lens.glsl` | scene | Vignetting | |
| Optics | `optics.glsl` | scene | Halation and glow, added back from blurred highlights | |
| Emulsion | `emulsion.glsl` | scene | Dye crosstalk; black and white sensitivity | Measured stock data or CLUTs |
| Clarity | `clarity.glsl` | print | Clarity: darktable's local laplacian filter (its local contrast module's clarity preset) on CIE lightness, from a map the `ll*` passes make over the whole photo; keeps Lab a and b. **Ported from darktable local contrast** | |
| Tone | `tone.glsl` | scene to print | **Ported from darktable sigmoid**: log-logistic curve with hue preservation; stock contrast and push scale its contrast, crossover is a per-channel ratio on top, Whites set the display white and Blacks above zero the display black. Then print saturation and stock black lift | |
| Output | `output.glsl` | print to display | Rec.2020 to sRGB | Colour-managed output |
| Grain | `grain.glsl` | display | Film grain from the Boolean model's statistics: each pixel draws its grain count (Poisson) from a smooth field and shows the share it covers. Size and Roughness sliders, ISO presets; see `engine/grain.ts` | |
| Scanner | `scanner.glsl` | display | Levels, colour cast, contrast and saturation of the scan | |
| Curve | `curve.glsl` | display | Point curve: master, then red, green and blue, from a 256-step lookup table sampled in `film/curve.ts` (darktable's monotone spline) | |
| Finish | `finish.glsl` | display | Matte fade and dither | |

The tone curve's maths is mirrored in `engine/tone.ts` so it can be unit-tested; the shader receives its constants from there. Emulsion's neutral curve uses sigmoid contrast 1.15 and skew 0.11 rather than darktable's 1.5 and 0, fitted to the curve the stocks were first tuned on, and a display black of 0 so the inverse is exact. The original (Compare, or no look) renders the neutral curve per channel without hue preservation, the exact inverse of the input stage.

### Passes

`engine/engine.ts` runs these passes per render:

```
source ─┬─ tone eq map (1/4 res) ─ down ─ ... ─ blur ── tone equalizer ─┐   (only with Highlights)
        ├─ (develop to the scene's L*) ─ wavelet scales ─ texture ─┤   (only with Texture)
        ├─ (develop to the print's lightness) ─ local laplacian pyramids ─ clarity ─┤   (only with Clarity)
        ├─ extract (1/4 res) ─ down ─ down ─ ...      highlight pyramid
        │        └─ blur at ≤256 px wide ──────────── halation ─┐
        │        └─ blur at ≤128 px wide ──────────── glow ─────┤
        ├─ down (1/2 res) ─ blur ───────────────────── sharpen ──┤
        └───────────────────────────────────────────────────── develop ─▶ screen or export
```

The tone equalizer's map holds each pixel's brightness and its square, so the blur yields the local mean and variance its edge-aware filter needs. It is halved down to the halation level (at most 256 wide) and blurred there with a sigma of 2.5% of the long edge, darktable's default smoothing; it uses 32-bit float targets where the GPU can filter them, because the variance is a small difference of large numbers. Without float targets the stage falls back to a plain per-pixel correction, darktable's "no detail preservation" mode.

Clarity runs the develop pass once more over the whole source, stopping at the tone curve to write CIE lightness, then darktable's local laplacian filter: six remapped images in two RGBA pyramids (the second also carries the lightness's own Gaussian pyramid), collapsed coarse to fine into a map of the change in lightness per source pixel, which the develop pass adds after the tone stage. The map is kept until the recipe or the photo changes, so panning, zooming and the split view reuse it. It costs about 70 ms at preview size. Like darktable's, its finest levels are in pixels, so at full resolution (zoomed in, or in an export) clarity reaches finer detail than in the fitted preview.

Texture works the same way one stage earlier: the develop pass writes the scene's L* after the tone equalizer, and darktable's contrast equalizer runs one edge-avoiding à-trous pass per detail size (up to eight, from 5 px at full resolution to about 20% of the frame) in two 32-bit targets, keeping the coarse residue, the boosted detail and the starting L* in one texture. Its sizes are tied to the photo, not to pixels, so the preview shows the same bands as full resolution minus the finest. Its map is kept like clarity's; an edit costs about 50 ms at preview size. The clarity pass's input includes texture.

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

Writes are debounced in the webview and atomic in Rust (write to a temporary file, then rename). Removing a look deletes the sidecar.

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
