#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// Haze removal's input: the scene-linear Rec.2020 input of every pixel (darktable runs haze
// removal right after lens correction, before exposure). Drawn at the source's size for the
// filter passes (dehazegf.frag.glsl), and at a small size, read back, for the ambient light.
uniform sampler2D uSrc;

#include "common.glsl"
#include "stages/tone.glsl"
#include "stages/input.glsl"

void main() {
  outColor = vec4(stageInput(texture(uSrc, vUv)), 1.0);
}
