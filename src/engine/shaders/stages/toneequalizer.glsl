// Copyright (C) 2018-2026 darktable developers.
// Copyright (C) 2019-2024 darktable developers (exposure-independent guided filter).
// Copyright (C) 2019-2023 darktable developers (luminance mask).
// Ported from darktable src/iop/toneequal.c, src/common/eigf.h and src/common/luminance_mask.h
// at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2). Translated from C to GLSL;
// the euclidean RGB norm and the exposure-independent guided filter without quantization or
// contrast boost, one iteration; the filter's averages come from a small blurred map
// (uTeqTex) made by toneeqmask.frag.glsl and the engine's blur. Mirrors
// src/engine/toneequalizer.ts, which solves the band factors.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Tone equalizer, in scene light: exposure by brightness band through an
// edge-aware brightness map, for the Shadows and Highlights sliders.

// 1 when Shadows or Highlights is set.
uniform float uTeqOn;
// 1 to use the blurred map (edge-aware); 0 for a plain per-pixel correction.
uniform float uTeqLocal;
// Blurred map: .r mean brightness, .g mean of brightness squared.
uniform sampler2D uTeqTex;
// Weights of the 8 band Gaussians.
uniform vec4 uTeqF0;
uniform vec4 uTeqF1;
// x: exposure boost, y: feathering, z: 2 sigma^2 of the band Gaussians
uniform vec3 uTeqParams;

const float TEQ_MIN_FLOAT = 1.52587890625e-05; // 2^-16

// Brightness map value: euclidean RGB norm with the exposure boost.
float teqLuminance(vec3 x) { return max(uTeqParams.x * length(x), TEQ_MIN_FLOAT); }

float teqCorrection(float lum) {
  float ev = clamp(log2(lum), -8.0, 0.0);
  float r = 0.0;
  for (int i = 0; i < 8; i++) {
    float d = ev - float(-56 + 8 * i) / 7.0;
    float w = i < 4 ? uTeqF0[i] : uTeqF1[i - 4];
    r += exp(-d * d / uTeqParams.z) * w;
  }
  return clamp(r, 0.25, 4.0);
}

vec3 stageToneEqualizer(vec3 x, vec2 uv) {
  if (uTeqOn < 0.5) return x;
  float lum = teqLuminance(x);
  if (uTeqLocal > 0.5) {
    vec2 m = texture(uTeqTex, uv).rg;
    float avg = m.x;
    float nv = max(m.y - avg * avg, 0.0) / max(avg * lum, 1e-6);
    float a = nv / (nv + uTeqParams.y);
    lum = max(lum * a + (avg - a * avg), TEQ_MIN_FLOAT);
  }
  return x * teqCorrection(lum);
}
