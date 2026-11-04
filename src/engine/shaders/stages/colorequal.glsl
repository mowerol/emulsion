// Copyright (C) 2022-2026 darktable developers.
// Ported from darktable src/iop/colorequal.c at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773
// (release 5.6.2). Translated from C to GLSL. Mirrors src/engine/colorequal.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Colour, in scene light: darktable's color equalizer. Its guided filters run
// in the ce.frag passes over the whole photo, starting from ceAnalyse() here;
// this stage takes the finished colour from their map. Needs
// stages/colorbalance.glsl (the darktable UCS helpers).

// 1 replaces the colour with uCeTex (.rgb: scene-linear Rec.2020 after the equalizer).
// 2 adds the preview's RGB change during a live regional drag, preserving the source's detail.
// This engine approximation ends at the settle; the equalizer's port above is unchanged.
uniform float uCeOn;
uniform sampler2D uCeTex;
uniform vec4 uCeRoi;

/** STEP 1 of process(): darktable UCS U and V, lightness L* and RGB saturation. */
vec4 ceAnalyse(vec3 rgb) {
  vec3 xyY = cbXyzToXyY(uCbLmsToXyz * (uCbRgbToLms * rgb));
  float hi = max(rgb.r, max(rgb.g, rgb.b));
  float delta = hi - min(rgb.r, min(rgb.g, rgb.b));
  const float NORM_MIN = 1.52587890625e-5;
  float sat = hi > NORM_MIN && delta > NORM_MIN ? delta / hi : 0.0;
  return vec4(cbXyYToUV(xyY), cbYToLStar(xyY.z), sat);
}

vec3 stageColorEqual(vec3 rgb, vec2 uv) {
  if (uCeOn < 0.5) return rgb;
  if (uCeOn > 1.5) return rgb + texture(uCeTex, uCeRoi.xy + uv * uCeRoi.zw).rgb;
  return texture(uCeTex, uv).rgb;
}
