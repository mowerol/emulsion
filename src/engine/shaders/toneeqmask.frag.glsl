#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// Tone equalizer brightness map at quarter resolution, from the same scene light
// the develop pass sees after exposure (and the masks' exposure), or a masked instance's input. .r: mean brightness, .g: mean of its
// square, averaged over four taps; later halved and blurred into the filter's
// local mean and variance.
uniform sampler2D uSrc;

#include "common.glsl"
#include "stages/tone.glsl"
#include "stages/input.glsl"
#include "stages/exposure.glsl"
#include "stages/dehaze.glsl"
#include "stages/toneequalizer.glsl"
#include "stages/colorbalance.glsl"
#include "stages/optics.glsl"
#include "stages/masks.glsl"

uniform vec2 uTexel;

// The input at uv with haze removed (these passes have no scanner sharpness).
vec3 stageDehazed(vec2 uv) {
  return stageDehaze(stageInput(texture(uSrc, uv)), uv);
}

void main() {
  vec2 acc = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2((i == 0 || i == 2) ? -1.0 : 1.0, i < 2 ? -1.0 : 1.0);
    vec2 uv = vUv + o * uTexel;
    computeMasks(uv, vec2(textureSize(uSrc, 0)));
    vec3 x = stageMaskExposure(stageExposure(stageDehazed(uv)));
    // A masked instance's map is made from its own input: after the photo's instance and the
    // earlier masked ones (the engine turns the later ones off, and the photo's for its own map).
    x = stageMaskToneEqualizer(stageToneEqualizer(x, uv), uv);
    float l = teqLuminance(x);
    acc += vec2(l, l * l);
  }
  outColor = vec4(acc * 0.25, 0.0, 1.0);
}
