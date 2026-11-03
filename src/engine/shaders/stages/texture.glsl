// Copyright (C) 2010-2026 darktable developers.
// Copyright (C) 2017-2024 darktable developers (edge-avoiding wavelets).
// Ported from darktable src/iop/atrous.c and src/common/eaw.c at commit
// 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2). Translated from C to GLSL;
// lightness only, Lab relative to D65. Mirrors src/engine/equalizer.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Texture, in scene light: darktable's contrast equalizer changes CIE lightness
// by detail size and keeps Lab a and b. The wavelet passes (eq.frag) run over
// the whole photo; this stage adds their result.
// Trial deviation (Oli, 2026-11-03, off by default): with uTextureLog the detail was measured in
// log lightness before Exposure and is applied as a ratio of luminance (detaillog.glsl; NOTICE.md).
#include "stages/detaillog.glsl"
#include "stages/clarity.glsl"

// 1 applies the change in L* in uTextureTex (.r): the photo's instance and the masks'
// masked instances folded together (maskfold.frag).
uniform float uTextureOn;
uniform sampler2D uTextureTex;
// 1 (Engine.detailOrder 'log'): the change is in log lightness, taken before Exposure
// (detaillog.glsl), and applied as a ratio of luminance.
uniform float uTextureLog;

// Clarity with detail before Exposure (detaillog.ts): its input, on the local laplacian's 0-1
// scale within the extended grid (LOG_RANGE in locallaplacian.ts), and its change applied as a
// ratio of luminance in scene light (uClarityTex, clarity.glsl, holds it on that scale).
const vec2 LL_LOG_RANGE = vec2(-0.5, 7.0 / 6.0);
float clarityLogInput(vec3 lin, float du) { return clamp((logLightness(lin) + du) / 100.0, LL_LOG_RANGE.x, LL_LOG_RANGE.y); }
vec3 stageClarityLog(vec3 x, vec2 uv) {
  if (uTextureLog < 0.5 || uClarityOn < 0.5) return x;
  return labShiftL(x, logShift(x, 100.0 * texture(uClarityTex, uv).r));
}

vec3 stageTexture(vec3 x, vec2 uv) {
  if (uTextureOn < 0.5) return x;
  float d = texture(uTextureTex, uv).r;
  return labShiftL(x, uTextureLog > 0.5 ? logShift(x, d) : d);
}
