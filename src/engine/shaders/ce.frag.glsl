#version 300 es
// Copyright (C) 2022-2026 darktable developers.
// Ported from darktable src/iop/colorequal.c (process, _prefilter_chromaticity,
// _guide_with_chromaticity), src/common/darktable_ucs_22_helpers.h (gamut_map_HSB) and
// src/common/math.h (scharr_gradient) at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773
// (release 5.6.2). Translated from C to GLSL; Gaussian means are exact 2D kernels with clamped
// borders. Mirrors colorEqualize() in src/engine/colorequal.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The color equalizer over the whole photo, one step per draw (uMode). uA holds
// ceAnalyse() of every pixel: U, V, L*, saturation. Modes 0 and 4 write two
// targets at once (outColor and outColor2), as both halves need the same sums.
//  0 the prefilter's a (4); and its b (2) with the mean U, V
//  2 from uA, uB (a), uC (b, means): filtered U, V, L* and the blurred saturation
//  3 from uA (step 2): the hue, saturation and brightness corrections and the raw saturation gradient
//  4 the guided filter's a (4), from uA (step 2) and uB (step 3); and its b (2) with the blurred hue correction
//  6 from uA (step 2), uB (step 3), uC (a), uD (b): the finished scene-linear Rec.2020 colour
precision highp float;
precision highp int;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outColor2;
#include "stages/colorbalance.glsl"

uniform int uMode;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uC;
uniform sampler2D uD;
// 1D Gaussians (half-widths up to 3): hue analysis, effect, saturation, gradient, brightness (0.1 × effect).
uniform float uKh[7];
uniform int uKhHalf;
uniform float uKp[7];
uniform int uKpHalf;
uniform float uKs[7];
uniform int uKsHalf;
uniform float uKb[7];
uniform int uKbHalf;
// The hue, saturation and brightness LUTs over 512 hues in [-pi, pi), packed in fours.
uniform vec4 uCeHue[128];
uniform vec4 uCeSat[128];
uniform vec4 uCeBright[128];
// x: saturation shift, y: brightness shift, z: gradient amplitude, w: white (UCS L*)
uniform vec4 uCeShift;

ivec2 gMax;
vec4 at(sampler2D t, ivec2 p) { return texelFetch(t, clamp(p, ivec2(0), gMax), 0); }

float lutAt(int which, int i) {
  vec4 v = which == 0 ? uCeHue[i >> 2] : which == 1 ? uCeSat[i >> 2] : uCeBright[i >> 2];
  int k = i & 3;
  return k == 0 ? v.x : k == 1 ? v.y : k == 2 ? v.z : v.w;
}

// lookup_gamut on one of the hue LUTs.
float lut(int which, float hue) {
  float x = 512.0 * (hue + CB_PI) / (2.0 * CB_PI);
  float x0 = floor(x);
  float x1 = ceil(x);
  int i0 = int(x0) & 511;
  int i1 = int(x1) & 511;
  float y0 = lutAt(which, i0);
  return y0 + (i0 != i1 ? (x - x0) * (lutAt(which, i1) - y0) : 0.0);
}

// _get_satweight with darktable's contrast 0.
float satWeight(float s) {
  float c = clamp(s, -1.0, 1.0 - 1.0 / 4096.0);
  return 1.0 / (1.0 + exp(-30.0 * c));
}

// The guided filter's a and b for a 2-channel guide (Σ + εI inverted as darktable does).
void guided(vec2 m, vec3 sec, vec4 cross, vec2 mg, float eps, out vec4 a, out vec2 b) {
  float s0 = sec.x - m.x * m.x + eps;
  float s1 = sec.y - m.x * m.y;
  float s3 = sec.z - m.y * m.y + eps;
  float det = s0 * s3 - s1 * s1;
  a = vec4(0.0);
  if (abs(det) > 4.0 * 1.1920929e-7) {
    vec4 inv = vec4(s3, -s1, -s1, s0) / det;
    vec4 x = cross - vec4(m.x * mg.x, m.y * mg.x, m.x * mg.y, m.y * mg.y);
    a = vec4(x.x * inv.x + x.y * inv.y, x.x * inv.z + x.y * inv.w, x.z * inv.x + x.w * inv.y, x.z * inv.z + x.w * inv.w);
  }
  b = mg - vec2(a.x * m.x + a.y * m.y, a.z * m.x + a.w * m.y);
}

vec3 hsbOf(vec4 a) {
  float M2 = dot(a.xy, a.xy);
  float L = a.z;
  vec3 jch = vec3(L / uCeShift.w, 15.932993652962535 * pow(L, 0.6523997524738018) * pow(M2, 0.6007557017508491) / uCeShift.w, atan(a.y, a.x));
  float B = jch.x * (pow(jch.y, CB_HK) + 1.0);
  return vec3(jch.z, B > 0.0 ? jch.y / B : 0.0, B);
}

float chromaOf(vec4 a) {
  return 15.932993652962535 * pow(a.z, 0.6523997524738018) * pow(dot(a.xy, a.xy), 0.6007557017508491) / uCeShift.w;
}

vec3 hsbToJch(vec3 h) {
  float C = h.y * h.z;
  return vec3(h.z / (pow(C, CB_HK) + 1.0), C, h.x);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  gMax = textureSize(uA, 0) - 1;
  if (uMode == 0) {
    // Gaussian moments of the guide UV: mean, and second moments.
    vec2 m = vec2(0.0);
    vec3 sec = vec3(0.0);
    for (int j = -uKhHalf; j <= uKhHalf; j++)
      for (int i = -uKhHalf; i <= uKhHalf; i++) {
        float w = uKh[i + uKhHalf] * uKh[j + uKhHalf];
        vec2 g = at(uA, p + ivec2(i, j)).xy;
        m += w * g;
        sec += w * vec3(g.x * g.x, g.x * g.y, g.y * g.y);
      }
    vec4 a;
    vec2 b;
    guided(m, sec, vec4(sec.x, sec.y, sec.y, sec.z), m, 1e-5, a, b);
    outColor = a;
    outColor2 = vec4(b, m);
  } else if (uMode == 2) {
    vec4 a = vec4(0.0);
    vec2 b = vec2(0.0);
    for (int j = -uKhHalf; j <= uKhHalf; j++)
      for (int i = -uKhHalf; i <= uKhHalf; i++) {
        float w = uKh[i + uKhHalf] * uKh[j + uKhHalf];
        a += w * at(uB, p + ivec2(i, j));
        b += w * at(uC, p + ivec2(i, j)).xy;
      }
    float sat = 0.0;
    for (int j = -uKsHalf; j <= uKsHalf; j++)
      for (int i = -uKsHalf; i <= uKsHalf; i++) sat += uKs[i + uKsHalf] * uKs[j + uKsHalf] * at(uA, p + ivec2(i, j)).w;
    // UV was blurred in place, so the filter applies to (and falls back on) its local mean.
    vec2 m = texelFetch(uC, p, 0).zw;
    vec2 c = vec2(a.x * m.x + a.y * m.y, a.z * m.x + a.w * m.y) + b;
    outColor = vec4(mix(m, c, satWeight(sat - uCeShift.x)), texelFetch(uA, p, 0).z, sat);
  } else if (uMode == 3) {
    vec4 here = texelFetch(uA, p, 0);
    vec3 hsb = hsbOf(here);
    // scharr_gradient of the blurred saturation, its neighbourhood moved inside the image.
    ivec2 q = clamp(p, ivec2(1), gMax - 1);
    float s00 = at(uA, q + ivec2(-1, -1)).w, s10 = at(uA, q + ivec2(0, -1)).w, s20 = at(uA, q + ivec2(1, -1)).w;
    float s01 = at(uA, q + ivec2(-1, 0)).w, s21 = at(uA, q + ivec2(1, 0)).w;
    float s02 = at(uA, q + ivec2(-1, 1)).w, s12 = at(uA, q + ivec2(0, 1)).w, s22 = at(uA, q + ivec2(1, 1)).w;
    float gx = 47.0 / 255.0 * (s00 - s20 + s02 - s22) + 162.0 / 255.0 * (s01 - s21);
    float gy = 47.0 / 255.0 * (s00 - s02 + s20 - s22) + 162.0 / 255.0 * (s10 - s12);
    float g = max(0.0, length(vec2(gx, gy)) - 0.02);
    float grad = uCeShift.z * g * g;
    vec3 corr = chromaOf(here) > 1.52587890625e-5 ? vec3(lut(0, hsb.x), lut(1, hsb.x), hsb.y * (lut(2, hsb.x) - 1.0)) : vec3(0.0, 1.0, 0.0);
    outColor = vec4(corr, grad);
  } else if (uMode == 4) {
    // Gaussian moments of the guide UV and its cross moments with the saturation and brightness corrections.
    vec2 m = vec2(0.0);
    vec3 sec = vec3(0.0);
    vec4 cross = vec4(0.0);
    float mh = 0.0;
    float ms = 0.0;
    for (int j = -uKpHalf; j <= uKpHalf; j++)
      for (int i = -uKpHalf; i <= uKpHalf; i++) {
        float w = uKp[i + uKpHalf] * uKp[j + uKpHalf];
        vec2 g = at(uA, p + ivec2(i, j)).xy;
        vec3 c = at(uB, p + ivec2(i, j)).xyz;
        m += w * g;
        sec += w * vec3(g.x * g.x, g.x * g.y, g.y * g.y);
        cross += w * vec4(g * c.y, g * c.z);
        mh += w * c.x;
        ms += w * c.y;
      }
    float mb = 0.0;
    for (int j = -uKbHalf; j <= uKbHalf; j++)
      for (int i = -uKbHalf; i <= uKbHalf; i++) mb += uKb[i + uKbHalf] * uKb[j + uKbHalf] * at(uB, p + ivec2(i, j)).z;
    vec4 a;
    vec2 b;
    guided(m, sec, cross, vec2(ms, mb), 1e-6, a, b);
    outColor = a;
    outColor2 = vec4(b, mh, 0.0);
  } else {
    vec4 a = vec4(0.0);
    vec2 b = vec2(0.0);
    vec2 m = vec2(0.0);
    for (int j = -uKpHalf; j <= uKpHalf; j++)
      for (int i = -uKpHalf; i <= uKpHalf; i++) {
        float w = uKp[i + uKpHalf] * uKp[j + uKpHalf];
        a += w * at(uC, p + ivec2(i, j));
        b += w * at(uD, p + ivec2(i, j)).xy;
        m += w * at(uA, p + ivec2(i, j)).xy;
      }
    float grad = 0.0;
    for (int j = -uKsHalf; j <= uKsHalf; j++)
      for (int i = -uKsHalf; i <= uKsHalf; i++) grad += uKs[i + uKsHalf] * uKs[j + uKsHalf] * at(uB, p + ivec2(i, j)).w;
    vec4 here = texelFetch(uA, p, 0);
    vec2 c = vec2(a.x * m.x + a.y * m.y, a.z * m.x + a.w * m.y) + b;
    float satC = 1.0 + (c.x - 1.0) * satWeight(here.w - uCeShift.x);
    float brC = c.y * (1.0 - clamp(grad, 0.0, 1.0)) * satWeight(here.w - uCeShift.y);
    vec3 hsb = hsbOf(here);
    hsb = vec3(hsb.x + texelFetch(uD, p, 0).z, max(0.0, hsb.y * (1.0 + 2.0 * (satC - 1.0))), max(0.0, hsb.z * (1.0 + 8.0 * brC)));
    // gamut_map_HSB
    vec3 jch = hsbToJch(hsb);
    float maxC = 15.932993652962535 * pow(jch.x * uCeShift.w, 0.6523997524738018) * pow(cbLookupGamut(jch.z), 0.6007557017508491) / uCeShift.w;
    float bB = jch.x * (pow(maxC, CB_HK) + 1.0);
    float bS = bB > 0.0 ? maxC / bB : 0.0;
    hsb.y = cbSoftClip(hsb.y, 0.8 * bS, bS);
    vec3 xyz = cbXyYToXyz(cbJCHToXyY(hsbToJch(hsb), uCeShift.w));
    outColor = vec4(uCbXyzToRgb * xyz, 1.0);
  }
}
