#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// The integrated film (src/engine/filmgrain.ts exactShare): for each block of the baked film's
// texels, the share covered at one value (a knot, uNeed its 16-bit level). The first level counts
// the 8 × 8 texels of the tile (filmgrain-bake.frag.glsl) whose thresholds it reaches; each level
// after averages 2 × 2 blocks of the one before, layer uLayer.
precision highp float;
precision highp int;
out vec4 outColor;
uniform highp usampler2D uTile;
uniform highp sampler2DArray uPrev;
uniform int uFromTile;
uniform uint uNeed;
uniform int uLayer;
void main() {
  ivec2 b = ivec2(floor(gl_FragCoord.xy));
  if (uFromTile == 1) {
    int n = 0;
    for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) {
      uint level = texelFetch(uTile, b * 8 + ivec2(x, y), 0).r;
      if (level > 0u && level <= uNeed) n++;
    }
    outColor = vec4(float(n) / 64.0, 0.0, 0.0, 1.0);
    return;
  }
  float s = 0.0;
  for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) s += texelFetch(uPrev, ivec3(b * 2 + ivec2(x, y), uLayer), 0).r;
  outColor = vec4(0.25 * s, 0.0, 0.0, 1.0);
}
