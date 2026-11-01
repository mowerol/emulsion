#version 300 es
// Copyright (C) 2011-2026 darktable developers (blend.c).
// Copyright (C) 2017-2026 darktable developers (guided_filter.c).
// Copyright (C) 2009-2024 darktable developers (box_filters.cc).
// Copyright (C) 2012-2026 darktable developers (gaussian.c).
// Ported from darktable src/develop/blend.c, src/common/guided_filter.c, box_filters.cc and
// gaussian.c at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2). Translated from
// C to GLSL; mirrors src/engine/maskrefine.ts. The box means are differences of running sums
// (prefix sums made in log2 steps) rather than darktable's moving sums, and the recursive
// Gaussian is convolved with its own impulse response, which is the same filter.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// A mask's refinement, one step per draw (uMode). uA holds the tap: the instance's input (rgb)
// and its unrefined mask (a).
//  0 blur along uAxis: rgb kept, a convolved with darktable's Gaussian (uAlpha, uK, uTaps)
//  1 the guided filter's sums for part uPart: 0 (p, I), 1 (I p, I.r I.r), 2 (I.r I.g, I.r I.b, I.g I.g, I.g I.b), 3 (I.b I.b)
//  2 a running sum along uAxis, step uStep
//  3 the box mean of radius uRadius along uAxis, from running sums
//  4 the guided filter's coefficients from the box means uA..uD
//  5 the feathered mask from the coefficients' box means (uB) and the guide (uA), in .a
//  6 the finished mask (.a of uA, filtered linearly), through the tone curve if uTone
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;

uniform int uMode;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uC;
uniform sampler2D uD;
uniform int uAxis;
uniform int uPart;
uniform int uStep;
uniform int uRadius;
uniform int uTaps;
uniform float uAlpha;
uniform float uK;
uniform float uGuideWeight;
uniform float uEps;
uniform float uTone;
uniform float uContrast;
uniform float uBrightness;
uniform float uOpacity;

ivec2 along(ivec2 p, int d) { return uAxis == 0 ? p + ivec2(d, 0) : p + ivec2(0, d); }

vec4 fetchClamped(sampler2D s, ivec2 p) {
  ivec2 size = textureSize(s, 0);
  return texelFetch(s, clamp(p, ivec2(0), size - 1), 0);
}

// _develop_blend_process_mask_tone_curve.
float toneCurve(float mask) {
  float epsilon = 16.0 * 1.1920929e-7;
  float e = exp(3.0 * uContrast);
  float x = 2.0 * mask / uOpacity - 1.0;
  if (1.0 - uBrightness <= 0.0) x = mask <= epsilon ? -1.0 : 1.0;
  else if (1.0 + uBrightness <= 0.0) x = mask >= 1.0 - epsilon ? 1.0 : -1.0;
  else if (uBrightness > 0.0) x = min((x + uBrightness) / (1.0 - uBrightness), 1.0);
  else x = max((x + uBrightness) / (1.0 + uBrightness), -1.0);
  float cval = 0.5 * (x * e / (1.0 + (e - 1.0) * abs(x))) + 0.5;
  float mval = cval > 1e-6 ? cval : 0.0;
  return clamp(mval, 0.0, 1.0) * uOpacity;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (uMode == 0) {
    vec4 c = texelFetch(uA, p, 0);
    float sum = uK * clamp(c.a, 0.0, 1.0);
    for (int n = 1; n < 4096; n++) {
      if (n > uTaps) break;
      float w = uK * (1.0 + uAlpha * float(n)) * exp(-uAlpha * float(n));
      sum += w * (clamp(fetchClamped(uA, along(p, n)).a, 0.0, 1.0) + clamp(fetchClamped(uA, along(p, -n)).a, 0.0, 1.0));
    }
    outColor = vec4(c.rgb, sum);
  } else if (uMode == 1) {
    vec4 t = texelFetch(uA, p, 0);
    vec3 I = t.rgb * uGuideWeight;
    float m = t.a;
    if (uPart == 0) outColor = vec4(m, I);
    else if (uPart == 1) outColor = vec4(I * m, I.r * I.r);
    else if (uPart == 2) outColor = vec4(I.r * I.g, I.r * I.b, I.g * I.g, I.g * I.b);
    else outColor = vec4(I.b * I.b, 0.0, 0.0, 0.0);
  } else if (uMode == 2) {
    int x = uAxis == 0 ? p.x : p.y;
    vec4 s = texelFetch(uA, p, 0);
    if (x >= uStep) s += texelFetch(uA, along(p, -uStep), 0);
    outColor = s;
  } else if (uMode == 3) {
    ivec2 size = textureSize(uA, 0);
    int n = uAxis == 0 ? size.x : size.y;
    int x = uAxis == 0 ? p.x : p.y;
    int hi = min(x + uRadius, n - 1);
    int lo = max(x - uRadius, 0);
    vec4 s = texelFetch(uA, along(p, hi - x), 0);
    if (lo > 0) s -= texelFetch(uA, along(p, lo - 1 - x), 0);
    outColor = s / float(hi - lo + 1);
  } else if (uMode == 4) {
    vec4 mean = texelFetch(uA, p, 0);
    vec4 v1 = texelFetch(uB, p, 0);
    vec4 v2 = texelFetch(uC, p, 0);
    vec4 v3 = texelFetch(uD, p, 0);
    float inp = mean.x;
    vec3 g = mean.yzw;
    float s00 = v1.w - g.r * g.r + uEps;
    float s01 = v2.x - g.r * g.g;
    float s02 = v2.y - g.r * g.b;
    float s11 = v2.z - g.g * g.g + uEps;
    float s12 = v2.w - g.g * g.b;
    float s22 = v3.x - g.b * g.b + uEps;
    float det0 = s00 * (s11 * s22 - s12 * s12) - s01 * (s01 * s22 - s02 * s12) + s02 * (s01 * s12 - s02 * s11);
    if (abs(det0) > 4.0 * 1.1920929e-7) {
      float cr = v1.x - g.r * inp;
      float cg = v1.y - g.g * inp;
      float cb = v1.z - g.b * inp;
      float det1 = cr * (s11 * s22 - s12 * s12) - s01 * (cg * s22 - cb * s12) + s02 * (cg * s12 - cb * s11);
      float det2 = s00 * (cg * s22 - cb * s12) - cr * (s01 * s22 - s02 * s12) + s02 * (s01 * cb - s02 * cg);
      float det3 = s00 * (s11 * cb - s12 * cg) - s01 * (s01 * cb - s02 * cg) + cr * (s01 * s12 - s02 * s11);
      vec3 a = vec3(det1, det2, det3) / det0;
      outColor = vec4(a, inp - dot(a, g));
    } else outColor = vec4(0.0, 0.0, 0.0, inp);
  } else if (uMode == 5) {
    vec4 t = texelFetch(uA, p, 0);
    vec4 ab = texelFetch(uB, p, 0);
    outColor = vec4(t.rgb, clamp(uGuideWeight * dot(ab.rgb, t.rgb) + ab.a, 0.0, 1.0));
  } else {
    float m = texture(uA, vUv).a;
    outColor = vec4(uTone > 0.5 ? toneCurve(m) : m);
  }
}
