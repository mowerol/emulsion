#version 300 es
// Copyright (C) 2013-2025 darktable developers.
// Ported from darktable src/develop/masks/brush.c (_brush_falloff_roi) at commit 20891f6c; mirrors
// segmentValue and falloff in engine/brush.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// A segment's falloff at this pixel, written to the channels left open; MAX blending keeps the
// largest over every segment of the shape (darktable's union of strokes).
precision highp float;
flat in vec4 vEnds;
flat in vec4 vBorder;
flat in vec2 vDensity;
out vec4 outColor;

void main() {
  vec2 q = gl_FragCoord.xy;
  vec2 a = vEnds.xy;
  vec2 d = vEnds.zw - a;
  float l = dot(d, d);
  float t = l > 0.0 ? clamp(dot(q - a, d) / l, 0.0, 1.0) : 0.0;
  float dist = length(q - (a + t * d));
  float r = mix(vBorder.x, vBorder.y, t);
  float solid = mix(vBorder.z, vBorder.w, t) * r;
  float density = mix(vDensity.x, vDensity.y, t);
  float v = dist >= r ? 0.0 : dist <= solid ? density : density * (r - dist) / (r - solid);
  outColor = vec4(v);
}
