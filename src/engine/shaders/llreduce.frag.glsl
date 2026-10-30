#version 300 es
// Copyright (C) 2016-2026 darktable developers.
// Ported from darktable src/common/locallaplacian.c (gauss_reduce) at commit
// 20891f6c6fa7be995e5bf9dff9d1ee5062051773, with borders clamped to the edge.
// Mirrors reduce() in src/engine/locallaplacian.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// One level down a Gaussian pyramid: the 5x5 binomial blur at every other pixel.
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uFine;

void main() {
  ivec2 size = textureSize(uFine, 0) - 1;
  ivec2 c = 2 * ivec2(gl_FragCoord.xy);
  float k[5] = float[5](1.0, 4.0, 6.0, 4.0, 1.0);
  vec4 s = vec4(0.0);
  for (int dj = -2; dj <= 2; dj++)
    for (int di = -2; di <= 2; di++)
      s += k[di + 2] * k[dj + 2] * texelFetch(uFine, clamp(c + ivec2(di, dj), ivec2(0), size), 0);
  outColor = s / 256.0;
}
