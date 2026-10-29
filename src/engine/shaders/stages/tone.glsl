// Copyright (C) 2020-2026 darktable developers.
// Ported from darktable src/iop/sigmoid.c at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773
// (release 5.6.2). Translated from C to GLSL; per-channel processing with full hue
// preservation, Rec.2020 base primaries without inset or rotation (an identity), plus an exact
// inverse of the per-channel curve, a per-channel crossover ratio for film stocks, and sRGB
// encoding of the output. Mirrors src/engine/tone.ts, which computes the curve constants.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Tone: scene-linear light to a display-encoded print.

// Curves as (paper exposure, film fog, film power, paper power).
// Neutral curve, magnitude 1: the input stage's inverse and the original.
uniform vec4 uSigN;
// The look's shared curve, and each channel's own curve for crossover.
uniform vec4 uSigS;
uniform vec4 uSigR;
uniform vec4 uSigG;
uniform vec4 uSigB;
// Display white the look's curves approach (1 = 100%).
uniform float uSigMag;
uniform float uSat;
uniform float uStockFade;

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

vec3 desaturateNegative(vec3 p) {
  float avg = max((p.r + p.g + p.b) / 3.0, 0.0);
  float mn = min(p.r, min(p.g, p.b));
  float k = mn < 0.0 ? -avg / (mn - avg) : 1.0;
  return avg + k * (p - avg);
}

// darktable's _pixel_channel_order: indices of the max, mid and min channels.
ivec3 channelOrder(vec3 p) {
  if (p.r >= p.g) {
    if (p.g > p.b) return ivec3(0, 1, 2);
    if (p.b > p.r) return ivec3(2, 0, 1);
    if (p.b > p.g) return ivec3(0, 2, 1);
    return ivec3(0, 1, 2);
  }
  if (p.r >= p.b) return ivec3(1, 0, 2);
  if (p.b > p.g) return ivec3(2, 1, 0);
  return ivec3(1, 2, 0);
}

// darktable's _preserve_hue_and_energy with full hue preservation.
vec3 preserveHue(vec3 inp, vec3 per) {
  ivec3 o = channelOrder(inp);
  float iMax = inp[o.x], iMid = inp[o.y], iMin = inp[o.z];
  float pMax = per[o.x], pMid = per[o.y], pMin = per[o.z];
  float chroma = iMax - iMin;
  float midscale = chroma != 0.0 ? (iMid - iMin) / chroma : 0.0;
  float naiveMid = pMin + (pMax - pMin) * midscale;
  float energy = pMin + pMid + pMax;
  float naiveEnergy = pMin + naiveMid + pMax;
  float minPlusMid = iMin + iMid;
  float blend = minPlusMid != 0.0 ? 2.0 * iMin / minPlusMid : 0.0;
  float target = blend * energy + (1.0 - blend) * naiveEnergy;
  vec3 out3;
  if (naiveMid <= pMid) {
    float mid = (midscale * pMax + (1.0 - midscale) * (target - pMax)) / (1.0 + (1.0 - midscale));
    out3[o.z] = target - pMax - mid;
    out3[o.y] = mid;
    out3[o.x] = pMax;
  } else {
    float mid = (pMin * (1.0 - midscale) + midscale * (target - pMin)) / (1.0 + midscale);
    out3[o.z] = pMin;
    out3[o.y] = mid;
    out3[o.x] = target - pMin - mid;
  }
  return out3;
}

// The look: shared curve with hue preservation, then each channel scaled by its
// own curve over the shared one (the stock's crossover).
vec3 stageTone(vec3 x) {
  vec3 pos = desaturateNegative(x);
  vec3 per = vec3(sigmoid(pos.r, uSigS, uSigMag), sigmoid(pos.g, uSigS, uSigMag), sigmoid(pos.b, uSigS, uSigMag));
  vec3 kept = preserveHue(pos, per);
  vec3 own = vec3(sigmoid(pos.r, uSigR, uSigMag), sigmoid(pos.g, uSigG, uSigMag), sigmoid(pos.b, uSigB, uSigMag));
  vec3 ratio = vec3(per.r > 0.0 ? own.r / per.r : 1.0, per.g > 0.0 ? own.g / per.g : 1.0, per.b > 0.0 ? own.b / per.b : 1.0);
  vec3 lin = max(kept * ratio, vec3(0.0));
  return vec3(srgbOetf1(lin.r), srgbOetf1(lin.g), srgbOetf1(lin.b));
}

// Contrast S-curve on [0, 1], pivoting on p. Used by the scanner stage.
float sCurve(float v, float c, float p) {
  v = clamp(v, 0.0, 1.0);
  return v < p ? p * pow(v / p, c) : 1.0 - (1.0 - p) * pow((1.0 - v) / (1.0 - p), c);
}

// Print saturation and the stock's black lift.
vec3 stagePrint(vec3 e) {
  if (uBW < 0.5) {
    float y = dot(e, LUMA_W);
    e = clamp(mix(vec3(y), e, uSat), 0.0, 1.0);
  }
  return uStockFade + e * (1.0 - uStockFade);
}
