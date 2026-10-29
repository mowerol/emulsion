#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// Highlight extraction at quarter resolution, feeding halation and glow.
// .rgb: highlights with their colour (glow source); .a: halation energy.
#include "common.glsl"
#include "stages/tone.glsl"
#include "stages/input.glsl"
#include "stages/exposure.glsl"
#include "stages/toneequalizer.glsl"
#include "stages/colorbalance.glsl"

uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uStore;
uniform float uHalThreshold;

void main() {
  vec3 g = vec3(0.0);
  float h = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2((i == 0 || i == 2) ? -1.0 : 1.0, i < 2 ? -1.0 : 1.0);
    vec2 uv = vUv + o * uTexel;
    vec3 x = stageColorBalance(stageToneEqualizer(stageExposure(stageInput(texture(uSrc, uv))), uv));
    float L = dot(x, LUMA_W);
    h += max(L - uHalThreshold, 0.0);
    g += x * smoothstep(0.35, 1.6, L);
  }
  outColor = vec4(g * 0.25, h * 0.25) * uStore;
}
