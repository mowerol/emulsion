#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// Separable Gaussian, 9 taps folded into 5 bilinear fetches.
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uDir;
void main() {
  vec4 c = texture(uTex, vUv) * 0.2270270270;
  c += texture(uTex, vUv + uDir * 1.3846153846) * 0.3162162162;
  c += texture(uTex, vUv - uDir * 1.3846153846) * 0.3162162162;
  c += texture(uTex, vUv + uDir * 3.2307692308) * 0.0702702703;
  c += texture(uTex, vUv - uDir * 3.2307692308) * 0.0702702703;
  outColor = c;
}
