#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// An AI object's 8-bit pixels resampled into a mask stack layer, into the channel the colour
// mask leaves open (ObjectGpu).
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
void main() {
  outColor = vec4(texture(uTex, vUv).r);
}
