// Copyright (C) 2016-2026 darktable developers.
// Ported from darktable src/common/locallaplacian.c and src/iop/bilat.c at commit
// 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2). Translated from C to GLSL;
// Lab relative to D65. Mirrors src/engine/locallaplacian.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Clarity, on the print: darktable's local laplacian filter changes CIE
// lightness and keeps Lab a and b. The filter itself runs in the ll*.frag
// passes over the whole photo; this stage adds its lightness change.
// Trial deviation (Oli, 2026-11-03, off by default): with uTextureLog the filter ran on log
// lightness before Exposure and stageClarityLog (texture.glsl) applies its change in scene light,
// before the film's curve, instead of this stage (detaillog.ts; NOTICE.md).

#include "stages/lab.glsl"

// 1 applies the filter's change from uClarityTex (.r: change in lightness, 0 to 1 scale): the
// photo's instance and the masks' masked instances folded together (maskfold.frag).
uniform float uClarityOn;
uniform sampler2D uClarityTex;
// The photo's amount over the one its map was made at (clarityScale in locallaplacian.ts): the
// filter's change is proportional to the amount on each side of zero, so a drag scales the map
// instead of making it again. 1 with masked instances, whose maps are always made again.
uniform float uClarityScale;

/** CIE lightness (0 to 1) of a tone-stage pixel: display-encoded Rec.2020. */
float clarityLightness(vec3 e) { return labL(srgbEotf(max(e, vec3(0.0)))) / 100.0; }

/** The pixel with its lightness moved by `delta` (0 to 1 scale), keeping Lab a and b. */
vec3 clarityShift(vec3 e, float delta) { return srgbOetf(labShiftL(srgbEotf(max(e, vec3(0.0))), 100.0 * delta)); }

vec3 stageClarity(vec3 e, vec2 uv) {
  if (uClarityOn < 0.5) return e;
  return clarityShift(e, uClarityScale * texture(uClarityTex, uv).r);
}
