// Copyright (C) 2013-2025 darktable developers.
// Copyright (C) 2009-2026 darktable developers (colour space conversions).
// Ported from darktable src/develop/masks/gradient.c (_gradient_get_mask_roi), ellipse.c
// (_ellipse_get_mask_roi, _fill_mask), group.c (_group_get_mask_roi, _combine_masks_*),
// src/develop/blend.c (dt_develop_blendif_process_parameters, global opacity) with
// blends/blendif_rgb_jzczhz.c (_blendif_compute_factor, _blendif_jzczhz, the exclusive mask
// combination, _blend_normal), and src/common/colorspaces_inline_conversions.h
// (dt_XYZ_2_JzAzBz, dt_JzAzBz_2_JzCzhz), with blend_gui.c's channel scales and its "set values"
// picker (blend_color_picker_apply, with common/color_picker.c's statistics), at commit
// 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2). Translated from C to TypeScript, the
// reference for stages/masks.glsl. Each shape is evaluated exactly at every pixel; darktable
// samples a grid of 1 to 8 pixels and interpolates (and reads the gradient's erf from a table
// with one entry per pixel), to save time on the CPU. erf is Abramowitz and Stegun 7.1.26
// (error under 1.5e-7), which the shader shares.
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BrushShape, EllipseShape, GradientShape, Mask, MaskMode, MaskRange, MaskShape, RangeChannel } from '../film/masks';
import { MAX_BRUSHES, MAX_MASKS, MAX_SHAPES, RANGE_CHANNELS, maskActive } from '../film/masks';
import { brushValue } from './brush';
import { REC2020_TO_XYZ } from './colorbalance';
import type { Vec3 } from '../film/stocks';

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
  s.kind === 'gradient' ? gradientValue(s, u, v, W, H) : s.kind === 'ellipse' ? ellipseValue(s, u, v, W, H) : brushValue(s as BrushShape, u, v, W, H);

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

/** A mask's group of shapes (darktable's drawn mask). */
export function drawnValue(m: Mask, u: number, v: number, W: number, H: number): number {
  let dest = 0;
  m.shapes.forEach((s, i) => {
    const raw = shapeValue(s, u, v, W, H);
    const value = s.opacity * (s.invert ? 1 - raw : raw);
    dest = combine(i === 0 ? 'copy' : s.mode, dest, value);
  });
  return dest;
}

/** darktable's dt_XYZ_2_JzAzBz then dt_JzAzBz_2_JzCzhz, from scene-linear Rec.2020 (D65). */
export function jzczhz(rgb: Vec3): Vec3 {
  const [X, Y, Z] = REC2020_TO_XYZ.map((r) => r[0] * rgb[0] + r[1] * rgb[1] + r[2] * rgb[2]);
  const b = 1.15, g = 0.66, c1 = 0.8359375, c2 = 18.8515625, c3 = 18.6875, n = 0.159301758, p = 134.034375, d = -0.56, d0 = 1.6295499532821566e-11;
  const xp = b * X - (b - 1) * Z;
  const yp = g * Y - (g - 1) * X;
  const lms = [
    0.41478972 * xp + 0.579999 * yp + 0.014648 * Z,
    -0.20151 * xp + 1.120649 * yp + 0.0531008 * Z,
    -0.0166008 * xp + 0.2648 * yp + 0.6684799 * Z,
  ].map((v) => {
    const t = Math.max(v / 10000, 0) ** n;
    return ((c1 + c2 * t) / (1 + c3 * t)) ** p;
  });
  const iz = 0.5 * lms[0] + 0.5 * lms[1];
  const az = 3.524 * lms[0] - 4.066708 * lms[1] + 0.542708 * lms[2];
  const bz = 0.199076 * lms[0] + 1.096799 * lms[1] - 1.295875 * lms[2];
  const jz = Math.max(((1 + d) * iz) / (1 + d * iz) - d0, 0);
  const h = Math.atan2(bz, az) / (2 * Math.PI);
  return [jz, Math.hypot(az, bz), h >= 0 ? h : 1 + h];
}

/**
 * The channels' boost (darktable's blendif_boost_factors, in EV over blend_gui.c's offset of
 * -6.64 for Jz and Cz; hue has none). darktable lets the user raise them; ours are fixed so the
 * slider spans a photo: +1 EV puts diffuse white near 88 on Luminance, +2 EV puts vivid colours
 * under 80 on Chroma.
 */
const BOOST: Record<RangeChannel, number> = { luminance: 2 ** (-6.64385619 + 1), chroma: 2 ** (-6.64385619 + 2), hue: 1 };

/** A channel's value (Jz, Cz or hz) in the slider's units. */
export function rangeUnits(channel: RangeChannel, value: number): number {
  return (value / BOOST[channel]) * RANGE_CHANNELS.find((c) => c.id === channel)!.max;
}

/**
 * dt_develop_blendif_process_parameters for one channel: the markers in the channel's units, the
 * rising and falling slopes, and an open end where both markers sit at the slider's end.
 */
export function rangeParameters(r: MaskRange, channel: RangeChannel): number[] {
  const max = RANGE_CHANNELS.find((c) => c.id === channel)!.max;
  const q = r.points.map((x) => x / max);
  const p = q.map((x) => x * BOOST[channel]);
  const out = [p[0], p[1], p[2], p[3], 1 / Math.max(0.001, p[1] - p[0]), 1 / Math.max(0.001, p[3] - p[2])];
  if (q[0] <= 0 && q[1] <= 0) out[0] = out[1] = -Number.MAX_VALUE;
  if (q[2] >= 1 && q[3] >= 1) out[2] = out[3] = Number.MAX_VALUE;
  return out;
}

/** darktable's _blendif_compute_factor. */
export function blendifFactor(value: number, p: number[], invert: boolean): number {
  let f: number;
  if (value <= p[0]) f = 0;
  else if (value < p[1]) f = (value - p[0]) * p[4];
  else if (value <= p[2]) f = 1;
  else if (value < p[3]) f = 1 - (value - p[2]) * p[5];
  else f = 0;
  return invert ? 1 - f : f;
}

/** A mask's ranges at a pixel (scene-linear Rec.2020): the product over its channels, 1 with none. */
export function rangeValue(m: Mask, rgb: Vec3): number {
  const on = RANGE_CHANNELS.filter((c) => m.ranges[c.id]);
  if (!on.length) return 1;
  const j = jzczhz(rgb);
  return on.reduce((f, c) => f * blendifFactor(j[c.id === 'luminance' ? 0 : c.id === 'chroma' ? 1 : 2], rangeParameters(m.ranges[c.id]!, c.id), m.ranges[c.id]!.invert), 1);
}

/**
 * The share of the adjusted pixel: darktable's exclusive, non-inverted combination of the drawn
 * mask and the parametric one, times the blend opacity. `rgb` is the input of the mask's exposure
 * instance; its colour balance instance reuses the value (darktable's raster mask).
 */
export function maskValue(m: Mask, u: number, v: number, W: number, H: number, rgb?: Vec3): number {
  return drawnValue(m, u, v, W, H) * (rgb ? rangeValue(m, rgb) : 1) * clip(m.opacity / 100);
}

/**
 * What darktable's area picker gathers over JzCzhz (color_picker.c, _update_stats_4ch): the
 * least and greatest Jz, Cz and hz, and of hz turned half way round (the fourth channel, which
 * the blendif picker uses to tell a range across red from one around cyan).
 */
export interface PickStats {
  min: [number, number, number, number];
  max: [number, number, number, number];
}

/** The statistics of some pixels (scene-linear Rec.2020, `stride` floats apart). Null with none. */
export function pickStats(px: ArrayLike<number>, stride = 4): PickStats | null {
  const min: PickStats['min'] = [Infinity, Infinity, Infinity, Infinity];
  const max: PickStats['max'] = [-Infinity, -Infinity, -Infinity, -Infinity];
  let n = 0;
  for (let i = 0; i + 2 < px.length; i += stride) {
    const rgb: Vec3 = [px[i], px[i + 1], px[i + 2]];
    if (!rgb.every(Number.isFinite)) continue;
    const [jz, cz, hz] = jzczhz(rgb);
    const pick = [jz, cz, hz, hz < 0.5 ? hz + 0.5 : hz - 0.5];
    for (let k = 0; k < 4; k++) {
      min[k] = Math.min(min[k], pick[k]);
      max[k] = Math.max(max[k], pick[k]);
    }
    n++;
  }
  return n ? { min, max } : null;
}

/**
 * darktable's blendif "set values" picker (blend_gui.c, blend_color_picker_apply) for one
 * channel: the markers hug the picked span with a feather of 0.01 of the slider each side, a hue
 * span shorter the other way round is taken across red with the range inverted, and a channel
 * whose markers span the whole slider is turned off (null).
 */
export function pickedRange(stats: PickStats, channel: RangeChannel): MaskRange | null {
  const k = channel === 'luminance' ? 0 : channel === 'chroma' ? 1 : 2;
  let lo = stats.min[k];
  let hi = stats.max[k];
  let reverse = false;
  if (channel === 'hue' && stats.max[3] - stats.min[3] < stats.max[2] - stats.min[2] && stats.min[3] < 0.5 && stats.max[3] > 0.5) {
    hi = stats.max[3] < 0.5 ? stats.max[3] + 0.5 : stats.max[3] - 0.5;
    lo = stats.min[3] < 0.5 ? stats.min[3] + 0.5 : stats.min[3] - 0.5;
    reverse = true;
  }
  // _blendif_scale: the slider's 0 to 1.
  let a = lo / BOOST[channel];
  let b = hi / BOOST[channel];
  if (a > b) [a, b] = [b, a];
  const feather = 0.01;
  const v = [clip(a - feather), clip(a + feather), clip(b - feather), clip(b + feather)];
  if (v[1] > v[2]) {
    v[1] = clip(a);
    v[2] = clip(b);
  }
  v[0] = Math.min(Math.max(v[0], 0), v[1]);
  v[3] = Math.min(Math.max(v[3], v[2]), 1);
  if (v[1] === 0 && v[2] === 1) return null;
  const max = RANGE_CHANNELS.find((c) => c.id === channel)!.max;
  return { points: v.map((x) => x * max) as MaskRange['points'], invert: reverse };
}

/** The ranges as the shader reads them: three vec4 of markers (Jz, Cz, hz) and one of flags. */
export function packRanges(m: Mask): { points: number[]; flags: number[] } {
  const points: number[] = [];
  const flags: number[] = [];
  for (const c of RANGE_CHANNELS) {
    const r = m.ranges[c.id];
    // GLSL has no FLT_MAX literal it is sure to keep; 1e30 is beyond any value here.
    points.push(...(r ? rangeParameters(r, c.id).slice(0, 4).map((x) => Math.max(-1e30, Math.min(1e30, x))) : [0, 0, 0, 0]));
    flags.push(r ? (r.invert ? 2 : 1) : 0);
  }
  flags.push(0);
  return { points, flags };
}

/** darktable's _blend_normal. */
export const blendNormal = (a: number[], b: number[], mask: number) => a.map((x, i) => x * (1 - mask) + b[i] * mask);

const MODE_CODE: Record<MaskMode | 'copy', number> = { copy: 0, add: 1, intersect: 2, subtract: 3, sum: 4, exclude: 5 };

/**
 * The shapes as the shader reads them, three vec4 each:
 * [kind (1 gradient, 2 ellipse), combine code, opacity, mask index],
 * gradient: [anchor x, anchor y, rotation (rad), compression], [curvature, linear, invert, 0];
 * ellipse: [centre x, centre y, radius a, radius b], [rotation (rad), border, proportional, invert];
 * brush (3): [its channel in the brush masks, 0, 0, 0], [0, 0, 0, invert].
 * Only masks that change something, and the one shown, are packed; `index` maps a packed mask to
 * its place in the list.
 */
export function packShapes(masks: Mask[], show = -1): { shapes: number[]; count: number; index: number[] } {
  const shapes: number[] = [];
  const index: number[] = [];
  let count = 0;
  let brushes = 0;
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
      else if (s.kind === 'ellipse') shapes.push(2, mode, s.opacity, slot, s.center[0], s.center[1], s.radius[0], s.radius[1], rad(s.rotation), s.border, s.proportional ? 1 : 0, s.invert ? 1 : 0);
      // Brushes past the textures' room count as empty.
      else shapes.push(3, mode, brushes < MAX_BRUSHES ? s.opacity : 0, slot, brushes++, 0, 0, 0, 0, 0, 0, s.invert ? 1 : 0);
    });
  }
  return { shapes, count, index };
}
