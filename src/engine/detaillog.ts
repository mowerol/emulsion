// SPDX-License-Identifier: GPL-3.0-or-later
// Detail before Exposure (Oli, 2026-11-03: "option B", behind Engine.detailOrder = 'log'). A
// deviation from darktable's order, where the contrast equalizer (Texture) runs on L* after
// exposure: here it runs, with darktable's own filter and preset, on a log lightness taken
// before exposure, so an Exposure (or tone equalizer, or later) edit no longer remakes it.
//
// The log lightness is L* near mid grey, and Exposure moves it by the same amount everywhere:
//   u(Y) = 50 + S log2((Y + ε) / Y50),  Y50 = Y at L* = 50,  S = dL*/dlog2 Y at Y50 = ln 2 · 66 / 3,
// so a filter that sees only differences (the à-trous detail and its edge weights) gives the
// same detail at every exposure. The detail is applied back as a ratio of luminance (logShift):
// a change du moves Y + ε by 2^(du / S), which in L* is du times the pixel's own L* per stop,
// as darktable's L* detail is to first order. The look differs in the second order: the edge
// weights see stops, not L*, and large contrasts. ε keeps the deepest shadows' noise from being
// boosted as log space would; below it the lightness is no longer exactly exposure-free.
// Clarity (darktable's local laplacian) runs on the same log lightness, after Texture's change,
// scaled to the filter's 0-1 and clamped to its extended grid (LOG_GAMMAS in locallaplacian.ts);
// its change is applied as a ratio of luminance in scene light, before the camera profile and
// the film's curve, where darktable's order applies it to the print's L* after them.
// Mirrors shaders/stages/detaillog.glsl.

import type { Vec3 } from '../film/stocks';
import { REC2020_TO_XYZ } from './colorbalance';
import { LOG_RANGE } from './locallaplacian';

/** The luminance (Y, white 1) of linear working RGB (Rec.2020). */
export const lumY = (lin: Vec3) => REC2020_TO_XYZ[1][0] * lin[0] + REC2020_TO_XYZ[1][1] * lin[1] + REC2020_TO_XYZ[1][2] * lin[2];

/** L* of a luminance (Y, white 1). */
const lstar = (Y: number) => {
  const t = Math.max(Y, 0);
  return t > 216 / 24389 ? 116 * Math.cbrt(t) - 16 : (24389 / 27) * t;
};

/** Y at L* = 50. */
export const LOG_Y50 = ((50 + 16) / 116) ** 3;
/** L* per stop at Y50: d(116 Y^(1/3) - 16) / d log2 Y = ln 2 (L* + 16) / 3. */
export const LOG_SLOPE = (Math.LN2 * (50 + 16)) / 3;
/** The shadow floor, in Y (L* ≈ 0.2). */
export const LOG_EPS = 2 ** -12;

/** The log lightness of a luminance. */
export function logLightness(Y: number): number {
  return 50 + LOG_SLOPE * Math.log2((Math.max(Y, 0) + LOG_EPS) / LOG_Y50);
}

/** The change in L* that moving a pixel of luminance Y by `du` in log lightness makes. */
export function logShift(Y: number, du: number): number {
  const y = Math.max(Y, 0);
  const moved = (y + LOG_EPS) * 2 ** (du / LOG_SLOPE) - LOG_EPS;
  return lstar(moved) - lstar(y);
}

/** Clarity's input (the local laplacian's 0-1 scale) for a luminance and Texture's change `du` there. */
export function clarityLogInput(Y: number, du: number): number {
  return Math.min(Math.max((logLightness(Y) + du) / 100, LOG_RANGE[0]), LOG_RANGE[1]);
}
