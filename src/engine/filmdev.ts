// Copyright (C) 2026 darktable developers.
// Film edges: the spatial part of darktable spektrafilm's DIR couplers (src/iop/spektrafilm.c
// process(), the coupler field's diffusion, and src/common/spektra_sim.c sf_sim_develop_corr at
// c247126f9a7a2c3cdfc0f675a7698c24710438ca), applied to the photo's light so that it works under
// any look. Film modeling powered by spektrafilm, GPLv3, © Andrea Volpato.
//
// darktable develops a film's density as curve(e - blur(c(e))): e is the film's log exposure,
// c the inhibitor each pixel releases, blur its spread through the emulsion (a 20 µm Gaussian
// plus a 3 % exponential tail of 200 µm). The per-pixel part, curve(e - c(e)), is inside a film
// stock already (engine/film.ts) and in a look's own colour; what this adds is the rest, the
// difference between a pixel's own inhibition and its neighbourhood's, as a log exposure change
// per layer:
//   delta = c(e) - blur(c(e))                                 (any look)
//   delta : delta - (c(e + delta) - c(e)) = c(e) - blur(c(e)) (a film stock, whose own per-pixel
//           couplers then act on e + delta and land exactly on darktable's spatial result)
// and the photo's light is multiplied by 10^(amount * delta) per channel.
// Approved by Oli (2026-11-27, "two toggles"): Film edges and Film softness as two controls for
// every look. Deviations from darktable, recorded here: the change is applied to the photo's light
// before the scene edits (the light that exposes the film), not inside the film's development;
// a look that is not a film stock takes Portra 400's coupler data; a film layer's log exposure is
// changed through its own RGB channel (darktable's layers see a spectral mix); exact Gaussians.
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Vec3 } from '../film/stocks';
import { curveAt, filmCorrection, filmExposure, type FilmData } from './film';
import { gaussianKernel } from './scatter';

/** The exponential tail as three Gaussians (spektra_sim.h SF_EXPTAIL_*). */
export const EXPTAIL_AMP = [0.1633, 0.6496, 0.1870] as const;
export const EXPTAIL_RATIO = [0.5360, 1.5236, 2.7684] as const;

/** One blur of the coupler spread: sigma in source pixels, weight in the mix. */
export interface SpreadComponent { sigma: number; weight: number }

/** darktable's coupler spread, (1 - w) G(σ) + w Σ a_g G(r_g λ), in pixels of `pixelUm` µm. */
export function couplerSpread(film: FilmData, pixelUm: number): SpreadComponent[] {
  const c = film.meta.couplers;
  const w = c.tailWeight, tail = c.tailUm / Math.max(pixelUm, 1e-3);
  const bank: SpreadComponent[] = [{ sigma: c.diffusionUm / Math.max(pixelUm, 1e-3), weight: 1 - w }];
  if (w > 0) EXPTAIL_AMP.forEach((a, g) => bank.push({ sigma: EXPTAIL_RATIO[g] * tail, weight: w * a }));
  return bank;
}

/** A film's correction as a function of its log exposure, with its derivative per layer. */
function silverSlope(film: FilmData, e: Vec3): { s: Vec3; ds: Vec3 } {
  const c = film.meta.couplers, h = 1e-3;
  const silver = (v: number, k: number) => {
    const d = curveAt(c.curvesNorm, c.le0, c.invLeStep, v, k);
    const s = c.positive ? c.dmax[k] - d : d;
    return c.donorLangmuir ? s * (c.donorK[k] + c.donorDref[k]) / (c.donorK[k] + s) : s;
  };
  const s = e.map((v, k) => silver(v, k)) as Vec3;
  const ds = e.map((v, k) => (silver(v + h, k) - silver(v - h, k)) / (2 * h)) as Vec3;
  return { s, ds };
}

/**
 * The log exposure change a film stock needs at this pixel: solves
 * delta - (c(e + delta) - c(e)) = spatial by Newton's method on the 3 x 3 Jacobian
 * I - Mᵀ diag(s'(e + delta)). `spatial` is c(e) - blur(c(e)).
 */
export function stockDelta(film: FilmData, e: Vec3, spatial: Vec3): Vec3 {
  const M = film.meta.couplers.M;
  const ce = filmCorrection(film, e);
  let d: Vec3 = [...spatial];
  for (let it = 0; it < 4; it++) {
    const at = e.map((v, k) => v + d[k]) as Vec3;
    const cd = filmCorrection(film, at);
    const f = [0, 1, 2].map(m => d[m] - (cd[m] - ce[m]) - spatial[m]);
    const { ds } = silverSlope(film, at);
    // J[m][k] = δmk - M[k][m] s'_k
    const J = [0, 1, 2].map(m => [0, 1, 2].map(k => (m === k ? 1 : 0) - M[k * 3 + m] * ds[k]));
    const step = solve3(J, f);
    d = d.map((v, k) => v - step[k]) as Vec3;
    if (Math.max(...f.map(Math.abs)) < 1e-6) break;
  }
  return d;
}

function solve3(A: number[][], b: number[]): number[] {
  const [a, bb, c] = A[0], [d, e, f] = A[1], [g, h, i] = A[2];
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return b;
  const inv = [
    [e * i - f * h, c * h - bb * i, bb * f - c * e],
    [f * g - d * i, a * i - c * g, c * d - a * f],
    [d * h - e * g, bb * g - a * h, a * e - bb * d],
  ];
  return inv.map(row => (row[0] * b[0] + row[1] * b[1] + row[2] * b[2]) / det);
}

/** Separable clamp-to-edge Gaussian of a 3-channel image (exact kernel, as scatter.ts). */
export function blur3(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma < 1e-6) return src.slice();
  const k = gaussianKernel(sigma), r = (k.length - 1) / 2;
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let a = 0;
    for (let i = -r; i <= r; i++) a += k[i + r] * src[3 * (y * w + Math.min(w - 1, Math.max(0, x + i))) + c];
    tmp[3 * (y * w + x) + c] = a;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let a = 0;
    for (let i = -r; i <= r; i++) a += k[i + r] * tmp[3 * (Math.min(h - 1, Math.max(0, y + i)) * w + x) + c];
    out[3 * (y * w + x) + c] = a;
  }
  return out;
}

/**
 * Film edges on a linear Rec.2020 image (the light that exposes the film): the multiplier per
 * pixel and channel, 10^(amount · delta). `stock` says the look is this film stock (its own
 * per-pixel couplers follow); otherwise `film` is the reference film for any look.
 */
export function filmEdgesGain(rgb: Float32Array, w: number, h: number, pixelUm: number, film: FilmData, amount: number, stock: boolean): Float32Array {
  const n = w * h, e = new Float32Array(n * 3), c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const ei = filmExposure(film, [rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2]]);
    e.set(ei, 3 * i);
    c.set(filmCorrection(film, ei), 3 * i);
  }
  const spread = new Float32Array(n * 3);
  for (const comp of couplerSpread(film, pixelUm)) {
    const b = blur3(c, w, h, comp.sigma);
    for (let i = 0; i < spread.length; i++) spread[i] += comp.weight * b[i];
  }
  const gain = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const spatial = [0, 1, 2].map(k => c[3 * i + k] - spread[3 * i + k]) as Vec3;
    const d = stock ? stockDelta(film, [e[3 * i], e[3 * i + 1], e[3 * i + 2]], spatial) : spatial;
    for (let k = 0; k < 3; k++) gain[3 * i + k] = 10 ** (amount * d[k]);
  }
  return gain;
}
