// Copyright (C) 2011-2024 darktable developers.
// Copyright (C) 2009-2026 darktable developers (colour space conversions).
// Ported from darktable at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2):
// src/develop/blends/blendif_rgb_hsl.c _blend_color and _CLAMP_XYZ, and
// src/common/colorspaces_inline_conversions.h dt_RGB_2_HSL, dt_HSL_2_RGB, _dt_RGB_2_Hue and
// _dt_Hue_2_RGB. Translated from C to TypeScript; mirrored in src/engine/shaders/stages/lut.glsl.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// darktable's "color" blend mode in its RGB (display) blending: the module's output contributes hue
// and saturation, the input keeps its lightness. Emulsion uses it for a look's LUT ("Colour" blend):
// the film's colour without its tone curve. `a` is the input, `b` the module's output, both in the
// pipe's linear RGB, as darktable's blendif_rgb_hsl receives them.

import type { Vec3 } from '../film/stocks';

const clip = (v: number) => Math.min(Math.max(v, 0), 1);

function rgbToHue(rgb: Vec3, max: number, delta: number): number {
  let hue: number;
  if (rgb[0] === max) hue = (rgb[1] - rgb[2]) / delta;
  else if (rgb[1] === max) hue = 2 + (rgb[2] - rgb[0]) / delta;
  else hue = 4 + (rgb[0] - rgb[1]) / delta;
  hue /= 6;
  // restrict to [0, 1), handling hue < 0 and hue >= 1
  return hue - Math.floor(hue);
}

function hueToRgb(H: number, C: number, min: number): Vec3 {
  const h = H * 6;
  const i = Math.floor(h);
  const f = h - i;
  const fc = f * C;
  const top = C + min;
  const inc = fc + min;
  const dec = top - fc;
  if (i === 0) return [top, inc, min];
  if (i === 1) return [dec, top, min];
  if (i === 2) return [min, top, inc];
  if (i === 3) return [min, dec, top];
  if (i === 4) return [inc, min, top];
  return [top, min, dec];
}

/** dt_RGB_2_HSL: hue, saturation and lightness, each 0 to 1. */
export function rgbToHsl(rgb: Vec3): Vec3 {
  const min = Math.min(rgb[0], rgb[1], rgb[2]);
  const max = Math.max(rgb[0], rgb[1], rgb[2]);
  const delta = max - min;
  const L = (max + min) / 2;
  let H = 0;
  let S = 0;
  if (Math.abs(max) > 1e-6 && Math.abs(delta) > 1e-6) {
    S = L < 0.5 ? delta / (max + min) : delta / (2 - max - min);
    H = rgbToHue(rgb, max, delta);
  }
  return [H, S, L];
}

/** dt_HSL_2_RGB. */
export function hslToRgb(hsl: Vec3): Vec3 {
  const L = hsl[2];
  const C = L < 0.5 ? L * hsl[1] : (1 - L) * hsl[1];
  const m = L - C;
  return hueToRgb(hsl[0], 2 * C, m);
}

/** _blend_color: hue and saturation from `b` at `opacity`, lightness from `a`. */
export function blendColor(a: Vec3, b: Vec3, opacity: number): Vec3 {
  const ta = rgbToHsl(a.map(clip) as Vec3);
  const tb = rgbToHsl(b.map(clip) as Vec3);
  // blend hue along shortest distance on color circle
  const d = Math.abs(ta[0] - tb[0]);
  const s = d > 0.5 ? (-opacity * (1 - d)) / d : opacity;
  const H = (ta[0] * (1 - s) + tb[0] * s + 1) % 1; // fmodf: the sum is always positive here
  const S = ta[1] * (1 - opacity) + tb[1] * opacity;
  return hslToRgb([H, S, ta[2]]).map(clip) as Vec3;
}
