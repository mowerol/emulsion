#version 300 es
// Copyright (C) 2026 darktable developers.
// Film softness and Film edges on the photo's light (engine/filmdevgpu.ts): darktable spektrafilm's
// in-emulsion scatter (src/common/spektra_core.c sf_halation stage 1) and the spatial part of its
// DIR couplers (sf_sim_develop_corr, and the coupler field's diffusion in src/iop/spektrafilm.c
// process()), at c247126f9a7a2c3cdfc0f675a7698c24710438ca. Mirrors engine/scatter.ts and
// engine/filmdev.ts (deviations listed there). Film modeling powered by spektrafilm, GPLv3,
// © Andrea Volpato.
// SPDX-License-Identifier: GPL-3.0-or-later
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 outColor;
#include "stages/filmcore.glsl"

uniform sampler2D uSource;
uniform sampler2D uOther;
uniform sampler2D uThird;
// 0 scatter, across: per-channel kernel. 1 scatter, down, into the mix. 2 the coupler correction.
// 3 a spread component's blur along uDir. 4 a spread component into the mix. 5 the result.
uniform int uMode;
uniform vec3 uK[49];
uniform int uRadius;
uniform float uKs[20];
uniform ivec2 uDir;
uniform vec3 uWeight;
uniform float uReset;
uniform float uScatter;
// The light that exposes the film: the photo's white balance and exposure.
uniform mat3 uWb;
uniform mat3 uWbInv;
uniform float uGain;
uniform float uEdges;
uniform float uStock;

vec4 fetch(sampler2D t, ivec2 p) {
  ivec2 s = textureSize(t, 0);
  return texelFetch(t, clamp(p, ivec2(0), s - 1), 0);
}

// darktable's coupler spread on a film stock: delta - (c(e + delta) - c(e)) = spatial, by Newton's
// method on I - M diag(s'(e + delta)) (engine/filmdev.ts stockDelta).
vec3 stockDelta(vec3 e, vec3 spatial) {
  vec3 ce = filmCorrection(e), d = spatial;
  const float h = 1e-3;
  for (int it = 0; it < 4; it++) {
    vec3 at = e + d;
    vec3 f = d - (filmCorrection(at) - ce) - spatial;
    vec3 ds = (filmSilver(at + h) - filmSilver(at - h)) / (2.0 * h);
    mat3 J = mat3(1.0) - mat3(uFilmM[0] * ds.x, uFilmM[1] * ds.y, uFilmM[2] * ds.z);
    d -= inverse(J) * f;
  }
  return d;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (uMode == 0 || uMode == 1) {
    ivec2 step = uMode == 0 ? ivec2(1, 0) : ivec2(0, 1);
    vec3 c = uK[0] * fetch(uSource, p).rgb;
    for (int i = 1; i <= uRadius; i++) c += uK[i] * (fetch(uSource, p + step * i).rgb + fetch(uSource, p - step * i).rgb);
    if (uMode == 0) { outColor = vec4(c, 1.0); return; }
    vec4 original = fetch(uThird, p);
    vec3 base = uReset > 0.5 ? (1.0 - uScatter) * original.rgb : fetch(uOther, p).rgb;
    outColor = vec4(base + uWeight * c, original.a);
  } else if (uMode == 2) {
    vec3 x = max(uWb * fetch(uSource, p).rgb * uGain, vec3(0.0));
    outColor = vec4(filmCorrection(filmExposure(x)), 1.0);
  } else if (uMode == 3) {
    vec3 c = uKs[0] * fetch(uSource, p).rgb;
    for (int i = 1; i <= uRadius; i++) c += uKs[i] * (fetch(uSource, p + uDir * i).rgb + fetch(uSource, p - uDir * i).rgb);
    outColor = vec4(c, 1.0);
  } else if (uMode == 4) {
    vec3 c = uWeight * texture(uSource, vUv).rgb;
    if (uReset < 0.5) c += fetch(uOther, p).rgb;
    outColor = vec4(c, 1.0);
  } else {
    vec4 src = fetch(uSource, p);
    vec3 x = max(uWb * src.rgb * uGain, vec3(0.0));
    vec3 e = filmExposure(x);
    vec3 spatial = filmCorrection(e) - fetch(uOther, p).rgb;
    vec3 d = uStock > 0.5 ? stockDelta(e, spatial) : spatial;
    vec3 moved = x * exp2(uEdges * d * 3.321928094887362);
    outColor = vec4(uWbInv * moved / uGain, src.a);
  }
}
