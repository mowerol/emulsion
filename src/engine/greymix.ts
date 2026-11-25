// Copyright (C) 2010-2026 darktable developers.
// Ported from darktable src/iop/channelmixerrgb.c (color calibration: its grey tab, `commit_params`'
// grey normalisation and the `_loop_switch` path its monochrome presets take) and
// src/common/colorspaces_inline_conversions.h at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773
// (release 5.6.2). Translated from C to TypeScript, at the settings darktable's monochrome presets
// use: XYZ adaptation at the pipeline's own illuminant (no white balance change), the R/G/B mix at
// identity, gamut compression 0, negative clipping on, normalised grey. The colourfulness and
// brightness tabs are at 0, where `_luma_chroma` returns its input, so they are left out.
// darktable's working Rec.2020 is D50-adapted; Emulsion's is D65, so the pixel goes to XYZ through
// the D50-adapted matrix (RawTherapee iccmatrices.h, as in retouch.ts), which is what darktable's
// pipeline RGB to XYZ is.
// Deviation agreed with Oli (2026-11-25): Emulsion runs it after the colour equalizer, where its
// black and white looks desaturated, so the colour equalizer's brightness bands still see colour;
// darktable's default order has color calibration before the colour equalizer.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Reference implementation of the grey mixer stage (stages/greymix.glsl): a look's black and white
// conversion, grey = max(0, w · XYZ) with the weights normalised to sum 1, blended by the look's
// Amount (darktable's opacity).

import type { Vec3 } from '../film/stocks';

/** darktable NORM_MIN (src/common/math.h). */
const NORM_MIN = 1.52587890625e-5;
/** D50 white, xy (src/common/colorspaces.h D50xyY) and u'v' (channelmixerrgb.c _gamut_mapping). */
const D50_XY: [number, number] = [0.34567, 0.3585];
const D50_UV: [number, number] = [0.20915914598542354, 0.488075320769787];
/** Linear Rec.2020 to D50-adapted XYZ (RawTherapee iccmatrices.h, see retouch.ts and NOTICE.md). */
export const REC2020_TO_XYZ_D50: [Vec3, Vec3, Vec3] = [
  [0.6734241, 0.1656411, 0.1251286],
  [0.2790177, 0.6753402, 0.0456377],
  [-0.00193, 0.0299784, 0.797333],
];

/** darktable's commit_params for the grey tab with "normalize" on: the weights over their sum (a sum of 0 keeps them). */
export function greyWeights(grey: Vec3): Vec3 {
  const sum = grey[0] + grey[1] + grey[2];
  const n = sum === 0 ? 1 : sum;
  return [grey[0] / n, grey[1] / n, grey[2] / n];
}

/** Whether a grey mix does anything (darktable's apply_grey). */
export const greyApplies = (grey: Vec3 | null | undefined): grey is Vec3 => !!grey && (grey[0] !== 0 || grey[1] !== 0 || grey[2] !== 0);

/** channelmixerrgb.c _gamut_mapping with clip on, at compression `compression`. */
function gamutMapping(input: Vec3, compression: number): Vec3 {
  const sum = input[0] + input[1] + input[2];
  const Y = input[1];
  const xyY: Vec3 = [sum > 0 ? input[0] / sum : D50_XY[0], sum > 0 ? input[1] / sum : D50_XY[1], Y];
  // dt_xyY_to_uvY
  const den = -2 * xyY[0] + 12 * xyY[1] + 3;
  const uv = [4 * xyY[0] / den, 9 * xyY[1] / den];
  const delta = [D50_UV[0] - uv[0], D50_UV[1] - uv[1]];
  const Delta = Y * (delta[0] * delta[0] + delta[1] * delta[1]);
  const correction = compression === 0 ? 0 : Math.pow(Delta, compression);
  for (let c = 0; c < 2; c++) {
    const tmp = correction * delta[c] + uv[c];
    uv[c] = uv[c] > D50_UV[c] ? Math.max(tmp, D50_UV[c]) : Math.min(tmp, D50_UV[c]);
  }
  // dt_uvY_to_xyY
  const d2 = 6 * uv[0] - 16 * uv[1] + 12;
  let x = 9 * uv[0] / d2, y = 4 * uv[1] / d2;
  x = Math.max(x, 0);
  y = Math.max(y, 0);
  y = Math.max(y, NORM_MIN);
  const scale = x + y;
  if (scale >= 1) { x /= scale; y /= scale; }
  // dt_xyY_to_XYZ (y is never 0 here)
  return [Y * x / y, Y, Y * (1 - x - y) / y];
}

/** The grey value of one scene-linear Rec.2020 pixel, with `w` from greyWeights. */
export function greyOf(rgb: Vec3, w: Vec3): number {
  // clip: dt_vector_max_nan with 0
  const r = Math.max(rgb[0], 0), g = Math.max(rgb[1], 0), b = Math.max(rgb[2], 0);
  const m = REC2020_TO_XYZ_D50;
  // XYZ adaptation at the pipeline's illuminant is no change; the identity mix keeps XYZ.
  let xyz: Vec3 = [m[0][0] * r + m[0][1] * g + m[0][2] * b, m[1][0] * r + m[1][1] * g + m[1][2] * b, m[2][0] * r + m[2][1] * g + m[2][2] * b];
  xyz = [Math.max(xyz[0], 0), Math.max(xyz[1], 0), Math.max(xyz[2], 0)];
  xyz = gamutMapping(xyz, 0);
  // Back in "LMS" (here XYZ), clipped twice around the identity _luma_chroma.
  xyz = [Math.max(xyz[0], 0), Math.max(xyz[1], 0), Math.max(xyz[2], 0)];
  return Math.max(xyz[0] * w[0] + xyz[1] * w[1] + xyz[2] * w[2], 0);
}

/** The stage: the pixel turned grey by `w`, blended over the input by `amount` (0 to 1). */
export function greyMix(rgb: Vec3, w: Vec3, amount: number): Vec3 {
  const g = greyOf(rgb, w);
  return [rgb[0] + (g - rgb[0]) * amount, rgb[1] + (g - rgb[1]) * amount, rgb[2] + (g - rgb[2]) * amount];
}
