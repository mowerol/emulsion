#version 300 es
// Copyright (C) 2016-2026 darktable developers.
// Ported from darktable src/common/locallaplacian.c (ll_expand_gaussian, ll_laplacian and the
// output assembly of local_laplacian_internal) at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773,
// with borders clamped to the edge. Mirrors localLaplacian() in src/engine/locallaplacian.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// One level up the output pyramid: the coarser output brought up, plus each
// remapped image's Laplacian coefficient, interpolated between the two
// brightness levels around this pixel's own brightness at this scale.
// uA*: remapped images for levels 0-3; uB*: levels 4-5 in .rg and the
// lightness Gaussian pyramid in .b. *0 is this level, *1 the next coarser.
// With LL_LOG defined (detail before Exposure, LOG_GAMMAS in locallaplacian.ts): ten levels,
// darktable's six extended at the same spacing, three below and one above: uA* 0-3, uB* 4-7,
// uC* 8-9 in .rg and the lightness in .b.
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uCoarse;
uniform sampler2D uA0;
uniform sampler2D uA1;
uniform sampler2D uB0;
uniform sampler2D uB1;
#ifdef LL_LOG
uniform sampler2D uC0;
uniform sampler2D uC1;
#define NG 10
#define G0 -3
#else
#define NG 6
#define G0 0
#endif
// 1 at the coarsest step: the coarser output is the lightness pyramid's last level (uB1.b).
uniform float uTop;
// 1 at the finest level: write the change in lightness rather than the lightness.
uniform float uDelta;

float ew(int d) { return d == 0 ? 6.0 / 16.0 : (abs(d) == 1 ? 4.0 / 16.0 : (abs(d) == 2 ? 1.0 / 16.0 : 0.0)); }

// The coarse level brought up to fine pixel p; every channel at once.
vec4 expandAt(sampler2D coarse, ivec2 p) {
  ivec2 size = textureSize(coarse, 0) - 1;
  vec4 s = vec4(0.0);
  for (int cj = (p.y - 1) / 2 - 1; cj <= (p.y + 2) / 2; cj++)
    for (int ci = (p.x - 1) / 2 - 1; ci <= (p.x + 2) / 2; ci++) {
      float w = ew(p.x - 2 * ci) * ew(p.y - 2 * cj);
      if (w > 0.0) s += w * texelFetch(coarse, clamp(ivec2(ci, cj), ivec2(0), size), 0);
    }
  return 4.0 * s;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a0 = texelFetch(uA0, p, 0);
  vec4 b0 = texelFetch(uB0, p, 0);
  vec4 la = a0 - expandAt(uA1, p);
  vec4 lb = b0 - expandAt(uB1, p);
#ifdef LL_LOG
  vec4 c0 = texelFetch(uC0, p, 0);
  vec4 lc = c0 - expandAt(uC1, p);
  float lap[NG] = float[NG](la.x, la.y, la.z, la.w, lb.x, lb.y, lb.z, lb.w, lc.x, lc.y);
  float base = uTop > 0.5 ? expandAt(uC1, p).b : expandAt(uCoarse, p).r;
  float v = c0.b;
#else
  float lap[NG] = float[NG](la.x, la.y, la.z, la.w, lb.x, lb.y);
  float base = uTop > 0.5 ? expandAt(uB1, p).b : expandAt(uCoarse, p).r;
  float v = b0.b;
#endif

  // darktable's search for the two brightness levels around v.
  int hi = 1;
  for (int k = 1; k < NG - 1; k++) if ((float(hi + G0) + 0.5) / 6.0 <= v) hi++;
  int lo = hi - 1;
  float glo = (float(lo + G0) + 0.5) / 6.0;
  float a = clamp((v - glo) * 6.0, 0.0, 1.0);
  float l0 = lap[0], l1 = lap[1];
  for (int k = 0; k < NG; k++) {
    if (k == lo) l0 = lap[k];
    if (k == hi) l1 = lap[k];
  }
  float outL = base + l0 * (1.0 - a) + l1 * a;
  outColor = vec4(uDelta > 0.5 ? outL - v : outL, 0.0, 0.0, 1.0);
}
