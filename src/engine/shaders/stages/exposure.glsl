// SPDX-License-Identifier: GPL-3.0-or-later
// Exposure and colour balance, in scene light.

uniform float uExposure;
// Black level, as in darktable's exposure module: light below it is cut and the
// rest rescaled so white stays put. Set by lowering the Blacks slider.
// Stock balance with warmth and tint, normalised to keep luminance.
uniform vec3 uWB;
uniform float uExpBlack;

vec3 stageExposure(vec3 x) {
  float gain = exp2(uExposure);
  return (x - uExpBlack) * (gain / (1.0 - uExpBlack * gain)) * uWB;
}
