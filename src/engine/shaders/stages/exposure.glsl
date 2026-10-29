// SPDX-License-Identifier: GPL-3.0-or-later
// Exposure and colour balance, in scene light.

uniform float uExposure;
// Stock balance with warmth and tint, normalised to keep luminance.
uniform vec3 uWB;

vec3 stageExposure(vec3 x) {
  return x * exp2(uExposure) * uWB;
}
