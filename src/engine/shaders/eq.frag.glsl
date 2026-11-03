#version 300 es
// Copyright (C) 2017-2024 darktable developers.
// Ported from darktable src/common/eaw.c (eaw_decompose_and_synthesize) at commit
// 20891f6c6fa7be995e5bf9dff9d1ee5062051773. Mirrors decompose() in src/engine/equalizer.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// One scale of the contrast equalizer's edge-avoiding à-trous wavelet on
// lightness (L*): uIn holds .r the image at this scale and the detail so far
// boosted by power of the Texture amount (equalizer.ts amountScales): .g by a
// (the mix's term), .b by c (the mix²'s). Writes the next coarser image and adds
// this scale's detail to both, so the change in L* is mix·.g + mix²·.b for every
// amount. With uFirst, uIn is the lightness itself in .r, and a masked
// instance's mask in .g, which .a then carries through every scale (for the
// fold, maskfold.frag).
//
// The image at each scale also goes to a one-channel target (outImage), which the next scale's
// 25 taps read through uImg: 4 bytes a tap instead of the RGBA's 16 (the same values; the
// RGBA's .r is only read on the first scale, from the lightness tap).
precision highp float;
precision highp int;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outImage;
layout(location = 2) out vec4 outCoarse;

uniform sampler2D uIn;
uniform sampler2D uImg;
uniform int uMult;
uniform float uA;
uniform float uC;
uniform float uSharpen;
uniform float uFirst;
// A second render attachment captures each preview instance's coarse change, split as .g and .b.
uniform float uCoarseCapture;
uniform float uCoarseOn;
uniform sampler2D uCoarse;

// The edge-avoiding 5 × 5 sum around p, at spacing uMult, from `img`'s .r.
void gather(sampler2D img, ivec2 p, ivec2 size, float c, out float sum, out float wgt) {
  float f[5] = float[5](1.0, 4.0, 6.0, 4.0, 1.0);
  sum = 0.0;
  wgt = 0.0;
  for (int jj = 0; jj < 5; jj++)
    for (int ii = 0; ii < 5; ii++) {
      float v = texelFetch(img, clamp(p + uMult * ivec2(ii - 2, jj - 2), ivec2(0), size), 0).r;
      float w = f[ii] * f[jj] / 256.0 * exp(-uSharpen * (c - v) * (c - v));
      sum += w * v;
      wgt += w;
    }
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 size = textureSize(uIn, 0) - 1;
  vec4 here = texelFetch(uIn, p, 0);
  float c, sum, wgt;
  if (uFirst > 0.5) {
    c = here.r;
    gather(uIn, p, size, c, sum, wgt);
  } else {
    c = texelFetch(uImg, p, 0).r;
    gather(uImg, p, size, c, sum, wgt);
  }
  float coarse = sum / wgt;
  float d = c - coarse;
  vec2 accum = uFirst > 0.5 ? vec2(0.0) : here.gb;
  float mask = uFirst > 0.5 ? here.g : here.a;
  outColor = vec4(coarse, accum + vec2(uA, uC) * d, mask);
  outImage = vec4(coarse, 0.0, 0.0, 1.0);
  vec2 coarseSum = uFirst > 0.5 ? vec2(0.0) : texelFetch(uCoarse, p, 0).rg;
  outCoarse = uCoarseCapture > 0.5 ? vec4(coarseSum + uCoarseOn * vec2(uA, uC) * d, 0.0, 1.0) : vec4(0.0, 0.0, 0.0, 1.0);
}
