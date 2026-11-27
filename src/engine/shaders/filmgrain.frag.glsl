#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// Film grain's grid (src/engine/filmgrain.ts renderFilmGrain): whether each grid point lies in a
// grain, read from the baked film (filmgrain-bake.frag.glsl): in a grain when the film's coverage
// under the shown value there (filmgrain-print.glsl) reaches the 16-bit threshold of the texel under it. Texel (c, j) of the
// target packs the uK points of grid row j in output column c, bit i (r: bits 0-7, g: 8-15) for the
// point at output position ((uGridOrigin.x + c uK + i + 0.5) / uK, (uGridOrigin.y + j + 0.5) / uK),
// in output pixels of the view; they share one shown pixel. A point's place on the film is in the
// uncropped frame's full-resolution pixels, in radii, each FILM_BLOCK-radius block of the frame at
// its own place on the tile (filmgrain.ts blockOffset).
precision highp float;
precision highp int;
out vec4 outColor;
// The developed frame (display-encoded RGB) at output pixels -uMargin .. uSize + uMargin - 1.
uniform sampler2D uShown;
uniform int uMargin;
uniform vec2 uSize;
// The part of the frame the output shows (offset xy, size zw).
uniform vec4 uView;
// A frame point's place on the whole source (develop.frag's uGeo).
uniform vec3 uGeoU;
uniform vec3 uGeoV;
uniform vec3 uGeoW;
// The whole source's full-resolution size: frame pixels across it.
uniform vec2 uFull;
uniform float uK;
uniform vec2 uGridOrigin;
// The baked film: uSide × uSide texels of uTexel radii (uCells cells of uPerCell texels), grains
// of uRadius frame pixels; the photo's seed places its blocks of uBlock radii.
uniform highp usampler2D uTile;
uniform int uSide;
uniform float uTexel;
uniform uint uCells;
uniform uint uPerCell;
uniform float uRadius;
uniform float uBlock;
uniform uint uSeed;
// Lookups shifted by this share of a texel, off the texel edges grid points can fall on.
uniform float uPhase;

#include "filmgrain-print.glsl"

uint hashU(uint s) {
  s = (s ^ 61u) ^ (s >> 16u);
  s *= 9u;
  s = s ^ (s >> 4u);
  s *= 668265261u;
  return s ^ (s >> 15u);
}
// A block's place on the tile (filmgrain.ts blockOffset), in texels.
ivec2 blockOffset(ivec2 b) {
  uint a = hashU((uint(b.x) * 73856093u) ^ (uint(b.y) * 19349663u) ^ (uSeed * 83492791u));
  uint c = hashU(a ^ 0x9e3779b9u);
  return ivec2(int((a % uCells) * uPerCell), int((c % uCells) * uPerCell));
}

void main() {
  ivec2 cj = ivec2(floor(gl_FragCoord.xy));
  int k = int(uK + 0.5);
  float y = (uGridOrigin.y + float(cj.y) + 0.5) / uK;
  float xFirst = uGridOrigin.x + float(cj.x * k);
  // The film's coverage under the row's shown pixel (the frame's edge beyond it).
  vec2 fc = uView.xy + vec2((xFirst + 0.5) / uK, y) / uSize * uView.zw;
  vec2 inFrame = (clamp(fc, 0.0, 1.0) - uView.xy) / uView.zw * uSize;
  ivec2 e = clamp(ivec2(floor(inFrame)) + uMargin, ivec2(0), textureSize(uShown, 0) - 1);
  vec3 d = texelFetch(uShown, e, 0).rgb;
  float cov = coverageFor(0.2126 * d.r + 0.7152 * d.g + 0.0722 * d.b);
  int bits = 0;
  // The row's points nearly always share a block: its place is hashed again only when it changes.
  ivec2 block = ivec2(-2147483647), offset = ivec2(0);
  for (int i = 0; i < k; i++) {
    vec2 f = uView.xy + vec2((xFirst + float(i) + 0.5) / uK, y) / uSize * uView.zw;
    vec3 h = vec3(f, 1.0);
    vec2 q = vec2(dot(uGeoU, h), dot(uGeoV, h)) / dot(uGeoW, h) * uFull / uRadius;
    ivec2 b = ivec2(floor(q / uBlock));
    if (b != block) { block = b; offset = blockOffset(b); }
    ivec2 t = ivec2(floor(q / uTexel + uPhase)) + offset;
    t -= uSide * ivec2(floor(vec2(t) / float(uSide)));
    uint level = texelFetch(uTile, t, 0).r;
    if (level > 0u && cov >= float(level) / 65535.0) bits |= 1 << i;
  }
  outColor = vec4(float(bits & 255) / 255.0, float(bits >> 8) / 255.0, 0.0, 1.0);
}
