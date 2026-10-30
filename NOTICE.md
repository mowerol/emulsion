# Notices

Emulsion is licensed under the GNU General Public License, version 3 or later (GPL-3.0-or-later). See [LICENSE](LICENSE).

## Code ported from other projects

Every port is listed here with its source, upstream licence, the upstream commit it came from, and what changed. See [docs/PORTING.md](docs/PORTING.md) for the format.

### Colour balance rgb, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/iop/colorbalancergb.c`, `src/common/colorspaces_inline_conversions.h` and `src/common/darktable_ucs_22_helpers.h`, commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2020-2026 darktable developers. Copyright (C) 2017-2023 darktable developers (colour space conversions). darktable Uniform Color Space 2022 © Aurélien Pierre
- Ported to: `src/engine/colorbalance.ts` (reference and gamut table) and `src/engine/shaders/stages/colorbalance.glsl`
- Changes: translated from C to TypeScript and GLSL. Only the global contrast, vibrance and saturation (darktable UCS formula) and the luminance of the shadows lift are kept, the lift with darktable's default masks (middle grey 0.1845, fall-offs 1); the lift colour and other colour wheels, brilliance, chroma and hue shift are left out. The working space is D65 Rec.2020, so darktable's D50 adaptation drops out. Contrast pivots on Emulsion's middle grey. Negative output is clipped, and FLT_MIN guards are 1e-30 so they cannot overflow on a GPU

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
- Upstream: https://github.com/darktable-org/darktable, `src/iop/sigmoid.c`, commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2020-2026 darktable developers.
- Ported to: `src/engine/tone.ts` (reference and curve constants) and `src/engine/shaders/stages/tone.glsl`
- Changes: translated from C to TypeScript and GLSL. Per-channel processing with full hue preservation only; Rec.2020 base primaries without inset or rotation, which is an identity. Added an exact inverse of the per-channel curve for display-referred input, a per-channel ratio for film stock crossover, and sRGB encoding of the output. Emulsion's neutral settings are contrast 1.15, skew 0.11 and display black 0. Blacks below zero use the black level of darktable's exposure module (`src/iop/exposure.c`, same commit, Copyright (C) 2009-2026 darktable developers)

### Tone equalizer, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/iop/toneequal.c`, `src/common/eigf.h`, `src/common/luminance_mask.h` and `src/iop/choleski.h`, commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2018-2026 darktable developers. Copyright (C) 2019-2024 darktable developers (exposure-independent guided filter; Cholesky least squares). Copyright (C) 2019-2023 darktable developers (luminance mask)
- Ported to: `src/engine/toneequalizer.ts` (reference and band solving), `src/engine/shaders/stages/toneequalizer.glsl` and `src/engine/shaders/toneeqmask.frag.glsl`
- Changes: translated from C to TypeScript and GLSL. Only the euclidean RGB norm and the exposure-independent guided filter without quantization or contrast boost, with one iteration. The filter's local averages are computed on the GPU on a small fixed-size map with Emulsion's blur, and negative variance from rounding is clamped. The Highlights slider drives the upper bands in the shape of darktable's "compress shadows/highlights" presets (3:5:5:3 over -3 to 0 EV), with their exposure boost of -1.57 EV

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

## Methods from published work

Implemented from the papers, not from code.

### Film grain
- A. Newson, N. Faraj, B. Galerne and J. Delon, "A Stochastic Film Grain Model for Resolution-Independent Rendering", Computer Graphics Forum 36(8), 2017
- Used in: `src/engine/grain.ts` and `src/engine/shaders/stages/grain.glsl`
- Emulsion uses the model's statistics (Poisson grain counts at the density that keeps the mean tone, and the resulting variance) rather than rendering each grain, and makes grains larger in thin areas

### Random hash
- M. Jarzynski and M. Olano, "Hash Functions for GPU Rendering", Journal of Computer Graphics Techniques 9(3), 2020 (the PCG 3D hash)
- Used in: `src/engine/grain.ts` and `src/engine/shaders/stages/grain.glsl`

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
