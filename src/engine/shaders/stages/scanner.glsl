// SPDX-License-Identifier: GPL-3.0-or-later
// Scanner: levels, colour gain, shadow and highlight cast, contrast and
// saturation, applied to the display-referred print.

uniform float uScC;
uniform float uScSat;
uniform float uScBlack;
uniform float uScWhite;
uniform vec3 uScGain;
uniform vec3 uScShadow;
uniform vec3 uScHigh;

vec3 stageScanner(vec3 d) {
  d = (d - uScBlack) / (uScWhite - uScBlack);
  d *= uScGain;
  float y = dot(clamp(d, 0.0, 1.0), LUMA_D);
  d += uScShadow * (1.0 - smoothstep(0.0, 0.5, y)) + uScHigh * smoothstep(0.5, 1.0, y);
  d = vec3(sCurve(d.r, uScC, 0.46), sCurve(d.g, uScC, 0.46), sCurve(d.b, uScC, 0.46));
  float y2 = dot(d, LUMA_D);
  return mix(vec3(y2), d, uScSat);
}
