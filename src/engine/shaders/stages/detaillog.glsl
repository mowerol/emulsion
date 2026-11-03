// SPDX-License-Identifier: GPL-3.0-or-later
// Detail before Exposure: the log lightness Texture's contrast equalizer runs on with
// Engine.detailOrder 'log', and a change in it applied back as a ratio of luminance. A
// deviation from darktable's order; the maths and why are in src/engine/detaillog.ts, which
// this mirrors.
#include "stages/lab.glsl"

const float LOG_Y50 = 0.18419206;          // ((50 + 16) / 116)^3
const float LOG_SLOPE = 15.249237;          // ln 2 · 66 / 3
const float LOG_EPS = 0.000244140625;       // 2^-12

float lumY(vec3 lin) { return dot(transpose(uLlToXyz)[1], lin); }
float lstarOfY(float Y) { float t = max(Y, 0.0); return t > LAB_EPS ? 116.0 * pow(t, 1.0 / 3.0) - 16.0 : LAB_KAPPA * t; }

/** The log lightness of a linear working RGB pixel. */
float logLightness(vec3 lin) { return 50.0 + LOG_SLOPE * log2((max(lumY(lin), 0.0) + LOG_EPS) / LOG_Y50); }

/** The change in L* that moving a pixel by `du` in log lightness makes. */
float logShift(vec3 lin, float du) {
  float y = max(lumY(lin), 0.0);
  return lstarOfY((y + LOG_EPS) * exp2(du / LOG_SLOPE) - LOG_EPS) - lstarOfY(y);
}
