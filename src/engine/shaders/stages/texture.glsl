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

// 1 applies the change in L* in uTextureTex (.r): the photo's instance and the masks'
// masked instances folded together (maskfold.frag).
uniform float uTextureOn;
uniform sampler2D uTextureTex;
// 1 (Engine.detailOrder 'log'): the change is in log lightness, taken before Exposure
// (detaillog.glsl), and applied as a ratio of luminance.
uniform float uTextureLog;

vec3 stageTexture(vec3 x, vec2 uv) {
  if (uTextureOn < 0.5) return x;
  float d = texture(uTextureTex, uv).r;
  return labShiftL(x, uTextureLog > 0.5 ? logShift(x, d) : d);
}
