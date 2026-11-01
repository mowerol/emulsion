// SPDX-License-Identifier: GPL-3.0-or-later
// Shared declarations and helpers. Included first by every fragment shader.
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 outColor;

// Output size in pixels, used for resolution-independent effects.
uniform vec2 uOut;
// Per-frame random seed so grain differs between frames but is stable.
uniform float uSeed;

const vec3 LUMA_W = vec3(0.2627, 0.6780, 0.0593); // Rec.2020, scene stages
const vec3 LUMA_D = vec3(0.2126, 0.7152, 0.0722); // Rec.709, display stages

vec3 srgbEotf(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
vec3 srgbOetf(vec3 l) {
  l = max(l, vec3(0.0));
  return mix(l * 12.92, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), l));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
