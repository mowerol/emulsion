#version 300 es
// Copyright (C) 2017 Alasdair Newson, Noura Faraj, Bruno Galerne, Julie Delon.
// From the reference implementation of "Realistic Film Grain Rendering" (IPOL 2017,
// https://www.ipol.im/pub/art/2017/192), render_pixel's cells and grains, licence GPL v3+.
// Mirrors src/engine/filmgrain.ts (grainThreshold, tileLevel), which lists the changes.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The baked film: at each texel's centre (texel × (i, j) + 0.5 texel, in frame pixels), the lowest
// value at which the point lies in a grain, as a 16-bit level (1 to 65535, 0 for never). A cell's
// grains appear in order as the value rises and are the same at every value, so the first grain
// over the point in each cell gives that cell's threshold. The cells repeat every uCells.
precision highp float;
precision highp int;
out uvec4 outLevel;
#include "filmgrain-common.glsl"
uniform float uTexel;
uniform int uCells;
uniform float uRadius;
uniform float uSigmaR;
uniform float uMu;
uniform float uSigma;
uniform float uMaxRadius;
uniform float uAg;
// ag^2 / (pi (r^2 + sigmaR^2)): the Poisson intensity per cell is this × -log(1 - u).
uniform float uLambdaK;
uniform uint uSeed;
const float U_TOP = 255.0 / 255.1;

// The intensity at which P(N <= k) = u0 for a Poisson count N (it falls as the intensity grows).
float lambdaAt(int k, float u0, float top) {
  float lo = 0.0, hi = top;
  // 24 halvings: far finer than the 8-bit level the threshold is stored as.
  for (int i = 0; i < 24; i++) {
    float mid = 0.5 * (lo + hi);
    float prod = exp(-mid), sum = prod;
    for (int x = 1; x <= k; x++) { prod *= mid / float(x); sum += prod; }
    if (sum < u0) hi = mid; else lo = mid;
  }
  return hi;
}
int wrapCell(int c) { return c - uCells * int(floor(float(c) / float(uCells))); }

void main() {
  vec2 g = (floor(gl_FragCoord.xy) + 0.5) * uTexel;
  float lambdaTop = -uLambdaK * log(1.0 - U_TOP);
  float r2 = uRadius * uRadius;
  float best = 2.0;
  ivec2 lo = ivec2(floor((g - uMaxRadius) / uAg));
  ivec2 hi = ivec2(floor((g + uMaxRadius) / uAg));
  for (int cx = lo.x; cx <= hi.x; cx++) {
    for (int cy = lo.y; cy <= hi.y; cy++) {
      vec2 corner = uAg * vec2(cx, cy);
      uint s = wangHash(cellSeed(wrapCell(cx), wrapCell(cy), uSeed));
      float u0 = uniform01(s);
      // The most grains the cell holds, at the top value.
      int n = 0;
      float prod = exp(-lambdaTop), sum = prod;
      // At most MAX_CELL_GRAINS (filmgrain.ts): the reference's cap of 10000 × the intensity makes
      // the loop long enough to fault the GPU in the rare cell whose draw is exactly 1.
      while (u0 > sum && n < 64) { n++; prod *= lambdaTop / float(n); sum += prod; }
      for (int k = 0; k < n; k++) {
        float cx0 = uniform01(s);
        float cy0 = uniform01(s);
        vec2 d = corner + uAg * vec2(cx0, cy0) - g;
        float rr = r2;
        if (uSigmaR > 0.0) { float rad = min(exp(uMu + uSigma * gaussian01(s)), uMaxRadius); rr = rad * rad; }
        if (dot(d, d) >= rr) continue;
        best = min(best, 1.0 - exp(-lambdaAt(k, u0, lambdaTop) / uLambdaK));
        break;
      }
    }
  }
  uint level = best < U_TOP ? uint(min(65535.0, floor(best * 65535.0) + 1.0)) : 0u;
  outLevel = uvec4(level, 0u, 0u, 1u);
}
