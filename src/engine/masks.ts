// Copyright (C) 2013-2025 darktable developers.
// Ported from darktable src/develop/masks/gradient.c (_gradient_get_mask_roi), ellipse.c
// (_ellipse_get_mask_roi, _fill_mask), group.c (_group_get_mask_roi, _combine_masks_*) and
// src/develop/blend.c with blends/blendif_rgb_jzczhz.c (global opacity, _blend_normal) at commit
// 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2). Translated from C to TypeScript, the
// reference for stages/masks.glsl. Each shape is evaluated exactly at every pixel; darktable
// samples a grid of 1 to 8 pixels and interpolates (and reads the gradient's erf from a table
// with one entry per pixel), to save time on the CPU. erf is Abramowitz and Stegun 7.1.26
// (error under 1.5e-7), which the shader shares.
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EllipseShape, GradientShape, Mask, MaskMode, MaskShape } from '../film/masks';
import { MAX_MASKS, MAX_SHAPES, maskActive } from '../film/masks';

const rad = (deg: number) => (deg * Math.PI) / 180;
const clip = (v: number) => Math.min(1, Math.max(0, v));

/** erf by Abramowitz and Stegun 7.1.26. */
export function erf(x: number): number {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

/** darktable's gradient at source point (u, v) of a W × H photo. */
export function gradientValue(g: GradientShape, u: number, v: number, W: number, H: number): number {
  const x = u * W;
  const y = v * H;
  const hwscale = 1 / Math.hypot(W, H);
  const a = rad(-g.rotation);
  const sinv = Math.sin(a);
  const cosv = Math.cos(a);
  const xoffset = cosv * g.anchor[0] * W + sinv * g.anchor[1] * H;
  const yoffset = sinv * g.anchor[0] * W - cosv * g.anchor[1] * H;
  const compression = Math.max(g.compression, 0.001);
  const x0 = (cosv * x + sinv * y - xoffset) * hwscale;
  const y0 = (sinv * x - cosv * y - yoffset) * hwscale;
  const distance = y0 - g.curvature * x0 * x0;
  if (distance <= -4 * compression) return 0;
  if (distance >= 4 * compression) return 1;
  return clip(0.5 + 0.5 * (g.linear ? distance / compression : erf(distance / compression)));
}

/** darktable's ellipse at source point (u, v): 1 inside, falling off quadratically across the feather. */
export function ellipseValue(e: EllipseShape, u: number, v: number, W: number, H: number): number {
  const m = Math.min(W, H);
  const ta = (e.proportional ? e.radius[0] * (1 + e.border) : e.radius[0] + e.border) * m;
  const tb = (e.proportional ? e.radius[1] * (1 + e.border) : e.radius[1] + e.border) * m;
  const a = e.radius[0] * m;
  const b = e.radius[1] * m;
  const alpha = rad(e.rotation);
  const x = u * W - e.center[0] * W;
  const y = v * H - e.center[1] * H;
  const l2 = x * x + y * y;
  const l = Math.sqrt(l2);
  const xn = l ? x / l : 0;
  const yn = l ? y / l : 1;
  const xr = xn * Math.cos(alpha) + yn * Math.sin(alpha);
  const yr = -xn * Math.sin(alpha) + yn * Math.cos(alpha);
  const cos2 = xr * xr;
  const sin2 = yr * yr;
  const radius2 = (a * a * b * b) / (a * a * sin2 + b * b * cos2);
  const total2 = (ta * ta * tb * tb) / (ta * ta * sin2 + tb * tb * cos2);
  const f = clip((total2 - l2) / (total2 - radius2));
  return f * f;
}

export const shapeValue = (s: MaskShape, u: number, v: number, W: number, H: number) =>
  s.kind === 'gradient' ? gradientValue(s, u, v, W, H) : ellipseValue(s, u, v, W, H);

/** darktable's _combine_masks_*: `dest` so far, with the next shape's value already at its opacity. */
export function combine(mode: MaskMode | 'copy', dest: number, mask: number): number {
  switch (mode) {
    case 'copy': return mask;
    case 'add': return Math.max(dest, mask);
    case 'intersect': return Math.min(Math.max(dest, 0), Math.max(mask, 0));
    case 'subtract': return dest * (1 - mask * (dest > 0 && mask > 0 ? 1 : 0));
    case 'sum': return Math.min(1, dest + mask);
    case 'exclude': {
      const pos = dest > 0 && mask > 0 ? 1 : 0;
      return pos * Math.max((1 - dest) * mask, dest * (1 - mask)) + (1 - pos) * Math.max(dest, mask);
    }
  }
}

/** A mask's group, then its global opacity (darktable's blend opacity): the share of the adjusted pixel. */
export function maskValue(m: Mask, u: number, v: number, W: number, H: number): number {
  let dest = 0;
  m.shapes.forEach((s, i) => {
    const raw = shapeValue(s, u, v, W, H);
    const value = s.opacity * (s.invert ? 1 - raw : raw);
    dest = combine(i === 0 ? 'copy' : s.mode, dest, value);
  });
  return dest * clip(m.opacity / 100);
}

/** darktable's _blend_normal. */
export const blendNormal = (a: number[], b: number[], mask: number) => a.map((x, i) => x * (1 - mask) + b[i] * mask);

const MODE_CODE: Record<MaskMode | 'copy', number> = { copy: 0, add: 1, intersect: 2, subtract: 3, sum: 4, exclude: 5 };

/**
 * The shapes as the shader reads them, three vec4 each:
 * [kind (1 gradient, 2 ellipse), combine code, opacity, mask index],
 * gradient: [anchor x, anchor y, rotation (rad), compression], [curvature, linear, invert, 0];
 * ellipse: [centre x, centre y, radius a, radius b], [rotation (rad), border, proportional, invert].
 * Only masks that change something, and the one shown, are packed; `index` maps a packed mask to
 * its place in the list.
 */
export function packShapes(masks: Mask[], show = -1): { shapes: number[]; count: number; index: number[] } {
  const shapes: number[] = [];
  const index: number[] = [];
  let count = 0;
  for (let mi = 0; mi < masks.length; mi++) {
    const m = masks[mi];
    if (!m.shapes.length || !(maskActive(m) || mi === show) || index.length >= MAX_MASKS) continue;
    const slot = index.length;
    index.push(mi);
    m.shapes.forEach((s, i) => {
      if (count >= MAX_SHAPES) return;
      count++;
      const mode = MODE_CODE[i === 0 ? 'copy' : s.mode];
      if (s.kind === 'gradient') shapes.push(1, mode, s.opacity, slot, s.anchor[0], s.anchor[1], rad(s.rotation), s.compression, s.curvature, s.linear ? 1 : 0, s.invert ? 1 : 0, 0);
      else shapes.push(2, mode, s.opacity, slot, s.center[0], s.center[1], s.radius[0], s.radius[1], rad(s.rotation), s.border, s.proportional ? 1 : 0, s.invert ? 1 : 0);
    });
  }
  return { shapes, count, index };
}
