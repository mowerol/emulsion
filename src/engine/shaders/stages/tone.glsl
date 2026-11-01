// Copyright (C) 2020-2026 darktable developers.
// Ported from darktable src/iop/sigmoid.c at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773
// (release 5.6.2). Translated from C to GLSL; the per-channel log-logistic curve, plus an exact
// inverse of it and sRGB encoding of the output. Mirrors src/engine/tone.ts, which computes the
// curve constants.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Tone: scene-linear light to a display-encoded print.

// Curves as (paper exposure, film fog, film power, paper power).
// Neutral curve, magnitude 1: the input stage's inverse and the original.
uniform vec4 uSigN;
// The print's curve: the neutral curve under the Whites and Blacks display targets.
uniform vec4 uSigS;
// Display white the print's curve approaches (1 = 100%).
uniform float uSigMag;

float srgbEotf1(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
float srgbOetf1(float l) { l = max(l, 0.0); return l <= 0.0031308 ? l * 12.92 : 1.055 * pow(l, 1.0 / 2.4) - 0.055; }

float sigmoid(float x, vec4 c, float magnitude) {
  float film = pow(c.y + max(x, 0.0), c.z);
  float paper = magnitude * pow(film / (c.x + film), c.w);
  return isnan(paper) ? magnitude : paper;
}

float sigmoidInverse(float y, vec4 c, float magnitude) {
  float r = pow(min(max(y, 0.0) / magnitude, 1.0 - 1e-7), 1.0 / c.w);
  float film = c.x * r / (1.0 - r);
  return max(pow(film, 1.0 / c.z) - c.y, 0.0);
}

// Display-encoded value to scene light: the exact inverse of the neutral curve.
float toneInverse(float e) { return sigmoidInverse(srgbEotf1(clamp(e, 0.0, 1.0)), uSigN, 1.0); }

// The original: the neutral curve per channel, so input and output round-trip.
vec3 stageToneNeutral(vec3 x) {
  return vec3(srgbOetf1(sigmoid(x.r, uSigN, 1.0)), srgbOetf1(sigmoid(x.g, uSigN, 1.0)), srgbOetf1(sigmoid(x.b, uSigN, 1.0)));
}

// Contrast S-curve on [0, 1], pivoting on p. Used by the scanner stage.
float sCurve(float v, float c, float p) {
  v = clamp(v, 0.0, 1.0);
  return v < p ? p * pow(v / p, c) : 1.0 - (1.0 - p) * pow((1.0 - v) / (1.0 - p), c);
}

// The camera profile's print: the neutral curve per channel, with the Whites and Blacks targets.
vec3 stageToneProfile(vec3 x) {
  return vec3(srgbOetf1(sigmoid(x.r, uSigS, uSigMag)),
              srgbOetf1(sigmoid(x.g, uSigS, uSigMag)),
              srgbOetf1(sigmoid(x.b, uSigS, uSigMag)));
}
