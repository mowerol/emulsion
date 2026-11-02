#version 300 es
// Copyright (C) 2016-2026 darktable developers.
// Ported from darktable src/common/locallaplacian.c (curve_scalar, apply_curve) at commit
// 20891f6c6fa7be995e5bf9dff9d1ee5062051773. Mirrors curve() in src/engine/locallaplacian.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Finest level of the remapped images: lightness (.r of uL) through the curve
// around each brightness level in uGamma, one per channel. With uCarry, .b
// instead carries the lightness itself, so its Gaussian pyramid comes along, and
// .a a masked instance's mask (.g of uL), for the fold (maskfold.frag).
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uL;
uniform vec4 uGamma;
uniform float uCarry;
// x: sigma, y: shadows, z: highlights, w: clarity
uniform vec4 uLl;

float llCurve(float x, float g) {
  float sigma = uLl.x;
  float c = x - g;
  float val;
  if (c > 2.0 * sigma) val = g + sigma + uLl.y * (c - sigma);
  else if (c < -2.0 * sigma) val = g - sigma + uLl.z * (c + sigma);
  else if (c > 0.0) {
    float t = clamp(c / (2.0 * sigma), 0.0, 1.0);
    val = g + sigma * 2.0 * (1.0 - t) * t + t * t * (sigma + sigma * uLl.y);
  } else {
    float t = clamp(-c / (2.0 * sigma), 0.0, 1.0);
    val = g - sigma * 2.0 * (1.0 - t) * t + t * t * (-sigma - sigma * uLl.z);
  }
  return val + uLl.w * c * exp(-c * c / (2.0 * sigma * sigma / 3.0));
}

void main() {
  vec4 in0 = texelFetch(uL, ivec2(gl_FragCoord.xy), 0);
  float x = in0.r;
  vec4 o = vec4(llCurve(x, uGamma.x), llCurve(x, uGamma.y), llCurve(x, uGamma.z), llCurve(x, uGamma.w));
  outColor = uCarry > 0.5 ? vec4(o.xy, x, in0.g) : o;
}
