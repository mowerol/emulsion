#version 300 es
// Copyright (C) 2016-2026 darktable developers.
// Ported from darktable common/locallaplacian.c full-pipe coarse boundary sampling at
// 20891f6c6fa7be995e5bf9dff9d1ee5062051773. Integer-index bilinear sampling of reconstructed
// output levels, followed by interpolation between their footprints. The region's padded
// halo supplies the fine levels. See clarityBoundary() in locallaplacian.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
precision highp float;
precision highp int;
out vec4 outColor;
uniform sampler2D uLow;
uniform sampler2D uHigh;
uniform sampler2D uBase;
uniform vec4 uBoundary; // origin in preview pixels, preview pixels per region coarse pixel
uniform vec3 uLevels; // low level, high level, fractional weight
uniform vec2 uModes; // 0: reconstructed .r, 1: top Gaussian .b, 2: finest delta + input .b
float sampleLevel(sampler2D image, vec2 p, float mode, float level) {
  vec2 q = p / exp2(level);
  ivec2 size = textureSize(image, 0), a = ivec2(floor(q));
  ivec2 p00 = clamp(a, ivec2(0), size - 1), p10 = clamp(a + ivec2(1, 0), ivec2(0), size - 1);
  ivec2 p01 = clamp(a + ivec2(0, 1), ivec2(0), size - 1), p11 = clamp(a + ivec2(1), ivec2(0), size - 1);
  vec2 t = fract(q);
  vec4 value = mix(mix(texelFetch(image, p00, 0), texelFetch(image, p10, 0), t.x), mix(texelFetch(image, p01, 0), texelFetch(image, p11, 0), t.x), t.y);
  float base = 0.0;
  if (mode > 1.5) base = mix(mix(texelFetch(uBase, p00, 0).b, texelFetch(uBase, p10, 0).b, t.x), mix(texelFetch(uBase, p01, 0).b, texelFetch(uBase, p11, 0).b, t.x), t.y);
  return mode > 1.5 ? value.r + base : mode > 0.5 ? value.b : value.r;
}
void main() {
  vec2 p = uBoundary.xy + floor(gl_FragCoord.xy) * uBoundary.zw;
  float a = sampleLevel(uLow, p, uModes.x, uLevels.x);
  float b = sampleLevel(uHigh, p, uModes.y, uLevels.y);
  outColor = vec4(mix(a, b, uLevels.z), 0.0, 0.0, 1.0);
}
