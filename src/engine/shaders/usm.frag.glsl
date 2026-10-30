#version 300 es
// Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
// Ported from RawTherapee rtengine/ipsharpen.cc (ImProcFunctions::sharpening, unsharp mask),
// rtengine/params/threshold.h and rtengine/rt_algo.cc (buildBlendMask) at commit
// b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c. Translated from C++ to GLSL; borders clamp.
// Mirrors unsharpMask() in src/engine/usm.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Sharpening, one step per draw (uMode), on the print's lightness (0 to 1,
// L* / 100) in RawTherapee's units (× 32768):
//  0 from uIn.r = L: writes L, the raw contrast mask, and L blurred along x by uG
//  1 from mode 0: writes L, the mask blurred along x by 2 px (uM), and L blurred along y by uG
//  2 from mode 1: the mask blurred along y, then .r the change in lightness (0 to 1 scale), .g the mask
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;

uniform int uMode;
uniform sampler2D uIn;
// RawTherapee's contrast threshold / 100; 0 sharpens everywhere.
uniform float uThreshold;
// RawTherapee's amount / 100.
uniform float uAmount;
// The lightness blur (RawTherapee's gaussianBlur for the radius) and the mask's 2 px blur, 1D.
uniform float uG[25];
uniform int uGHalf;
uniform float uM[13];
uniform int uMHalf;

const float L_SCALE = 32768.0;

ivec2 gMax;
vec4 at(ivec2 p) { return texelFetch(uIn, clamp(p, ivec2(0), gMax), 0); }

// rt_algo.cc's calcBlendFactor.
float blendFactor(float val, float threshold) {
  float x = -16.0 + (16.0 / threshold) * val;
  return 0.5 * (1.0 + x / sqrt(1.0 + x * x));
}

// buildBlendMask's local contrast, from neighbours one and two away; the outer two rows and columns copy inwards.
float contrastAt(ivec2 p) {
  p = clamp(p, ivec2(2), gMax - 2);
  float a = at(p + ivec2(1, 0)).r - at(p - ivec2(1, 0)).r;
  float b = at(p + ivec2(0, 1)).r - at(p - ivec2(0, 1)).r;
  float c = at(p + ivec2(2, 0)).r - at(p - ivec2(2, 0)).r;
  float d = at(p + ivec2(0, 2)).r - at(p - ivec2(0, 2)).r;
  return sqrt(a * a + b * b + c * c + d * d) * L_SCALE * 0.0625 / 327.68;
}

// Threshold<int>::multiply with RawTherapee's default (20, 80, 2000, 1200).
float thresholdMultiply(float x, float yMax) {
  if (x >= 2000.0) return 0.0;
  if (x > 1200.0) return yMax * (1.0 - (x - 1200.0) / 800.0);
  if (x >= 80.0) return yMax;
  if (x > 20.0) return yMax * (x - 20.0) / 60.0;
  return 0.0;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  gMax = textureSize(uIn, 0) - 1;
  vec4 here = texelFetch(uIn, p, 0);
  if (uMode == 0) {
    float s = 0.0;
    for (int i = -uGHalf; i <= uGHalf; i++) s += uG[i + uGHalf] * at(p + ivec2(i, 0)).r;
    float mask = uThreshold == 0.0 ? 1.0 : blendFactor(contrastAt(p), uThreshold);
    outColor = vec4(here.r, mask, s, 1.0);
  } else if (uMode == 1) {
    float m = 0.0;
    for (int i = -uMHalf; i <= uMHalf; i++) m += uM[i + uMHalf] * at(p + ivec2(i, 0)).g;
    float s = 0.0;
    for (int j = -uGHalf; j <= uGHalf; j++) s += uG[j + uGHalf] * at(p + ivec2(0, j)).b;
    outColor = vec4(here.r, m, s, 1.0);
  } else {
    float mask = 0.0;
    for (int j = -uMHalf; j <= uMHalf; j++) mask += uM[j + uMHalf] * at(p + ivec2(0, j)).g;
    float diff = (here.r - here.b) * L_SCALE;
    float delta = thresholdMultiply(min(abs(diff), 2000.0), uAmount * diff);
    // intp(blend, L + delta, L)
    outColor = vec4(mask * delta / L_SCALE, mask, 0.0, 1.0);
  }
}
