// Copyright (C) 2013-2025 darktable developers.
// Copyright (C) 2009-2026 darktable developers (colour space conversions).
// Ported from darktable src/develop/masks/gradient.c, ellipse.c, group.c, src/develop/blend.c
// with blends/blendif_rgb_jzczhz.c, and src/common/colorspaces_inline_conversions.h at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release
// 5.6.2). Translated from C to GLSL; mirrors src/engine/masks.ts (see there for what differs).
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Needs stages/toneequalizer.glsl, stages/colorbalance.glsl and stages/optics.glsl included first.
//
// Masks: each is a group of shapes, evaluated per source pixel, with its own masked exposure and
// white balance (at the exposure stage), tone equalizer, glow and colour balance instances (after
// the photo's own). A
// mask is evaluated once, at its exposure instance (drawn × ranges × opacity, or its refined
// raster from the mask stack), and later instances reuse that value, as darktable's raster masks
// let one instance use another's final mask.

#define MAX_MASKS 8
#define MAX_SHAPES 32

// Shapes, three vec4 each (packShapes in masks.ts).
uniform vec4 uMaskShapes[MAX_SHAPES * 3];
uniform float uMaskShapeCount;
uniform float uMaskCount;
// Per mask: [blend opacity 0-1, exposure gain, colour balance on, refined (read from the stack)].
uniform vec4 uMaskMeta[MAX_MASKS];
// Per mask: CAT16 from the photo's white to the mask's.
uniform mat3 uMaskWb[MAX_MASKS];
// Per mask, its local instances: x tone equalizer on, y its tile in the tone equalizer's atlas,
// z its haze removal instance's mask refined at that instance (stack layers 3 and 4).
uniform vec4 uMaskLocal[MAX_MASKS];
// Per mask, the tone equalizer's band factors (two vec4).
uniform vec4 uMaskTeq[MAX_MASKS * 2];
// Per mask, a colour balance instance (cbUniform), ten vec4 each.
uniform vec4 uMaskCb[MAX_MASKS * 10];
// Which mask to show as an overlay (its index), or -1.
uniform float uMaskShow;
// Per mask, darktable's blendif markers for Jz, Cz and hz (three vec4 each), and which are on
// (0 off, 1 on, 2 on and inverted) in xyz.
uniform vec4 uMaskRange[MAX_MASKS * 3];
uniform vec4 uMaskRangeOn[MAX_MASKS];
// Working RGB to XYZ (D65), for JzAzBz.
uniform mat3 uMaskToXyz;
// The mask stack (maskstack.ts): layer 0 the brush shapes (BrushGpu), one channel each; layers 1
// and 2 refined masks, one channel per packed mask; layers 3 and 4 likewise, refined at the masks'
// haze removal instances.
uniform highp sampler2DArray uMaskStack;
// The stack layer the AI objects start at: object k is in layer uMaskObjectLayer + k / 4, channel
// k % 4 (ObjectGpu).
uniform float uMaskObjectLayer;
// The packed mask (slot) whose input and unrefined value the refinement tap writes, or -1.
uniform float uMaskTap;
// Per mask, a spektrafilm diffusion instance after the photo's optics: [diffusion fraction (0
// off), its field's layer in uMaskGlowTex, Glow size, 0] (opticsgpu.ts makes the fields).
uniform vec4 uMaskGlow[MAX_MASKS];
uniform float uMaskGlowCount;
uniform highp sampler2DArray uMaskGlowTex;
// Only the masks before this slot apply their Glow: a masked instance's input (extract.frag).
uniform float uMaskGlowUpTo;

float maskChannel(vec4 t, int c) {
  return c == 0 ? t.r : c == 1 ? t.g : c == 2 ? t.b : t.a;
}

float maskBrush(float channel, vec2 uv) {
  return maskChannel(texture(uMaskStack, vec3(uv, 0.0)), int(channel + 0.5));
}

// An AI object's pixels (darktable's pixel mask), resampled into the stack.
float maskObject(float k, vec2 uv) {
  int i = int(k + 0.5);
  return maskChannel(texture(uMaskStack, vec3(uv, uMaskObjectLayer + float(i / 4))), i - (i / 4) * 4);
}

float maskRefined(int i, vec2 uv) {
  return maskChannel(texture(uMaskStack, vec3(uv, float(1 + i / 4))), i - (i / 4) * 4);
}

// A mask refined at its haze removal instance's input (layers 3 and 4, as 1 and 2).
float maskRefinedDehaze(int i, vec2 uv) {
  return maskChannel(texture(uMaskStack, vec3(uv, float(3 + i / 4))), i - (i / 4) * 4);
}

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

// darktable's dt_XYZ_2_JzAzBz and dt_JzAzBz_2_JzCzhz.
vec3 maskJzCzhz(vec3 rgb) {
  vec3 xyz = uMaskToXyz * rgb;
  vec3 p = vec3(1.15 * xyz.x - 0.15 * xyz.z, 0.66 * xyz.y + 0.34 * xyz.x, xyz.z);
  vec3 lms = vec3(0.41478972 * p.x + 0.579999 * p.y + 0.014648 * p.z,
                  -0.20151 * p.x + 1.120649 * p.y + 0.0531008 * p.z,
                  -0.0166008 * p.x + 0.2648 * p.y + 0.6684799 * p.z);
  vec3 t = pow(max(lms / 10000.0, vec3(0.0)), vec3(0.159301758));
  lms = pow((0.8359375 + 18.8515625 * t) / (1.0 + 18.6875 * t), vec3(134.034375));
  float iz = 0.5 * lms.x + 0.5 * lms.y;
  float az = 3.524 * lms.x - 4.066708 * lms.y + 0.542708 * lms.z;
  float bz = 0.199076 * lms.x + 1.096799 * lms.y - 1.295875 * lms.z;
  float jz = max(0.44 * iz / (1.0 - 0.56 * iz) - 1.6295499532821566e-11, 0.0);
  float h = atan(bz, az) / 6.283185307179586;
  return vec3(jz, length(vec2(az, bz)), h >= 0.0 ? h : 1.0 + h);
}

// darktable's _blendif_compute_factor, with the slopes of dt_develop_blendif_process_parameters.
float maskBlendif(float value, vec4 p, float on) {
  float f;
  if (value <= p.x) f = 0.0;
  else if (value < p.y) f = (value - p.x) / max(0.001, p.y - p.x);
  else if (value <= p.z) f = 1.0;
  else if (value < p.w) f = 1.0 - (value - p.z) / max(0.001, p.w - p.z);
  else f = 0.0;
  return on > 1.5 ? 1.0 - f : f;
}

// Every mask's drawn value at a source point, after its blend opacity.
float gMask[MAX_MASKS];
// Every mask's final value, set at its exposure instance and reused after.
float gMaskFinal[MAX_MASKS];
// The shown mask's value as its exposure instance saw it.
float gMaskShown;
vec2 gMaskUv;
// The refinement tap's output, (the instance's input, the unrefined mask), once written.
vec4 gMaskTapOut;
bool gMaskTapped;

// The mask at an instance whose input is `x`: drawn times parametric (darktable's exclusive mode).
float maskAt(int i, vec3 x) {
  vec4 on = uMaskRangeOn[i];
  if (gMask[i] <= 0.0 || on.x + on.y + on.z < 0.5) return gMask[i];
  vec3 j = maskJzCzhz(x);
  float f = 1.0;
  if (on.x > 0.5) f *= maskBlendif(j.x, uMaskRange[i * 3], on.x);
  if (on.y > 0.5) f *= maskBlendif(j.y, uMaskRange[i * 3 + 1], on.y);
  if (on.z > 0.5) f *= maskBlendif(j.z, uMaskRange[i * 3 + 2], on.z);
  return gMask[i] * f;
}

void computeMasks(vec2 uv, vec2 dim) {
  gMaskUv = uv;
  gMaskTapped = false;
  gMaskTapOut = vec4(0.0);
  for (int i = 0; i < MAX_MASKS; i++) { gMask[i] = 0.0; gMaskFinal[i] = 0.0; }
  int count = int(uMaskShapeCount + 0.5);
  vec2 px = uv * dim;
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= count) break;
    vec4 h = uMaskShapes[i * 3], p = uMaskShapes[i * 3 + 1], q = uMaskShapes[i * 3 + 2];
    float raw = h.x < 1.5 ? maskGradient(p, q, px, dim) : h.x < 2.5 ? maskEllipse(p, q, px, dim) : h.x < 3.5 ? maskBrush(p.x, uv) : maskObject(p.x, uv);
    float invert = h.x < 1.5 ? q.z : q.w;
    float value = h.z * (invert > 0.5 ? 1.0 - raw : raw);
    int m = int(h.w + 0.5);
    gMask[m] = maskCombine(h.y, gMask[m], value);
  }
  int masks = int(uMaskCount + 0.5);
  for (int i = 0; i < MAX_MASKS; i++) if (i < masks) gMask[i] *= uMaskMeta[i].x;
  gMaskShown = 0.0;
}

// Masked exposure and white balance, as darktable's exposure (and a white balance) instance with a
// drawn mask: the adjusted pixel blended in at the mask's value.
vec3 stageMaskExposure(vec3 x) {
  int masks = int(uMaskCount + 0.5);
  for (int i = 0; i < MAX_MASKS; i++) {
    if (i >= masks) break;
    if (float(i) == uMaskTap) {
      gMaskTapOut = vec4(x, maskAt(i, x));
      gMaskTapped = true;
      return x;
    }
    float m = uMaskMeta[i].w > 0.5 ? maskRefined(i, gMaskUv) : maskAt(i, x);
    gMaskFinal[i] = m;
    if (float(i) == uMaskShow) gMaskShown = m;
    if (m <= 0.0) continue;
    vec3 adjusted = (uMaskWb[i] * x) * uMaskMeta[i].y;
    x = mix(x, adjusted, m);
  }
  return x;
}

// Masked tone equalizer instances, after the photo's own: each with its own map (made from its
// own input, see Engine.toneEqualizerMap), blended normally by the mask.
vec3 stageMaskToneEqualizer(vec3 x, vec2 uv) {
  int masks = int(uMaskCount + 0.5);
  for (int i = 0; i < MAX_MASKS; i++) {
    if (i >= masks) break;
    float m = gMaskFinal[i];
    vec4 l = uMaskLocal[i];
    if (m <= 0.0 || l.x < 0.5) continue;
    x = mix(x, x * teqGain(x, uv, l.y, uMaskTeq[i * 2], uMaskTeq[i * 2 + 1]), m);
  }
  return x;
}

// Masked Glow: darktable's second spektrafilm diffusion instance after the photo's optics, each
// with its own field (blurred from its own input), blended normally by the mask.
vec3 stageMaskGlow(vec3 x, vec2 uv) {
  if (uMaskGlowCount < 0.5) return x;
  int masks = int(uMaskCount + 0.5);
  for (int i = 0; i < MAX_MASKS; i++) {
    if (i >= masks || float(i) >= uMaskGlowUpTo) break;
    float m = gMaskFinal[i];
    vec4 g = uMaskGlow[i];
    if (m <= 0.0 || g.x <= 0.0) continue;
    vec3 diffused = (1.0 - g.x) * x + g.x * texture(uMaskGlowTex, vec3(uv, g.y)).rgb / uStore;
    x = mix(x, diffused, m);
  }
  return x;
}

// Masked colour balance instances, after the photo's own.
vec3 stageMaskColorBalance(vec3 x) {
  int masks = int(uMaskCount + 0.5);
  for (int i = 0; i < MAX_MASKS; i++) {
    if (i >= masks) break;
    float m = gMaskFinal[i];
    if (m <= 0.0 || uMaskMeta[i].z < 0.5) continue;
    vec4 P[10];
    for (int k = 0; k < 10; k++) P[k] = uMaskCb[i * 10 + k];
    x = mix(x, colorBalanceRgb(x, P), m);
  }
  return x;
}

// The shown mask (as its exposure instance saw it) over the display image, darktable's yellow
// mask display at half strength.
vec3 maskOverlay(vec3 d) {
  if (uMaskShow < -0.5) return d;
  return mix(d, vec3(1.0, 0.85, 0.0), 0.5 * gMaskShown);
}
