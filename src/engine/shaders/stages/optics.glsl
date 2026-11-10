// SPDX-License-Identifier: GPL-3.0-or-later
// Optics: scanner sharpness, halation and glow.
//
// Halation is light that passes through the emulsion, reflects off the film
// base and comes back, mostly into the red layer: a warm halo around bright
// lights. Glow is diffusion, like a mist filter. stageOpticsScene mixes in the
// spektrafilm fields (opticsgpu.ts); stageOptics is the original renderer, kept
// for edits saved with it (blurred highlights from extract.frag.glsl and
// blur.frag.glsl, added after the tone curve).

uniform sampler2D uBlurTex;  // half-resolution blurred source
uniform sampler2D uHalTex;   // new: .rgb halation field; original: .a blurred halation energy
uniform sampler2D uGlowTex;  // new: .rgb diffusion field; original: .rgb blurred highlights
uniform float uStore;        // scale used when storing into 8-bit targets
uniform float uSharp;
uniform float uHal;
uniform vec3 uHalCol;
// Halation strength at 100 on the slider.
const float HALATION_GAIN = 7.0;
uniform float uGlow;
uniform float uHalModel;
uniform float uGlowModel;
uniform vec3 uHalStrength;
uniform float uGlowFraction;

// Copyright (C) 2026 darktable developers.
// Ported from spektrafilm_halation_apply / spektrafilm_diffusion_mix, darktable
// data/kernels/spektrafilm.cl at c96cf1d0de8fff468e9eddee28621e91f83bdf1a.
// Approved (Oli, 2026-11-10): RGB instead of spectral film exposures, Gaussian pyramid.
// New optics act on exposed scene light, before detail, grading and the look.
vec3 stageOpticsScene(vec3 x, vec2 uv) {
  if (uGlowModel > 1.5 && uGlow > 0.0)
    x = (1.0 - uGlowFraction) * x + uGlowFraction * texture(uGlowTex, uv).rgb / uStore;
  if (uHalModel > 1.5 && uHal > 0.0)
    x = (x + uHalStrength * texture(uHalTex, uv).rgb / uStore) / (vec3(1.0) + uHalStrength);
  return x;
}

// Unsharp mask in the log domain, so it behaves the same at every brightness.
vec3 stageSharpen(vec3 x, vec2 uv) {
  if (uSharp == 0.0) return x;
  vec3 xb = stageInput(texture(uBlurTex, uv));
  vec3 ratio = clamp(x / max(xb, vec3(1e-6)), 0.25, 4.0);
  return x * pow(ratio, vec3(uSharp));
}

vec3 stageOptics(vec3 x, vec2 uv) {
  if (uHalModel < 1.5 && uHal > 0.0) x += uHalCol * (texture(uHalTex, uv).a / uStore) * uHal * HALATION_GAIN;
  if (uGlowModel < 1.5 && uGlow > 0.0) x = x * (1.0 - 0.2 * uGlow) + (texture(uGlowTex, uv).rgb / uStore) * uGlow * 0.95;
  return x;
}
