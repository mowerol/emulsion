// Copyright (C) 2010-2026 darktable developers.
// Rec.709 decoding translated from the Gamma Rec709 RGB profile definition in
// darktable src/common/colorspaces.c (_colorspaces_create_gamma_rec709_rgb_profile),
// commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773. Same piecewise TRC; evaluated directly.
// F-Log2 encoding: FUJIFILM F-Log2 Data Sheet v1.1, section 2-3 (2024-11-21).
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Build-time adapter for user-supplied Fuji LUTs, not a new app processing stage.
// The monitor recommendation (gamma 2.2) does not specify a signal encoding.
// Use darktable's standard Gamma Rec709 RGB input profile for this photo adaptation.

import type { Vec3 } from '../../src/film/stocks';
import { SRGB_TO_REC2020, mulVec, srgbEotf, srgbOetf } from '../../src/engine/color.ts';
import { toneInverse } from '../../src/engine/tone.ts';
import { tetrahedral, type Clut } from '../../src/engine/lut3d.ts';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Inverse BT.709 OETF, matching darktable's Gamma Rec709 RGB ICC tone curve. */
export const decodeRec709 = (v: number): number => v < 0.081 ? v / 4.5 : Math.pow((v + 0.099) / 1.099, 1 / 0.45);
export const rec709ToSrgb = (v: number): number => clamp01(srgbOetf(decodeRec709(clamp01(v))));

/** Scene-linear reflection -> F-Log2. F-Gamut primaries/white are the same as Rec.2020. */
export const encodeFLog2 = (x: number): number => x >= 0.000889
  ? 0.245281 * Math.log10(5.555556 * x + 0.064829) + 0.384316
  : 8.799461 * x + 0.092864;

/** Undo the exact neutral print encoding applied before Emulsion's sRGB display LUT. */
export function fujiInputToLog(rgb: Vec3): Vec3 {
  return mulVec(SRGB_TO_REC2020, rgb.map(srgbEotf) as Vec3)
    .map(v => toneInverse(srgbOetf(clamp01(v))))
    .map(v => clamp01(encodeFLog2(v))) as Vec3;
}

/** Fuji's original colour/contrast table, with the input/output adaptation around it. */
export const adaptFuji = (lut: Clut, rgb: Vec3): Vec3 => tetrahedral(lut, fujiInputToLog(rgb)).map(rec709ToSrgb) as Vec3;
