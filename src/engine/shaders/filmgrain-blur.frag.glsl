#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// Film grain's filter (filmgrain.ts renderFilmGrain) over the grid's points, one axis at a time.
// Mode 0, along x: texel t of
// the target is output column t.x of the tile at grid row t.y, from the packed grid (filmgrain.frag:
// each texel the uK points of one row in one output column), the weights of the points set in
// each texel's two bytes summed ahead in uLut (row 2 (d + uReach) + byte for the column d away;
// filmgraingpu.ts filterLut). Mode 2, along x, from integrated cells (one a texel). Mode 1, along
// y, into the grain's change at full size (drawn scissored to the tile): the filtered coverage at
// output pixel gl_FragCoord printed (filmgrain-print.glsl), split into the softening (.r: mode 3's
// own coverage filtered along y, printed, less the shown value's) and the grain (.g: the render
// printed less its expected print). Mode 3: the
// photo's own coverage along x over whole pixels. The taps
// are filmgrain.ts filterTaps (uWeights): the reference's Gaussian, or zoomed out the full size's
// shrunk with Lanczos3.
precision highp float;
precision highp int;
out vec4 outColor;
uniform sampler2D uSrc;
uniform sampler2D uLut;
uniform int uReach;
// The filter's taps (filmgrain.ts filterTaps): uTaps weights from tap uLo, in row 0; over whole
// pixels (pixelTaps) uPTaps from uPLo, in row 1.
uniform sampler2D uWeights;
uniform int uLo;
uniform int uTaps;
uniform int uPLo;
uniform int uPTaps;
// Mode 1: the photo's own coverage filtered along x (mode 3's target).
uniform sampler2D uMean;
// The model's variance per varianceShape: the radius in output pixels squared × the filter's energy.
uniform float uVarScale;
uniform sampler2D uShown;
uniform int uMargin;
uniform int uMode;
uniform ivec2 uTile;
uniform float uK;

#include "filmgrain-print.glsl"
void main() {
  ivec2 p = ivec2(floor(gl_FragCoord.xy));
  int k = int(uK + 0.5);
  if (uMode == 0) {
    // Packed points (filmgrain.frag): output column p.x is grid column p.x + uReach in this tile.
    float sum = 0.0;
    for (int d = -uReach; d <= uReach; d++) {
      vec2 bytes = floor(texelFetch(uSrc, ivec2(p.x + uReach + d, p.y), 0).rg * 255.0 + 0.5);
      int row = 2 * (d + uReach);
      sum += texelFetch(uLut, ivec2(int(bytes.x), row), 0).r + texelFetch(uLut, ivec2(int(bytes.y), row + 1), 0).r;
    }
    outColor = vec4(sum, 0.0, 0.0, 1.0);
    return;
  }
  if (uMode == 2) {
    // Integrated cells (filmgrain-cells.frag), one a texel: the taps along x.
    int base = (p.x + uReach) * k + uLo;
    float sum = 0.0;
    for (int q = 0; q < uTaps; q++) sum += texelFetch(uWeights, ivec2(q, 0), 0).r * texelFetch(uSrc, ivec2(base + q, p.y), 0).r;
    outColor = vec4(sum, 0.0, 0.0, 1.0);
    return;
  }
  if (uMode == 3) {
    // The photo's own coverage, a value a pixel, along x over whole pixels: texel p is output
    // column uTile.x + p.x at output row uTile.y - uReach + p.y.
    float sum = 0.0;
    for (int a = 0; a < uPTaps; a++) {
      vec3 d = texelFetch(uShown, ivec2(uTile.x + p.x + uPLo + a, uTile.y - uReach + p.y) + uMargin, 0).rgb;
      sum += texelFetch(uWeights, ivec2(a, 1), 0).r * coverageFor(grainValue(d));
    }
    outColor = vec4(sum, 0.0, 0.0, 1.0);
    return;
  }
  ivec2 t = p - uTile;
  int base = (t.y + uReach) * k + uLo;
  float sum = 0.0;
  for (int q = 0; q < uTaps; q++) sum += texelFetch(uWeights, ivec2(q, 0), 0).r * texelFetch(uSrc, ivec2(t.x, base + q), 0).r;
  float mean = 0.0;
  for (int b = 0; b < uPTaps; b++) mean += texelFetch(uWeights, ivec2(b, 1), 0).r * texelFetch(uMean, ivec2(t.x, t.y + uReach + uPLo + b), 0).r;
  // The change in the shown value, split (filmgrain.ts filmChange): the softening, the photo's
  // own coverage filtered and printed less the pixel's; the grain, the render printed less that.
  vec3 d = texelFetch(uShown, p + uMargin, 0).rgb;
  // The grain less its expected print (filmgrain.ts filmChange): the model's variance at the mean
  // (row 2: varianceShape at 256 coverages to the top, times uVarScale), three-point Gauss-Hermite.
  float x = clamp(mean / U_TOP, 0.0, 1.0) * 255.0;
  int i0 = min(254, int(floor(x)));
  float shape = mix(texelFetch(uWeights, ivec2(i0, 2), 0).r, texelFetch(uWeights, ivec2(i0 + 1, 2), 0).r, x - float(i0));
  float dev = sqrt(3.0 * max(0.0, shape * uVarScale));
  float expected = (shownFor(clamp(mean - dev, 0.0, U_TOP)) + shownFor(clamp(mean + dev, 0.0, U_TOP))) / 6.0 + shownFor(mean) * (2.0 / 3.0);
  float grain = shownFor(sum) - expected;
  if (uChannel < 0) {
    // The original monochrome result initializes the chroma coordinates to zero.
    outColor = vec4(shownFor(mean) - shownFor(coverageFor(grainValue(d))), grain, 0.0, 0.0);
  } else {
    // Accumulate each independent channel's zero-luma contribution into .ba. The two
    // coordinates store chroma R and B; G is reconstructed in the compose pass.
    vec3 h = vec3(0.0);
    h[uChannel] = grain;
    h -= dot(h, vec3(0.2126, 0.7152, 0.0722));
    outColor = vec4(0.0, 0.0, h.r, h.b);
  }
}
