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
// Blurred maps: .r mean brightness, .g mean of brightness squared. An atlas of uTeqTiles maps
// side by side: tile 0 the photo's instance, then the masked instances' (masks.glsl).
uniform sampler2D uTeqTex;
uniform float uTeqTiles;
// Weights of the 8 band Gaussians.
uniform vec4 uTeqF0;
uniform vec4 uTeqF1;
// x: exposure boost, y: feathering, z: 2 sigma^2 of the band Gaussians
uniform vec3 uTeqParams;

const float TEQ_MIN_FLOAT = 1.52587890625e-05; // 2^-16

// Brightness map value: euclidean RGB norm with the exposure boost.
float teqLuminance(vec3 x) { return max(uTeqParams.x * length(x), TEQ_MIN_FLOAT); }

float teqCorrection(float lum, vec4 f0, vec4 f1) {
  float ev = clamp(log2(lum), -8.0, 0.0);
  float r = 0.0;
  for (int i = 0; i < 8; i++) {
    float d = ev - float(-56 + 8 * i) / 7.0;
    float w = i < 4 ? f0[i] : f1[i - 4];
    r += exp(-d * d / uTeqParams.z) * w;
  }
  return clamp(r, 0.25, 4.0);
}

// The instance's gain for x at uv, its map in atlas tile `tile` (EIGF, then the bands).
float teqGain(vec3 x, vec2 uv, float tile, vec4 f0, vec4 f1) {
  float lum = teqLuminance(x);
  if (uTeqLocal > 0.5) {
    float tiles = max(uTeqTiles, 1.0);
    float inset = 0.5 * tiles / float(textureSize(uTeqTex, 0).x);
    vec2 m = texture(uTeqTex, vec2((tile + clamp(uv.x, inset, 1.0 - inset)) / tiles, uv.y)).rg;
    float avg = m.x;
    float nv = max(m.y - avg * avg, 0.0) / max(avg * lum, 1e-6);
    float a = nv / (nv + uTeqParams.y);
    lum = max(lum * a + (avg - a * avg), TEQ_MIN_FLOAT);
  }
  return teqCorrection(lum, f0, f1);
}

vec3 stageToneEqualizer(vec3 x, vec2 uv) {
  if (uTeqOn < 0.5) return x;
  return x * teqGain(x, uv, 0.0, uTeqF0, uTeqF1);
}
