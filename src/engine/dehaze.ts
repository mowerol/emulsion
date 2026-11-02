// Copyright (C) 2017-2025 darktable developers.
// Copyright (C) 2017-2026 darktable developers (guided filter, box filters).
// Ported from darktable src/iop/hazeremoval.c, src/common/guided_filter.c and
// src/common/box_filters.cc at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2).
// Translated from C to TypeScript. darktable's method is K. He, J. Sun and X. Tang, "Single Image
// Haze Removal Using Dark Channel Prior" (TPAMI 2011) and "Guided Image Filtering" (ECCV 2010).
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Reference implementation of haze removal (dehaze.frag.glsl and stages/dehaze.glsl). The
// module runs where darktable puts it, after lens correction and before exposure, on the
// scene-linear input. What differs from darktable:
//  - darktable's darkroom takes the ambient light and the maximum depth from its small preview
//    pipe and uses them in the full pipe; Emulsion always measures them on a copy of at most
//    ANALYSIS_MAX pixels across (see Engine.dehazeAnalysis), so preview and export agree;
//  - the non-compatibility quick select is replaced by an exact order statistic (the value it
//    finds is the same);
//  - box means are summed directly over each window rather than as running sums.

export type Rgb = Float32Array; // RGBA, four floats per pixel, as darktable's 4-channel buffers

/** darktable's adaptive windows: w1 for the dark channel and transition map, w2 for the guided filter. */
export function windows(wscale: number): { w1: number; w2: number } {
  const s = Math.min(1, Math.max(0, wscale));
  return { w1: 2 + Math.ceil(4 * s), w2: 3 + Math.ceil(6 * s) };
}

/** darktable's regularisation of the guided filter, sqrt(eps) = sqrt(0.025). */
export const SQRT_EPS = Math.sqrt(0.025);
/** Longest side of the image the ambient light is measured on (darktable's preview pipe). */
export const ANALYSIS_MAX = 1280;
const FLT_MAX = 3.4028234663852886e38;
const FLT_EPSILON = 1.1920928955078125e-7;

/** One-dimensional moving extreme over 2w+1, truncated at the ends (box_max_1d, _box_min_1d). */
function extreme1d(buf: Float32Array, width: number, height: number, w: number, max: boolean, vertical: boolean) {
  const out = new Float32Array(buf.length);
  const n = vertical ? height : width;
  const lines = vertical ? width : height;
  for (let l = 0; l < lines; l++) {
    for (let i = 0; i < n; i++) {
      let m = max ? -FLT_MAX : FLT_MAX;
      for (let k = Math.max(0, i - w); k <= Math.min(n - 1, i + w); k++) {
        const v = buf[vertical ? k * width + l : l * width + k];
        m = max ? Math.max(m, v) : Math.min(m, v);
      }
      out[vertical ? i * width + l : l * width + i] = m;
    }
  }
  return out;
}

/** dt_box_min: the moving minimum over a (2w+1)² box, truncated at the edges. */
export const boxMin = (buf: Float32Array, width: number, height: number, w: number) =>
  extreme1d(extreme1d(buf, width, height, w, false, false), width, height, w, false, true);
/** dt_box_max. */
export const boxMax = (buf: Float32Array, width: number, height: number, w: number) =>
  extreme1d(extreme1d(buf, width, height, w, true, false), width, height, w, true, true);

/** dt_box_mean on `ch` interleaved channels: the mean over a (2w+1)² box, truncated at the edges. */
export function boxMean(buf: Float64Array, width: number, height: number, ch: number, w: number): Float64Array {
  const h = new Float64Array(buf.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const x0 = Math.max(0, x - w), x1 = Math.min(width - 1, x + w);
    for (let c = 0; c < ch; c++) {
      let s = 0;
      for (let k = x0; k <= x1; k++) s += buf[(y * width + k) * ch + c];
      h[(y * width + x) * ch + c] = s / (x1 - x0 + 1);
    }
  }
  const out = new Float64Array(buf.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const y0 = Math.max(0, y - w), y1 = Math.min(height - 1, y + w);
    for (let c = 0; c < ch; c++) {
      let s = 0;
      for (let k = y0; k <= y1; k++) s += h[(k * width + x) * ch + c];
      out[(y * width + x) * ch + c] = s / (y1 - y0 + 1);
    }
  }
  return out;
}

/** _dark_channel: the smallest colour component, then its box minimum. */
export function darkChannel(img: Rgb, width: number, height: number, w1: number): Float32Array {
  const m = new Float32Array(width * height);
  for (let i = 0; i < m.length; i++) m[i] = Math.min(img[4 * i], img[4 * i + 1], img[4 * i + 2]);
  return boxMin(m, width, height, w1);
}

/** The element `nth` would hold if `values` were sorted (what darktable's quick select finds). */
export function orderStatistic(values: Float32Array, nth: number): number {
  const a = Float32Array.from(values);
  let lo = 0, hi = a.length - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo, j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
    }
    if (nth <= j) hi = j;
    else if (nth >= i) lo = i;
    else break;
  }
  return a[nth];
}

/**
 * _ambient_light: the ambient light A0, the mean of the brightest 5% (by r + g + b) of the most
 * hazy 5% of pixels (by dark channel), and the maximum depth, from the haze level at that quantile.
 */
export function ambientLight(img: Rgb, width: number, height: number, w1: number): { A0: [number, number, number]; distanceMax: number } {
  const size = width * height;
  const dark = darkChannel(img, width, height, w1);
  const crit = orderStatistic(dark, Math.floor(size * 0.95));
  // r + g + b in float, as darktable sums them.
  const sum = (i: number) => Math.fround(Math.fround(img[4 * i] + img[4 * i + 1]) + img[4 * i + 2]);
  const hazy: number[] = [];
  for (let i = 0; i < size; i++) if (dark[i] >= crit) hazy.push(sum(i));
  const bright = orderStatistic(Float32Array.from(hazy), Math.floor(hazy.length * 0.95));
  const A0: [number, number, number] = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < size; i++) {
    if (dark[i] >= crit && sum(i) >= bright) {
      for (let c = 0; c < 3; c++) A0[c] += img[4 * i + c];
      n++;
    }
  }
  if (n > 0) for (let c = 0; c < 3; c++) A0[c] /= n;
  return { A0, distanceMax: crit > 0 ? -1.125 * Math.log(crit) : Math.log(FLT_MAX) / 2 };
}

/** _transition_map followed by process()'s refinement: 1 - strength · min(rgb / A0), box max, then box min. */
export function transitionMap(img: Rgb, width: number, height: number, w1: number, A0: number[], strength: number): Float32Array {
  const t = new Float32Array(width * height);
  for (let i = 0; i < t.length; i++) t[i] = 1 - Math.min(img[4 * i] / A0[0], img[4 * i + 1] / A0[1], img[4 * i + 2] / A0[2]) * strength;
  return boxMin(boxMax(t, width, height, w1), width, height, w1);
}

/** darktable's guided_filter with a colour guide (guide weight 1, no clipping). */
export function guidedFilter(guide: Rgb, input: Float32Array, width: number, height: number, w: number, sqrtEps: number): Float32Array {
  const size = width * height;
  const eps = sqrtEps * sqrtEps;
  // mean: input, guide r g b; variance: cov r g b, rr rg rb gg gb bb.
  const mean = new Float64Array(size * 4);
  const vari = new Float64Array(size * 9);
  for (let i = 0; i < size; i++) {
    const [r, g, b] = [guide[4 * i], guide[4 * i + 1], guide[4 * i + 2]];
    const v = input[i];
    mean.set([v, r, g, b], 4 * i);
    vari.set([r * v, g * v, b * v, r * r, r * g, r * b, g * g, g * b, b * b], 9 * i);
  }
  const m = boxMean(mean, width, height, 4, w);
  const s = boxMean(vari, width, height, 9, w);
  const ab = new Float64Array(size * 4);
  for (let i = 0; i < size; i++) {
    const [inp, gr, gg, gb] = [m[4 * i], m[4 * i + 1], m[4 * i + 2], m[4 * i + 3]];
    const q = (k: number) => s[9 * i + k];
    const s00 = q(3) - gr * gr + eps, s01 = q(4) - gr * gg, s02 = q(5) - gr * gb;
    const s11 = q(6) - gg * gg + eps, s12 = q(7) - gg * gb, s22 = q(8) - gb * gb + eps;
    const det0 = s00 * (s11 * s22 - s12 * s12) - s01 * (s01 * s22 - s02 * s12) + s02 * (s01 * s12 - s02 * s11);
    if (Math.abs(det0) > 4 * FLT_EPSILON) {
      const cr = q(0) - gr * inp, cg = q(1) - gg * inp, cb = q(2) - gb * inp;
      const det1 = cr * (s11 * s22 - s12 * s12) - s01 * (cg * s22 - cb * s12) + s02 * (cg * s12 - cb * s11);
      const det2 = s00 * (cg * s22 - cb * s12) - cr * (s01 * s22 - s02 * s12) + s02 * (s01 * cb - s02 * cg);
      const det3 = s00 * (s11 * cb - s12 * cg) - s01 * (s01 * cb - s02 * cg) + cr * (s01 * s12 - s02 * s11);
      const [ar, ag, abl] = [det1 / det0, det2 / det0, det3 / det0];
      ab.set([ar, ag, abl, inp - ar * gr - ag * gg - abl * gb], 4 * i);
    } else ab.set([0, 0, 0, inp], 4 * i);
  }
  const abm = boxMean(ab, width, height, 4, w);
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) out[i] = abm[4 * i] * guide[4 * i] + abm[4 * i + 1] * guide[4 * i + 1] + abm[4 * i + 2] * guide[4 * i + 2] + abm[4 * i + 3];
  return out;
}

/** darktable's minimum transmission: exp(-distance · maximum depth), between 1/1024 and 1. */
export const minTransmission = (distance: number, distanceMax: number) => Math.min(1, Math.max(1 / 1024, Math.exp(-distance * distanceMax)));

/** One pixel's recovery, (x - A0) / t + A0, with t at least tMin. */
export const recover = (x: number[], A0: number[], t: number, tMin: number) => {
  const tt = Math.max(t, tMin);
  return x.map((v, c) => (v - A0[c]) / tt + A0[c]);
};

/**
 * process() for one image: `strength` -1 to 1, `distance` 0 to 1, `wscale` the image's size over
 * the full image's. `ambient` is the measured ambient light and depth (by default, of this image).
 */
export function dehaze(img: Rgb, width: number, height: number, strength: number, distance: number, wscale = 1, ambient?: { A0: number[]; distanceMax: number }): Rgb {
  const { w1, w2 } = windows(wscale);
  const { A0, distanceMax } = ambient ?? ambientLight(img, width, height, w1);
  const t = guidedFilter(img, transitionMap(img, width, height, w1, A0, strength), width, height, w2, SQRT_EPS);
  const tMin = minTransmission(distance, distanceMax);
  const out = new Float32Array(img.length);
  for (let i = 0; i < width * height; i++) {
    const r = recover([img[4 * i], img[4 * i + 1], img[4 * i + 2]], A0, t[i], tMin);
    out.set([r[0], r[1], r[2], img[4 * i + 3]], 4 * i);
  }
  return out;
}
