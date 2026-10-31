// SPDX-License-Identifier: GPL-3.0-or-later
// Emulsion: black and white stocks collapse to one sensitivity curve. Colour
// stocks pass through; their colour comes from their grade and sigmoid primaries.

uniform vec3 uBWw;

vec3 stageEmulsion(vec3 x) {
  if (uBW > 0.5) return vec3(dot(x, uBWw));
  return x;
}
