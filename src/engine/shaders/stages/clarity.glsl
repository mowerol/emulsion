// Copyright (C) 2016-2026 darktable developers.
// Ported from darktable src/common/locallaplacian.c and src/iop/bilat.c at commit
// 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2). Translated from C to GLSL;
// Lab relative to D65. Mirrors src/engine/locallaplacian.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Clarity, on the print: darktable's local laplacian filter changes CIE
// lightness and keeps Lab a and b. The filter itself runs in the ll*.frag
// passes over the whole photo; this stage adds its lightness change.

// 1 applies the filter's change from uClarityTex (.r: change in lightness, 0 to 1 scale).
uniform float uClarityOn;
uniform sampler2D uClarityTex;
// Working RGB to XYZ, back, and the working white in XYZ.
uniform mat3 uLlToXyz;
uniform mat3 uLlFromXyz;
uniform vec3 uLlWhite;

const float LL_EPS = 216.0 / 24389.0;
const float LL_KAPPA = 24389.0 / 27.0;

float llF(float t) { return t > LL_EPS ? pow(t, 1.0 / 3.0) : (LL_KAPPA * t + 16.0) / 116.0; }
float llFInv(float f) { return f * f * f > LL_EPS ? f * f * f : (116.0 * f - 16.0) / LL_KAPPA; }

/** CIE lightness (0 to 1) of a tone-stage pixel: display-encoded Rec.2020. */
float clarityLightness(vec3 e) {
  vec3 lin = srgbEotf(max(e, vec3(0.0)));
  float Y = dot(transpose(uLlToXyz)[1], lin);
  return (116.0 * llF(max(Y, 0.0)) - 16.0) / 100.0;
}

/** The pixel with its lightness moved by `delta`, keeping Lab a and b. */
vec3 clarityShift(vec3 e, float delta) {
  vec3 xyz = uLlToXyz * srgbEotf(max(e, vec3(0.0)));
  vec3 f = vec3(llF(max(xyz.x, 0.0) / uLlWhite.x), llF(max(xyz.y, 0.0) / uLlWhite.y), llF(max(xyz.z, 0.0) / uLlWhite.z));
  float L = max(116.0 * f.y - 16.0 + 100.0 * delta, 0.0);
  f += (L + 16.0) / 116.0 - f.y;
  vec3 back = vec3(llFInv(f.x), llFInv(f.y), llFInv(f.z)) * uLlWhite;
  return srgbOetf(uLlFromXyz * back);
}

vec3 stageClarity(vec3 e, vec2 uv) {
  if (uClarityOn < 0.5) return e;
  return clarityShift(e, texture(uClarityTex, uv).r);
}
