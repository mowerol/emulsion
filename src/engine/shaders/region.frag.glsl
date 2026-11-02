#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// A rectangle of a texture copied exactly, texel for texel: the region of a full-size source the
// view develops (docs/plans/roi.md). uOffset is the rectangle's corner in the input's texels.
precision highp float;
out vec4 outColor;
uniform sampler2D uTex;
uniform ivec2 uOffset;
void main() {
  outColor = texelFetch(uTex, ivec2(gl_FragCoord.xy) + uOffset, 0);
}
