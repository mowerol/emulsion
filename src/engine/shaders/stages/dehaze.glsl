// Copyright (C) 2017-2025 darktable developers.
// Ported from darktable src/iop/hazeremoval.c (process) at commit
// 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2). Translated from C to GLSL; mirrors
// recover() in src/engine/dehaze.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Haze removal, in scene light right after the input (darktable runs it after lens correction,
// before exposure): the photo's instance and the masks' masked instances. Each is the haze-free
// pixel (x - A0) / t + A0 with the guided filter's transmission t at least darktable's minimum
// for Distance, blended by its mask; that is affine per pixel, so dehazegf.frag folds them all
// into (beta, alpha) per source pixel and this stage applies alpha x + beta.

uniform float uDehazeOn;
uniform sampler2D uDehazeTex;

vec3 stageDehaze(vec3 x, vec2 uv) {
  if (uDehazeOn < 0.5) return x;
  vec4 f = texture(uDehazeTex, uv);
  return f.a * x + f.rgb;
}
