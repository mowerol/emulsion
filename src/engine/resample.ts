// Copyright (C) 2012-2026 darktable developers.
// Ported from darktable src/common/interpolation.c at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773
// (release 5.6.2): `_maketaps_lanczos`, `_compute_downsampling_kernel`, `_prepare_resampling_plan`
// (downscale branch, BORDER_REPLICATE) and `dt_interpolation_resample`, with Lanczos3, darktable's
// default "pixel interpolator (scaling)" (data/darktableconfig.xml.in). Translated from C to
// TypeScript; `dt_vector_sin`'s polynomial is `Math.sin` (upstream's reference form). Only
// downscaling is ported: the engine never uses this to enlarge.
// Upstream's mapping is kept: output pixel x is input x / scale (pixel indices, not centres), so the
// shrunk image sits 0.5 · (1 - scale) of an output pixel right and down of a centre-aligned one
// (0.03 px at 1.07×, 0.17 px at 1.54×).
// SPDX-License-Identifier: GPL-3.0-or-later

/** Lanczos3: darktable's `width` for its lanczos3 interpolator. */
export const LANCZOS_WIDTH = 3;
/** The most taps one output pixel takes (the GLSL twin's loop bound): 2 · width / scale. */
export const RESAMPLE_MAX_TAPS = 64;
/** The smallest scale the GLSL twin handles within RESAMPLE_MAX_TAPS. */
export const RESAMPLE_MIN_SCALE = (2 * LANCZOS_WIDTH) / RESAMPLE_MAX_TAPS;
const EPS = 1e-9;

/** darktable's `_maketaps_lanczos` for one tap at `t` (output pixels from the output centre). */
export function lanczosTap(t: number, width = LANCZOS_WIDTH): number {
  const a = Math.trunc(t), r = t - a, sign = a & 1 ? -1 : 1;
  return (width * sign * Math.sin(Math.PI * r) * Math.sin((Math.PI * t) / width) + EPS) / (Math.PI * Math.PI * t * t + EPS);
}

/**
 * The normalised taps for output sample `x` of `outN` from `inN` input samples at `scale`
 * (out / in, below 1): darktable's downsampling kernel, its indices clamped (BORDER_REPLICATE).
 */
export function downsampleTaps(inN: number, scale: number, x: number): { index: number[]; weight: number[] } {
  // In 32-bit floats as upstream (and the GLSL twin): its phase drifts measurably by x ≈ 1000.
  const f = Math.fround, s = f(scale), w = LANCZOS_WIDTH;
  const xin = Math.ceil(f(f(x - w) / s));
  const t = f(f(xin * s) - x);
  const taps = Math.trunc(f(f(w - t) / s));
  const raw: number[] = [];
  let norm = 0;
  // _maketaps_lanczos steps four taps at once: tap c of each run of four is t + c·s, then += 4·s.
  const vt = [0, 1, 2, 3].map((c) => f(t + f(c * s))), step = f(4 * s);
  for (let i = 0; i < taps; i++) {
    const k = f(lanczosTap(vt[i % 4], w));
    raw.push(k); norm = f(norm + k);
    if (i % 4 === 3) for (let c = 0; c < 4; c++) vt[c] = f(vt[c] + step);
  }
  return {
    index: raw.map((_, i) => Math.min(inN - 1, Math.max(0, xin + i))),
    weight: raw.map((k) => k / norm),
  };
}

/** The size `w × h` becomes at `scale`, as darktable's roi_out for a whole image. */
export const resampledSize = (w: number, h: number, scale: number): [number, number] =>
  [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];

/**
 * darktable's `dt_interpolation_resample` of an RGBA float image down to `scale` (one scale for
 * both axes, as roi_out->scale). Returns the image and its size.
 */
export function resample(src: Float32Array, w: number, h: number, scale: number): { data: Float32Array; w: number; h: number } {
  const [ow, oh] = resampledSize(w, h, scale);
  if (scale >= 1) return { data: src.slice(), w, h };
  const cols = Array.from({ length: ow }, (_, x) => downsampleTaps(w, scale, x));
  const rows = Array.from({ length: oh }, (_, y) => downsampleTaps(h, scale, y));
  const out = new Float32Array(ow * oh * 4);
  for (let y = 0; y < oh; y++) {
    const v = rows[y];
    for (let x = 0; x < ow; x++) {
      const hz = cols[x];
      const acc = [0, 0, 0, 0];
      for (let j = 0; j < v.index.length; j++) {
        const line = v.index[j] * w;
        const row = [0, 0, 0, 0];
        for (let i = 0; i < hz.index.length; i++) {
          const p = (line + hz.index[i]) * 4, k = hz.weight[i];
          for (let c = 0; c < 4; c++) row[c] += src[p + c] * k;
        }
        for (let c = 0; c < 4; c++) acc[c] += row[c] * v.weight[j];
      }
      out.set(acc, (y * ow + x) * 4);
    }
  }
  return { data: out, w: ow, h: oh };
}
