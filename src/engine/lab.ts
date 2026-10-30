// SPDX-License-Identifier: GPL-3.0-or-later
// CIE Lab lightness of linear working RGB (Rec.2020, D65 white), and moving it
// while keeping Lab a and b, for the stages ported from darktable's Lab modules.
// Mirrors shaders/stages/lab.glsl.

import type { Vec3 } from '../film/stocks';
import { REC2020_TO_XYZ, XYZ_TO_REC2020 } from './colorbalance';
import { mulVec } from './color';

/** The working space's white in XYZ, so greys stay exactly grey. */
export const WORKING_WHITE = mulVec(REC2020_TO_XYZ, [1, 1, 1]);
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;
const f = (t: number) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
const fInv = (v: number) => (v * v * v > EPS ? v * v * v : (116 * v - 16) / KAPPA);

/** CIE L* (0 to 100 for display light; more for scene light above white) of linear RGB. */
export function labL(lin: Vec3): number {
  const Y = REC2020_TO_XYZ[1][0] * lin[0] + REC2020_TO_XYZ[1][1] * lin[1] + REC2020_TO_XYZ[1][2] * lin[2];
  return 116 * f(Math.max(Y, 0)) - 16;
}

/** Linear RGB with L* moved by `dL` (L* units), keeping a and b. */
export function labShiftL(lin: Vec3, dL: number): Vec3 {
  const xyz = mulVec(REC2020_TO_XYZ, lin);
  const fs = xyz.map((v, i) => f(Math.max(v, 0) / WORKING_WHITE[i]));
  const L = Math.max(116 * fs[1] - 16 + dL, 0);
  // Keeping a = 500 (fx - fy) and b = 200 (fy - fz) moves all three by the same step.
  const step = (L + 16) / 116 - fs[1];
  return mulVec(XYZ_TO_REC2020, fs.map((v, i) => fInv(v + step) * WORKING_WHITE[i]) as Vec3).map((v) => Math.max(v, 0)) as Vec3;
}
