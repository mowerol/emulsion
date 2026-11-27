// Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
// Ported from RawTherapee rtengine/curves.h (basel, baseu, cupper, clower, clower2,
// simplebasecurve), rtengine/curves.cc (CurveFactory::complexCurve's shCurve) and
// rtengine/improcfun.cc (shadowToneCurve) at commit 3458b9a1813f26b99c8dcf22aad7cc24deffdbae.
// Translated from C++ to GLSL; mirrors src/engine/blacks.ts. The curve is evaluated per pixel
// instead of from RawTherapee's 65536-entry table, with the same clamps (gain held below one
// 16-bit step, exactly 1 at and above white). Shadow compression is upstream's default 50.
// Deviation agreed with Oli (2026-11-25): it runs on Emulsion's linear print (white at 1),
// after the neutral sigmoid, not before RawTherapee's own tone curve.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Blacks: RawTherapee's Exposure Black on the print, one gain from luminance (colours kept).
// Needs srgbEotf1 and srgbOetf1 (tone.glsl).

// (Black / 65535, 0.015 × Shadow compression); x = 0 bypasses the stage exactly.
uniform vec2 uBlacks;

float rtBasel(float x, float m1, float m2) {
  if (x <= 0.0) return 0.0;
  float k = sqrt((m1 - 1.0) * (m1 - m2) * 0.5) / (1.0 - m2);
  float l = (m1 - m2) / (1.0 - m2) + k;
  float lx = log(x);
  return m2 * x + (1.0 - m2) * (2.0 - exp(k * lx)) * exp(l * lx);
}

float rtBaseu(float x, float m1, float m2) { return 1.0 - rtBasel(1.0 - x, m1, m2); }

float rtCupper(float x, float m, float hr) {
  if (hr > 1.0) return rtBaseu(x, m, 2.0 * (hr - 1.0) / m);
  float x1 = (1.0 - hr) / m;
  float x2 = x1 + hr;
  if (x >= x2) return 1.0;
  if (x < x1) return x * m;
  return 1.0 - hr + hr * rtBaseu((x - x1) / hr, m, 0.0);
}

float rtClower(float x, float m, float sr) { return 1.0 - rtCupper(1.0 - x, m, sr); }

float rtClower2(float x, float m, float sr) {
  float x1 = sr / 1.5 + 0.00001;
  if (x > x1 || sr < 0.001) return 1.0 - (1.0 - x) * m;
  float y1 = 1.0 - (1.0 - x1) * m;
  float t = 1.0 - x / x1;
  return y1 + m * (x - x1) - (1.0 - m) * (t * t) * (t * t);
}

float rtSimplebasecurve(float x, float b, float sr) {
  if (b < 0.0) {
    float m = 0.5;
    float slope = 1.0 + b;
    float y = -b + m * slope;
    if (x > m) return y + (x - m) * slope;
    return y * rtClower2(x / m, slope * m / y, 2.0 - sr);
  }
  float slope = 1.0 / (1.0 - b);
  float m = b + (1.0 - b) * 0.25;
  float y = (m - b) * slope;
  if (x <= m) return rtClower(x / m, slope * m / y, sr) * y;
  return y + (x - m) * slope;
}

vec3 stageBlacks(vec3 e) {
  if (uBlacks.x == 0.0) return e;
  vec3 lin = vec3(srgbEotf1(max(e.r, 0.0)), srgbEotf1(max(e.g, 0.0)), srgbEotf1(max(e.b, 0.0)));
  float y = dot(lin, vec3(0.299, 0.587, 0.114));
  if (y >= 1.0) return e;
  float v = max(y, 1.0 / 65535.0);
  float g = max(rtSimplebasecurve(v, uBlacks.x, uBlacks.y), 0.0) / v;
  lin *= g;
  return vec3(srgbOetf1(lin.r), srgbOetf1(lin.g), srgbOetf1(lin.b));
}
