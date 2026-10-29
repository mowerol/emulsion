// Copyright (C) 2020-2024 darktable developers (illuminants).
// Copyright (C) 2020-2025 darktable developers (chromatic adaptation).
// Ported from darktable src/common/illuminants.h (CCT_to_xy_daylight, CCT_to_xy_blackbody,
// planckian_normal, blackbody_xy_to_tinted_xy, illuminant_xy_to_XYZ) and
// src/common/chromatic_adaptation.h (CAT16 matrices and CAT16_adapt_D65 with full adaptation)
// at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2). Translated from C to
// TypeScript. Emulsion's additions: adaptation from one white to another in Rec.2020, a numeric
// inverse from a white point to temperature and tint that round-trips exactly, a tint scale for
// the slider, and solving the white that makes a sampled colour neutral.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// White balance by chromatic adaptation. Every photo arrives balanced for some
// white, its as-shot white (a RAW's camera setting; D65 for anything else).
// Choosing another white W re-balances it with CAT16: in its cone space each
// channel is scaled by as-shot / W, so the light W renders as neutral.

import type { Mat3, Vec3 } from '../film/stocks';
import { mulMat, mulVec } from './color';
import { REC2020_TO_XYZ, XYZ_TO_REC2020 } from './colorbalance';

export type Xy = [number, number];

/** The white of everything that is not a RAW: D65, as darktable defines it. */
export const D65_XY: Xy = [0.31271, 0.32902];

export const MIN_TEMPERATURE = 2000;
export const MAX_TEMPERATURE = 15000;
/** Tint slider ±100 moves the white this far from the Planckian locus, in xy. */
export const TINT_SCALE = 0.0003;
export const MAX_TINT = 100;

// CAT16 cone space (darktable chromatic_adaptation.h).
const XYZ_TO_CAT16: Mat3 = [
  [0.401288, 0.650173, -0.051461],
  [-0.250268, 1.204414, 0.045854],
  [-0.002079, 0.048952, 0.953127],
];
const CAT16_TO_XYZ: Mat3 = [
  [1.862068, -1.011255, 0.149187],
  [0.38752, 0.621447, -0.008974],
  [-0.015841, -0.034123, 1.049964],
];

/** CIE daylight chromaticity, 4000 K to 25000 K. */
export function daylightXy(t: number): Xy {
  let x = 0;
  if (t >= 4000 && t <= 7000) x = ((-4.607e9 / t + 2.9678e6) / t + 0.09911e3) / t + 0.244063;
  else if (t > 7000 && t <= 25000) x = ((-2.0064e9 / t + 1.9018e6) / t + 0.24748e3) / t + 0.23704;
  return [x, (-3 * x + 2.87) * x - 0.275];
}

/** Planckian (blackbody) chromaticity, 1667 K to 25000 K. */
export function blackbodyXy(t: number): Xy {
  let x = 0;
  let y = 0;
  if (t >= 1667 && t <= 4000) x = ((-0.2661239e9 / t - 0.2343589e6) / t + 0.8776956e3) / t + 0.17991;
  else if (t > 4000 && t <= 25000) x = ((-3.0258469e9 / t + 2.1070379e6) / t + 0.2226347e3) / t + 0.24039;
  if (t >= 1667 && t <= 2222) y = ((-1.1063814 * x - 1.3481102) * x + 2.18555832) * x - 0.20219683;
  else if (t > 2222 && t <= 4000) y = ((-0.9549476 * x - 1.37418593) * x + 2.09137015) * x - 0.16748867;
  else if (t > 4000 && t <= 25000) y = ((3.081758 * x - 5.8733867) * x + 3.75112997) * x - 0.37001483;
  return [x, y];
}

/** Slope direction of the normal to the Planckian locus at `x` (darktable's planckian_normal). */
function planckianNormal(x: number, t: number): number {
  if (t >= 1667 && t <= 2222) return (-3.3191442 * x - 2.6962204) * x + 2.18555832;
  if (t > 2222 && t <= 4000) return (-2.8648428 * x - 2.74837186) * x + 2.09137015;
  if (t > 4000 && t < 25000) return (9.245274 * x - 11.7467734) * x + 3.75112997;
  return 0;
}

/**
 * The white for a temperature and tint: daylight above 4000 K and blackbody
 * below, as darktable picks them, moved off the locus at right angles by the
 * tint. As in Lightroom, positive tint makes the image more magenta, which
 * means the light being corrected was greener: the white moves towards green,
 * the opposite of darktable's blackbody_xy_to_tinted_xy sign.
 */
export function whiteXy(temperature: number, tint: number): Xy {
  const [x, y] = temperature >= 4000 ? daylightXy(temperature) : blackbodyXy(temperature);
  const n = planckianNormal(x, temperature);
  const norm = Math.sqrt(1 + n * n);
  const d = -tint * TINT_SCALE;
  return [x + (d * n) / norm, y - d / norm];
}

/**
 * Temperature and tint for a white point: the inverse of `whiteXy`, found by
 * searching temperature in mireds (even steps for the eye) for the point whose
 * tint line passes through `xy`, then refining.
 */
export function temperatureTint(xy: Xy): { temperature: number; tint: number } {
  // Signed distance of xy from the tint line through T, along the locus.
  const miss = (t: number) => {
    const [x0, y0] = whiteXy(t, 0);
    const [x1, y1] = whiteXy(t, 1);
    const dx = x1 - x0;
    const dy = y1 - y0;
    return ((xy[0] - x0) * dy - (xy[1] - y0) * dx) / Math.hypot(dx, dy);
  };
  const minM = 1e6 / MAX_TEMPERATURE;
  const maxM = 1e6 / MIN_TEMPERATURE;
  let best = minM;
  let bestErr = Infinity;
  for (let m = minM; m <= maxM; m += 2) {
    const e = Math.abs(miss(1e6 / m));
    if (e < bestErr) [best, bestErr] = [m, e];
  }
  let lo = Math.max(minM, best - 2);
  let hi = Math.min(maxM, best + 2);
  for (let i = 0; i < 50; i++) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (Math.abs(miss(1e6 / a)) < Math.abs(miss(1e6 / b))) hi = b;
    else lo = a;
  }
  const temperature = 1e6 / ((lo + hi) / 2);
  const [x0, y0] = whiteXy(temperature, 0);
  const [x1, y1] = whiteXy(temperature, 1);
  const tint = ((xy[0] - x0) * (x1 - x0) + (xy[1] - y0) * (y1 - y0)) / ((x1 - x0) ** 2 + (y1 - y0) ** 2);
  return { temperature, tint };
}

/** An illuminant's XYZ with Y = 1 (darktable's illuminant_xy_to_XYZ). */
export const illuminantXyz = ([x, y]: Xy): Vec3 => [x / y, 1, (1 - x - y) / y];

const XYZ_TO_REC = XYZ_TO_REC2020;

/**
 * Rec.2020 matrix that re-balances a photo shot for `from` so that light of
 * colour `to` becomes neutral: CAT16 with full adaptation.
 */
export function whiteBalanceMatrix(from: Xy, to: Xy): Mat3 {
  const a = mulVec(XYZ_TO_CAT16, illuminantXyz(from));
  const b = mulVec(XYZ_TO_CAT16, illuminantXyz(to));
  const scale: Mat3 = [
    [a[0] / b[0], 0, 0],
    [0, a[1] / b[1], 0],
    [0, 0, a[2] / b[2]],
  ];
  return mulMat(XYZ_TO_REC, mulMat(CAT16_TO_XYZ, mulMat(scale, mulMat(XYZ_TO_CAT16, REC2020_TO_XYZ))));
}

/**
 * The white that makes `sample` (scene-linear Rec.2020, as balanced for
 * `from`) neutral: its cone response divided by D65's, scaled back by the
 * as-shot white.
 */
export function neutralizingWhite(sample: Vec3, from: Xy): Xy | null {
  const s = mulVec(XYZ_TO_CAT16, mulVec(REC2020_TO_XYZ, sample));
  const w = mulVec(XYZ_TO_CAT16, illuminantXyz(D65_XY));
  const a = mulVec(XYZ_TO_CAT16, illuminantXyz(from));
  if (s.some((v) => !(v > 0))) return null;
  const lms: Vec3 = [(s[0] * a[0]) / w[0], (s[1] * a[1]) / w[1], (s[2] * a[2]) / w[2]];
  const xyz = mulVec(CAT16_TO_XYZ, lms);
  const sum = xyz[0] + xyz[1] + xyz[2];
  return sum > 0 ? [xyz[0] / sum, xyz[1] / sum] : null;
}

export interface WhiteBalance {
  temperature: number;
  tint: number;
}

export const clampWhiteBalance = (wb: WhiteBalance): WhiteBalance => ({
  temperature: Math.min(MAX_TEMPERATURE, Math.max(MIN_TEMPERATURE, wb.temperature)),
  tint: Math.min(MAX_TINT, Math.max(-MAX_TINT, wb.tint)),
});

/** Lightroom's presets, as temperature and tint. */
export const WB_PRESETS: { id: string; label: string; wb: WhiteBalance }[] = [
  { id: 'daylight', label: 'Daylight', wb: { temperature: 5500, tint: 0 } },
  { id: 'cloudy', label: 'Cloudy', wb: { temperature: 6500, tint: 0 } },
  { id: 'shade', label: 'Shade', wb: { temperature: 7500, tint: 0 } },
  { id: 'tungsten', label: 'Tungsten', wb: { temperature: 2850, tint: 0 } },
  { id: 'fluorescent', label: 'Fluorescent', wb: { temperature: 3800, tint: 20 } },
  { id: 'flash', label: 'Flash', wb: { temperature: 5500, tint: 0 } },
];
