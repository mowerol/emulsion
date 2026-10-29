// SPDX-License-Identifier: GPL-3.0-or-later
// Point curve on the display image: the master curve, then each channel's own.
// The lookup table holds (master, red, green, blue) for 256 input steps; it is
// sampled from darktable's monotone spline in src/film/curve.ts.

uniform float uCurveOn;
uniform sampler2D uCurveTex;

float curveAt(float v, int k) {
  vec4 t = texture(uCurveTex, vec2((clamp(v, 0.0, 1.0) * 255.0 + 0.5) / 256.0, 0.5));
  return k == 0 ? t.r : k == 1 ? t.g : k == 2 ? t.b : t.a;
}

vec3 stageCurve(vec3 d) {
  if (uCurveOn < 0.5) return d;
  return vec3(curveAt(curveAt(d.r, 0), 1), curveAt(curveAt(d.g, 0), 2), curveAt(curveAt(d.b, 0), 3));
}
