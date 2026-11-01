// Copyright (C) 2019-2026 darktable developers.
// Copyright (C) 2011-2024 darktable developers (blending).
// Ported from darktable src/iop/lut3d.c at commit f38e304ce78e4332cc4528443e242dcd815c45a2:
// the tetrahedral interpolation (_correct_pixel_tetrahedral, from OpenColorIO). Translated to
// GLSL; the table is a 3D texture read with texelFetch. Mirrors src/engine/lut3d.ts.
// The Colour blend is darktable's color blend mode, from src/develop/blends/blendif_rgb_hsl.c and
// the HSL conversions in src/common/colorspaces_inline_conversions.h at commit
// 20891f6c6fa7be995e5bf9dff9d1ee5062051773. Mirrors src/engine/blend.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Look: a stock's LUT from the chosen pack, on the camera profile's print (sRGB).

uniform float uLutOn;
// How much of the LUT, 0 to 1: a blend with the original's display image (Emulsion's addition,
// as Lightroom profiles' Amount; darktable's lut3d has none).
uniform float uLutAmount;
// 1 blends the LUT by colour only: its hue and saturation, the print's lightness.
uniform float uLutColor;
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

// darktable's dt_RGB_2_HSL and dt_HSL_2_RGB.
vec3 rgbToHsl(vec3 c) {
  float mn = min(c.r, min(c.g, c.b)), mx = max(c.r, max(c.g, c.b)), delta = mx - mn;
  float L = (mx + mn) / 2.0, H = 0.0, S = 0.0;
  if (abs(mx) > 1e-6 && abs(delta) > 1e-6) {
    S = L < 0.5 ? delta / (mx + mn) : delta / (2.0 - mx - mn);
    float hue = c.r == mx ? (c.g - c.b) / delta : c.g == mx ? 2.0 + (c.b - c.r) / delta : 4.0 + (c.r - c.g) / delta;
    hue /= 6.0;
    H = hue - floor(hue);
  }
  return vec3(H, S, L);
}

vec3 hslToRgb(vec3 hsl) {
  float L = hsl.z;
  float C = L < 0.5 ? L * hsl.y : (1.0 - L) * hsl.y;
  float m = L - C;
  // _dt_Hue_2_RGB with chroma 2C above the minimum m.
  float h = hsl.x * 6.0, i = floor(h), fc = (h - i) * 2.0 * C;
  float top = 2.0 * C + m, inc = fc + m, dec = top - fc;
  if (i == 0.0) return vec3(top, inc, m);
  if (i == 1.0) return vec3(dec, top, m);
  if (i == 2.0) return vec3(m, top, inc);
  if (i == 3.0) return vec3(m, dec, top);
  if (i == 4.0) return vec3(inc, m, top);
  return vec3(top, m, dec);
}

// darktable's _blend_color: hue and saturation from b at the opacity, lightness from a.
vec3 blendColor(vec3 a, vec3 b, float opacity) {
  vec3 ta = rgbToHsl(clamp(a, 0.0, 1.0)), tb = rgbToHsl(clamp(b, 0.0, 1.0));
  // blend hue along shortest distance on color circle
  float d = abs(ta.x - tb.x);
  float s = d > 0.5 ? -opacity * (1.0 - d) / d : opacity;
  float H = mod(ta.x * (1.0 - s) + tb.x * s + 1.0, 1.0);
  float S = ta.y * (1.0 - opacity) + tb.y * opacity;
  return clamp(hslToRgb(vec3(H, S, ta.z)), 0.0, 1.0);
}

// The look on the camera profile's print, blended with it by Amount. Normal mixes the display
// images; Colour blends as darktable's RGB (display) blending does, on the pipe's linear RGB.
vec3 stageLookPrint(vec3 e) {
  if (uLutAmount <= 0.0) return e;
  vec3 original = stageOutput(e);
  vec3 lut = stageLut(original);
  if (uLutColor > 0.5) return srgbOetf(blendColor(srgbEotf(e), uToWorking * srgbEotf(lut), uLutAmount));
  vec3 d = mix(original, lut, uLutAmount);
  return srgbOetf(clamp(uToWorking * srgbEotf(d), 0.0, 1.0));
}
