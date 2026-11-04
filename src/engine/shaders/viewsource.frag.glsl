#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// Effect analysis from the sharp region's mip pyramid. The final image keeps the sharp input.
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
void main() {
  outColor = texture(uTex, vUv);
}
