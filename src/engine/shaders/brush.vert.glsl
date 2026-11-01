#version 300 es
// Copyright (C) 2013-2025 darktable developers.
// Ported from darktable src/develop/masks/brush.c at commit 20891f6c (see engine/brush.ts).
// SPDX-License-Identifier: GPL-3.0-or-later
//
// One brush segment per instance: the quad covers the segment grown by its larger border.
precision highp float;
precision highp int;
in vec2 aPos;
// Segments, three texels each (brushSegmentData in brushgpu.ts): ends, borders and hardness,
// density; uSegRow texels to a row.
uniform highp sampler2D uSeg;
uniform int uSegRow;
uniform vec2 uSize;
flat out vec4 vEnds;
flat out vec4 vBorder;
flat out vec2 vDensity;

vec4 seg(int k) {
  int i = gl_InstanceID * 3 + k;
  return texelFetch(uSeg, ivec2(i % uSegRow, i / uSegRow), 0);
}

void main() {
  vEnds = seg(0);
  vBorder = seg(1);
  vDensity = seg(2).xy;
  float r = max(vBorder.x, vBorder.y) + 1.0;
  vec2 lo = min(vEnds.xy, vEnds.zw) - r;
  vec2 hi = max(vEnds.xy, vEnds.zw) + r;
  vec2 px = mix(lo, hi, aPos * 0.5 + 0.5);
  gl_Position = vec4(px / uSize * 2.0 - 1.0, 0.0, 1.0);
}
