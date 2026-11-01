// Copyright (C) 2013-2025 darktable developers.
// Ported from darktable src/develop/masks/gradient.c, ellipse.c, group.c and src/develop/blend.c
// with blends/blendif_rgb_jzczhz.c at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release
// 5.6.2). Translated from C to GLSL; mirrors src/engine/masks.ts (see there for what differs).
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Masks: each is a group of shapes, evaluated per source pixel, with its own masked exposure and
// white balance (at the exposure stage) and colour balance instance (after the photo's own).

#define MAX_MASKS 8
#define MAX_SHAPES 32

// Shapes, three vec4 each (packShapes in masks.ts).
uniform vec4 uMaskShapes[MAX_SHAPES * 3];
uniform float uMaskShapeCount;
uniform float uMaskCount;
// Per mask: [blend opacity 0-1, exposure gain, colour balance on, 0].
uniform vec4 uMaskMeta[MAX_MASKS];
// Per mask: CAT16 from the photo's white to the mask's.
uniform mat3 uMaskWb[MAX_MASKS];
// Per mask, a colour balance instance (cbUniform), ten vec4 each.
uniform vec4 uMaskCb[MAX_MASKS * 10];
// Which mask to show as an overlay (its index), or -1.
uniform float uMaskShow;

float maskErf(float x) {
  float a = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * a);
  float y = 1.0 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return sign(x) * y;
}

float maskGradient(vec4 p, vec4 q, vec2 px, vec2 dim) {
  float hwscale = 1.0 / length(dim);
  float sinv = sin(-p.z), cosv = cos(-p.z);
  float xoffset = cosv * p.x * dim.x + sinv * p.y * dim.y;
  float yoffset = sinv * p.x * dim.x - cosv * p.y * dim.y;
  float compression = max(p.w, 0.001);
  float x0 = (cosv * px.x + sinv * px.y - xoffset) * hwscale;
  float y0 = (sinv * px.x - cosv * px.y - yoffset) * hwscale;
  float distance = y0 - q.x * x0 * x0;
  if (distance <= -4.0 * compression) return 0.0;
  if (distance >= 4.0 * compression) return 1.0;
  return clamp(0.5 + 0.5 * (q.y > 0.5 ? distance / compression : maskErf(distance / compression)), 0.0, 1.0);
}

float maskEllipse(vec4 p, vec4 q, vec2 px, vec2 dim) {
  float m = min(dim.x, dim.y);
  vec2 r = p.zw * m;
  vec2 t = (q.z > 0.5 ? p.zw * (1.0 + q.y) : p.zw + q.y) * m;
  vec2 d = px - p.xy * dim;
  float l2 = dot(d, d);
  float l = sqrt(l2);
  vec2 n = l > 0.0 ? d / l : vec2(0.0, 1.0);
  float ca = cos(q.x), sa = sin(q.x);
  float xr = n.x * ca + n.y * sa;
  float yr = -n.x * sa + n.y * ca;
  float cos2 = xr * xr, sin2 = yr * yr;
  float radius2 = r.x * r.x * r.y * r.y / (r.x * r.x * sin2 + r.y * r.y * cos2);
  float total2 = t.x * t.x * t.y * t.y / (t.x * t.x * sin2 + t.y * t.y * cos2);
  float f = clamp((total2 - l2) / (total2 - radius2), 0.0, 1.0);
  return f * f;
}

float maskCombine(float mode, float dest, float mask) {
  if (mode < 0.5) return mask;
  if (mode < 1.5) return max(dest, mask);
  if (mode < 2.5) return min(max(dest, 0.0), max(mask, 0.0));
  float pos = dest > 0.0 && mask > 0.0 ? 1.0 : 0.0;
  if (mode < 3.5) return dest * (1.0 - mask * pos);
  if (mode < 4.5) return min(1.0, dest + mask);
  return pos * max((1.0 - dest) * mask, dest * (1.0 - mask)) + (1.0 - pos) * max(dest, mask);
}

// Every mask's value at a source point, after its blend opacity.
float gMask[MAX_MASKS];

void computeMasks(vec2 uv, vec2 dim) {
  for (int i = 0; i < MAX_MASKS; i++) gMask[i] = 0.0;
  int count = int(uMaskShapeCount + 0.5);
  vec2 px = uv * dim;
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= count) break;
    vec4 h = uMaskShapes[i * 3], p = uMaskShapes[i * 3 + 1], q = uMaskShapes[i * 3 + 2];
    float raw = h.x < 1.5 ? maskGradient(p, q, px, dim) : maskEllipse(p, q, px, dim);
    float invert = h.x < 1.5 ? q.z : q.w;
    float value = h.z * (invert > 0.5 ? 1.0 - raw : raw);
    int m = int(h.w + 0.5);
    gMask[m] = maskCombine(h.y, gMask[m], value);
  }
  int masks = int(uMaskCount + 0.5);
  for (int i = 0; i < MAX_MASKS; i++) if (i < masks) gMask[i] *= uMaskMeta[i].x;
}

// Masked exposure and white balance, as darktable's exposure (and a white balance) instance with a
// drawn mask: the adjusted pixel blended in at the mask's value.
vec3 stageMaskExposure(vec3 x) {
  int masks = int(uMaskCount + 0.5);
  for (int i = 0; i < MAX_MASKS; i++) {
    if (i >= masks) break;
    if (gMask[i] <= 0.0) continue;
    vec3 adjusted = (uMaskWb[i] * x) * uMaskMeta[i].y;
    x = mix(x, adjusted, gMask[i]);
  }
  return x;
}

// Masked colour balance instances, after the photo's own.
vec3 stageMaskColorBalance(vec3 x) {
  int masks = int(uMaskCount + 0.5);
  for (int i = 0; i < MAX_MASKS; i++) {
    if (i >= masks) break;
    if (gMask[i] <= 0.0 || uMaskMeta[i].z < 0.5) continue;
    vec4 P[10];
    for (int k = 0; k < 10; k++) P[k] = uMaskCb[i * 10 + k];
    x = mix(x, colorBalanceRgb(x, P), gMask[i]);
  }
  return x;
}

// The shown mask over the display image, darktable's yellow mask display at half strength.
vec3 maskOverlay(vec3 d) {
  if (uMaskShow < -0.5) return d;
  int s = int(uMaskShow + 0.5);
  float m = 0.0;
  for (int i = 0; i < MAX_MASKS; i++) if (i == s) m = gMask[i];
  return mix(d, vec3(1.0, 0.85, 0.0), 0.5 * m);
}
