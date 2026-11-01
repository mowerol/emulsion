// Copyright (C) 2011-2026 darktable developers (blend.c).
// Copyright (C) 2017-2026 darktable developers (guided_filter.c).
// Copyright (C) 2009-2024 darktable developers (box_filters.cc).
// Copyright (C) 2012-2026 darktable developers (gaussian.c).
// Ported from darktable src/develop/blend.c (_get_post_operations, _get_required_w,
// _get_guide_weight, _get_feathering_eps, _develop_blend_process_feather,
// _develop_blend_process_mask_tone_curve, the mask's post-processing in dt_develop_blend_process),
// src/common/guided_filter.c (_guided_filter_tiling, guided_filter), src/common/box_filters.cc
// (_blur_horizontal, _blur_vertical: the box mean over the window clipped to the image) and
// src/common/gaussian.c (_compute_gauss_params at order zero, dt_gaussian_blur) at commit
// 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2). Translated from C to TypeScript, the
// reference for the mask refinement passes. darktable tiles the guided filter with an overlap of
// three windows, which leaves the result as if untiled; this runs untiled. Its Kahan-compensated
// sums are plain sums here (doubles).
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * darktable's mask refinement (the blend module's "feathering radius", "blurring radius", "mask
 * opacity" and "mask contrast"), with its default guide: the module's input, after the blur
 * (DEVELOP_MASK_GUIDE_IN_AFTER_BLUR). Radii are in full-resolution pixels, as darktable's are.
 */
export interface MaskRefine {
  /** Feathering radius, 0 to 250 px; off at 0.1 and under. */
  feather: number;
  /** Blurring radius, 0 to 100 px; off at 0.1 and under. */
  blur: number;
  /** darktable's "mask opacity" (brightness), -1 to 1. */
  brightness: number;
  /** darktable's "mask contrast", -1 to 1. */
  contrast: number;
}

export const NO_REFINE: MaskRefine = { feather: 0, blur: 0, brightness: 0, contrast: 0 };

export type PostOp = 'feather' | 'blur' | 'tone';

/** _get_post_operations with the default guide (input, after blur): blur, feather, then the tone curve. */
export function postOperations(r: MaskRefine, opacity: number): PostOp[] {
  const ops: PostOp[] = [];
  if (r.blur > 0.1) ops.push('blur');
  if (r.feather > 0.1) ops.push('feather');
  if ((Math.abs(r.contrast) >= 0.01 || Math.abs(r.brightness) >= 0.01) && opacity > 1e-4) ops.push('tone');
  return ops;
}

/** _get_required_w: the guided filter's window radius at `scale` (the image's pixels per full-resolution pixel). */
export const featherWindow = (radius: number, scale: number) => Math.max(1, Math.trunc(2 * radius * scale + 0.5));

/** _get_guide_weight and _get_feathering_eps for an RGB module at darktable's current feather_version (1). */
export const GUIDE_WEIGHT = 10;
export const FEATHER_SQRT_EPS = 0.5;

/**
 * darktable's box mean (box_filters.cc) of `ch` interleaved channels: horizontally then
 * vertically, each over the window of radius `r` clipped to the image, in place.
 */
export function boxMean(buf: Float64Array, width: number, height: number, ch: number, r: number) {
  const line = new Float64Array(Math.max(width, height) * ch);
  const pass = (count: number, length: number, at: (i: number, x: number) => number) => {
    for (let i = 0; i < count; i++) {
      for (let x = 0; x < length; x++) for (let k = 0; k < ch; k++) line[x * ch + k] = buf[at(i, x) + k];
      const sum = new Float64Array(ch);
      let lo = 0;
      let hi = -1;
      for (let x = 0; x < length; x++) {
        const want = Math.min(length - 1, x + r);
        while (hi < want) { hi++; for (let k = 0; k < ch; k++) sum[k] += line[hi * ch + k]; }
        while (lo < x - r) { for (let k = 0; k < ch; k++) sum[k] -= line[lo * ch + k]; lo++; }
        for (let k = 0; k < ch; k++) buf[at(i, x) + k] = sum[k] / (hi - lo + 1);
      }
    }
  };
  pass(height, width, (y, x) => (y * width + x) * ch);
  pass(width, height, (x, y) => (y * width + x) * ch);
}

/**
 * darktable's guided_filter: `input` (one channel) filtered with the colour guide `guide` (RGB,
 * `stride` floats a pixel) over windows of radius `w`, clamped to [min, max].
 */
export function guidedFilter(guide: ArrayLike<number>, stride: number, input: ArrayLike<number>, width: number, height: number, w: number, sqrtEps: number, guideWeight: number, min = 0, max = 1): Float64Array {
  const n = width * height;
  const eps = sqrtEps * sqrtEps;
  const mean = new Float64Array(n * 4);
  const variance = new Float64Array(n * 9);
  for (let i = 0; i < n; i++) {
    const r = guide[i * stride] * guideWeight;
    const g = guide[i * stride + 1] * guideWeight;
    const b = guide[i * stride + 2] * guideWeight;
    const p = input[i];
    mean.set([p, r, g, b], i * 4);
    variance.set([r * p, g * p, b * p, r * r, r * g, r * b, g * g, g * b, b * b], i * 9);
  }
  boxMean(mean, width, height, 4, w);
  boxMean(variance, width, height, 9, w);
  const ab = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    const [inp, gr, gg, gb] = mean.subarray(i * 4, i * 4 + 4);
    const v = variance.subarray(i * 9, i * 9 + 9);
    const s00 = v[3] - gr * gr + eps;
    const s01 = v[4] - gr * gg;
    const s02 = v[5] - gr * gb;
    const s11 = v[6] - gg * gg + eps;
    const s12 = v[7] - gg * gb;
    const s22 = v[8] - gb * gb + eps;
    const det0 = s00 * (s11 * s22 - s12 * s12) - s01 * (s01 * s22 - s02 * s12) + s02 * (s01 * s12 - s02 * s11);
    if (Math.abs(det0) > 4 * 1.1920929e-7) {
      const cr = v[0] - gr * inp;
      const cg = v[1] - gg * inp;
      const cb = v[2] - gb * inp;
      const det1 = cr * (s11 * s22 - s12 * s12) - s01 * (cg * s22 - cb * s12) + s02 * (cg * s12 - cb * s11);
      const det2 = s00 * (cg * s22 - cb * s12) - cr * (s01 * s22 - s02 * s12) + s02 * (s01 * cb - s02 * cg);
      const det3 = s00 * (s11 * cb - s12 * cg) - s01 * (s01 * cb - s02 * cg) + cr * (s01 * s12 - s02 * s11);
      const ar = det1 / det0;
      const ag = det2 / det0;
      const abl = det3 / det0;
      ab.set([ar, ag, abl, inp - ar * gr - ag * gg - abl * gb], i * 4);
    } else ab.set([0, 0, 0, inp], i * 4);
  }
  boxMean(ab, width, height, 4, w);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const res = guideWeight * (ab[i * 4] * guide[i * stride] + ab[i * 4 + 1] * guide[i * stride + 1] + ab[i * 4 + 2] * guide[i * stride + 2]) + ab[i * 4 + 3];
    out[i] = Math.min(max, Math.max(min, res));
  }
  return out;
}

/** _compute_gauss_params at order zero: Deriche's recursive Gaussian. */
export function gaussParams(sigma: number) {
  const alpha = 1.695 / sigma;
  const ema = Math.exp(-alpha);
  const ema2 = Math.exp(-2 * alpha);
  const k = ((1 - ema) * (1 - ema)) / (1 + 2 * alpha * ema - ema2);
  const a0 = k, a1 = k * (alpha - 1) * ema, a2 = k * (alpha + 1) * ema, a3 = -k * ema2;
  const b1 = -2 * ema, b2 = ema2;
  return { alpha, k, a0, a1, a2, a3, b1, b2, coefp: (a0 + a1) / (1 + b1 + b2), coefn: (a2 + a3) / (1 + b1 + b2) };
}

/** One line of dt_gaussian_blur: the causal and anti-causal recursions, each started at its edge pixel. */
function gaussLine(x: Float64Array, p: ReturnType<typeof gaussParams>, lo: number, hi: number): Float64Array {
  const n = x.length;
  const c = (v: number) => Math.min(hi, Math.max(lo, v));
  const out = new Float64Array(n);
  let xp = c(x[0]);
  let yb = xp * p.coefp;
  let yp = yb;
  for (let j = 0; j < n; j++) {
    const xc = c(x[j]);
    const yc = p.a0 * xc + p.a1 * xp - p.b1 * yp - p.b2 * yb;
    out[j] = yc;
    xp = xc; yb = yp; yp = yc;
  }
  let xn = c(x[n - 1]);
  let xa = xn;
  let yn = xn * p.coefn;
  let ya = yn;
  for (let j = n - 1; j >= 0; j--) {
    const xc = c(x[j]);
    const yc = p.a2 * xn + p.a3 * xa - p.b1 * yn - p.b2 * ya;
    xa = xn; xn = xc; ya = yn; yn = yc;
    out[j] += yc;
  }
  return out;
}

/** dt_gaussian_blur of one channel, vertically then horizontally, input clamped to [lo, hi]. */
export function gaussianBlur(img: ArrayLike<number>, width: number, height: number, sigma: number, lo = 0, hi = 1): Float64Array {
  const p = gaussParams(sigma);
  const tmp = new Float64Array(width * height);
  const col = new Float64Array(height);
  for (let i = 0; i < width; i++) {
    for (let j = 0; j < height; j++) col[j] = img[j * width + i];
    gaussLine(col, p, lo, hi).forEach((v, j) => (tmp[j * width + i] = v));
  }
  const out = new Float64Array(width * height);
  for (let j = 0; j < height; j++) out.set(gaussLine(tmp.subarray(j * width, (j + 1) * width), p, lo, hi), j * width);
  return out;
}

/**
 * The recursion's impulse response in closed form, k (1 + α|n|) e^(-α|n|), which sums to 1:
 * convolving with it (edges extended, as the recursions start) is the same blur, which the GPU
 * does as an ordinary kernel. Taps out to where they fall under `cut` of the centre.
 */
export function gaussKernel(sigma: number, cut = 1e-6): number[] {
  const { alpha, k } = gaussParams(sigma);
  const taps = [k];
  for (let n = 1; ; n++) {
    const v = k * (1 + alpha * n) * Math.exp(-alpha * n);
    if (v < k * cut) break;
    taps.push(v);
  }
  return taps;
}

/** _develop_blend_process_mask_tone_curve on one mask value (already at the blend opacity). */
export function maskToneCurve(mask: number, contrast: number, brightness: number, opacity: number): number {
  const epsilon = 16 * 1.1920929e-7;
  const e = Math.exp(3 * contrast);
  let x = (2 * mask) / opacity - 1;
  if (1 - brightness <= 0) x = mask <= epsilon ? -1 : 1;
  else if (1 + brightness <= 0) x = mask >= 1 - epsilon ? 1 : -1;
  else if (brightness > 0) x = Math.min((x + brightness) / (1 - brightness), 1);
  else x = Math.max((x + brightness) / (1 + brightness), -1);
  const cval = 0.5 * ((x * e) / (1 + (e - 1) * Math.abs(x))) + 0.5;
  const mval = cval > 1e-6 ? cval : 0;
  return Math.min(1, Math.max(0, mval)) * opacity;
}

/**
 * A whole mask refined as darktable refines a blend mask: `mask` (drawn × parametric × opacity),
 * `guide` the instance's input (RGB, `stride` floats a pixel), `scale` the image's pixels per
 * full-resolution pixel.
 */
export function refineMask(mask: ArrayLike<number>, guide: ArrayLike<number>, stride: number, width: number, height: number, r: MaskRefine, opacity: number, scale: number): Float64Array {
  let m: Float64Array = Float64Array.from(mask);
  for (const op of postOperations(r, opacity)) {
    if (op === 'blur') m = gaussianBlur(m, width, height, r.blur * scale);
    else if (op === 'feather') m = guidedFilter(guide, stride, m, width, height, featherWindow(r.feather, scale), FEATHER_SQRT_EPS, GUIDE_WEIGHT);
    else m = m.map((v) => maskToneCurve(v, r.contrast, r.brightness, opacity));
  }
  return m;
}
