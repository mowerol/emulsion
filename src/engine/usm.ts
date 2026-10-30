// Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
// Ported from RawTherapee rtengine/ipsharpen.cc (ImProcFunctions::sharpening, unsharp mask),
// rtengine/params/threshold.h (Threshold::multiply), rtengine/gauss.cc (gaussianBlur's small-sigma
// rules) and rtengine/rt_algo.cc (buildBlendMask, shared with capture.ts) at commit
// b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c. Translated from C++ to TypeScript (and GLSL, in
// shaders/usm.frag.glsl and stages/usm.glsl). Changes: Gaussians from sigma 0.6 up are exact
// rather than RawTherapee's recursive ones, and image borders clamp rather than using
// RawTherapee's border kernels; lightness is CIE L* relative to D65 of the print. Only the
// unsharp mask with RawTherapee's defaults otherwise: threshold (20, 80, 2000, 1200), no
// edges-only, no halo control, no blur of flat areas (its default 0.2 is below the 0.25 that
// turns it on). Sliders: Sharpening 0-100 is RawTherapee's amount / 10 (its default 200 at 20,
// its maximum 1000 at 100), Radius is RawTherapee's radius, Masking 0-100 is its contrast
// threshold / 2 (its default 20 at 10).
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Reference implementation of Sharpening: RawTherapee's unsharp mask on the
// print's lightness. The lightness is blurred by the radius; the difference,
// shaped by RawTherapee's threshold curve and scaled by the amount, is added
// back where a contrast mask says there is detail.

import { blendMask, gaussian1d, type Plane } from './capture';

/** RawTherapee's Lab L units: L* 100 is 32768. */
export const L_SCALE = 32768;
/** RawTherapee's default threshold curve (bottom left, top left, bottom right, top right). */
export const THRESHOLD = [20, 80, 2000, 1200] as const;
/** The cap on |difference| before the threshold curve, as in ipsharpen.cc. */
export const UPPER_BOUND = 2000;

export interface UsmParams {
  /** RawTherapee's amount, percent (200 is its default). */
  amount: number;
  /** RawTherapee's radius in full-resolution pixels. */
  radius: number;
  /** RawTherapee's contrast threshold (0 to 200); 0 sharpens everywhere. */
  contrast: number;
}

/** The slider values to RawTherapee's parameters. */
export const usmParams = (sharpen: number, radius: number, masking: number): UsmParams => ({ amount: sharpen * 10, radius, contrast: masking * 2 });

/**
 * Threshold<int>::multiply for a double threshold that does not start at one:
 * no sharpening below the bottom left, a ramp to full by the top left, full up
 * to the top right, then fading to none at the bottom right.
 */
export function thresholdMultiply(x: number, yMax: number, [bl, tl, br, tr]: readonly number[] = THRESHOLD): number {
  if (x === br && br === tr) return yMax;
  if (x >= br) return 0;
  if (x > tr) return yMax * (1 - (x - tr) / (br - tr));
  if (x >= tl) return yMax;
  if (x > bl) return (yMax * (x - bl)) / (tl - bl);
  return 0;
}

/**
 * The 1D kernel RawTherapee's gaussianBlur applies for `sigma`: none below 0.25,
 * its separable 3-tap kernel below 0.6, otherwise a Gaussian (exact here).
 */
export function usmKernel(sigma: number): number[] {
  if (sigma < 0.25) return [1];
  if (sigma < 0.6) {
    const c1 = Math.exp(-1 / (2 * sigma * sigma));
    const sum = 2 * c1 + 1;
    return [c1 / sum, 1 / sum, c1 / sum];
  }
  return gaussian1d(sigma);
}

const at = (p: Plane, i: number, j: number) => p.data[Math.min(Math.max(j, 0), p.h - 1) * p.w + Math.min(Math.max(i, 0), p.w - 1)];

function blur(p: Plane, k: number[]): Plane {
  const r = (k.length - 1) / 2;
  const tmp: Plane = { w: p.w, h: p.h, data: new Float64Array(p.w * p.h) };
  const out: Plane = { w: p.w, h: p.h, data: new Float64Array(p.w * p.h) };
  for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) tmp.data[j * p.w + i] = k.reduce((s, w, t) => s + w * at(p, i + t - r, j), 0);
  for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) out.data[j * p.w + i] = k.reduce((s, w, t) => s + w * at(tmp, i, j + t - r), 0);
  return out;
}

/**
 * Sharpen a lightness plane (0 to 1, L* / 100) at `scale` = this plane's width
 * over the full-resolution width. Returns the change in lightness for each
 * pixel (same 0 to 1 scale) and the contrast mask (0 to 1).
 */
export function unsharpMask(L: Plane, p: UsmParams, scale = 1): { delta: Plane; mask: Plane } {
  const n = L.w * L.h;
  const Lrt: Plane = { w: L.w, h: L.h, data: L.data.map((v) => v * L_SCALE) };
  const ones: Plane = { w: L.w, h: L.h, data: new Float64Array(n).fill(1) };
  const mask = blendMask(Lrt, ones, p.contrast / 100);
  const blurred = blur(Lrt, usmKernel(p.radius * scale));
  const delta = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const diff = Lrt.data[k] - blurred.data[k];
    const d = thresholdMultiply(Math.min(Math.abs(diff), UPPER_BOUND), (p.amount * diff) / 100);
    // intp(blend, L + delta, L)
    delta[k] = (mask.data[k] * d) / L_SCALE;
  }
  return { delta: { w: L.w, h: L.h, data: delta }, mask };
}
