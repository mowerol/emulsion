#version 300 es
// Copyright (C) 2017-2024 darktable developers.
// Ported from darktable src/common/eaw.c (eaw_decompose_and_synthesize) at commit
// 20891f6c6fa7be995e5bf9dff9d1ee5062051773. Mirrors decompose() in src/engine/equalizer.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// One scale of the contrast equalizer's edge-avoiding à-trous wavelet on
// lightness (L*): uIn holds .r the image at this scale, .g the boosted detail
// so far and .b the starting lightness. Writes the next coarser image, the
// detail with this scale's boost added, and carries the start along. With
// uFirst, uIn is the lightness itself in .r.
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uIn;
uniform int uMult;
uniform float uBoost;
uniform float uSharpen;
uniform float uFirst;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 size = textureSize(uIn, 0) - 1;
  vec4 here = texelFetch(uIn, p, 0);
  float c = here.r;
  float f[5] = float[5](1.0, 4.0, 6.0, 4.0, 1.0);
  float sum = 0.0;
  float wgt = 0.0;
  for (int jj = 0; jj < 5; jj++)
    for (int ii = 0; ii < 5; ii++) {
      float v = texelFetch(uIn, clamp(p + uMult * ivec2(ii - 2, jj - 2), ivec2(0), size), 0).r;
      float w = f[ii] * f[jj] / 256.0 * exp(-uSharpen * (c - v) * (c - v));
      sum += w * v;
      wgt += w;
    }
  float coarse = sum / wgt;
  float accum = uFirst > 0.5 ? 0.0 : here.g;
  float start = uFirst > 0.5 ? c : here.b;
  outColor = vec4(coarse, accum + uBoost * (c - coarse), start, 1.0);
}
