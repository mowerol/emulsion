// SPDX-License-Identifier: GPL-3.0-or-later
// CIE Lab lightness of linear working RGB (Rec.2020, D65 white), and moving it
// while keeping Lab a and b, for the stages ported from darktable's Lab modules.
// Mirrors lightness() and withLightness() in src/engine/locallaplacian.ts.

// Working RGB to XYZ, back, and the working white in XYZ.
uniform mat3 uLlToXyz;
uniform mat3 uLlFromXyz;
uniform vec3 uLlWhite;

const float LAB_EPS = 216.0 / 24389.0;
const float LAB_KAPPA = 24389.0 / 27.0;

float labF(float t) { return t > LAB_EPS ? pow(t, 1.0 / 3.0) : (LAB_KAPPA * t + 16.0) / 116.0; }
float labFInv(float f) { return f * f * f > LAB_EPS ? f * f * f : (116.0 * f - 16.0) / LAB_KAPPA; }

/** CIE L* (0 to 100 for display light; more for scene light above white) of linear RGB. */
float labL(vec3 lin) {
  float Y = dot(transpose(uLlToXyz)[1], lin);
  return 116.0 * labF(max(Y, 0.0)) - 16.0;
}

/** Linear RGB with L* moved by `dL` (L* units), keeping a and b. */
vec3 labShiftL(vec3 lin, float dL) {
  vec3 xyz = uLlToXyz * lin;
  vec3 f = vec3(labF(max(xyz.x, 0.0) / uLlWhite.x), labF(max(xyz.y, 0.0) / uLlWhite.y), labF(max(xyz.z, 0.0) / uLlWhite.z));
  float L = max(116.0 * f.y - 16.0 + dL, 0.0);
  // Keeping a = 500 (fx - fy) and b = 200 (fy - fz) moves all three by the same step.
  f += (L + 16.0) / 116.0 - f.y;
  return max(uLlFromXyz * (vec3(labFInv(f.x), labFInv(f.y), labFInv(f.z)) * uLlWhite), vec3(0.0));
}
