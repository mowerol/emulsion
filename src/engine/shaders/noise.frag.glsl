#version 300 es
// Copyright (C) 2026 darktable developers.
// RAW strength blend from restore_raw_linear.c at
// 0c67b465033205c46735c5a194f2b23d55e68363. TypeScript twin: film/noisereduction.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uOriginal;
uniform sampler2D uDenoised;
uniform float uAmount;
uniform float uSplit;
void main() {
  vec3 original = texture(uOriginal, vUv).rgb;
  vec3 denoised = texture(uDenoised, vUv).rgb;
  outColor = vec4(uSplit >= 0.0 ? (vUv.x < uSplit ? original : denoised) : mix(original, denoised, uAmount), 1.0);
}
