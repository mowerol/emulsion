#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// The dark channel is independent of the dehaze sliders, so calculate it once
// into a source-sized map instead of recalculating it for every output pixel.
uniform sampler2D uSrc;

#include "common.glsl"
#include "stages/tone.glsl"
#include "stages/input.glsl"

void main() {
  vec2 texel = 1.0 / vec2(textureSize(uSrc, 0));
  float dark = 1.0;
  for (int y = -4; y <= 4; y++) {
    for (int x = -4; x <= 4; x++) {
      vec3 c = max(stageInput(texture(uSrc, clamp(vUv + vec2(x, y) * texel, 0.0, 1.0))), vec3(0.0));
      dark = min(dark, min(c.r, min(c.g, c.b)));
    }
  }
  outColor = vec4(dark, dark, dark, 1.0);
}
