#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// Film grain onto the developed frame: the model's render replaces the shown luma (the grain's
// change, filmgrain-blur's mode 1, its softening and grain each times its share of Amount, added to
// each channel), keeping the colour; left of uSplit
// the original shows without it.
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uShown;
uniform int uMargin;
uniform vec2 uSize;
uniform sampler2D uDelta;
uniform float uDeltaOn;
// Amount (filmgrain.ts filmAmounts): how much of the softening (.r) and the grain (.g) is added.
uniform float uSoft;
uniform float uGrain;
uniform float uSplit;
void main() {
  ivec2 p = clamp(ivec2(floor(vUv * uSize)), ivec2(0), ivec2(uSize) - 1);
  vec3 d = texelFetch(uShown, p + uMargin, 0).rgb;
  if (uDeltaOn > 0.5 && vUv.x >= uSplit) { vec2 c = texture(uDelta, vUv).rg; d += uSoft * c.r + uGrain * c.g; }
  outColor = vec4(clamp(d, 0.0, 1.0), 1.0);
}
