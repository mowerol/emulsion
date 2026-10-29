// SPDX-License-Identifier: GPL-3.0-or-later
// Lens: vignetting, as light falloff before the film.

uniform float uVig;

vec3 stageLens(vec3 x, vec2 uv) {
  if (uVig <= 0.0) return x;
  vec2 q = uv - 0.5;
  float aspect = uOut.x / uOut.y;
  q.x *= aspect;
  float r = length(q) / length(vec2(aspect, 1.0) * 0.5);
  return x * (1.0 - uVig * 0.72 * smoothstep(0.2, 1.05, r));
}
