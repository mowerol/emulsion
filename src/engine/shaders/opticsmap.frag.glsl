#version 300 es
// Copyright (C) 2026 darktable developers.
// Ported from spektrafilm_diffusion_accum/_mix and spektrafilm_halation_apply in
// data/kernels/spektrafilm.cl at c96cf1d0de8fff468e9eddee28621e91f83bdf1a.
// Approved deviations (Oli, 2026-11-10): working RGB and Gaussian pyramid (see optics.ts).
// SPDX-License-Identifier: GPL-3.0-or-later
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSource;
uniform sampler2D uOther;
uniform int uKind; // 0 blur, 1 bank accumulation, 2 diffusion mix
uniform vec2 uDir;
uniform float uWeights[20];
uniform int uRadius;
uniform vec3 uWeight;
uniform float uReset;
uniform float uFraction;
void main() {
  if (uKind == 0) {
    vec3 c = texture(uSource, vUv).rgb * uWeights[0];
    for (int k = 1; k <= uRadius; k++)
      c += (texture(uSource, vUv + uDir * float(k)).rgb + texture(uSource, vUv - uDir * float(k)).rgb) * uWeights[k];
    outColor = vec4(c, 1.0);
  } else if (uKind == 1) {
    vec3 c = texture(uSource, vUv).rgb * uWeight;
    if (uReset < 0.5) c += texture(uOther, vUv).rgb;
    outColor = vec4(c, 1.0);
  } else {
    outColor = vec4((1.0 - uFraction) * texture(uSource, vUv).rgb + uFraction * texture(uOther, vUv).rgb, 1.0);
  }
}
