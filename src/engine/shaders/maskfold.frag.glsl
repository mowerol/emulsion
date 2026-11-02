#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// Folds one instance of Texture or Clarity into the stage's map of the change in lightness. Both
// change only Lab L, so each instance after the photo's, blended normally by its mask as
// darktable blends a masked instance, adds m · ΔL to the lightness: the map holds the sum.
//  uKind 0, Texture: uNew is the contrast equalizer's output, ΔL = .r + .g - .b, the mask in .a.
//  uKind 1, Clarity: uNew is the local laplacian's output, ΔL = .r; the mask is uMask's .a.
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

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float prev = uPrevOn > 0.5 ? texelFetch(uPrev, p, 0).r : 0.0;
  vec4 n = texelFetch(uNew, p, 0);
  float delta = uKind == 0 ? n.r + n.g - n.b : n.r;
  if (uCoarseOn > 0.5) delta += texture(uCoarse, uCoarseRoi.xy + vUv * uCoarseRoi.zw).r;
  float m = uWeighted < 0.5 ? 1.0 : uKind == 0 ? n.a : texelFetch(uMask, p, 0).a;
  outColor = vec4(prev + m * delta, 0.0, 0.0, 1.0);
}
