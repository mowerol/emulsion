// Copyright (C) 2010-2026 darktable developers.
// Copyright (C) 2017-2024 darktable developers (edge-avoiding wavelets).
// Copyright (C) 2011-2022 darktable developers (curve tools).
// Ported from darktable src/iop/atrous.c (contrast equalizer: scales, the "sharpen" preset and the
// mix control), src/common/eaw.c (edge-avoiding à-trous wavelets) and src/common/curve_tools.c
// (Catmull-Rom curves) at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2).
// Translated from C to TypeScript (and GLSL, in shaders/eq.frag.glsl). Changes: lightness only,
// as the preset leaves colour alone; Lab relative to D65; the Texture slider is darktable's mix.
// Region preview deviation, approved by Oli (2026-11-02, docs/plans/roi.md): bands with spacing
// <=32 full-resolution pixels run locally; broader-band changes are sampled from the preview.
// Scale counts and boost curves still use whole-photo dimensions. Exports use every full-size band.
// The detail is summed by the boost's two terms in the mix (amountScales, equalizeParts) so the
// amount applies after the decomposition: the same synthesis, regrouped, exact for the preset.
// Trial deviation (Oli, 2026-11-03, off by default): with Engine.detailOrder 'log' the filter
// runs on a log lightness before Exposure instead of L* after it (detaillog.ts; NOTICE.md).
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Reference implementation of the texture stage: darktable's contrast equalizer.
// Lightness is split into detail at doubling sizes by an à-trous wavelet whose
// weights avoid strong edges; each size is boosted by a curve over the sizes
// (fine on the right), and the pieces are added back. The sizes are fixed to
// the photo, not to pixels: the largest is about 20% of the frame and the
// finest is 5 px at full resolution, so a preview shows the same bands minus
// the finest it cannot hold.

/** darktable's BANDS and MAX_NUM_SCALES. */
export const BANDS = 6;
export const MAX_SCALES = 8;
/** Approved region preview split: evaluate fine bands locally, coarse changes in the preview. */
export const REGION_FINE_MULT = 32;
export const regionFineScales = <T extends { mult: number }>(sc: T[]) => sc.filter(s => s.mult <= REGION_FINE_MULT);
export const isRegionCoarse = (s: { mult: number }, previewScale: number) => (4 * s.mult + 1) / previewScale > 4 * REGION_FINE_MULT + 1;

/** A curve over the sizes, coarse (x = 0) to fine (x = 1). */
export interface BandCurve {
  x: number[];
  y: number[];
}

const xs = Array.from({ length: BANDS }, (_, k) => k / (BANDS - 1));

/** darktable's defaults: 0.5 everywhere, no change. */
export const FLAT: BandCurve = { x: xs, y: xs.map(() => 0.5) };

/** The "sharpen" preset of darktable's contrast equalizer: lightness boosted more the finer it is. */
export const SHARPEN_PRESET = {
  L: { x: xs, y: xs.map((_, k) => 0.5 + (0.25 * k) / BANDS) },
  sharpness: { x: xs, y: xs.map(() => 0.5) },
};

/** darktable's _apply_mix: `mix` scales a curve's distance from the defaults; 0 is no change, below 0 inverts it. */
export function applyMix(c: BandCurve, mix: number, def: BandCurve = FLAT): BandCurve {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: c.x.map((x, k) => clamp(x + (mix - 1) * (x - def.x[k]))), y: c.y.map((y, k) => clamp(y + (mix - 1) * (y - def.y[k]))) };
}

/** darktable's catmull_rom_set and catmull_rom_val, clamped to [0, 1] as dt_draw_curve_calc_value does. */
export function curveValue(c: BandCurve, x: number): number {
  const n = c.x.length;
  const m = new Array<number>(n);
  m[0] = (c.y[1] - c.y[0]) / (c.x[1] - c.x[0]);
  for (let i = 1; i < n - 1; i++) m[i] = (c.y[i + 1] - c.y[i - 1]) / (c.x[i + 1] - c.x[i - 1]);
  m[n - 1] = (c.y[n - 1] - c.y[n - 2]) / (c.x[n - 1] - c.x[n - 2]);
  let iv = n - 2;
  for (let i = 0; i < n - 2; i++)
    if (x < c.x[i + 1]) {
      iv = i;
      break;
    }
  const h = c.x[iv + 1] - c.x[iv];
  const dx = (x - c.x[iv]) / h;
  const dx2 = dx * dx;
  const dx3 = dx * dx2;
  const v = (2 * dx3 - 3 * dx2 + 1) * c.y[iv] + (dx3 - 2 * dx2 + dx) * h * m[iv] + (-2 * dx3 + 3 * dx2) * c.y[iv + 1] + (dx3 - dx2) * h * m[iv + 1];
  return Math.min(Math.max(v, 0), 1);
}

export interface Scale {
  /** Tap spacing in source pixels: 2^scale. */
  mult: number;
  /** Gain on this size's detail. */
  boost: number;
  /** Edge-avoiding strength: weights fall as exp(-sharpen · ΔL²), L from 0 to 100. */
  sharpen: number;
}

/**
 * darktable's get_scales for a source of srcW × srcH showing a photo of
 * fullW × fullH, with the Texture slider's mix applied to the preset.
 */
export function scales(srcW: number, srcH: number, fullW: number, fullH: number, mix: number): Scale[] {
  const L = applyMix(SHARPEN_PRESET.L, mix);
  const S = applyMix(SHARPEN_PRESET.sharpness, mix);
  const scale = srcW / fullW;
  const supp0 = Math.min(2 * (2 << (MAX_SCALES - 1)) + 1, Math.max(fullW, fullH) * 0.2);
  const i0 = Math.log2((supp0 - 1) * 0.5);
  const out: Scale[] = [];
  let i = 0;
  for (; i < MAX_SCALES; i++) {
    const supp = 2 * (2 << i) + 1;
    const suppIn = supp / scale;
    const t = 1 - (Math.log2((suppIn - 1) * 0.5) - 1 + 0.5) / i0;
    const b = 2 * curveValue(L, t);
    out.push({ mult: 1 << i, boost: b * b, sharpen: 0.0025 * curveValue(S, t) });
    if (t < 0) break;
  }
  const maxRoi = Math.floor(Math.log2(Math.min(srcW, srcH))) - 2;
  return out.slice(0, Math.min(maxRoi, i));
}

/**
 * A band's boost as a function of the Texture amount: boost - 1 = a·mix + c·mix². The mix moves
 * the preset's L curve linearly (applyMix leaves x alone, and the curve through points on a line
 * is that line), so the boost (2·curve)² is (1 + 2·mix·g)² = 1 + 4g·mix + 4g²·mix², g the
 * curve's distance from 0.5 at mix 1; the sharpness curve is flat, so mixing leaves it and the
 * edge weights as they are. The decomposition is then the same for every amount and the change in
 * lightness is mix·A + mix²·B (equalizeParts), the same sum darktable's synthesis makes, regrouped.
 */
export interface AmountScale {
  mult: number;
  sharpen: number;
  a: number;
  c: number;
}

/** The bands of `scales` with their boosts split by power of the mix (from the boosts at ±1). */
export function amountScales(srcW: number, srcH: number, fullW: number, fullH: number): AmountScale[] {
  const up = scales(srcW, srcH, fullW, fullH, 1), down = scales(srcW, srcH, fullW, fullH, -1);
  return up.map((s, i) => ({ mult: s.mult, sharpen: s.sharpen, a: (s.boost - down[i].boost) / 2, c: (s.boost + down[i].boost) / 2 - 1 }));
}

const FILTER = [1, 4, 6, 4, 1];

/**
 * One scale of darktable's eaw_decompose_and_synthesize on lightness (0 to 100):
 * the edge-avoiding blur at spacing `mult`, and its detail boosted into `accum`.
 */
export function decompose(L: Float64Array, w: number, h: number, s: Scale, accum: Float64Array): Float64Array {
  const coarse = new Float64Array(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const c = L[j * w + i];
      let sum = 0;
      let wgt = 0;
      for (let jj = 0; jj < 5; jj++) {
        const y = Math.min(Math.max(j + s.mult * (jj - 2), 0), h - 1);
        for (let ii = 0; ii < 5; ii++) {
          const x = Math.min(Math.max(i + s.mult * (ii - 2), 0), w - 1);
          const v = L[y * w + x];
          // darktable's weight() for lightness: exp(-0.5 · sharpen · 2 · ΔL²).
          const wt = ((FILTER[ii] * FILTER[jj]) / 256) * Math.exp(-s.sharpen * (c - v) * (c - v));
          sum += wt * v;
          wgt += wt;
        }
      }
      coarse[j * w + i] = sum / wgt;
      // No noise threshold in the preset, so the detail goes in whole.
      accum[j * w + i] += s.boost * (c - sum / wgt);
    }
  return coarse;
}

/**
 * The contrast equalizer's change in lightness split by power of the mix, for `amountScales`:
 * equalize(L, scales(mix)) - L = mix·A + mix²·B. The detail of every band, boosted by a and by c.
 */
export function equalizeParts(L: Float64Array, w: number, h: number, sc: AmountScale[]): { A: Float64Array; B: Float64Array } {
  const A = new Float64Array(w * h), B = new Float64Array(w * h);
  let buf = L;
  for (const s of sc) {
    const detail = new Float64Array(w * h);
    const next = decompose(buf, w, h, { mult: s.mult, sharpen: s.sharpen, boost: 1 }, detail);
    for (let k = 0; k < w * h; k++) {
      A[k] += s.a * detail[k];
      B[k] += s.c * detail[k];
    }
    buf = next;
  }
  return { A, B };
}

/** The contrast equalizer on a lightness plane (0 to 100). */
export function equalize(L: Float64Array, w: number, h: number, sc: Scale[]): Float64Array {
  const accum = new Float64Array(w * h);
  let buf = L;
  for (const s of sc) buf = decompose(buf, w, h, s, accum);
  return accum.map((v, k) => v + buf[k]);
}
