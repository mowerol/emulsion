// Copyright (c) 2019 Ingo Weyrich (heckflosse67@gmx.de)
// Copyright (C) 2010 Emil Martinec <ejmartin@uchicago.edu> (blur kernels)
// Ported from RawTherapee rtengine/capturesharpening.cc (CaptureDeconvSharpening and the end of
// captureSharpening), rtengine/rt_algo.cc (buildBlendMask, calcContrastThreshold) and
// rtengine/boxblur.cc (compute3x3kernel2 to compute13x13kernel2) at commit
// b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c. Translated from C++ to TypeScript (and GLSL, in
// shaders/cs*.frag.glsl). Changes: one Richardson-Lucy deconvolution over the whole photo with
// RawTherapee's per-tile early stop applied to 32 px tiles, instead of each tile deconvolved on
// its own; the blend mask's blur is an exact Gaussian rather than RawTherapee's recursive one;
// luminance comes from the as-shot white-balanced camera RGB LibRaw decodes to; the Sharpening
// slider sets the iteration count. The auto radius and clip mask are in src-tauri/src/capture.rs.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Reference implementation of capture sharpening: RawTherapee's deconvolution
// of the lens and sensor blur. Luminance is deconvolved with a Gaussian of the
// photo's own radius (Richardson-Lucy), only where there is detail (a mask
// from local contrast) and not near clipping, and the colour channels are
// scaled by the new luminance over the old.

/** RawTherapee's default iterations, which the slider reaches at 100. */
export const DEFAULT_ITERATIONS = 20;
/** Tiles that stop early, as in RawTherapee. */
export const TILE = 32;

/** The Sharpening slider (0 to 100) to Richardson-Lucy iterations. */
export const iterationsFor = (slider: number) => (slider <= 0 ? 0 : Math.max(1, Math.round((DEFAULT_ITERATIONS * Math.min(slider, 100)) / 100)));

/** RawTherapee's kernel for `sigma`: a Gaussian on a disc, normalised; half-width and weights. */
export function kernelFor(sigma: number): { half: number; weights: number[][] } {
  // compute3x3kernel2 has no disc; the others cut at 3 × the largest sigma their size serves.
  const [half, disc] = sigma < 0.6 ? [1, Infinity] : sigma <= 0.84 ? [2, 3 * 0.84] : sigma <= 1.15 ? [3, 3 * 1.15] : sigma <= 1.5 ? [4, 3 * 1.5] : [6, 3 * 2];
  const temp = -2 * sigma * sigma;
  const weights = Array.from({ length: 2 * half + 1 }, (_, a) =>
    Array.from({ length: 2 * half + 1 }, (_, b) => {
      const i = a - half;
      const j = b - half;
      return i * i + j * j <= disc * disc ? Math.exp((i * i + j * j) / temp) : 0;
    }),
  );
  const sum = weights.flat().reduce((s, v) => s + v, 0);
  return { half, weights: weights.map((r) => r.map((v) => v / sum)) };
}

/** RawTherapee leaves this many pixels at the photo's edges alone. */
export const borderFor = (sigma: number, iterations: number) => (sigma <= 1.15 ? (iterations <= 30 ? 5 : 7) : 8);

/** A one-channel image. */
export interface Plane {
  w: number;
  h: number;
  data: Float64Array;
}

const at = (p: Plane, i: number, j: number) => p.data[Math.min(Math.max(j, 0), p.h - 1) * p.w + Math.min(Math.max(i, 0), p.w - 1)];

function convolve(p: Plane, k: { half: number; weights: number[][] }): Plane {
  const out = new Float64Array(p.w * p.h);
  for (let j = 0; j < p.h; j++)
    for (let i = 0; i < p.w; i++) {
      let s = 0;
      for (let b = -k.half; b <= k.half; b++) for (let a = -k.half; a <= k.half; a++) s += k.weights[b + k.half][a + k.half] * at(p, i + a, j + b);
      out[j * p.w + i] = s;
    }
  return { w: p.w, h: p.h, data: out };
}

// ---------- The blend mask ----------

/** rt_algo.cc's calcBlendFactor: a sigmoid with its middle at the threshold. */
export function blendFactor(val: number, threshold: number): number {
  const x = -16 + (16 / threshold) * val;
  return 0.5 * (1 + x / Math.sqrt(1 + x * x));
}

/** RawTherapee's local contrast of L (0 to 32768) at a pixel, from neighbours one and two away. */
export function contrastAt(L: Plane, i: number, j: number): number {
  // The outer two rows and columns copy the nearest computed value.
  i = Math.min(Math.max(i, 2), L.w - 3);
  j = Math.min(Math.max(j, 2), L.h - 3);
  const d = (a: number, b: number) => (a - b) * (a - b);
  const c = Math.sqrt(d(at(L, i + 1, j), at(L, i - 1, j)) + d(at(L, i, j + 1), at(L, i, j - 1)) + d(at(L, i + 2, j), at(L, i - 2, j)) + d(at(L, i, j + 2), at(L, i, j - 2)));
  return (c * 0.0625) / 327.68;
}

/** A normalised Gaussian of `sigma`, three sigma each way. */
export function gaussian1d(sigma: number): number[] {
  const r = Math.ceil(3 * sigma);
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const s = k.reduce((a, b) => a + b, 0);
  return k.map((v) => v / s);
}

function blurSeparable(p: Plane, k: number[]): Plane {
  const r = (k.length - 1) / 2;
  const tmp = new Float64Array(p.w * p.h);
  const out = new Float64Array(p.w * p.h);
  for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) tmp[j * p.w + i] = k.reduce((s, w, t) => s + w * at(p, i + t - r, j), 0);
  const t: Plane = { w: p.w, h: p.h, data: tmp };
  for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) out[j * p.w + i] = k.reduce((s, w, q) => s + w * at(t, i, j + q - r), 0);
  return { w: p.w, h: p.h, data: out };
}

/** buildBlendMask without auto contrast: where to sharpen, 0 to 1, times the clip mask, blurred by 2 px. */
export function blendMask(L: Plane, clip: Plane, threshold: number): Plane {
  if (threshold === 0) return { w: L.w, h: L.h, data: new Float64Array(L.w * L.h).fill(1) };
  const raw = new Float64Array(L.w * L.h);
  for (let j = 0; j < L.h; j++)
    for (let i = 0; i < L.w; i++) {
      const ci = Math.min(Math.max(i, 2), L.w - 3);
      const cj = Math.min(Math.max(j, 2), L.h - 3);
      raw[j * L.w + i] = clip.data[cj * L.w + ci] * blendFactor(contrastAt(L, i, j), threshold);
    }
  return blurSeparable({ w: L.w, h: L.h, data: raw }, gaussian1d(2));
}

// ---------- Auto contrast ----------

/** A tile's mean and rt_algo.cc's tileVariance: the variance over the mean. */
function tileStats(L: Plane, y: number, x: number, size: number): [number, number] {
  let avg = 0;
  for (let j = y; j < y + size; j++) for (let i = x; i < x + size; i++) avg += L.data[j * L.w + i];
  avg /= size * size;
  let v = 0;
  for (let j = y; j < y + size; j++) for (let i = x; i < x + size; i++) v += (L.data[j * L.w + i] - avg) ** 2;
  return [avg, v / (size * size * avg)];
}

/** rt_algo.cc's calcContrastThreshold: the lowest threshold that leaves under 1% of a flat tile sharpened. */
export function tileThreshold(L: Plane, y: number, x: number, size: number): number {
  const contrasts: number[] = [];
  for (let j = y + 2; j < y + size - 2; j++) for (let i = x + 2; i < x + size - 2; i++) contrasts.push(contrastAt(L, i, j));
  const limit = (size - 4) ** 2 / 100;
  let c = 1;
  for (; c < 100; c++) {
    const t = c / 100;
    if (contrasts.reduce((s, v) => s + blendFactor(v, t), 0) <= limit) break;
  }
  return (c + 1) / 100;
}

/** buildBlendMask's auto contrast: the threshold from the flattest mid-tone tile, or 0 (sharpen everywhere). */
export function autoContrast(L: Plane): number {
  const [minL, maxL, minVar] = [2000, 20000, 0.5];
  const varOf = (y: number, x: number, size: number) => {
    const [avg, v] = tileStats(L, y, x, size);
    return avg < minL || avg > maxL || v < minVar ? Infinity : v;
  };
  // Pass 1: 80 px tiles side by side.
  let best = { v: Infinity, y: 0, x: 0 };
  for (let ty = 0; ty < Math.floor(L.h / 80); ty++)
    for (let tx = 0; tx < Math.floor(L.w / 80); tx++) {
      const v = varOf(ty * 80, tx * 80, 80);
      if (v < best.v) best = { v, y: ty * 80, x: tx * 80 };
    }
  if (best.v <= 1) return tileThreshold(L, best.y, best.x, 80);
  // Pass 2: 40 px tiles every 10 px, then every pixel position around the best.
  best = { v: Infinity, y: 0, x: 0 };
  for (let ty = 0; ty < Math.floor(L.h / 10) - 3; ty++)
    for (let tx = 0; tx < Math.floor(L.w / 10) - 3; tx++) {
      const v = varOf(ty * 10, tx * 10, 40);
      if (v < best.v) best = { v, y: ty * 10, x: tx * 10 };
    }
  let fine = { v: Infinity, y: 0, x: 0 };
  for (let y = Math.max(best.y - 10, 0); y <= Math.min(best.y + 10, L.h - 40); y++)
    for (let x = Math.max(best.x - 10, 0); x <= Math.min(best.x + 10, L.w - 40); x++) {
      const v = varOf(y, x, 40);
      if (v < fine.v) fine = { v, y, x };
    }
  return fine.v <= 8 ? tileThreshold(L, fine.y, fine.x, 40) : 0;
}

// ---------- Deconvolution ----------

/** Which stop tile a pixel falls in, along one axis; tiles start after the untouched border. */
export const tileOf = (p: number, border: number, count: number) => Math.min(Math.max(Math.floor((p - border) / TILE), 0), count - 1);

/**
 * Richardson-Lucy deconvolution of luminance `Y` with RawTherapee's kernel for
 * `sigma`, blended into the original by `blend`. A tile stops early once any
 * pixel in it falls below half its blended original, as RawTherapee's
 * iteration check does; tiles with almost no blend are left alone.
 */
export function deconvolve(Y: Plane, blend: Plane, sigma: number, iterations: number): Plane {
  const k = kernelFor(sigma);
  const border = borderFor(sigma, iterations);
  const tw = Math.max(1, Math.ceil((Y.w - 2 * border) / TILE));
  const th = Math.max(1, Math.ceil((Y.h - 2 * border) / TILE));
  const tile = (i: number, j: number) => tileOf(j, border, th) * tw + tileOf(i, border, tw);
  const stopped = new Uint8Array(tw * th);
  const maxBlend = new Float64Array(tw * th);
  for (let j = 0; j < Y.h; j++) for (let i = 0; i < Y.w; i++) maxBlend[tile(i, j)] = Math.max(maxBlend[tile(i, j)], blend.data[j * Y.w + i]);
  maxBlend.forEach((m, t) => (stopped[t] = m < 0.01 ? 1 : 0));

  let est: Plane = { w: Y.w, h: Y.h, data: Float64Array.from(Y.data) };
  for (let n = 0; n < iterations; n++) {
    const b = convolve(est, k);
    const ratio: Plane = { w: Y.w, h: Y.h, data: Y.data.map((v, q) => v / Math.max(b.data[q], 0.00001)) };
    const corr = convolve(ratio, k);
    const next = est.data.map((v, q) => (stopped[tile(q % Y.w, Math.floor(q / Y.w))] ? v : v * corr.data[q]));
    est = { w: Y.w, h: Y.h, data: next };
    if (n < iterations - 1) {
      for (let q = 0; q < next.length; q++) {
        const t = tile(q % Y.w, Math.floor(q / Y.w));
        if (!stopped[t] && next[q] < Y.data[q] * blend.data[q] * 0.5) stopped[t] = 2;
      }
      // A tile that tripped this round keeps this round's result, then stops.
      stopped.forEach((s, t) => (stopped[t] = s ? 1 : 0));
    }
  }
  // Blend into the original; the outer border stays as it was.
  const out = new Float64Array(Y.w * Y.h);
  for (let j = 0; j < Y.h; j++)
    for (let i = 0; i < Y.w; i++) {
      const q = j * Y.w + i;
      const inside = i >= border && i < Y.w - border && j >= border && j < Y.h - border;
      out[q] = inside ? blend.data[q] * est.data[q] + (1 - blend.data[q]) * Y.data[q] : Y.data[q];
    }
  return { w: Y.w, h: Y.h, data: out };
}
