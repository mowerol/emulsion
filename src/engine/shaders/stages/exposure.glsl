// SPDX-License-Identifier: GPL-3.0-or-later
// Exposure and white balance, in scene light.

uniform float uExposure;
// Black level, as in darktable's exposure module: light below it is cut and the
// rest rescaled so white stays put. Set by lowering the Blacks slider.
// White balance: CAT16 from the as-shot white to the chosen one (identity when unchanged).
uniform mat3 uWbMat;
uniform float uExpBlack;

vec3 stageExposure(vec3 x) {
  x = uWbMat * x;
  float gain = exp2(uExposure);
  return (x - uExpBlack) * (gain / (1.0 - uExpBlack * gain));
}
