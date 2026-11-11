#version 300 es
// Copyright (C) 2012-2026 darktable developers.
// Ported from darktable src/common/interpolation.c at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773
// (release 5.6.2): Lanczos3 downscaling as `dt_interpolation_resample` (`_maketaps_lanczos`,
// `_compute_downsampling_kernel`, BORDER_REPLICATE), one axis per pass. Translated from C to
// GLSL; `dt_vector_sin` is `sin`. The TypeScript reference is src/engine/resample.ts. Where
// upstream's tap count (W - t) / scale lands on a whole number, float rounding decides whether
// one more tap is taken; the GPU's division is not bit-exact with the CPU's, so such pixels can
// differ from the reference by up to ~1.5% on a one-pixel stripe (the probe's `resample`).
// Upstream's mapping is kept: output pixel x is input x / scale (pixel indices, not centres), so the
// shrunk image sits 0.5 · (1 - scale) of an output pixel right and down of a centre-aligned one
// (0.03 px at 1.07×, 0.17 px at 1.54×).
// SPDX-License-Identifier: GPL-3.0-or-later
precision highp float;
precision highp int;
out vec4 outColor;
uniform highp sampler2D uTex;
// out / in, below 1, the same on both axes (roi_out->scale).
uniform float uScale;
// 0 resamples x (the input's rows), 1 resamples y.
uniform int uAxis;

const float W = 3.0;
const int MAX_TAPS = 64;
const float PI = 3.14159265358979324;

float lanczosTap(float t) {
  float a = trunc(t), r = t - a;
  float sign = (int(a) & 1) != 0 ? -1.0 : 1.0;
  return (W * sign * sin(PI * r) * sin(PI * t / W) + 1e-9) / (PI * PI * t * t + 1e-9);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int x = uAxis == 0 ? p.x : p.y;
  int inN = textureSize(uTex, 0)[uAxis];
  float xin = ceil((float(x) - W) / uScale);
  float t = xin * uScale - float(x);
  int taps = int((W - t) / uScale);
  // Upstream steps four taps at a time: tap c of each run is t + c·scale, then += 4·scale.
  vec4 vt = t + vec4(0.0, 1.0, 2.0, 3.0) * uScale;
  float step4 = 4.0 * uScale;
  vec4 acc = vec4(0.0);
  float norm = 0.0;
  for (int i = 0; i < MAX_TAPS; i++) {
    if (i >= taps) break;
    int c = i & 3;
    float k = lanczosTap(vt[c]);
    int idx = clamp(int(xin) + i, 0, inN - 1);
    acc += k * texelFetch(uTex, uAxis == 0 ? ivec2(idx, p.y) : ivec2(p.x, idx), 0);
    norm += k;
    if (c == 3) vt += step4;
  }
  outColor = acc / norm;
}
