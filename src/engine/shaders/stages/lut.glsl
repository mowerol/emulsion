// Copyright (C) 2019-2026 darktable developers.
// Ported from darktable src/iop/lut3d.c at commit f38e304ce78e4332cc4528443e242dcd815c45a2:
// the tetrahedral interpolation (_correct_pixel_tetrahedral, from OpenColorIO). Translated to
// GLSL; the table is a 3D texture read with texelFetch. Mirrors src/engine/lut3d.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Look: a stock's LUT from the chosen pack, on the camera profile's print (sRGB).

uniform float uLutOn;
// How much of the LUT, 0 to 1: a blend with the original's display image (Emulsion's addition,
// as Lightroom profiles' Amount; darktable's lut3d has none).
uniform float uLutAmount;
// level^3, x red, y green, z blue.
uniform highp sampler3D uLutTex;

vec3 lutAt(int r, int g, int b) { return texelFetch(uLutTex, ivec3(r, g, b), 0).rgb; }

vec3 stageLut(vec3 d) {
  int level = textureSize(uLutTex, 0).x;
  vec3 s = clamp(d, 0.0, 1.0) * float(level - 1);
  ivec3 i = clamp(ivec3(s), ivec3(0), ivec3(level - 2));
  vec3 f = s - vec3(i);
  float r = f.r, g = f.g, b = f.b;
  vec3 c000 = lutAt(i.r, i.g, i.b), c111 = lutAt(i.r + 1, i.g + 1, i.b + 1);
  if (r > g) {
    if (g > b) return (1.0 - r) * c000 + (r - g) * lutAt(i.r + 1, i.g, i.b) + (g - b) * lutAt(i.r + 1, i.g + 1, i.b) + b * c111;
    if (r > b) return (1.0 - r) * c000 + (r - b) * lutAt(i.r + 1, i.g, i.b) + (b - g) * lutAt(i.r + 1, i.g, i.b + 1) + g * c111;
    return (1.0 - b) * c000 + (b - r) * lutAt(i.r, i.g, i.b + 1) + (r - g) * lutAt(i.r + 1, i.g, i.b + 1) + g * c111;
  }
  if (b > g) return (1.0 - b) * c000 + (b - g) * lutAt(i.r, i.g, i.b + 1) + (g - r) * lutAt(i.r, i.g + 1, i.b + 1) + r * c111;
  if (b > r) return (1.0 - g) * c000 + (g - b) * lutAt(i.r, i.g + 1, i.b) + (b - r) * lutAt(i.r, i.g + 1, i.b + 1) + r * c111;
  return (1.0 - g) * c000 + (g - r) * lutAt(i.r, i.g + 1, i.b) + (r - b) * lutAt(i.r + 1, i.g + 1, i.b) + b * c111;
}

// The look on the camera profile's print, blended with it by Amount.
vec3 stageLookPrint(vec3 e) {
  if (uLutAmount <= 0.0) return e;
  vec3 original = stageOutput(e);
  vec3 d = mix(original, stageLut(original), uLutAmount);
  return srgbOetf(clamp(uToWorking * srgbEotf(d), 0.0, 1.0));
}
