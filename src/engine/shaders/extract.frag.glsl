#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// Highlight extraction at quarter resolution, feeding halation and glow.
// .rgb: highlights with their colour (glow source); .a: halation energy.
uniform sampler2D uSrc;

#include "common.glsl"
#include "stages/tone.glsl"
#include "stages/input.glsl"
#include "stages/exposure.glsl"
#include "stages/dehaze.glsl"
#include "stages/toneequalizer.glsl"
#include "stages/colorbalance.glsl"
#include "stages/masks.glsl"

uniform vec2 uTexel;

// The input at uv with haze removed (these passes have no scanner sharpness).
vec3 stageDehazed(vec2 uv) {
  return stageDehaze(stageInput(texture(uSrc, uv)), uv);
}
uniform float uStore;
uniform float uHalThreshold;

void main() {
  vec3 g = vec3(0.0);
  float h = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2((i == 0 || i == 2) ? -1.0 : 1.0, i < 2 ? -1.0 : 1.0);
    vec2 uv = vUv + o * uTexel;
    computeMasks(uv, vec2(textureSize(uSrc, 0)));
    vec3 x = stageMaskColorBalance(stageColorBalance(stageMaskToneEqualizer(stageToneEqualizer(stageMaskExposure(stageExposure(stageDehazed(uv))), uv), uv)));
    float L = dot(x, LUMA_W);
    h += max(L - uHalThreshold, 0.0);
    g += x * smoothstep(0.35, 1.6, L);
  }
  outColor = vec4(g * 0.25, h * 0.25) * uStore;
}
