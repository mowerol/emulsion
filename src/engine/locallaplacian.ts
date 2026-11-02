// Copyright (C) 2016-2026 darktable developers.
// Ported from darktable src/common/locallaplacian.c and the "clarity" preset of src/iop/bilat.c
// (local contrast) at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2).
// Translated from C to TypeScript (and GLSL, in shaders/ll*.frag.glsl). Changes: pyramid borders
// clamp to the edge at every level instead of padding the input by replication; Lab is relative
// to D65, as Emulsion's working space is D65 Rec.2020; the Clarity slider is mapped onto the
// module's parameters (below).
// Region views use the same file's boundary-mode coarse output sampling, with four local fine
// levels and an explicit filter halo instead of LL_FILL's preview padding. Each instance keeps
// its own reconstructed preview levels. This can differ from full-size mode 0; the pinned bilat.c
// passes a null boundary and does not itself enable mode 2. Exports retain the full pyramid.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Reference implementation of the clarity stage: darktable's local laplacian
// filter (Paris, Hasinoff and Kautz 2011, in the fast form of Aubry et al. 2014)
// on CIE lightness, after the tone curve, as darktable's local contrast module
// runs it. Brightness is sampled at six levels; for each, the image is remapped
// by a curve that boosts detail around that level and broken into a Laplacian
// pyramid; each output coefficient is interpolated from the two levels around
// the pixel's own brightness at that scale, and the pyramid is collapsed.

import type { Vec3 } from '../film/stocks';
import { labL, labShiftL } from './lab';

export const NUM_GAMMA = 6;
/** Brightness levels the remapping curves centre on: evenly spaced in [0, 1]. */
export const GAMMAS = Array.from({ length: NUM_GAMMA }, (_, k) => (k + 0.5) / NUM_GAMMA);
const MAX_LEVELS = 30;

export interface ClarityParams {
  /** darktable's `midtone`: the brightness range treated as detail. */
  sigma: number;
  /** darktable's `sigma_s` in local laplacian mode: contrast of large shadow edges (1 keeps it). */
  shadows: number;
  /** darktable's `sigma_r` in local laplacian mode: contrast of large highlight edges (1 keeps it). */
  highlights: number;
  /** darktable's `detail`: added local contrast in the midtones. */
  clarity: number;
}

/** darktable's "clarity" preset of the local contrast module. */
export const CLARITY_PRESET: ClarityParams = { sigma: 0.5, shadows: 0, highlights: 0, clarity: 0.33 };

/**
 * The Clarity slider (-100 to 100) to the filter's parameters. At +100 it is
 * darktable's clarity preset, reached from no change; below zero only the
 * detail goes negative, which softens local contrast and keeps large edges.
 */
export function clarityParams(slider: number): ClarityParams {
  const t = Math.max(-1, Math.min(1, slider / 100));
  if (t >= 0) {
    return {
      sigma: CLARITY_PRESET.sigma,
      shadows: 1 + (CLARITY_PRESET.shadows - 1) * t,
      highlights: 1 + (CLARITY_PRESET.highlights - 1) * t,
      clarity: CLARITY_PRESET.clarity * t,
    };
  }
  return { sigma: CLARITY_PRESET.sigma, shadows: 1, highlights: 1, clarity: CLARITY_PRESET.clarity * t };
}

/** darktable's curve_scalar: the remapping curve around brightness level `g`. */
export function curve(x: number, g: number, p: ClarityParams): number {
  const { sigma, shadows, highlights, clarity } = p;
  const c = x - g;
  let val: number;
  if (c > 2 * sigma) val = g + sigma + shadows * (c - sigma);
  else if (c < -2 * sigma) val = g - sigma + highlights * (c + sigma);
  else if (c > 0) {
    const t = Math.min(Math.max(c / (2 * sigma), 0), 1);
    val = g + sigma * 2 * (1 - t) * t + t * t * (sigma + sigma * shadows);
  } else {
    const t = Math.min(Math.max(-c / (2 * sigma), 0), 1);
    val = g - sigma * 2 * (1 - t) * t + t * t * (-sigma - sigma * highlights);
  }
  return val + clarity * c * Math.exp((-c * c) / ((2 * sigma * sigma) / 3));
}

/** A one-channel image. */
export interface Plane {
  w: number;
  h: number;
  data: Float64Array;
}

const plane = (w: number, h: number): Plane => ({ w, h, data: new Float64Array(w * h) });
const at = (p: Plane, i: number, j: number) => p.data[Math.min(Math.max(j, 0), p.h - 1) * p.w + Math.min(Math.max(i, 0), p.w - 1)];

/** darktable's dl: size of pyramid level `level`. */
export function levelSize(size: number, level: number): number {
  for (let l = 0; l < level; l++) size = Math.floor((size - 1) / 2) + 1;
  return size;
}

/** Pyramid levels: halve as often as the smaller side allows, as darktable does. */
export const numLevels = (w: number, h: number) => Math.min(MAX_LEVELS, Math.floor(Math.log2(Math.min(w, h))));

const K = [1, 4, 6, 4, 1];

/** Blur with the 5×5 binomial kernel and keep every other pixel (darktable's gauss_reduce). */
export function reduce(fine: Plane): Plane {
  const out = plane(levelSize(fine.w, 1), levelSize(fine.h, 1));
  for (let j = 0; j < out.h; j++)
    for (let i = 0; i < out.w; i++) {
      let s = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) s += K[di + 2] * K[dj + 2] * at(fine, 2 * i + di, 2 * j + dj);
      out.data[j * out.w + i] = s / 256;
    }
  return out;
}

/** Weight of a coarse sample `d` fine pixels away in the expansion (darktable's ll_expand_gaussian). */
const expandWeight = (d: number) => (d === 0 ? 6 / 16 : Math.abs(d) === 1 ? 4 / 16 : Math.abs(d) === 2 ? 1 / 16 : 0);

/** The coarse level brought up to fine pixel (i, j). */
export function expandAt(coarse: Plane, i: number, j: number): number {
  let s = 0;
  for (let cj = Math.ceil((j - 2) / 2); cj <= Math.floor((j + 2) / 2); cj++)
    for (let ci = Math.ceil((i - 2) / 2); ci <= Math.floor((i + 2) / 2); ci++) s += expandWeight(i - 2 * ci) * expandWeight(j - 2 * cj) * at(coarse, ci, cj);
  return 4 * s;
}

/** The local laplacian filter on a lightness plane (0 to 1). */
export function localLaplacian(input: Plane, p: ClarityParams, boundary?: { last: number; coarse: Plane }): Plane {
  const last = boundary ? Math.min(boundary.last, numLevels(input.w, input.h) - 1) : numLevels(input.w, input.h) - 1;
  if (last < 1) return input;
  const gauss: Plane[] = [input];
  for (let l = 1; l <= last; l++) gauss.push(reduce(gauss[l - 1]));
  const bufs = GAMMAS.map((g) => {
    const b0 = plane(input.w, input.h);
    for (let k = 0; k < b0.data.length; k++) b0.data[k] = curve(input.data[k], g, p);
    const levels = [b0];
    for (let l = 1; l <= last; l++) levels.push(reduce(levels[l - 1]));
    return levels;
  });
  let out = boundary?.coarse ?? gauss[last];
  if (out.w !== gauss[last].w || out.h !== gauss[last].h) throw Error('Clarity boundary has the wrong dimensions');
  for (let l = last - 1; l >= 0; l--) {
    const next = plane(gauss[l].w, gauss[l].h);
    for (let j = 0; j < next.h; j++)
      for (let i = 0; i < next.w; i++) {
        const v = gauss[l].data[j * next.w + i];
        const [lo, hi, a] = gammaSpan(v);
        const l0 = bufs[lo][l].data[j * next.w + i] - expandAt(bufs[lo][l + 1], i, j);
        const l1 = bufs[hi][l].data[j * next.w + i] - expandAt(bufs[hi][l + 1], i, j);
        next.data[j * next.w + i] = expandAt(out, i, j) + l0 * (1 - a) + l1 * a;
      }
    out = next;
  }
  return out;
}

/** Integer-index bilinear/trilinear coarse sampling used by darktable's full-pipe boundary.
 * `levels` are reconstructed preview output planes, never Gaussian input or delta planes.
 * Origin/step are in preview level-0 pixels; no normalized-texture half-texel shift is applied. */
export function clarityBoundary(levels: Plane[], width: number, height: number, origin: [number, number], step: number): Plane {
  const level = Math.max(0, Math.min(levels.length - 1, Math.log2(step)));
  const lo = Math.floor(level), hi = Math.min(levels.length - 1, lo + 1), t = level - lo;
  const sample = (p: Plane, x: number, y: number) => {
    const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j;
    return at(p, i, j) * (1 - u) * (1 - v) + at(p, i + 1, j) * u * (1 - v) + at(p, i, j + 1) * (1 - u) * v + at(p, i + 1, j + 1) * u * v;
  };
  const out = plane(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const X = origin[0] + x * step, Y = origin[1] + y * step;
    out.data[y * width + x] = sample(levels[lo], X / 2 ** lo, Y / 2 ** lo) * (1 - t) + sample(levels[hi], X / 2 ** hi, Y / 2 ** hi) * t;
  }
  return out;
}

/** The two brightness levels around `v` and the weight of the upper one (darktable's search). */
export function gammaSpan(v: number): [number, number, number] {
  let hi = 1;
  while (hi < NUM_GAMMA - 1 && GAMMAS[hi] <= v) hi++;
  const lo = hi - 1;
  return [lo, hi, Math.min(Math.max((v - GAMMAS[lo]) / (GAMMAS[hi] - GAMMAS[lo]), 0), 1)];
}

// ---------- Lightness ----------

const srgbEotf = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const srgbOetf = (l: number) => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);

/** CIE lightness (0 to 1) of a tone-stage pixel: display-encoded Rec.2020. */
export const lightness = (e: Vec3): number => labL(e.map((v) => srgbEotf(Math.max(v, 0))) as Vec3) / 100;

/** A tone-stage pixel with its lightness moved by `delta` (0 to 1 scale) and its Lab a and b kept. */
export const withLightness = (e: Vec3, delta: number): Vec3 =>
  labShiftL(e.map((v) => srgbEotf(Math.max(v, 0))) as Vec3, 100 * delta).map((v) => srgbOetf(v)) as Vec3;
