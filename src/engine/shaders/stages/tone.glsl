// SPDX-License-Identifier: GPL-3.0-or-later
// Tone: scene-linear light to a display-encoded print. Mirrors src/engine/tone.ts.
// Placeholder for a port of darktable's sigmoid.

// x: middle grey, y: black stops, z: white stops, w: display gamma
uniform vec4 uTone;
// Per-channel print contrast (stock contrast plus crossover).
uniform vec3 uToneC;
uniform float uSat;
uniform float uStockFade;

float tonePivot() { return -uTone.y / (uTone.z - uTone.y); }

float sCurve(float v, float c, float p) {
  v = clamp(v, 0.0, 1.0);
  return v < p ? p * pow(v / p, c) : 1.0 - (1.0 - p) * pow((1.0 - v) / (1.0 - p), c);
}

float toneForward(float x, float c) {
  float t = log2(max(x, 1e-10) / uTone.x);
  float u = clamp((t - uTone.y) / (uTone.z - uTone.y), 0.0, 1.0);
  return pow(sCurve(u, c, tonePivot()), uTone.w);
}

float toneInverse(float e) {
  float v = pow(clamp(e, 0.0, 1.0), 1.0 / uTone.w);
  return uTone.x * exp2(v * (uTone.z - uTone.y) + uTone.y);
}

vec3 stageTone(vec3 x, vec3 c) {
  return vec3(toneForward(x.r, c.r), toneForward(x.g, c.g), toneForward(x.b, c.b));
}

// Print saturation and the stock's black lift.
vec3 stagePrint(vec3 e) {
  if (uBW < 0.5) {
    float y = dot(e, LUMA_W);
    e = clamp(mix(vec3(y), e, uSat), 0.0, 1.0);
  }
  return uStockFade + e * (1.0 - uStockFade);
}
