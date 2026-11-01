// Copyright (c) 2012 Oliver Duis <www.oliverduis.de>
// Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
// RawTherapee dcp.cc / color.h / curves.h at b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c.
// Same two-stage DCP processing and table interpolation as dcp.ts; normalized RGB replaces 65535 units.
// SPDX-License-Identifier: GPL-3.0-or-later
uniform float uDcpOn;
uniform float uDcpHasCal;
uniform float uDcpHasLook;
uniform float uDcpHasCurve;
uniform float uDcpExposure;
uniform float uDcpScale;
uniform mat3 uDcpMatrix;
uniform mat3 uDcpToCamera;
uniform mat3 uDcpToProPhoto;
uniform mat3 uDcpFromProPhoto;
uniform vec4 uDcpCalDims;
uniform vec4 uDcpLookDims;
uniform highp sampler3D uDcpCal;
uniform highp sampler3D uDcpLook;
uniform highp sampler2D uDcpCurve;
uniform highp sampler2D uDcpGamma;
// 1 when Whites or positive Blacks re-render a DCP tone curve's print through the sigmoid targets.
uniform float uProfileTargetsOn;

// The profile's 65536-entry gamma table (forward in r, inverse in g), interpolated as RT's LUTf.
float dcpGamma(float x, bool inverse) {
  float p = x * 65535.0;
  int i = clamp(int(p), 0, 65534), j = i + 1;
  vec2 a = texelFetch(uDcpGamma, ivec2(i % 256, i / 256), 0).rg;
  vec2 b = texelFetch(uDcpGamma, ivec2(j % 256, j / 256), 0).rg;
  // RT LUTf extrapolates as a + (b-a)*diff. mix's a*(1-diff)+b*diff
  // loses precision when HDR values extend far past the last sample.
  vec2 value = a + (b - a) * (p - float(i));
  return inverse ? value.y : value.x;
}

vec3 dcpHsv(vec3 c) {
  float lo = min(c.r, min(c.g, c.b)), hi = max(c.r, max(c.g, c.b)), delta = hi - lo, h = 0.0, s = 0.0;
  if (delta >= 0.00001 / 65535.0) {
    s = delta / hi;
    h = hi == c.r ? (c.g - c.b) / delta : hi == c.g ? 2.0 + (c.b - c.r) / delta : 4.0 + (c.r - c.g) / delta;
    if (h < 0.0) h += 6.0;
    else if (h > 6.0) h -= 6.0;
  }
  return vec3(h, s, hi);
}

vec3 dcpRgb(vec3 hsv) {
  float h = hsv.x;
  if (h < 0.0) h += 6.0;
  else if (h >= 6.0) h -= 6.0;
  int sector = int(h);
  float f = h - float(sector), v = hsv.z, vs = v * hsv.y, p = v - vs, q = v - f * vs, t = p + v - q;
  if (sector == 1) return vec3(q, v, p);
  if (sector == 2) return vec3(p, v, t);
  if (sector == 3) return vec3(p, q, v);
  if (sector == 4) return vec3(t, p, v);
  if (sector == 5) return vec3(v, p, q);
  return vec3(v, t, p);
}

// One hue/saturation/value table (calibration or look): table dimensions in dim.xyz, dim.w set
// when its value axis is gamma-encoded.
vec3 dcpHsd(highp sampler3D table, vec4 dim, vec3 hsv) {
  int nh = int(dim.x), ns = int(dim.y), nv = int(dim.z);
  float h = hsv.x * (nh < 2 ? 0.0 : dim.x / 6.0), s = hsv.y * (dim.y - 1.0);
  int h0 = max(int(h), 0), h1 = h0 + 1;
  if (h0 >= nh - 1) {
    h0 = nh - 1;
    h1 = 0;
  }
  int s0 = clamp(int(s), 0, ns - 2);
  float hf = h - float(h0), sf = s - float(s0), encoded = hsv.z, vf = 0.0;
  int v0 = 0;
  if (nv >= 2) {
    if (dim.w > 0.5) encoded = dcpGamma(hsv.z, false);
    float v = encoded * (dim.z - 1.0);
    v0 = clamp(int(v), 0, nv - 2);
    vf = v - float(v0);
  }
  vec3 a = mix(mix(texelFetch(table, ivec3(s0, h0, v0), 0).rgb, texelFetch(table, ivec3(s0, h1, v0), 0).rgb, hf),
               mix(texelFetch(table, ivec3(s0 + 1, h0, v0), 0).rgb, texelFetch(table, ivec3(s0 + 1, h1, v0), 0).rgb, hf), sf);
  if (nv >= 2) {
    vec3 b = mix(mix(texelFetch(table, ivec3(s0, h0, v0 + 1), 0).rgb, texelFetch(table, ivec3(s0, h1, v0 + 1), 0).rgb, hf),
                 mix(texelFetch(table, ivec3(s0 + 1, h0, v0 + 1), 0).rgb, texelFetch(table, ivec3(s0 + 1, h1, v0 + 1), 0).rgb, hf), sf);
    a = mix(a, b, vf);
  }
  return vec3(hsv.x + a.x / 60.0, hsv.y * a.y, dim.w > 0.5 ? dcpGamma(encoded * a.z, true) : hsv.z * a.z);
}

bool dcpAllOog(vec3 x) { return all(bvec3(x.r < 0.0 || x.r > 1.0, x.g < 0.0 || x.g > 1.0, x.b < 0.0 || x.b > 1.0)); }

float dcpCurveAt(float x) {
  float p = clamp(x, 0.0, 1.0) * 65535.0;
  int i = min(int(p), 65534), j = i + 1;
  float a = texelFetch(uDcpCurve, ivec2(i % 256, i / 256), 0).r;
  return mix(a, texelFetch(uDcpCurve, ivec2(j % 256, j / 256), 0).r, p - float(i));
}

// RT's RGB tone curve: the curve on the smallest and largest channel, the middle one in proportion.
vec3 dcpTone(vec3 x) {
  if (dcpAllOog(x)) return x;
  vec3 c = clamp(x, 0.0, 1.0);
  float lo = min(c.r, min(c.g, c.b)), hi = max(c.r, max(c.g, c.b));
  if (hi == lo) return vec3(dcpCurveAt(lo));
  float a = dcpCurveAt(lo), b = dcpCurveAt(hi);
  return vec3(a) + (b - a) * (c - lo) / (hi - lo);
}

// Early stage, before scene analysis: the camera matrix, then the calibration table.
vec3 stageDcpEarly(vec3 x) {
  vec3 p = uDcpMatrix * (uDcpToCamera * x / uDcpScale);
  if (uDcpHasCal > 0.5 && all(greaterThanEqual(p, vec3(0.0)))) p = dcpRgb(dcpHsd(uDcpCal, uDcpCalDims, dcpHsv(p)));
  return uDcpFromProPhoto * p * uDcpScale;
}

// Late stage, after scene edits: baseline exposure, the look table and the tone curve.
vec3 stageDcpLate(vec3 x) {
  if (uDcpOn < 0.5) return x;
  if (uDcpHasLook < 0.5 && uDcpHasCurve < 0.5) return x * uDcpExposure;
  vec3 p = max(uDcpToProPhoto * (x * uDcpExposure), vec3(0.0));
  if (uDcpHasLook > 0.5 && !dcpAllOog(p)) {
    vec3 h = dcpHsd(uDcpLook, uDcpLookDims, dcpHsv(clamp(p, 0.0, 65535.5 / 65535.0)));
    h.yz = clamp(h.yz, 0.0, 1.0);
    p = dcpRgb(h);
  }
  if (uDcpHasCurve > 0.5) p = dcpTone(p);
  return uDcpFromProPhoto * p;
}
