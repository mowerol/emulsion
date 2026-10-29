// SPDX-License-Identifier: GPL-3.0-or-later
// Grain: clumped noise, strongest in the midtones, with a little dye-cloud
// colour on colour stocks. Sized relative to the frame, so a preview and a
// full-size export look alike. Candidate for a port of darktable's grain module.

uniform float uGrain;
uniform float uGrainSize;
uniform float uChroma;

float grainField(vec2 p) {
  return (valueNoise(p) - 0.5) + 0.55 * (valueNoise(p * 2.13 + 17.1) - 0.5);
}

vec3 stageGrain(vec3 d, vec2 uv) {
  if (uGrain <= 0.0) return d;
  float px = max(uGrainSize * uOut.x / 1600.0, 1e-4);
  vec2 gp = uv * uOut / px + uSeed * 37.0;
  vec3 n = vec3(grainField(gp));
  if (uChroma > 0.0) n = mix(n, vec3(grainField(gp + 101.3), grainField(gp + 211.7), grainField(gp + 307.9)), uChroma);
  float y = dot(d, LUMA_D);
  // Grain finer than a pixel averages out, so it fades rather than aliasing.
  return d + n * uGrain * 0.22 * (0.3 + 2.8 * y * (1.0 - y)) * min(1.0, px);
}
