#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// Folds one instance of Texture or Clarity into the stage's map of the change in lightness. Both
// change only Lab L, so each instance after the photo's, blended normally by its mask as
// darktable blends a masked instance, adds m · ΔL to the lightness: the map holds the sum.
//  uKind 0, Texture: uNew is the contrast equalizer's output, ΔL = mix·.g + mix²·.b at the
//  instance's amount uMix (equalizer.ts equalizeParts), the mask in .a; the preview's coarse
//  change (uCoarse, region lane) is split the same way in .r and .g.
//  uKind 1, Clarity: uNew is the local laplacian's output, ΔL = .r; the mask is uMask's .a.
//  uKind 2, a live drag's stand-in on the region lane: uNew is the preview's finished map of the
//  change (every instance folded), read at the region's place (uCoarseRoi) and scaled by uMix.
// Without uWeighted (the photo's own instance) the mask is 1; without uPrevOn the sum starts at 0.
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uPrev;
uniform sampler2D uNew;
uniform sampler2D uMask;
uniform float uPrevOn;
uniform float uWeighted;
uniform int uKind;
uniform sampler2D uCoarse;
uniform float uCoarseOn;
uniform vec4 uCoarseRoi;
uniform float uMix;

// Bilinear, as texture() with LINEAR and clamp to edge, from four texelFetch: ANGLE on Metal
// filtered the 32-bit maps ~30× slower than the half-float ones (11 against 0.3 ms over a region),
// and these weights are exact rather than the filter's 8-bit fractions.
vec4 bilinear(sampler2D t, vec2 uv) {
  ivec2 size = textureSize(t, 0);
  vec2 q = uv * vec2(size) - 0.5;
  ivec2 a = ivec2(floor(q));
  vec2 f = q - floor(q);
  ivec2 hi = size - 1;
  vec4 v00 = texelFetch(t, clamp(a, ivec2(0), hi), 0), v10 = texelFetch(t, clamp(a + ivec2(1, 0), ivec2(0), hi), 0);
  vec4 v01 = texelFetch(t, clamp(a + ivec2(0, 1), ivec2(0), hi), 0), v11 = texelFetch(t, clamp(a + ivec2(1), ivec2(0), hi), 0);
  return mix(mix(v00, v10, f.x), mix(v01, v11, f.x), f.y);
}

void main() {
  if (uKind == 2) {
    outColor = vec4(uMix * bilinear(uNew, uCoarseRoi.xy + vUv * uCoarseRoi.zw).r, 0.0, 0.0, 1.0);
    return;
  }
  ivec2 p = ivec2(gl_FragCoord.xy);
  float prev = uPrevOn > 0.5 ? texelFetch(uPrev, p, 0).r : 0.0;
  vec4 n = texelFetch(uNew, p, 0);
  vec2 byMix = vec2(uMix, uMix * uMix);
  float delta = uKind == 0 ? dot(byMix, n.gb) : n.r;
  if (uCoarseOn > 0.5) delta += dot(byMix, bilinear(uCoarse, uCoarseRoi.xy + vUv * uCoarseRoi.zw).rg);
  float m = uWeighted < 0.5 ? 1.0 : uKind == 0 ? n.a : texelFetch(uMask, p, 0).a;
  outColor = vec4(prev + m * delta, 0.0, 0.0, 1.0);
}
