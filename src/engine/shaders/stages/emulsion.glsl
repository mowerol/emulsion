// SPDX-License-Identifier: GPL-3.0-or-later
// Emulsion: how the film's dye layers respond. Colour stocks mix channels
// (crosstalk); black and white stocks collapse to one sensitivity curve.

uniform mat3 uMat;
uniform vec3 uBWw;

vec3 stageEmulsion(vec3 x) {
  if (uBW > 0.5) return vec3(dot(x, uBWw));
  return max(uMat * x, vec3(0.0));
}
