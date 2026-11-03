#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
//
// A reconstructed output level of the clarity filter, kept for region views (llboundary.frag),
// as its change from the input's own Gaussian level (.r) beside that level (.b). The change is
// proportional to the amount on each side of zero (clarityScale in locallaplacian.ts), so a level
// kept at one amount serves another: input + scale * change (scaleLevel).
precision highp float;
out vec4 outColor;
uniform sampler2D uOut;
uniform sampler2D uCarry;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float g = texelFetch(uCarry, p, 0).b;
  outColor = vec4(texelFetch(uOut, p, 0).r - g, 0.0, g, 1.0);
}
