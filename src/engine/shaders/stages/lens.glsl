// Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Lens: RawTherapee's post-crop vignette, as light falloff before the film. The reference, with
// what is ported and the slider mapping, is src/engine/vignette.ts (vignetteAt).

// 2^-strength: the factor at the crop's corners. 1 is off.
uniform float uVigScale;
// Where the falloff starts, in units of the ellipse through the corners: (1 - feather) / √2.
uniform float uVigInner;
// Whole-source uv → crop coordinates (the inverse of uGeoU/V/W), so the vignette fits the crop
// in every pass, the source-space taps included.
uniform vec3 uVigGeoU;
uniform vec3 uVigGeoV;
uniform vec3 uVigGeoW;

vec3 stageLens(vec3 x, vec2 uv) {
  if (uVigScale >= 1.0) return x;
  vec3 f = vec3(uv, 1.0);
  vec2 c = vec2(dot(uVigGeoU, f), dot(uVigGeoV, f)) / dot(uVigGeoW, f);
  float t = 1.41421356 * length(c - 0.5);
  if (t <= uVigInner) return x;
  float v = cos(1.57079633 * min((t - uVigInner) / (1.0 - uVigInner), 1.0));
  v *= v;
  return x * (uVigScale + v * v * (1.0 - uVigScale));
}
