// Copyright (C) 2020-2026 darktable developers.
// Copyright (C) 2017-2023 darktable developers (colour space conversions).
// darktable Uniform Color Space 2022 © Aurélien Pierre.
// Ported from darktable src/iop/colorbalancergb.c, src/common/colorspaces_inline_conversions.h
// and src/common/darktable_ucs_22_helpers.h at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773
// (release 5.6.2). Translated from C to GLSL: process() with the darktable UCS saturation
// formula (hue shift, chroma, vibrance, the four ways, luminance power, contrast, saturation and
// brilliance by tone, gamut mapping); the working space is D65 Rec.2020, and negative output is
// clipped. Mirrors src/engine/colorbalance.ts, whose cbUniform() packs the constants.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Colour balance, in scene light: vibrance and the shadows lift in Filmlight Yrg, contrast on
// luminance around middle grey, then saturation and gamut mapping in darktable UCS.

// Working RGB to CIE 2006 LMS, LMS to XYZ, XYZ to working RGB.
uniform mat3 uCbRgbToLms;
uniform mat3 uCbLmsToXyz;
uniform mat3 uCbXyzToRgb;
// LMS to Filmlight grading RGB and back.
uniform mat3 uCbLmsToGrading;
uniform mat3 uCbGradingToLms;
// An instance's constants (cbUniform in colorbalance.ts): [0] contrast, vibrance, grey and white
// fulcrums; [1-3] chroma, saturation and brilliance (global, shadows, mid-tones, highlights);
// [4-7] the global offset, shadows lift, highlights gain and mid-tones power in grading RGB;
// [8] mid-tones luminance power and the masks' weights; [9] mask grey, hue shift cos and sin, L* white.
uniform vec4 uCbP[10];
// A saved creative profile's hidden instance, run just before the photo's own (uCbLOn 0: none).
uniform vec4 uCbL[10];
uniform float uCbLOn;
// Squared colourfulness of the working gamut boundary for 512 hues in [-pi, pi), packed in fours.
uniform vec4 uCbGamut[128];

const float CB_D65_R = 0.21902143;
const float CB_D65_G = 0.54371398;
const vec2 CB_D65_XY = vec2(0.31271, 0.32902);
const float CB_TINY = 1e-30;
const float CB_PI = 3.14159265358979;
const float CB_HK = 1.33654221029386;
const float CB_L_RANGE = 2.098883786377;
const float CB_L_LIMIT = 2.09885;

vec3 cbLmsToYrg(vec3 lms) {
  float Y = 0.68990272 * lms.x + 0.34832189 * lms.y;
  float a = lms.x + lms.y + lms.z;
  vec3 rgb = uCbLmsToGrading * (a == 0.0 ? vec3(0.0) : lms / a);
  return vec3(Y, rgb.x, rgb.y);
}

vec3 cbYrgToLms(vec3 yrg) {
  vec3 lms = uCbGradingToLms * vec3(yrg.y, yrg.z, 1.0 - yrg.y - yrg.z);
  float denom = 0.68990272 * lms.x + 0.34832189 * lms.y;
  return lms * (denom == 0.0 ? 0.0 : yrg.x / denom);
}

float cbYToLStar(float Y) {
  float h = pow(max(Y, 0.0), 0.631651345306265);
  return CB_L_RANGE * h / (h + 1.12426773749357);
}

float cbLStarToY(float L) {
  return pow(1.12426773749357 * L / (CB_L_RANGE - L), 1.5831518565279648);
}

vec3 cbXyzToXyY(vec3 xyz) {
  xyz = max(xyz, vec3(0.0));
  float sum = xyz.x + xyz.y + xyz.z;
  return vec3(sum > 0.0 ? xyz.xy / sum : CB_D65_XY, xyz.y);
}

vec3 cbXyYToXyz(vec3 xyY) {
  if (xyY.y == 0.0) return vec3(0.0);
  return vec3(xyY.z * xyY.x / xyY.y, xyY.z, xyY.z * (1.0 - xyY.x - xyY.y) / xyY.y);
}

float cbSafeDiv(float v) { return v >= 0.0 ? max(CB_TINY, v) : min(-CB_TINY, v); }

vec2 cbXyYToUV(vec3 xyY) {
  vec3 uvd = vec3(-0.783941002840055, 0.745273540913283, 0.318707282433486) * xyY.x
           + vec3(0.277512987809202, -0.205375866083878, 2.16743692732158) * xyY.y
           + vec3(0.153836578598858, -0.165478376301988, 0.291320554395942);
  vec2 uv = uvd.xy / cbSafeDiv(uvd.z);
  vec2 s = vec2(1.39656225667, 1.4513954287) * uv / (abs(uv) + vec2(1.49217352929, 1.52488637914));
  return vec2(-1.124983854323892 * s.x - 0.980483721769325 * s.y, 1.86323315098672 * s.x + 1.971853092390862 * s.y);
}

// darktable UCS lightness J, chroma C, hue H.
vec3 cbXyYToJCH(vec3 xyY, float lWhite) {
  vec2 uv = cbXyYToUV(xyY);
  float L = cbYToLStar(xyY.z);
  float M2 = dot(uv, uv);
  return vec3(L / lWhite, 15.932993652962535 * pow(L, 0.6523997524738018) * pow(M2, 0.6007557017508491) / lWhite, atan(uv.y, uv.x));
}

vec3 cbJCHToXyY(vec3 jch, float lWhite) {
  float L = clamp(jch.x * lWhite, 0.0, CB_L_LIMIT);
  float M = L != 0.0 ? pow(max(jch.y * lWhite / (15.932993652962535 * pow(L, 0.6523997524738018)), 0.0), 0.8322850678616855) : 0.0;
  float u = M * cos(jch.z);
  float v = M * sin(jch.z);
  vec2 s = vec2(-5.037522385190711 * u - 2.504856328185843 * v, 4.760029407436461 * u + 2.874012963239247 * v);
  vec2 uv = -vec2(1.49217352929, 1.52488637914) * s / (abs(s) - vec2(1.39656225667, 1.4513954287));
  vec3 xyd = vec3(0.167171472114775, -0.150959086409163, 0.940254742367256) * uv.x
           + vec3(0.141299802443708, -0.155185060382272, 1.0) * uv.y
           + vec3(-0.00801531300850582, -0.00843312433578007, -0.0256325967652889);
  return vec3(xyd.xy / cbSafeDiv(xyd.z), cbLStarToY(L));
}

float cbSoftClip(float x, float soft, float hard) {
  float norm = hard - soft;
  return x > soft ? soft + (1.0 - exp(-(x - soft) / norm)) * norm : x;
}

float cbGamutAt(int i) {
  vec4 v = uCbGamut[i >> 2];
  int k = i & 3;
  return k == 0 ? v.x : k == 1 ? v.y : k == 2 ? v.z : v.w;
}

float cbLookupGamut(float hue) {
  float x = 512.0 * (hue + CB_PI) / (2.0 * CB_PI);
  float x0 = floor(x);
  float x1 = ceil(x);
  int i0 = int(x0) & 511;
  int i1 = int(x1) & 511;
  float y0 = cbGamutAt(i0);
  return y0 + (i0 != i1 ? (x - x0) * (cbGamutAt(i1) - y0) : 0.0);
}

vec3 colorBalanceRgb(vec3 rgb, vec4 P[10]) {
  float lWhite = P[9].w;
  vec3 yrg = cbLmsToYrg(uCbRgbToLms * max(rgb, vec3(0.0)));
  float Y = max(yrg.x, 0.0);
  vec2 rg = yrg.yz - vec2(CB_D65_R, CB_D65_G);
  float c = length(rg);
  float cosH = c != 0.0 ? rg.x / c : 1.0;
  float sinH = c != 0.0 ? rg.y / c : 0.0;

  // Opacities of the shadows, mid-tones and highlights masks.
  float off = pow(Y, 0.4101205819200422) - P[9].x;
  float offN = off / P[9].x;
  float alpha = 1.0 / (1.0 + exp(offN * P[8].y));
  float beta = 1.0 / (1.0 + exp(-offN * P[8].z));
  float gamma = exp(-off * off * P[8].w / 4.0) * (1.0 - alpha) * (1.0 - alpha) * (1.0 - beta) * (1.0 - beta) * 8.0;
  vec3 op = vec3(alpha, gamma, beta);

  // Hue shift.
  vec2 h = vec2(P[9].y * cosH - P[9].z * sinH, P[9].z * cosH + P[9].y * sinH);
  cosH = h.x;
  sinH = h.y;

  // Linear chroma and vibrance at constant luminance and hue. pow(0, 0) is undefined in GLSL.
  float vib = P[0].y == 0.0 ? 0.0 : P[0].y * (1.0 - pow(c, abs(P[0].y)));
  c *= max(1.0 + P[1].x + dot(op, P[1].yzw) + vib, 0.0);
  vec2 trial = c * vec2(cosH, sinH) + vec2(CB_D65_R, CB_D65_G);
  float maxC = c;
  if (trial.x < 0.0) maxC = min(-CB_D65_R / cosH, maxC);
  if (trial.y < 0.0) maxC = min(-CB_D65_G / sinH, maxC);
  if (trial.x + trial.y > 1.0) maxC = min((1.0 - CB_D65_R - CB_D65_G) / (cosH + sinH), maxC);
  yrg = vec3(Y, maxC * vec2(cosH, sinH) + vec2(CB_D65_R, CB_D65_G));

  // The four ways in grading RGB: offset, shadows lift and highlights gain, mid-tones power.
  vec3 g = uCbLmsToGrading * cbYrgToLms(yrg);
  g += P[4].xyz;
  g *= (1.0 - op.z) * (1.0 - op.x + op.x * P[5].xyz) + op.z * P[6].xyz;
  g = sign(g) * pow(abs(g) / P[0].w, P[7].xyz) * P[0].w;
  yrg = cbLmsToYrg(uCbGradingToLms * g);

  // Luminance power, then contrast around the grey fulcrum.
  yrg.x = pow(max(yrg.x / P[0].w, 0.0), P[8].x) * P[0].w;
  yrg.x = P[0].z * pow(yrg.x / P[0].z, P[0].x);
  vec3 xyz = uCbLmsToXyz * cbYrgToLms(yrg);

  // Saturation and brilliance in darktable UCS, at constant hue.
  vec3 jch = cbXyYToJCH(cbXyzToXyY(xyz), lWhite);
  vec3 hcb = vec3(jch.z, jch.y, jch.x * (pow(jch.y, CB_HK) + 1.0));
  float radius = length(hcb.yz);
  float sinT = radius > 0.0 ? hcb.y / radius : 0.0;
  float cosT = radius > 0.0 ? hcb.z / radius : 0.0;
  float Pp0 = max(CB_TINY, hcb.y);
  float W = sinT * hcb.y + cosT * hcb.z;
  float maxA = length(vec2(Pp0, W)) / Pp0;
  float a = cbSoftClip(max(1.0 + P[2].x + dot(op, P[2].yzw), 0.0), 0.5 * maxA, maxA);
  float b = max(1.0 + P[3].x + dot(op, P[3].yzw), 0.0);
  float Pp = (a - 1.0) * Pp0;
  float Wp = sqrt(max(Pp0 * Pp0 * (1.0 - a * a) + W * W, 0.0)) * b;
  hcb.y = max(cosT * Pp + sinT * Wp, 0.0);
  hcb.z = max(-sinT * Pp + cosT * Wp, 0.0);
  jch = vec3(hcb.z / (pow(hcb.y, CB_HK) + 1.0), hcb.y, hcb.x);

  // Gamut mapping: soft-clip saturation at constant brightness.
  float maxM2 = cbLookupGamut(jch.z);
  float boundC = 15.932993652962535 * pow(jch.x * lWhite, 0.6523997524738018) * pow(maxM2, 0.6007557017508491) / lWhite;
  float boundB = jch.x * (pow(boundC, CB_HK) + 1.0);
  float boundS = boundB > 0.0 ? boundC / boundB : 0.0;
  float S = hcb.z > 0.0 ? hcb.y / hcb.z : 0.0;
  S = cbSoftClip(S, 0.8 * boundS, boundS);
  float Cs = S * hcb.z;
  jch = vec3(hcb.z / (pow(Cs, CB_HK) + 1.0), Cs, hcb.x);
  return max(uCbXyzToRgb * cbXyYToXyz(cbJCHToXyY(jch, lWhite)), vec3(0.0));
}

// The recipe's Colour balance sliders.
vec3 stageColorBalance(vec3 rgb) { return colorBalanceRgb(rgb, uCbP); }

// A saved creative profile's colour and tone, applied without moving the photo's sliders.
vec3 stageProfileColorBalance(vec3 rgb) { return uCbLOn > 0.5 ? colorBalanceRgb(rgb, uCbL) : rgb; }

