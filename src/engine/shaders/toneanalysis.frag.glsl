#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// A fixed lattice over the whole photo, before the HDR controls or creative looks.
uniform sampler2D uSrc;
#include "common.glsl"
#include "stages/tone.glsl"
#include "stages/input.glsl"
#include "stages/exposure.glsl"
#include "stages/dehaze.glsl"
uniform vec3 uTeqParams;

void main() {
  vec3 x = max(stageExposure(stageDehaze(stageInput(texture(uSrc, vUv)), vUv)), vec3(0.0));
  float ev = log2(max(uTeqParams.x * length(x), exp2(-16.0)));
  // Encoding permits the same deterministic fallback on GPUs without float render targets.
  outColor = vec4(clamp((ev + 16.0) / 24.0, 0.0, 1.0), 0.0, 0.0, 1.0);
}
