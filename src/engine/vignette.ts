// Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Vignette: RawTherapee's post-crop vignette (`calcPCVignetteParams` and `calcPCVignetteFactor` in
// rtengine/iptransform.cc at 64c2d90a3248c7ad41842d9162368858b61aac6a). It multiplies scene-linear
// light by a factor that falls from 1 inside an inner ellipse to 2^-strength at an outer ellipse
// through the crop's corners, along cos⁴ of the distance between them. It is fitted to the crop,
// so the corners of whatever is kept darken.
//
// Ported: the strength (EV) and feather, with roundness at RawTherapee's default 50 (an ellipse in
// the crop's own aspect) and only the darkening branch (strength ≥ 0), which is all the Amount
// slider reaches. Not ported: roundness away from 50 (the super-ellipse and circle branches) and
// the fade-out RawTherapee draws outside the crop box, which Emulsion never shows.
//
// The Amount slider (0-100) maps onto strength 0-3 EV, so 20 is RawTherapee's default 0.6 EV.
// Feather stays at RawTherapee's default 50.

export const VIGNETTE_MAX_EV = 3;
export const VIGNETTE_FEATHER = 50;

/** Amount (0-100) → RawTherapee's strength in EV. */
export const vignetteStrength = (amount: number) => (amount / 100) * VIGNETTE_MAX_EV;

export interface PcVignette {
  w: number; h: number;
  oeA: number; oeB: number;
  ieMul: number;
  isPortrait: boolean;
  scale: number;
}

/** `calcPCVignetteParams` for a crop of w × h pixels at roundness 50. */
export function pcVignetteParams(w: number, h: number, strength: number, feather = VIGNETTE_FEATHER): PcVignette {
  const f = feather / 100;
  const shortSide = Math.min(w, h), longSide = Math.max(w, h);
  const oeA = Math.SQRT2 * longSide * 0.5;
  const oeB = oeA * shortSide / longSide;
  const ieMul = (1 - f) / Math.SQRT2;
  const scale = strength >= 6 ? 0 : Math.pow(2, -strength);
  return { w, h, oeA, oeB, ieMul, isPortrait: w < h, scale };
}

/** `calcPCVignetteFactor` at (x, y) pixels from the crop's top-left corner. */
export function pcVignetteFactor(p: PcVignette, x: number, y: number): number {
  let a = Math.abs(x - p.w * 0.5);
  let b = Math.abs(y - p.h * 0.5);
  if (p.isPortrait) [a, b] = [b, a];
  const dist = Math.hypot(a, b);
  const cos = dist === 0 ? 1 : a / dist, sin = dist === 0 ? 0 : b / dist;
  const distOe = p.oeA * p.oeB / Math.sqrt((p.oeB * cos) ** 2 + (p.oeA * sin) ** 2);
  const distIe = p.ieMul * distOe;
  if (dist <= distIe) return 1;
  let val: number;
  if (dist >= distOe) val = p.scale;
  else {
    val = Math.PI / 2 * (dist - distIe) / (distOe - distIe);
    val = p.scale < 1 ? Math.cos(val) ** 4 : 1 - Math.sin(val) ** 4;
    val = p.scale + val * (1 - p.scale);
  }
  return val;
}

/**
 * The same factor as the shader computes it, at c in crop coordinates (0-1 across each side).
 * At roundness 50 the ellipse is the crop's own, so the distance from the centre in units of the
 * outer ellipse is √2·|c − ½| whatever the aspect.
 */
export function vignetteAt(c: [number, number], scale: number, ieMul = (1 - VIGNETTE_FEATHER / 100) / Math.SQRT2): number {
  const t = Math.SQRT2 * Math.hypot(c[0] - 0.5, c[1] - 0.5);
  if (t <= ieMul) return 1;
  if (t >= 1) return scale;
  const v = Math.cos(Math.PI / 2 * (t - ieMul) / (1 - ieMul)) ** 4;
  return scale + v * (1 - scale);
}
