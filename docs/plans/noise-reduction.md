# Noise reduction: darktable ports

Status: agreed 2026-11-04; nothing here is implemented yet. The existing linear **RawNIND**
AI pass is unchanged by this plan.

Upstream pin for the non-AI modules: darktable
`20891f6c6fa7be995e5bf9dff9d1ee5062051773` (release 5.6.2), the same pin as the sigmoid,
tone equalizer, retouch, lens and contrast-equalizer ports. The AI paths keep the pin already
recorded in [NOTICE.md](../../NOTICE.md): `0c67b465033205c46735c5a194f2b23d55e68363`.

## Where we are

Emulsion has one noise-reduction path:

- `src/film/noisereduction.ts` — `noiseReduction: { enabled, amount, model: 'rawnind-linear-v1' }`.
- `src/ui/NoiseReduction.tsx` — RAW-only enable switch and Amount.
- `src-tauri/src/denoise.rs`, `noise_cache.rs` — full-resolution RawNIND linear inference, cached
  in memory and on disk, with CoreML then CPU fallback.
- `Engine.noiseReduced` (`src/engine/engine.ts`) — blends the cached denoised texture with the
  source before capture sharpening, lens correction and the camera profile's early pass.

There is no camera noise-profile database, no wavelet/NLM denoise, no chroma-only control, no
hot-pixel repair and no RGB denoise. `native/raw_shim.cpp` calls LibRaw's `unpack()` and then
`dcraw_process()` and only returns demosaiced RGB, so nothing runs on the sensor mosaic today.

## Order

| Phase | Adds | Why this order |
| --- | --- | --- |
| 1 | **denoise (profiled)**, wavelets, Y0U0V0 luma/chroma | Needs no model assets, works on every image including JPEG/TIFF, and is the largest practical gap |
| 2 | **hot pixels** | Cheap to run on the mosaic, catches defects AI denoise cannot reliably remove |
| 3 | **AI denoise for developed RGB** (NIND/NAFNet) | Reuses the existing `ort` and model-store work; extends denoise to the raster formats we already import |
| 4 | **raw denoise** and **RawNIND Bayer** | Both change the decode/demosaic boundary; leave until the linear model has had real-camera evaluation |

## Decisions (2026-11-04)

Oli confirmed all six recommendations:

1. **Two recipe fields, not a method selector.** Keep `noiseReduction` for the AI pass and add
   `profiledDenoise` beside it. Old sidecars stay byte-compatible. If both are on, the AI blend
   runs first and the profiled pass runs on its result.
2. **Automatic profile in phase 1.** Match the camera make/model and EXIF ISO. Show the matched
   profile name, or `Generic`, in the panel. A manual ISO/profile picker is a later addition.
3. **Simple controls that stay inside upstream's shapes.** Strength in darktable units (0 to 4,
   default 1), Luma and Chroma 0 to 100 (default 50, each a flat Y0 / U0V0 force curve at
   upstream's default 0.5). `Chroma only` is Luma 0. The per-band graph is future work; we are
   not inventing band shapes.
4. **Wavelets first.** No NLM, auto modes, compute-variance, astrophoto denoise, RGB force mode or
   per-channel profiles in this plan.
5. **Hot pixels off by default**, with darktable's threshold 0.05 and strength 0.25.
6. **The profile database ships with the app.** It is 1.79 MB of JSON; the alternative (a small
   subset) would silently produce worse results on most cameras.

## Phase 1: denoise (profiled), wavelets

Source map:

- [`denoiseprofile.c`](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/iop/denoiseprofile.c):
  parameters and modes at line 63, VST at 910 and 991, Y0U0V0 at 1125, `process_wavelets` at
  1423, defaults at 2671, profile auto-selection at 2803.
- [`common/eaw.c`, denoise section](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/common/eaw.c#L271):
  `eaw_dn_decompose` at 271, `eaw_synthesize` at 206.
- [`common/noiseprofiles.c`](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/common/noiseprofiles.c):
  generic profile at 26, matching at 227, interpolation at 375.
- [`data/noiseprofiles.json`](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/data/noiseprofiles.json):
  19 makers, 436 models, 8,641 profiles at the pin.

### 1.1 Profiles in the native core

Add `src-tauri/src/noiseprofiles.rs` and copy `noiseprofiles.json` into the app's resources
(compiled in with `include_str!` or loaded from the bundle; pin its SHA-256 and record the source
in NOTICE). Parse once.

Match exactly as upstream:

- maker is a substring match against the camera maker (`g_strstr_len` upstream), model must be
  exact; entries with `"skip": true` are ignored.
- exact ISO wins. Otherwise linearly interpolate `a[3]` and `b[3]` between the two bracketing ISO
  profiles. Outside the profile range, or with no camera match, use the generic profile
  `a = [0.0001, 0.0001, 0.0001]`, `b = [0, 0, 0]` — upstream does **not** clamp to the first or last
  profile.
- `a` and `b` are the Poissonian and Gaussian noise terms in `V(X) = a·E[X] + b`, fitted per
  camera and ISO on linear scene values. Only the green channel's `a`/`b` are used by the
  wavelet and NLM paths upstream; keep the other two for compatibility and for a future RGB mode.

Add `iso`, `a`, `b`, `name` and a `generic` flag to the camera metadata already sent with a RAW
payload (`CameraMetadata` in `src-tauri/src/raw.rs`). ISO is already read by the shim. Bump the
payload flag/version and every decode cache key that embeds the camera block. The TypeScript
tests load the same JSON as a fixture; the webview does not need its own copy.

The white-balance factors the module wants are the camera's as-shot multipliers. Emulsion has
`CameraMetadata.neutral` (the inverse multipliers normalised by their maximum); recover the
green-normalised gains from those ratios. Do not reuse the AI denoise's `BASELINE_GAIN`
remove/restore path: the profiled filter runs at scene scale throughout.

### 1.2 Reference maths

Add `src/engine/denoiseprofile.ts`, unit-tested against small fixtures and the pinned profile
JSON. It should expose:

- **Interpolation** with the same exact/bracketed/generic rules as the Rust matcher.
- **Upstream defaults inferred from the profile.** With `a_g = a[1]`:
  - `shadows = clamp(0.1 - 0.1·ln(a_g), 0.7, 1.8)`
  - `bias = -max(5 + 0.5·ln(a_g), 0)`
  - strength default 1; `radius` and `scattering` are NLM-only and not needed.
- **Variance-stabilising transform (v2).** Darktable's current path is
  `a·(E[X] + b)^p`, not the older plain Anscombe:
  - `compensate_p = 0.05 / 0.05^shadows`
  - `p[c] = max(shadows + 0.1·ln(inScale / wb[c]), 0)`
  - precondition: `2·(max(in/wb + b, 0))^(1 - p/2) / ((2 - p)·sqrt(a))`
  - backtransform: the closed-form inverse with the `bias` term from
    [`backtransform_v2`](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/iop/denoiseprofile.c#L1084)
  - wavelet mode multiplies `wb` by `strength · 2.5 · inScale`; the 2.5 is upstream's Y0U0V0
    compensation for the weaker smoothing that mode would otherwise give.
- **Y0U0V0 matrices** exactly as `set_up_conversion_matrices` at line 1290: the Y0 row is a
  white-balance-weighted mean normalised to unit variance; U0 and V0 keep their difference
  coefficients and are normalised by their WB-dependent standard deviations. Invert once per
  change. Fall back to the non-WB-adapted form when the matrix is singular, as upstream does.
- **Edge-avoiding decomposition.** `eaw_dn_decompose` is a 5×5 B3-spline blur with colour-distance
  weights (`dn_weight`: `0.02`, offset `9.0`), not the 5-tap hat used by Texture. Port it, plus
  `eaw_synthesize`'s soft threshold:
  `detail + threshold` clamped above 0 plus `detail - threshold` clamped below 0, added to the
  accumulator with the per-band boost. Seven scales (`DT_IOP_DENOISE_PROFILE_BANDS`).
- **BayesShrink thresholds.** Per band:
  - `sigma_band = (sqrt(2 + 2·16 + 6·36) / 16)^scale`
  - `std_x = sqrt(max(1e-6, var_y - sigma_band²))`
  - `adjt = 8 · force² · 4` per channel, where `force` is the flat Luma (Y0) or Chroma (U0V0)
    value. The defaults are 0.5, which makes `adjt = 8`.
  - `threshold = adjt · sigma_band² / std_x`
- **Scale handling.** `inScale` is the source's width over the full image's width (preview), and 1
  for a full-resolution region or export. Scale the filter spacing and thresholds as upstream
  does; this is the contract that keeps preview and export agreeing.

The exact upstream reference is the literal order in `process_wavelets`: precondition, then per
scale decompose → compute thresholds → synthesize/add, then backtransform. Keep that order in the
TypeScript reference even if the GPU folds passes.

### 1.3 GPU passes

Add `src/engine/shaders/eawdn.frag.glsl` (name chosen to distinguish it from the Texture
equalizer) and a small pass driver in the engine. One shader, two modes:

- **Precondition + first decompose**, or a separate precondition pass if folding complicates the
  reference check.
- **Decompose one scale**, writing the next coarse image and the accumulated thresholded detail.
  The GPU already supports two colour attachments (`Gpu.target2` and `targetN` in
  `src/engine/gpu.ts`), so each scale is one draw with two outputs: coarse and accumulator.
- **Backtransform** on the final accumulator.

Seven scales at most, with `mult = 1 << scale` and a 5×5 support. Use RGBA32F for the coarse and
accumulator targets; the half-float source is the input. The pass is exact at force 0 and is
skipped entirely when strength is 0 or both forces are 0.

Memory: two 32-bit RGBA images at source size. At 2560 px preview that is about 100 MB; at a
20 MP export it is about 640 MB, on top of the export buffers. If that exceeds the budget, tile
the export with at least the filter's full reach as overlap.

### 1.4 Engine wiring

`Engine.profiledDenoised` becomes a new source-level pass beside `noiseReduced`:

- Order: AI blend (existing `noiseReduced`) → profiled pass → capture sharpening → lens
  correction → camera-profile early pass. This preserves the existing noise slot and keeps the
  camera profile's look/curve from feeding back into denoise.
- Cache it in the lane like `noiseMade`: `profMade { input, key, out }`, plus the same structure
  in `fullCapture`. Key on source texture identity, profile `a`/`b`/ISO/name, strength, luma,
  chroma, source width/height, `src.roi` and `inScale`. Invalidate on source, profile, recipe or
  geometry changes; retain across downstream edits, pan and zoom within the same region.
- Include the profiled key in `captureKey` so a completed capture cache cannot survive a denoise
  change. `noiseMade` remains the AI cache.
- **Regions:** the filter's reach is `2 · 2^(bands-1)` (128 px at seven full-resolution bands).
  Grow the region by that reach in `engine/region.ts` and in the whole-photo/region boundary
  handling, as other local stages do; use `inScale = 1` for a full-resolution region. If a region
  is too small for the coarsest bands, fall back to the whole source for that view, as Texture
  and Clarity already do. Preview, region and export must all run the same reference; only
  `inScale` differs.
- **Thumbnails, look tiles and histogram** use the same profile and recipe. Thumbnails get the
  preview-scale result. Export uses full scale. Compare/Before/Split show the undenoised source,
  reusing the existing AI split plumbing with a profiled branch.
- No Rust inference job is needed for phase 1. The profile block arrives with the decode payload,
  and the filter is GPU-only.

### 1.5 Recipe and UI

`src/film/noisereduction.ts`:

```ts
export interface ProfiledDenoise {
  enabled: boolean;
  strength: number; // darktable strength, 0 to 4, default 1
  luma: number;     // 0 to 100, default 50 -> flat Y0 force 0.5
  chroma: number;   // 0 to 100, default 50 -> flat U0V0 force 0.5
}
```

`Recipe` gains `profiledDenoise: ProfiledDenoise | null`; null is off. Add normalisation that
clamps strength to 0–4 and luma/chroma to 0–100, treats a missing object or all-off object as
null, and leaves `noiseReduction` untouched. Add the field to `defaultRecipe`, sidecar
normalisation, copy/paste, presets and the Detail section reset. Old recipes must render
identically.

UI in Refine → Detail, above the existing AI block:

- `Noise reduction (profiled)` enable switch.
- Read-only profile line: the matched name, e.g. `OM-3 · ISO 4000`, or `Generic profile`.
- Strength (0–4, one decimal), Luma and Chroma (0–100), each with a reset.
- A `Chroma only` preset button (Luma 0).
- Hint: `Uses the camera's measured noise profile at this ISO. Check fine detail at 100%.`

The existing AI block keeps its own label and amount. If both are on, show a short note that the
AI result is denoised again by the profiled pass.

### 1.6 Validation

Unit and fixture tests:

- profile matching: exact ISO, interpolation, outside-range → generic, maker substring, model
  mismatch, `skip` entries;
- VST round trip on a range of positive values, including shadows and a non-zero bias;
- Y0U0V0 forward/inverse, including the singular fallback;
- auto default derivation from a real profile;
- `force = 0` is an exact no-op; a flat field stays flat; one synthetic step case matches a
  hand-computed threshold;
- `inScale` scaling: the same physical noise at two preview scales produces the same result after
  accounting for the resampling.

Reference and GPU checks:

- Extend `tools/probe` with `out.profiledDenoise` over synthetic colours and a small noisy patch,
  comparing GLSL against `denoiseprofile.ts`.
- Add `node tools/browser-tests/treatment-filters.mjs profiled-denoise`: enable/disable, strength,
  Luma/Chroma, profile change, cache reuse, region versus whole-source, split view, cleanup.
- Against darktable: render two RAWs (OM-3 ISO 4000 and X-T30 II ISO 1600/12800) with a pinned
  XMP that enables only denoise (profiled) in wavelets mode, export PFM, and compare a crop after
  a neutral pipeline. If isolating the stage is awkward, add a small reference harness under
  `tools/denoise-reference/` built from `common/eaw.c` and the pure VST functions; pin the
  source hash. Do not claim parity from a contact sheet alone.

Real-photo checks: flat shadows, foliage, hair, skin, fine text and chroma noise; several ISO
values; preview at Fit versus 100% versus export; tile/scale seams; an image with no matching
profile. Measure drag latency and the worst screen freeze at Fit and 100%, and the export time at
20 MP, against the existing 30 fps / 100 ms targets.

### 1.7 Risks

- **Profile units and WB.** The profiles were fitted on darktable's scene-linear values with a
  green reference and applied through its WB coefficients. Our Rec.2020 source, LibRaw decode and
  as-shot neutral must be mapped and then checked on a real flat patch: measured variance versus
  the profile's `a·mean + b` is the test. If the camera matrix mixing makes the WB scaling wrong,
  run the pass in camera RGB or reduce the plan to green-normalised gains, but do not ship a
  guessed scale.
- **Camera names.** LibRaw's model strings do not always equal darktable's. Add explicit aliases
  for the cameras already in Emulsion's sample set and log `Generic` when unmatched. A wrong
  profile is worse than the generic one.
- **Memory at export.** Two 32-bit images at 20 MP plus the existing export buffers may be too
  much. Tiling is the fallback; the tile overlap must be at least the filter's reach.
- **Preview/export agreement.** The `inScale` scaling and the region's `inScale = 1` must match
  upstream's `roi_in->scale / iscale`. Test the same crop at both scales, not just visually.
- **Half-float source precision.** The source is RGBA16F; thresholds near zero may quantise. Use
  32-bit intermediates and measure the smallest non-zero change.

## Phase 2: hot pixels

Source: [`hotpixels.c`](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/iop/hotpixels.c),
Bayer at 105, X-Trans at 219, defaults at 35. The module runs in raw CFA space after
white balance and before demosaic, in darktable's order (`iop_order.c`).

Run it in `native/raw_shim.cpp` between LibRaw's `unpack()` and `dcraw_process()`:

- Normalise the mosaic by black level and white level, apply the as-shot channel gains (or scale
  the threshold by the same gain), and use darktable's rule: a site brighter than `threshold`,
  with three (permissive) or four of its same-channel neighbours below `value · strength/2`,
  becomes the maximum neighbour. X-Trans uses its own neighbour pattern.
- Add `hotPixels: { enabled, threshold, strength, permissive } | null` to the recipe. Extend the
  decode request and every decode cache key with it; preview, thumbnails, look tiles, export and
  the noise caches must pass the same options. Off by default.
- UI: `Hot pixels` in the same Detail area, RAW only, with Threshold (0.05 default), Strength
  (0.25 default) and `Detect by 3 neighbours`. `Mark fixed` is a darktable debugging aid and can
  stay out.
- Validation: a synthetic CFA fixture with known hot sites; no-op at strength 0; no change to
  ordinary pixels; Bayer and X-Trans patterns; a long-exposure sample compared with darktable;
  toggling cost measured (a toggle re-decodes; X-Trans full decode is already about 11 s on this
  machine, so say so in the UI or defer X-Trans).
- Risk: this is a decode option, not a live GPU pass. Accept the re-decode cost or add a
  prepared-source cache like the AI denoise one. Do not approximate it after demosaic: the
  defect has already been spread across neighbours by then.

## Phase 3: AI denoise for developed RGB (NIND/NAFNet)

Source: [`restore_rgb.c`](https://github.com/darktable-org/darktable/blob/0c67b465033205c46735c5a194f2b23d55e68363/src/common/ai/restore_rgb.c)
at the existing AI pin. It converts the working profile to sRGB, runs NIND UNet or NAFNet, and
returns to the working profile with optional wide-gamut preservation. At strength below 100 it
applies DWT detail recovery to the luminance residual so the result does not turn to plastic, and
it gates an optional shadow boost on whether the image actually has deep shadows.

- Reuse `ort`, the model store in `src-tauri/src/ai_models.rs` and the cache/worker pattern in
  `noise_cache.rs`. Add an RGB model adapter and a model download entry, following the existing
  model-store rules rather than the fixed `tools/denoise` asset path.
- Current `noiseReduction` is RAW-only and its UI says so. Extend it with a model choice for
  developed images (NIND first, NAFNet as a comparison) and enable it for `InputMode` 0/1
  sources. Keep the linear RawNIND path for RAW.
- Strength is not a plain linear blend: port the DWT detail recovery and shadow-boost gates so
  Amount below 100 keeps texture. Cache the full-strength result; a strength change folds the
  residual on the GPU, as darktable does.
- Validation: JPEG/TIFF samples, wide-gamut edges, deep shadows, text and foliage; compare with
  darktable's neural restore at the same model and strength; check preview/export and provider
  agreement as the RawNIND work did.

## Phase 4: raw denoise and RawNIND Bayer

Both need the sensor mosaic and a demosaic that happens after the correction, so they are one
pipeline project rather than two module ports.

**raw denoise** ([`rawdenoise.c`](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/iop/rawdenoise.c)):
five-band `dwt_denoise` on the CFA, with the module's threshold (0.01 default) and per-channel
force curves (flat 0.5). Run it in the shim after hot pixels and before `dcraw_process`. The
threshold is in normalised raw units; match LibRaw's black/white/WB normalisation. UI: a single
Threshold slider plus `Chroma only`-style presets only if they are faithful; otherwise just
Threshold. This is slower than hot pixels and needs measurement on Bayer and X-Trans.

**RawNIND Bayer** (`restore_raw_bayer.c`, same AI pin): packed four-channel CFA input, 2× RGB
output, joint denoise and demosaic. It cannot be a drop-in model swap: Emulsion would have to
expose the CFA, run the model before LibRaw's demosaic, and carry the result back as a linear
source. That is a separate architecture change. Leave it until the linear model has had broader
real-camera evaluation and the Bayer model's CoreML/FP16 issues recorded in
[the research note](../research/ai-noise-reduction.md) are resolved.

## Not in this plan

- denoise (profiled) non-local means, the auto modes and compute-variance mode;
- the per-band force graph and RGB (rather than Y0U0V0) force mode;
- manual profile/ISO selection and highlight-preservation ISO compensation;
- astrophoto denoise (`nlmeans.c`), which is a different noise model for stacked astro frames;
- demosaic colour smoothing, which belongs to a demosaic port, not this one.

## Open questions for Oli

None. The six choices above are settled; new questions should be added here as they arise.
