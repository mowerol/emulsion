// Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
// Ported from RawTherapee rtengine/ipsharpen.cc (ImProcFunctions::sharpening) at commit
// b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c. Translated from C++ to GLSL. Mirrors src/engine/usm.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Sharpening, on the print: RawTherapee's unsharp mask changes CIE lightness
// and keeps Lab a and b, as it works on Lab L. The mask runs in the usm.frag
// passes over the whole photo; this stage adds its lightness change.
// Needs stages/clarity.glsl (clarityShift).

// 1 applies the change from uUsmTex (.r: change in lightness, 0 to 1 scale; .g: the contrast mask).
#include "stages/previewmap.glsl"
uniform float uUsmPreview;
uniform float uUsmOn;
uniform sampler2D uUsmTex;

vec3 stageUnsharpMask(vec3 e, vec2 uv) {
  if (uUsmOn < 0.5) return e;
  return clarityShift(e, texture(uUsmTex, previewMapUv(uv, uUsmPreview)).r);
}

/** The contrast mask as grey, for showing where Sharpening reaches. */
float usmMask(vec2 uv) { return texture(uUsmTex, previewMapUv(uv, uUsmPreview)).g; }
