#version 300 es
// Copyright (C) 2017-2025 darktable developers.
// Copyright (C) 2017-2026 darktable developers (guided filter, box filters).
// Ported from darktable src/iop/hazeremoval.c (_transition_map and process), src/common/guided_filter.c
// and src/common/box_filters.cc at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2).
// Translated from C to GLSL; box filters are separable passes over windows truncated at the edges,
// as darktable's, with the sums taken directly. Mirrors src/engine/dehaze.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Haze removal's transmission over the whole photo, one step per draw (uMode). uI holds the
// module's input (dehaze.frag). Box passes run along uDir (1, 0) or (0, 1) with radius uW.
//  1 from uI: the transition map 1 - strength · min(rgb / A0), its maximum along the row
//  2 from uA (.r): the moving maximum (uMin 0) or minimum (uMin 1) along uDir
//  3 from uI: means along the row of the guide (r, g, b, rr) (rg, rb, gg, gb) (bb), three outputs
//  4 from uA, uB, uC: their means along uDir, three outputs
//  5 from uI and uA (.r, the refined transition map): means along the row of (t, t·r, t·g, t·b)
//  6 from uA (step 5, both ways) and uB, uC, uD (the guide's means): the filter's a (rgb) and b
// An instance is x -> (x - A0) / t + A0 blended by its mask m, which is affine per pixel, so the
// instances fold into one image of (beta, alpha), x -> alpha x + beta:
//  7 from uI (the instance's input), uB (its a, b), uC (its mask, .r, with uWeighted) and uA (the
//    instances before it, with uPrevOn): the fold up to this instance. Steps 1-6 run for a
//    strength of ±1 (the sign); uGfScale, the strength's size k, makes their transmission t into
//    (1 - k) + k t, which is exactly the filter's output for the strength (Engine.dehazeTransmission).
//  8 from uI (the photo's input) and uA (with uPrevOn): a masked instance's input
//  9 the same at a small size, uI at this size and uA sampled, for measuring the ambient light
precision highp float;
precision highp int;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outColor2;
layout(location = 2) out vec4 outColor3;

uniform int uMode;
uniform sampler2D uI;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uC;
uniform sampler2D uD;
uniform ivec2 uDir;
uniform int uW;
uniform float uMin;
uniform vec3 uA0;
uniform float uStrength;
uniform float uEps;
uniform float uTmin;
uniform float uPrevOn;
uniform float uWeighted;
uniform float uGfScale;

const int MAX_W = 12;
const float FLT_MAX = 3.402823466e38;
const float FLT_EPSILON = 1.1920929e-7;

float transition(vec3 c) {
  return 1.0 - min(min(c.r / uA0.r, c.g / uA0.g), c.b / uA0.b) * uStrength;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 size = uMode == 2 || uMode == 4 || uMode == 6 ? textureSize(uA, 0) : textureSize(uI, 0);
  outColor = vec4(0.0);
  outColor2 = vec4(0.0);
  outColor3 = vec4(0.0);
  if (uMode >= 7) {
    vec4 prev = uPrevOn > 0.5 ? (uMode == 9 ? texture(uA, vUv) : texelFetch(uA, p, 0)) : vec4(0.0, 0.0, 0.0, 1.0);
    vec3 x = texelFetch(uI, p, 0).rgb;
    if (uMode != 7) {
      outColor = vec4(prev.a * x + prev.rgb, 1.0);
      return;
    }
    vec4 ab = texelFetch(uB, p, 0);
    float t = max((1.0 - uGfScale) + uGfScale * (dot(ab.rgb, x) + ab.a), uTmin);
    float m = uWeighted > 0.5 ? texelFetch(uC, p, 0).r : 1.0;
    // (1 - m) x + m ((x - A0) / t + A0)
    float alpha = 1.0 + m * (1.0 / t - 1.0);
    vec3 beta = m * uA0 * (1.0 - 1.0 / t);
    outColor = vec4(alpha * prev.rgb + beta, alpha * prev.a);
    return;
  }
  if (uMode == 6) {
    // Cramer's rule on the 3 × 3 system, exactly as darktable's _guided_filter_tiling.
    vec4 m = texelFetch(uA, p, 0);
    vec4 g0 = texelFetch(uB, p, 0), g1 = texelFetch(uC, p, 0);
    float bb = texelFetch(uD, p, 0).r;
    float inp = m.x;
    float gr = g0.x, gg = g0.y, gb = g0.z;
    float s00 = g0.w - gr * gr + uEps, s01 = g1.x - gr * gg, s02 = g1.y - gr * gb;
    float s11 = g1.z - gg * gg + uEps, s12 = g1.w - gg * gb, s22 = bb - gb * gb + uEps;
    float det0 = s00 * (s11 * s22 - s12 * s12) - s01 * (s01 * s22 - s02 * s12) + s02 * (s01 * s12 - s02 * s11);
    if (abs(det0) > 4.0 * FLT_EPSILON) {
      // m.yzw are the means of t·r, t·g, t·b.
      float cr = m.y - gr * inp, cg = m.z - gg * inp, cb = m.w - gb * inp;
      float det1 = cr * (s11 * s22 - s12 * s12) - s01 * (cg * s22 - cb * s12) + s02 * (cg * s12 - cb * s11);
      float det2 = s00 * (cg * s22 - cb * s12) - cr * (s01 * s22 - s02 * s12) + s02 * (s01 * cb - s02 * cg);
      float det3 = s00 * (s11 * cb - s12 * cg) - s01 * (s01 * cb - s02 * cg) + cr * (s01 * s12 - s02 * s11);
      vec3 a = vec3(det1, det2, det3) / det0;
      outColor = vec4(a, inp - dot(a, vec3(gr, gg, gb)));
    } else outColor = vec4(0.0, 0.0, 0.0, inp);
    return;
  }
  ivec2 dir = uMode == 1 || uMode == 3 || uMode == 5 ? ivec2(1, 0) : uDir;
  int n = dir.x == 1 ? size.x : size.y;
  int at = dir.x == 1 ? p.x : p.y;
  float extreme = uMode == 2 && uMin > 0.5 ? FLT_MAX : -FLT_MAX;
  vec4 s0 = vec4(0.0), s1 = vec4(0.0), s2 = vec4(0.0);
  float count = 0.0;
  for (int k = -MAX_W; k <= MAX_W; k++) {
    if (k < -uW || k > uW || at + k < 0 || at + k >= n) continue;
    ivec2 q = p + dir * k;
    count += 1.0;
    if (uMode == 1) extreme = max(extreme, transition(texelFetch(uI, q, 0).rgb));
    else if (uMode == 2) {
      float v = texelFetch(uA, q, 0).r;
      extreme = uMin > 0.5 ? min(extreme, v) : max(extreme, v);
    } else if (uMode == 3) {
      vec3 c = texelFetch(uI, q, 0).rgb;
      s0 += vec4(c, c.r * c.r);
      s1 += vec4(c.r * c.g, c.r * c.b, c.g * c.g, c.g * c.b);
      s2.r += c.b * c.b;
    } else if (uMode == 4) {
      s0 += texelFetch(uA, q, 0);
      s1 += texelFetch(uB, q, 0);
      s2 += texelFetch(uC, q, 0);
    } else if (uMode == 5) {
      float t = texelFetch(uA, q, 0).r;
      s0 += vec4(t, t * texelFetch(uI, q, 0).rgb);
    }
  }
  if (uMode == 1 || uMode == 2) {
    outColor = vec4(extreme, 0.0, 0.0, 1.0);
    return;
  }
  outColor = s0 / count;
  outColor2 = s1 / count;
  outColor3 = s2 / count;
}
