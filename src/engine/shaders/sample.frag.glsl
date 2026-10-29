#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// Average a small patch of the source in scene light, before white balance and
// the look: what the white balance eyedropper measures.
#include "common.glsl"
#include "stages/tone.glsl"
#include "stages/input.glsl"

uniform sampler2D uSrc;
uniform vec2 uAt;
uniform vec2 uTexel;

void main() {
  vec3 acc = vec3(0.0);
  for (int j = -2; j <= 2; j++)
    for (int i = -2; i <= 2; i++) acc += stageInput(texture(uSrc, uAt + vec2(i, j) * uTexel));
  outColor = vec4(acc / 25.0, 1.0);
}
