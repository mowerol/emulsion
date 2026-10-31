# Notices

Emulsion is licensed under the GNU General Public License, version 3 or later (GPL-3.0-or-later). See [LICENSE](LICENSE).

## Code ported from other projects

Every port is listed here with its source, upstream licence, the upstream commit it came from, and what changed. See [docs/PORTING.md](docs/PORTING.md) for the format.

### Colour balance rgb, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/iop/colorbalancergb.c`, `src/common/colorspaces_inline_conversions.h` and `src/common/darktable_ucs_22_helpers.h`, commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2020-2026 darktable developers. Copyright (C) 2017-2023 darktable developers (colour space conversions). darktable Uniform Color Space 2022 © Aurélien Pierre
- Ported to: `src/engine/colorbalance.ts` (reference and gamut table) and `src/engine/shaders/stages/colorbalance.glsl`
- Changes: translated from C to TypeScript and GLSL. The whole module with the darktable UCS saturation formula, run as two instances: the recipe's sliders (contrast, vibrance, saturation, the shadows lift's luminance) and a stock's grade (every control). The working space is D65 Rec.2020, so darktable's D50 adaptation drops out. Contrast pivots on Emulsion's middle grey. Negative output is clipped, and FLT_MIN guards are 1e-30 so they cannot overflow on a GPU

<!--
Template:

### <module>, from <project>
- Upstream: <repository URL>, <path>, commit <hash>
- Licence: <SPDX id>
- Copyright: <upstream copyright lines, verbatim>
- Ported to: <path in Emulsion>
- Changes: <for example, "translated from C to GLSL; parameters mapped to Emulsion's recipe">
-->

### Sigmoid, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/iop/sigmoid.c`, `src/common/custom_primaries.c` and `dt_make_transposed_matrices_from_primaries_and_whitepoint` in `src/common/colorspaces.c`, commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2020-2026 darktable developers. Copyright (C) 2023 darktable developers (custom primaries). Copyright (C) 2010-2026 darktable developers (colour spaces)
- Ported to: `src/engine/tone.ts` (reference and curve constants), `src/engine/primaries.ts` (the primaries' matrices) and `src/engine/shaders/stages/tone.glsl`
- Changes: translated from C to TypeScript and GLSL. Per-channel processing with full hue preservation only, with the module's primaries (attenuation, rotation, recover purity) on darktable's linear Rec.2020 base primaries, Emulsion's working space, so the pipe to base matrix is the identity; rotation is kept in degrees, as darktable's sliders show it. Added an exact inverse of the per-channel curve for display-referred input, and sRGB encoding of the output. Emulsion's neutral settings are contrast 1.15, skew 0.11 and display black 0. Blacks below zero use the black level of darktable's exposure module (`src/iop/exposure.c`, same commit, Copyright (C) 2009-2026 darktable developers)

### Tone equalizer, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/iop/toneequal.c`, `src/common/eigf.h`, `src/common/luminance_mask.h` and `src/iop/choleski.h`, commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2018-2026 darktable developers. Copyright (C) 2019-2024 darktable developers (exposure-independent guided filter; Cholesky least squares). Copyright (C) 2019-2023 darktable developers (luminance mask)
- Ported to: `src/engine/toneequalizer.ts` (reference and band solving), `src/engine/shaders/stages/toneequalizer.glsl` and `src/engine/shaders/toneeqmask.frag.glsl`
- Changes: translated from C to TypeScript and GLSL. Only the euclidean RGB norm and the exposure-independent guided filter without quantization or contrast boost, with one iteration. The filter's local averages are computed on the GPU on a small fixed-size map with Emulsion's blur, and negative variance from rounding is clamped. The Highlights slider drives the upper bands in the shape of darktable's "compress shadows/highlights" presets (3:5:5:3 over -3 to 0 EV), with their exposure boost of -1.57 EV

### Local laplacian filter and local contrast, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/common/locallaplacian.c` and the "clarity" preset of `src/iop/bilat.c`, commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2). The method is Paris, Hasinoff and Kautz, "Local Laplacian Filters: Edge-aware Image Processing with a Laplacian Pyramid" (SIGGRAPH 2011), in the fast form of Aubry et al., "Fast Local Laplacian Filters" (ACM TOG 2014)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2016-2026 darktable developers.
- Ported to: `src/engine/locallaplacian.ts` (reference), `src/engine/shaders/llcurve.frag.glsl`, `llreduce.frag.glsl`, `llcollapse.frag.glsl` and `src/engine/shaders/stages/clarity.glsl`
- Changes: translated from C to TypeScript and GLSL. Pyramid borders clamp to the edge at every level rather than padding the input by replication; the pyramids are half floats on the GPU; Lab is relative to D65. Runs on CIE lightness after the tone curve, as darktable's local contrast module does. The Clarity slider goes from no change to darktable's clarity preset at +100 (detail 0.33, shadows and highlights 0, mid-tone range 0.5); below zero only the detail goes negative

### Contrast equalizer, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/iop/atrous.c`, `src/common/eaw.c` and `src/common/curve_tools.c` (Catmull-Rom curves), commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2010-2026 darktable developers. Copyright (C) 2017-2024 darktable developers (edge-avoiding wavelets). Copyright (C) 2011-2022 darktable developers (curve tools)
- Ported to: `src/engine/equalizer.ts` (reference and scales), `src/engine/lab.ts`, `src/engine/shaders/eq.frag.glsl`, `src/engine/shaders/stages/texture.glsl` and `src/engine/shaders/stages/lab.glsl`
- Changes: translated from C to TypeScript and GLSL. Lightness only, as the "sharpen" preset it uses leaves colour alone, and without noise thresholds, which the preset sets to zero; Lab relative to D65. The Texture slider is darktable's mix control on the "sharpen" preset (slider / 100: no change at 0, the preset at +100, its mirror at -100). The highlight extraction for halation and glow does not see it

### Capture sharpening, from RawTherapee
- Upstream: https://github.com/Beep6581/RawTherapee, `rtengine/capturesharpening.cc` (CaptureDeconvSharpening, calcRadiusBayer, calcRadiusXtrans, buildClipMaskBayer, buildClipMaskXtrans), `rtengine/rt_algo.cc` (buildBlendMask, calcContrastThreshold), `rtengine/boxblur.cc` (the deconvolution kernels) and `rtengine/rawimagesource.cc` (calculate_scale_mul), commit b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c
- Licence: GPL-3.0-or-later
- Copyright: Copyright (c) 2019 Ingo Weyrich (heckflosse67@gmx.de). Copyright (C) 2010 Emil Martinec <ejmartin@uchicago.edu> (blur kernels)
- Ported to: `src-tauri/src/capture.rs` (auto radius and clip mask from the raw mosaic, read through `native/raw_shim.cpp`), `src/engine/capture.ts` (reference: kernels, blend mask, auto contrast, deconvolution) and `src/engine/shaders/cs.frag.glsl`
- Changes: translated from C++ to Rust, TypeScript and GLSL. One Richardson-Lucy deconvolution over the whole photo on the GPU, with RawTherapee's per-tile early stop applied to 32 px tiles, instead of each tile deconvolved separately; the blend mask's blur is an exact Gaussian rather than RawTherapee's recursive one; luminance and lightness come from the as-shot white-balanced camera RGB LibRaw decodes to, rebuilt on the GPU from the working space with the camera matrix; LibRaw's daylight multipliers stand in for RawTherapee's pre_mul. The Sharpening slider sets the iteration count (20, RawTherapee's default, at 100). The pre- and post-sharpening denoise options are not ported

### Monotone curve interpolation, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/common/curve_tools.c` (and node limits from `src/iop/rgbcurve.c`), commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2011-2022 darktable developers. Part of curve_tools.c is based on nikon_curve.c from UFRaw, Copyright 2004-2008 by Shawn Freeman, Udi Fuchs
- Ported to: `src/film/curve.ts`
- Changes: translated from C to TypeScript; only the monotone Hermite spline, sampled to floats rather than integers

### Illuminants and chromatic adaptation, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/common/illuminants.h` and `src/common/chromatic_adaptation.h`, commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2020-2024 darktable developers (illuminants). Copyright (C) 2020-2025 darktable developers (chromatic adaptation)
- Ported to: `src/engine/whitebalance.ts`, and the as-shot white point in `src-tauri/src/raw.rs` (from `WB_coeffs_to_illuminant_xy`)
- Changes: translated from C to TypeScript and Rust. CAT16 with full adaptation between two whites in Rec.2020 rather than to D65 or D50; the as-shot white is not adapted to D50, as Emulsion works in D65. Tint moves the white towards green for positive values so the image turns magenta, as in Lightroom (the opposite sign to `blackbody_xy_to_tinted_xy`). Added a numeric inverse from a white point to temperature and tint, and solving the white that makes a sample neutral

### 3D lookup tables (lut3d), from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/iop/lut3d.c`, commit f38e304ce78e4332cc4528443e242dcd815c45a2
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2019-2026 darktable developers. (Its tetrahedral interpolation is credited upstream to OpenColorIO.)
- Ported to: `src/engine/lut3d.ts` (readers and reference) and `src/engine/shaders/stages/lut.glsl`
- Changes: translated from C to TypeScript and GLSL. The .cube, .3dl and Hald CLUT readers and tetrahedral interpolation only (no trilinear or pyramid, no compressed .gmz). Every LUT is applied to the sRGB display image of the original (the scene through Emulsion's neutral curve) instead of in a chosen colour space within the scene-referred pipe; Hald images are read through the browser, so at 8 bits

## Methods from published work

Implemented from the papers, not from code.

### Grain, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/iop/grain.c`, commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2010-2024 darktable developers.
- Ported to: `src/engine/grain.ts` (reference) and `src/engine/shaders/stages/grain.glsl`
- Changes: translated from C to TypeScript and GLSL (single precision on the GPU). The lightness channel only, darktable's default; the paper response evaluated directly rather than from its 128 × 128 table; a per-photo offset from Emulsion's seed rather than a hash of the file name modulo the view width; grain on the uncropped frame; Lab relative to D65. Size is darktable's coarseness in its ISO units, set from the stock's film speed and doubled per stop of push. Replaces Emulsion's earlier grain from the statistics of Newson et al.'s Boolean model

## Bundled libraries

### LibRaw 0.22.3
- Upstream: https://www.libraw.org/data/LibRaw-0.22.3.tar.gz (SHA-256 789f3c33466210a1a0907f747a97c715d21bbf4af712f257fcbbd90111b227e4)
- Licence: LGPL-2.1, chosen from LibRaw's LGPL-2.1 or CDDL-1.0 dual licence
- Copyright: Copyright (C) 2008-2025 LibRaw LLC (http://www.libraw.org, info@libraw.org). LibRaw uses code from dcraw.c, copyright 1997-2018 Dave Coffin, and the DCB demosaic and FBDD denoise, Copyright (C) 2010 Jacek Gozdz (BSD-like 3-clause)
- Location: `src-tauri/vendor/libraw`, with its `COPYRIGHT`, `LICENSE.LGPL` and `LICENSE.CDDL`
- Changes: none. Only the library sources (`src`, `libraw`, `internal`) are included; samples, build files and RawSpeed/DNG SDK integrations are left out. It is compiled into Emulsion by `src-tauri/build.rs`
- The OM-3 colour matrix in `src-tauri/src/raw.rs` is LibRaw's OM-1 entry from `src/tables/colordata.cpp`

## Bundled assets

### Archivo typeface
- Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo)
- Licence: SIL Open Font License 1.1, bundled through `@fontsource-variable/archivo`

### t3mujinpack look pack
- Source: https://github.com/t3mujin/t3mujinpack, `haldcluts/`, commit 0b421f3e25209ed78253d1724a29cc6255c5e7fe; eight of its Hald CLUTs, unmodified
- Licence: MIT, Copyright (c) 2017 João Almeida (`public/looks/t3mujinpack/LICENSE.txt`)
- In: `public/looks/t3mujinpack/`

## Main dependencies

These are used as libraries, not copied, and keep their own licences.

| Dependency | Licence |
| --- | --- |
| Tauri and its plugins | Apache-2.0 OR MIT |
| `image` crate | MIT OR Apache-2.0 |
| `rayon`, `half`, `serde`, `percent-encoding` | MIT OR Apache-2.0 |
| `walkdir` | Unlicense OR MIT |
| `natord` | MIT |
| `cc` (build only) | MIT OR Apache-2.0 |
| `blake3` | CC0-1.0 OR Apache-2.0 |
| React, React DOM | MIT |
| zustand | MIT |

## Trademarks

Film stock and scanner names (Kodak Portra, Gold, Ektar, Tri-X; Fujifilm Superia, Pro 400H, Frontier; CineStill; Ilford HP5; Noritsu; Epson) are trademarks of their owners. Emulsion's looks are approximations inspired by these products and are not affiliated with or endorsed by their makers.

### Sharpening (unsharp mask), from RawTherapee
- Upstream: https://github.com/Beep6581/RawTherapee, `rtengine/ipsharpen.cc` (ImProcFunctions::sharpening), `rtengine/params/threshold.h` (Threshold::multiply), `rtengine/gauss.cc` (gaussianBlur's small-sigma rules) and `rtengine/rt_algo.cc` (buildBlendMask), commit b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c
- Licence: GPL-3.0-or-later
- Copyright: Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
- Ported to: `src/engine/usm.ts` (reference), `src/engine/shaders/usm.frag.glsl` and `src/engine/shaders/stages/usm.glsl`
- Changes: translated from C++ to TypeScript and GLSL. The unsharp mask only, with RawTherapee's defaults for what is not exposed: threshold (20, 80, 2000, 1200), no edges-only, no halo control, no blur of flat areas. Gaussians from sigma 0.6 up are exact rather than recursive, and borders clamp. Runs on CIE lightness (relative to D65) of the finished print, before grain. Sliders: Sharpening 0-100 is RawTherapee's amount / 10, Radius is its radius, Masking 0-100 is its contrast threshold / 2

### Color equalizer, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/iop/colorequal.c`, `src/common/darktable_ucs_22_helpers.h` (gamut_map_HSB), `src/common/math.h` (scharr_gradient) and `src/iop/choleski.h` (pseudo_solve), commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2022-2026 darktable developers.
- Ported to: `src/engine/colorequal.ts` (reference), `src/engine/shaders/ce.frag.glsl` and `src/engine/shaders/stages/colorequal.glsl`
- Changes: translated from C to TypeScript and GLSL. darktable's defaults for every option not exposed (saturation threshold, hue curve, contrast, white level, analysis and effect radii, guided filter on, node placement); at those radii darktable never downsamples, so that path is left out. Gaussian means are exact rather than recursive, borders clamp, and the saturation weight is its logistic evaluated directly rather than from a table. Sliders: hue -120 to +120 for darktable's ±36° (0.3° a step, a little past one neighbouring colour each way; darktable's own range is ±180°), saturation -100 to +100 for darktable's gain 0.5 to 1.5 (grey to twice the saturation; its full range triples saturation and vivid colours stop at the gamut early), brightness -100 to +100 for its gain 0.7 to 1.3 (its full range turns vivid colours black); the hue sliders' gradients span the same ±36°. Runs in scene light after Texture and before colour balance, as in darktable's order
