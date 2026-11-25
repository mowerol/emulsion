// Copyright (C) 2010-2026 darktable developers.
// Ported from darktable src/iop/channelmixerrgb.c (color calibration's grey tab, on the path its
// monochrome presets take) and src/common/colorspaces_inline_conversions.h at commit
// 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2). Translated from C to GLSL; see
// engine/greymix.ts (the reference) for the settings and the agreed deviation in stage order.
// SPDX-License-Identifier: GPL-3.0-or-later

// A look's black and white conversion: grey = max(0, w · XYZ(D50)), w normalised to sum 1
// (greyWeights), blended over the pixel by the look's Amount; off at amount 0.
uniform vec3 uGreyMix;
uniform float uGreyAmount;

const mat3 GREY_REC2020_TO_XYZ_D50 = mat3(
  0.6734241, 0.2790177, -0.00193,
  0.1656411, 0.6753402, 0.0299784,
  0.1251286, 0.0456377, 0.797333);
const vec2 GREY_D50_XY = vec2(0.34567, 0.3585);
const float GREY_NORM_MIN = 1.52587890625e-5;

// channelmixerrgb.c _gamut_mapping at compression 0 with clip on: the xyY round trip and its
// sanity checks (u'v' is unchanged at compression 0, so the u'v' step is its identity).
vec3 greyGamutMapping(vec3 xyz) {
  float sum = xyz.x + xyz.y + xyz.z;
  float Y = xyz.y;
  vec2 xy = sum > 0.0 ? xyz.xy / sum : GREY_D50_XY;
  float den = -2.0 * xy.x + 12.0 * xy.y + 3.0;
  vec2 uv = vec2(4.0 * xy.x, 9.0 * xy.y) / den;
  float d2 = 6.0 * uv.x - 16.0 * uv.y + 12.0;
  xy = max(vec2(9.0 * uv.x, 4.0 * uv.y) / d2, 0.0);
  xy.y = max(xy.y, GREY_NORM_MIN);
  float scale = xy.x + xy.y;
  if (scale >= 1.0) xy /= scale;
  return vec3(Y * xy.x / xy.y, Y, Y * (1.0 - xy.x - xy.y) / xy.y);
}

vec3 stageGreyMix(vec3 x) {
  if (uGreyAmount <= 0.0) return x;
  vec3 xyz = max(GREY_REC2020_TO_XYZ_D50 * max(x, 0.0), 0.0);
  xyz = max(greyGamutMapping(xyz), 0.0);
  float g = max(dot(xyz, uGreyMix), 0.0);
  return mix(x, vec3(g), uGreyAmount);
}
