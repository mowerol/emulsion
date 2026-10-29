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
| Exposure | `exposure.glsl` | scene | Exposure, black level (Blacks below zero, as darktable's exposure module) and colour balance (stock balance, warmth, tint) | darktable colour calibration |
| Tone equalizer | `toneequalizer.glsl` | scene | Highlights and Shadows: exposure by brightness band through an edge-aware brightness map. **Ported from darktable tone equalizer** | |
| Colour balance | `colorbalance.glsl` | scene | Contrast around middle grey, vibrance, saturation with gamut mapping. **Ported from darktable colour balance rgb** | |
| Lens | `lens.glsl` | scene | Vignetting | |
| Optics | `optics.glsl` | scene | Halation and glow, added back from blurred highlights | |
| Emulsion | `emulsion.glsl` | scene | Dye crosstalk; black and white sensitivity | Measured stock data or CLUTs |
| Tone | `tone.glsl` | scene to print | **Ported from darktable sigmoid**: log-logistic curve with hue preservation; stock contrast and push scale its contrast, crossover is a per-channel ratio on top, Whites set the display white and Blacks above zero the display black. Then print saturation and stock black lift | |
| Output | `output.glsl` | print to display | Rec.2020 to sRGB | Colour-managed output |
| Grain | `grain.glsl` | display | Clumped, midtone-weighted grain sized to the frame | **darktable grain** |
| Scanner | `scanner.glsl` | display | Levels, colour cast, contrast and saturation of the scan | |
| Finish | `finish.glsl` | display | Matte fade and dither | |

The tone curve's maths is mirrored in `engine/tone.ts` so it can be unit-tested; the shader receives its constants from there. Emulsion's neutral curve uses sigmoid contrast 1.15 and skew 0.11 rather than darktable's 1.5 and 0, fitted to the curve the stocks were first tuned on, and a display black of 0 so the inverse is exact. The original (Compare, or no look) renders the neutral curve per channel without hue preservation, the exact inverse of the input stage.

### Passes

`engine/engine.ts` runs these passes per render:

```
source ─┬─ tone eq map (1/4 res) ─ down ─ ... ─ blur ── tone equalizer ─┐   (only with Highlights or Shadows)
        ├─ extract (1/4 res) ─ down ─ down ─ ...      highlight pyramid
        │        └─ blur at ≤256 px wide ──────────── halation ─┐
        │        └─ blur at ≤128 px wide ──────────── glow ─────┤
        ├─ down (1/2 res) ─ blur ───────────────────── sharpen ──┤
        └───────────────────────────────────────────────────── develop ─▶ screen or export
```

The tone equalizer's map holds each pixel's brightness and its square, so the blur yields the local mean and variance its edge-aware filter needs. It is halved down to the halation level (at most 256 wide) and blurred there with a sigma of 2.5% of the long edge, darktable's default smoothing; it uses 32-bit float targets where the GPU can filter them, because the variance is a small difference of large numbers. Without float targets the stage falls back to a plain per-pixel correction, darktable's "no detail preservation" mode.

Halation and glow are blurred on small, fixed-size levels of a downsample pyramid (`engine/pyramid.ts`), with taps no more than one texel apart. That keeps the halos smooth, cheap, and the same relative size in the preview and in a full-size export. Passes are skipped when their amounts are zero.

### Preview and export

The develop view decodes a 2560 px preview; while it loads, the cached thumbnail is shown through the same pipeline. Export decodes at full size (up to the GPU's maximum texture size), develops into an offscreen target, reads the pixels back and hands them to Rust to encode. Grain and blur sizes are relative to the frame, so the export matches the preview.

## RAW files

LibRaw 0.22.3 is vendored in `src-tauri/vendor/libraw` and compiled into the app by `build.rs`, always optimised and without OpenMP, LCMS or libjpeg, so the app needs no extra libraries at run time. `native/raw_shim.cpp` is a small C interface over it; `raw.rs` calls it.

- **Decoding:** LibRaw demosaics, applies the white balance as shot and returns 16-bit linear camera RGB, oriented. Previews (2560 px and under) use LibRaw's half-size mode, which skips the demosaic and is several times faster; export decodes at full size.
- **Colour:** `raw.rs` converts camera RGB to Rec.2020 from the camera's XYZ matrix, the same way dcraw converts to sRGB (a test checks it reproduces LibRaw's sRGB matrix). Cameras LibRaw reads but has no colour data for can borrow a same-sensor camera's matrix from `SAME_SENSOR`; the OM-3 uses the OM-1's.
- **Exposure:** LibRaw's output has sensor clipping at 1.0. `BASELINE_GAIN` (1.8) scales it so a RAW lands at about the brightness of the camera's own JPEG; the ignored test `calibrate_baseline_gain` measures this over sample files.
- **Thumbnails** come from the camera's embedded preview, so the grid shows the camera's rendering until a frame is developed.

To update LibRaw, replace `src`, `libraw` and `internal` in the vendor folder from a release tarball, check its checksum, and rerun the RAW tests and calibration.

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
