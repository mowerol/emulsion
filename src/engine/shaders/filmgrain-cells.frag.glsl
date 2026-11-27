#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// Film grain's grid for grains far smaller than a pixel (src/engine/filmgrain.ts renderFilmGrain,
// its integrated plan): texel (i, j) is the cell at output position (uGridOrigin + (i, j) + 0.5) /
// uK, holding the share of its film covered at the film's coverage under the shown value there
// (filmgrain-print.glsl): read from the integrated film (filmgrain-pyramid.frag.glsl) at level
// uLevel, its blocks bilinearly, its knots linearly.
precision highp float;
precision highp int;
out vec4 outColor;
uniform sampler2D uShown;
uniform int uMargin;
uniform vec2 uSize;
uniform vec4 uView;
uniform vec3 uGeoU;
uniform vec3 uGeoV;
uniform vec3 uGeoW;
uniform vec2 uFull;
uniform float uK;
uniform vec2 uGridOrigin;
uniform highp sampler2DArray uPyr;
uniform int uLevel;
uniform int uKnots;
uniform int uSide;
uniform float uTexel;
uniform uint uCells;
uniform uint uPerCell;
uniform float uRadius;
uniform float uBlock;
uniform uint uSeed;

#include "filmgrain-print.glsl"

uint hashU(uint s) {
  s = (s ^ 61u) ^ (s >> 16u);
  s *= 9u;
  s = s ^ (s >> 4u);
  s *= 668265261u;
  return s ^ (s >> 15u);
}
ivec2 blockOffset(ivec2 b) {
  uint a = hashU((uint(b.x) * 73856093u) ^ (uint(b.y) * 19349663u) ^ (uSeed * 83492791u));
  uint c = hashU(a ^ 0x9e3779b9u);
  return ivec2(int((a % uCells) * uPerCell), int((c % uCells) * uPerCell));
}
const float PI = 3.14159265358979;
float knot(int j) { return 0.5 * (1.0 - cos(PI * float(j) / float(uKnots - 1))); }

void main() {
  vec2 o = (uGridOrigin + floor(gl_FragCoord.xy) + 0.5) / uK;
  vec2 f = uView.xy + o / uSize * uView.zw;
  vec2 inFrame = (clamp(f, 0.0, 1.0) - uView.xy) / uView.zw * uSize;
  ivec2 e = clamp(ivec2(floor(inFrame)) + uMargin, ivec2(0), textureSize(uShown, 0) - 1);
  vec3 d = texelFetch(uShown, e, 0).rgb;
  float c = coverageFor(0.2126 * d.r + 0.7152 * d.g + 0.0722 * d.b);
  vec3 h = vec3(f, 1.0);
  vec2 q = vec2(dot(uGeoU, h), dot(uGeoV, h)) / dot(uGeoW, h) * uFull / uRadius;
  vec2 u = q / uTexel + vec2(blockOffset(ivec2(floor(q / uBlock))));
  float size = float(1 << uLevel);
  int n = uSide >> uLevel;
  vec2 bu = u / size - 0.5;
  vec2 b0 = floor(bu), fr = bu - b0;
  // The knots around c: denser near 0 and 1 (Chebyshev).
  float t = acos(clamp(1.0 - 2.0 * c, -1.0, 1.0)) * float(uKnots - 1) / PI;
  int j = min(uKnots - 2, int(floor(t)));
  float c0 = knot(j), c1 = knot(j + 1), a = (c - c0) / (c1 - c0);
  float share[4];
  for (int s = 0; s < 4; s++) {
    vec2 bb = b0 + vec2(s & 1, s >> 1);
    ivec2 w = ivec2(bb - float(n) * floor(bb / float(n)));
    float lo = texelFetch(uPyr, ivec3(w, j), 0).r, hi = texelFetch(uPyr, ivec3(w, j + 1), 0).r;
    share[s] = lo + a * (hi - lo);
  }
  outColor = vec4(mix(mix(share[0], share[1], fr.x), mix(share[2], share[3], fr.x), fr.y), 0.0, 0.0, 1.0);
}
