// Copyright (C) 2018-2026 darktable developers.
// Copyright (C) 2019-2024 darktable developers (exposure-independent guided filter).
// Copyright (C) 2019-2023 darktable developers (luminance mask).
// Copyright (C) 2019-2024 darktable developers (Cholesky least squares).
// Ported from darktable src/iop/toneequal.c, src/common/eigf.h, src/common/luminance_mask.h and
// src/iop/choleski.h at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2).
// Translated from C to TypeScript; the euclidean RGB norm and the exposure-independent guided
// filter (EIGF) without quantization or contrast boost, one iteration, and Shadows and Highlights
// sliders mapped onto the nine bands in the shape of darktable's "compress shadows/highlights"
// presets. The filter's averages are computed on a small fixed-size map (see engine.ts), and
// negative variance from rounding is clamped to zero.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Reference implementation of the tone equalizer stage (stages/toneequalizer.glsl).
// It changes exposure by brightness band, like an audio equalizer for light:
// a smoothed, edge-aware brightness map decides how much each pixel is lifted
// or lowered, so local contrast inside shadows and highlights survives.

import type { Vec3 } from '../film/stocks';

/** Band centres the user sets, in EV of the brightness map: -8 to 0. */
export const CENTERS_PARAMS = [-8, -7, -6, -5, -4, -3, -2, -1, 0];
/** Centres of the 8 Gaussians that approximate the 9 bands. */
export const CENTERS_OPS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (-56 + 8 * i) / 7);
export const MIN_EV = -8;
export const MAX_EV = 0;
/** Width of each band's Gaussian; darktable's default `smoothing`. */
export const SMOOTHING = Math.SQRT2;
const MIN_FLOAT = 2 ** -16;

/**
 * Brightness map exposure boost of darktable's "compress shadows/highlights"
 * presets, -1.57 EV, which puts middle grey near the centre of the bands.
 */
export const EXPOSURE_BOOST = 2 ** -1.57;
/** darktable's default `feathering` of 1, as the filter's regulariser 1 / feathering. */
export const FEATHERING = 1;
/** darktable's default `blending`: the smoothing diameter, 5% of the long edge. */
export const BLENDING = 0.05;
/** Gaussian sigma of the filter's averages as a fraction of the long edge (darktable's radius). */
export const MASK_SIGMA = BLENDING / 2;

/** Largest band change at ±100, in EV; darktable allows ±2 EV per band. */
export const MAX_STEP = 1.5;

const gaussianDenom = (sigma: number) => 2 * sigma * sigma;
const gaussian = (r: number, denom: number) => Math.exp((-r * r) / denom);

/** Band gains in EV for the Shadows and Highlights sliders (-100 to 100). */
export function bandGains(shadows: number, highlights: number): number[] {
  const s = (shadows / 100) * MAX_STEP;
  const h = (highlights / 100) * MAX_STEP;
  // darktable's compress presets shape shadows as 3:5:5:3 over the darkest four bands.
  return [0.6 * s, s, s, 0.6 * s, 0, 0, 0.6 * h, h, h];
}

/** Solve the symmetric positive definite system M x = v by Cholesky decomposition. */
function choleskySolve(M: number[][], v: number[]): number[] | null {
  const n = v.length;
  const L = M.map(() => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = M[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 0) return null;
        L[i][i] = Math.sqrt(sum);
      } else L[i][j] = sum / L[j][j];
    }
  }
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = v[i];
    for (let k = 0; k < i; k++) sum -= L[i][k] * y[k];
    y[i] = sum / L[i][i];
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let k = i + 1; k < n; k++) sum -= L[k][i] * x[k];
    x[i] = sum / L[i][i];
  }
  return x;
}

/**
 * Weights of the 8 Gaussians whose sum best fits the 9 band gains, by least
 * squares (darktable's pseudo_solve). Gains are linear factors, not EV.
 */
export function bandFactors(gainsEv: number[], sigma = SMOOTHING): number[] {
  const denom = gaussianDenom(sigma);
  const A = CENTERS_PARAMS.map((p) => CENTERS_OPS.map((o) => gaussian(p - o, denom)));
  const y = gainsEv.map((g) => 2 ** g);
  const n = CENTERS_OPS.length;
  const AtA = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => A.reduce((s, row) => s + row[i] * row[j], 0)));
  const Aty = Array.from({ length: n }, (_, i) => A.reduce((s, row, k) => s + row[i] * y[k], 0));
  return choleskySolve(AtA, Aty) ?? new Array<number>(n).fill(1 / n);
}

/** Exposure correction (a linear gain) for a brightness-map value, clamped to ±2 EV. */
export function correction(lum: number, factors: number[], sigma = SMOOTHING): number {
  const denom = gaussianDenom(sigma);
  const ev = Math.min(Math.max(Math.log2(lum), MIN_EV), MAX_EV);
  const r = CENTERS_OPS.reduce((s, c, i) => s + gaussian(ev - c, denom) * factors[i], 0);
  return Math.min(Math.max(r, 0.25), 4);
}

/** Brightness map value: the euclidean RGB norm, with the exposure boost. */
export function luminance(rgb: Vec3): number {
  return Math.max(EXPOSURE_BOOST * Math.hypot(rgb[0], rgb[1], rgb[2]), MIN_FLOAT);
}

/**
 * EIGF blend for one pixel, guide = mask: `avg` and `var` are the local mean
 * and variance of the brightness map around it. Flat areas move towards the
 * local mean; strong edges keep the pixel's own value.
 */
export function eigf(lum: number, avg: number, variance: number, feathering = FEATHERING): number {
  const nv = variance / Math.max(avg * lum, 1e-6);
  const a = nv / (nv + feathering);
  const b = avg - a * avg;
  return Math.max(lum * a + b, MIN_FLOAT);
}

/** One pixel through the stage, given its neighbourhood's map mean and mean square. */
export function toneEqualize(rgb: Vec3, mean: number, meanSquare: number, factors: number[]): Vec3 {
  const lum = luminance(rgb);
  const smoothed = eigf(lum, mean, Math.max(meanSquare - mean * mean, 0));
  const k = correction(smoothed, factors);
  return rgb.map((v) => v * k) as Vec3;
}
