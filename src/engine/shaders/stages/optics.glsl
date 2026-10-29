// SPDX-License-Identifier: GPL-3.0-or-later
// Optics: scanner sharpness, halation and glow.
//
// Halation is light that passes through the emulsion, reflects off the film
// base and comes back, mostly into the red layer: a warm halo around bright
// lights. Glow is diffusion, like a mist filter. Both are blurred copies of
// the scene's highlights, computed in separate passes (extract.frag.glsl,
// blur.frag.glsl) and added back here in scene light.

uniform sampler2D uBlurTex;  // half-resolution blurred source
uniform sampler2D uHalTex;   // .a: blurred halation energy
uniform sampler2D uGlowTex;  // .rgb: blurred highlights
uniform float uStore;        // scale used when storing into 8-bit targets
uniform float uSharp;
uniform float uHal;
uniform vec3 uHalCol;
// Halation strength at 100 on the slider.
const float HALATION_GAIN = 7.0;
uniform float uGlow;

// Unsharp mask in the log domain, so it behaves the same at every brightness.
vec3 stageSharpen(vec3 x, vec2 uv) {
  if (uSharp == 0.0) return x;
  vec3 xb = stageInput(texture(uBlurTex, uv));
  vec3 ratio = clamp(x / max(xb, vec3(1e-6)), 0.25, 4.0);
  return x * pow(ratio, vec3(uSharp));
}

vec3 stageOptics(vec3 x, vec2 uv) {
  if (uHal > 0.0) x += uHalCol * (texture(uHalTex, uv).a / uStore) * uHal * HALATION_GAIN;
  if (uGlow > 0.0) x = x * (1.0 - 0.2 * uGlow) + (texture(uGlowTex, uv).rgb / uStore) * uGlow * 0.95;
  return x;
}
