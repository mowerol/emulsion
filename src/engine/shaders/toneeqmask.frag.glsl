#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// Tone equalizer brightness map at quarter resolution, from the same scene light
// the develop pass sees after exposure. .r: mean brightness, .g: mean of its
// square, averaged over four taps; later halved and blurred into the filter's
// local mean and variance.
#include "common.glsl"
#include "stages/tone.glsl"
#include "stages/input.glsl"
#include "stages/exposure.glsl"
#include "stages/toneequalizer.glsl"

uniform sampler2D uSrc;
uniform vec2 uTexel;

void main() {
  vec2 acc = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2((i == 0 || i == 2) ? -1.0 : 1.0, i < 2 ? -1.0 : 1.0);
    float l = teqLuminance(stageExposure(stageInput(texture(uSrc, vUv + o * uTexel))));
    acc += vec2(l, l * l);
  }
  outColor = vec4(acc * 0.25, 0.0, 1.0);
}
