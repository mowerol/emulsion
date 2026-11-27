// Copyright (C) 2012-2026 darktable developers.
// Ported from darktable src/common/spektra_core.c sf_halation() stage 1 (scatter) and
// src/common/gaussian.c dt_gaussian_kernel_1d() at c247126f9a7a2c3cdfc0f675a7698c24710438ca;
// the defaults are the darktable-spektrafilm pack's Kodak colour negative values (b15cfe1),
// identical to spektrafilm runtime/params_schema.py at 6cd00c8d4f30b5b550f50f4bbd3753c9f2a48507.
// Film modeling powered by spektrafilm, GPLv3, © Andrea Volpato.
// RESEARCH PROTOTYPE (not in recipes or the UI). Deviations, to be put to Oli:
// - working RGB instead of spectral film exposure (as approved for Halation and Glow, 2026-11-10);
// - applied to the source (after capture sharpening, lens correction and retouch), before our
//   scene edits, instead of after the tone equalizer: it commutes exactly with exposure, Glow
//   and Halation (all linear), and differs only through haze removal and the tone equalizer;
// - the direct Gaussian kernel at every sigma (darktable's below 3 px; above, it switches to a
//   Young-van Vliet recursion for speed, which spektrafilm's own exact Gaussian doesn't).
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Vec3 } from '../film/stocks';
import { FRAME_UM } from './optics';

/** In-emulsion scatter: a Gaussian core and an exponential tail per layer, in µm on the film. */
export interface ScatterParams {
  core: Vec3;
  tail: Vec3;
  tailWeight: Vec3;
  /** Fraction of light that scatters, 0–1 (darktable "scatter amount"). */
  amount: number;
  /** Spatial scale of core and tail (darktable "scatter size", 0.2–4). */
  scale: number;
}

/** Every Kodak colour negative in the pack (Gold 200, Portra, UltraMax, Ektar) has these. */
export const SCATTER_DEFAULTS: ScatterParams = {
  core: [2.2, 2.0, 1.6],
  tail: [9.3, 9.7, 9.1],
  tailWeight: [0.78, 0.65, 0.67],
  amount: 1,
  scale: 1,
};

/** The exponential tail as three Gaussians: amplitude and radius multiplier (upstream fit). */
export const TAIL_AMP = [0.1633, 0.6496, 0.1870] as const;
export const TAIL_RATIO = [0.5360, 1.5236, 2.7684] as const;

/** dt_gaussian_kernel_1d: radius round(3σ), at least 1; normalised in double. */
export function gaussianKernel(sigma: number, maxRadius = 512): Float32Array {
  const radius = Math.min(maxRadius, Math.max(1, Math.trunc(Math.fround(3 * sigma) + 0.5)));
  const inv2s2 = 1 / (2 * sigma * sigma);
  const k = new Float64Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) { k[i + radius] = Math.fround(Math.exp(-i * i * inv2s2)); sum += Math.exp(-i * i * inv2s2); }
  const inv = Math.fround(1 / sum);
  return Float32Array.from(k, v => v * inv);
}

/** One blur of the bank: its per-channel sigma (source pixels) and weight in the mix. */
export interface ScatterComponent { sigma: Vec3; weight: Vec3 }

/**
 * The scatter as a bank of per-channel Gaussians whose weights, with the unscattered term
 * 1 − amount, sum to one per channel: core (1 − w)·s, tail g w·amp_g·s.
 * `pixelUm` is µm on the film per source pixel (darktable: film_format_mm·1000 / long edge).
 */
export function scatterBank(pixelUm: number, p: ScatterParams = SCATTER_DEFAULTS): ScatterComponent[] {
  const s = Math.min(1, Math.max(0, p.amount));
  const scl = Math.max(p.scale, 1e-3);
  const ch = (f: (c: number) => number) => [0, 1, 2].map(f) as Vec3;
  const bank: ScatterComponent[] = [{
    sigma: ch(c => Math.max(Math.fround(p.core[c] * scl / pixelUm), 1e-6)),
    weight: ch(c => s * (1 - p.tailWeight[c])),
  }];
  TAIL_AMP.forEach((amp, g) => bank.push({
    sigma: ch(c => Math.max(Math.fround(TAIL_RATIO[g] * (p.tail[c] * scl / pixelUm)), 1e-6)),
    weight: ch(c => s * p.tailWeight[c] * amp),
  }));
  return bank;
}

export const pixelUmFor = (longEdge: number) => FRAME_UM / Math.max(1, longEdge);

/** The widest kernel radius of the bank, in source pixels: the stage's reach. */
export const scatterReach = (bank: ScatterComponent[]) =>
  Math.max(...bank.flatMap(b => b.sigma.map(s => Math.trunc(Math.fround(3 * s) + 0.5))));

/** Separable clamp-to-edge convolution of one channel (the order darktable takes its taps). */
function blurPlane(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma < 1e-6) return src.slice();
  const k = gaussianKernel(sigma), r = (k.length - 1) / 2;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0;
    for (let i = -r; i <= r; i++) a = Math.fround(a + k[i + r] * src[y * w + Math.min(w - 1, Math.max(0, x + i))]);
    tmp[y * w + x] = a;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0;
    for (let i = -r; i <= r; i++) a = Math.fround(a + k[i + r] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x]);
    out[y * w + x] = a;
  }
  return out;
}

/**
 * sf_halation stage 1 on an interleaved RGB image: (1 − s)·raw + s·((1 − w)·core + w·tail),
 * the tail the sum of the three amplitude-weighted Gaussians.
 */
export function scatterImage(rgb: Float32Array, w: number, h: number, pixelUm: number, p: ScatterParams = SCATTER_DEFAULTS): Float32Array {
  const s = Math.min(1, Math.max(0, p.amount));
  const out = rgb.slice();
  if (s <= 0) return out;
  const scl = Math.max(p.scale, 1e-3);
  for (let c = 0; c < 3; c++) {
    const plane = Float32Array.from({ length: w * h }, (_, i) => rgb[3 * i + c]);
    const tail = new Float32Array(w * h);
    TAIL_AMP.forEach((amp, g) => {
      const b = blurPlane(plane, w, h, Math.max(Math.fround(TAIL_RATIO[g] * (p.tail[c] * scl / pixelUm)), 1e-6));
      for (let i = 0; i < w * h; i++) tail[i] = Math.fround(tail[i] + amp * b[i]);
    });
    const core = blurPlane(plane, w, h, Math.max(Math.fround(p.core[c] * scl / pixelUm), 1e-6));
    const ws = p.tailWeight[c];
    for (let i = 0; i < w * h; i++) {
      const scattered = ws * tail[i] + (1 - ws) * core[i];
      out[3 * i + c] = plane[i] + s * (scattered - plane[i]);
    }
  }
  return out;
}

/** The bank's modulation transfer at f cycles per mm on the film (continuous Gaussians). */
export function scatterMtf(f: number, p: ScatterParams = SCATTER_DEFAULTS): Vec3 {
  const g = (sigmaUm: number) => Math.exp(-2 * (Math.PI * f * sigmaUm / 1000) ** 2);
  const s = Math.min(1, Math.max(0, p.amount)), scl = Math.max(p.scale, 1e-3);
  return [0, 1, 2].map(c => {
    const tail = TAIL_AMP.reduce((a, amp, k) => a + amp * g(TAIL_RATIO[k] * p.tail[c] * scl), 0);
    return 1 - s + s * ((1 - p.tailWeight[c]) * g(p.core[c] * scl) + p.tailWeight[c] * tail);
  }) as Vec3;
}
