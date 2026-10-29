#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// Four-tap box downsample.
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uTexel;
void main() {
  outColor = 0.25 * (texture(uTex, vUv + vec2(-1.0, -1.0) * uTexel) + texture(uTex, vUv + vec2(1.0, -1.0) * uTexel)
                   + texture(uTex, vUv + vec2(-1.0, 1.0) * uTexel) + texture(uTex, vUv + vec2(1.0, 1.0) * uTexel));
}
