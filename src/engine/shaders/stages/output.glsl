// SPDX-License-Identifier: GPL-3.0-or-later
// Output: display-encoded Rec.2020 to display-encoded sRGB.

uniform mat3 uToDisplay;

vec3 stageOutput(vec3 e) {
  vec3 lin = srgbEotf(clamp(e, 0.0, 1.0));
  return srgbOetf(clamp(uToDisplay * lin, 0.0, 1.0));
}
