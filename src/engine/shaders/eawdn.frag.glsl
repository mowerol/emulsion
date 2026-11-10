#version 300 es
// Copyright (C) 2010-2024 darktable developers.
// SPDX-License-Identifier: GPL-3.0-or-later
// denoise (profiled), wavelets, Y0U0V0: darktable's src/iop/denoiseprofile.c process_wavelets
// with src/common/eaw.c eaw_dn_decompose / eaw_synthesize at
// 20891f6c6fa7be995e5bf9dff9d1ee5062051773. TypeScript twin: engine/denoiseprofile.ts.
//
// One step per draw (uMode), all images RGBA32F read with texelFetch:
//  0 precondition: the working-space source (uIn) to darktable's domain, then
//    precondition_Y0U0V0
//  1 decompose one scale: the edge-avoiding B3-spline blur of uIn with taps uMult apart
//  2 the sums of the squared detail (uIn - uCoarse) over 8 × 8 blocks
//  3 the sums of uIn over 8 × 8 blocks (repeated down to one texel)
//  4 synthesize: uAcc (none on the first scale) plus the detail soft-thresholded by BayesShrink
//    from the sums in uSum
//  5 the accumulated detail (uAcc; none when there were no scales) plus the residue (uCoarse),
//    backtransformed and returned to the working space
//  6 a copy of uIn (an image too small for its coarsest band)
//  7 uIn reduced by uMult: the mean of each uMult × uMult block (a live drag's smaller copy)
//  8 uIn scaled up to the target, bilinear
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;

uniform int uMode;
uniform sampler2D uIn;
uniform sampler2D uCoarse;
uniform sampler2D uAcc;
uniform sampler2D uSum;
uniform mat3 uToDt;    // working Rec.2020 to darktable's camera RGB
uniform mat3 uFromDt;
uniform mat3 uToY;     // forward Y0U0V0, divided by strength · 2.5 · inScale
uniform mat3 uToRgb;
uniform vec3 uP;       // VST exponent per channel
uniform float uA;      // a[1] · compensate_p
uniform float uB;      // b[1]
uniform vec3 uBiasWb;
uniform int uMult;     // 2^scale
uniform float uInvSigma2;
uniform float uSb2;    // sigma_band²
uniform vec2 uAdjt;    // Y0 and U0V0 threshold factors
uniform float uPixels;
uniform int uFirst;
uniform ivec2 uOffset; // a tile's origin in the whole image (modes 0 and 5)
uniform int uEncode;   // the domain is the sRGB encoding of the (linear) working values

vec3 oetf(vec3 v) {
  v = max(v, 0.0);
  return mix(v * 12.92, 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), v));
}
vec3 eotf(vec3 v) {
  v = max(v, 0.0);
  return mix(v / 12.92, pow((v + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), v));
}

vec4 at(sampler2D t, ivec2 p) {
  ivec2 s = textureSize(t, 0);
  return texelFetch(t, clamp(p, ivec2(0), s - 1), 0);
}

// src/common/math.h fast_mexp2f (the bit trick darktable keeps for compatibility).
float fastMexp2f(float x) {
  float k0 = 1065353216.0 + x * (1056964608.0 - 1065353216.0);
  return k0 >= 8388608.0 ? intBitsToFloat(int(k0)) : 0.0;
}

// The B3 spline's 1D taps; FILTER[jj][ii] = h[jj] · h[ii].
const float H[5] = float[5](1.0 / 16.0, 4.0 / 16.0, 6.0 / 16.0, 4.0 / 16.0, 1.0 / 16.0);

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (uMode == 0) {
    vec3 rgb = uToDt * texelFetch(uIn, p + uOffset, 0).rgb;
    if (uEncode == 1) rgb = oetf(rgb);
    vec3 x = max(rgb + uB, 0.0);
    vec3 e = 1.0 - uP / 2.0;
    vec3 t = vec3(x.r > 0.0 ? pow(x.r, e.r) : 0.0, x.g > 0.0 ? pow(x.g, e.g) : 0.0, x.b > 0.0 ? pow(x.b, e.b) : 0.0)
      * (2.0 / ((2.0 - uP) * sqrt(uA)));
    outColor = vec4(uToY * t, 0.0);
  } else if (uMode == 1) {
    vec3 c = texelFetch(uIn, p, 0).rgb;
    vec3 sum = vec3(0.0);
    float wgt = 0.0;
    for (int jj = 0; jj < 5; jj++) for (int ii = 0; ii < 5; ii++) {
      vec3 q = at(uIn, p + uMult * ivec2(ii - 2, jj - 2)).rgb;
      vec3 d = c - q;
      float w = H[jj] * H[ii] * fastMexp2f(max(0.0, dot(d, d) * uInvSigma2 * 0.02 - 9.0));
      wgt += w;
      sum += w * q;
    }
    outColor = vec4(sum / wgt, 0.0);
  } else if (uMode == 2 || uMode == 3) {
    ivec2 s = textureSize(uIn, 0), o = p * 8;
    vec3 sum = vec3(0.0);
    for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) {
      ivec2 q = o + ivec2(x, y);
      if (q.x >= s.x || q.y >= s.y) continue;
      vec3 v = texelFetch(uIn, q, 0).rgb;
      if (uMode == 2) { v -= texelFetch(uCoarse, q, 0).rgb; v *= v; }
      sum += v;
    }
    outColor = vec4(sum, 0.0);
  } else if (uMode == 4) {
    vec3 detail = texelFetch(uIn, p, 0).rgb - texelFetch(uCoarse, p, 0).rgb;
    vec3 varY = texelFetch(uSum, ivec2(0), 0).rgb / (uPixels - 1.0);
    vec3 stdX = sqrt(max(vec3(1e-6), varY - uSb2));
    vec3 thr = vec3(uAdjt.x, uAdjt.y, uAdjt.y) * uSb2 / stdX;
    vec3 acc = uFirst == 1 ? vec3(0.0) : texelFetch(uAcc, p, 0).rgb;
    outColor = vec4(acc + max(detail - thr, 0.0) + min(detail + thr, 0.0), 0.0);
  } else if (uMode == 7) {
    ivec2 sz = textureSize(uIn, 0);
    vec3 sum = vec3(0.0);
    float n = 0.0;
    for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
      ivec2 q = p * uMult + ivec2(x, y);
      if (x >= uMult || y >= uMult || q.x >= sz.x || q.y >= sz.y) continue;
      sum += texelFetch(uIn, q, 0).rgb;
      n += 1.0;
    }
    outColor = vec4(sum / n, 1.0);
  } else if (uMode == 8) {
    outColor = vec4(texture(uIn, vUv).rgb, 1.0);
  } else if (uMode == 6) {
    outColor = vec4(texelFetch(uIn, p, 0).rgb, 1.0);
  } else {
    ivec2 q = p - uOffset;
    vec3 yuv = (uFirst == 1 ? vec3(0.0) : texelFetch(uAcc, q, 0).rgb) + texelFetch(uCoarse, q, 0).rgb;
    vec3 x = max(uToRgb * yuv, 0.0);
    vec3 z = (x + sqrt(max(x * x + uBiasWb, 0.0))) * (sqrt(uA) * (2.0 - uP) / 4.0);
    vec3 e = 1.0 / (1.0 - uP / 2.0);
    vec3 back = vec3(z.r > 0.0 ? pow(z.r, e.r) : 0.0, z.g > 0.0 ? pow(z.g, e.g) : 0.0, z.b > 0.0 ? pow(z.b, e.b) : 0.0) - uB;
    if (uEncode == 1) back = eotf(back);
    outColor = vec4(uFromDt * back, 1.0);
  }
}
