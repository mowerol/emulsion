// SPDX-License-Identifier: GPL-3.0-or-later
// Grain: the statistics of the Boolean film grain model of Newson, Faraj,
// Galerne and Delon (Computer Graphics Forum, 2017), implemented from the
// paper. Each pixel draws how many grains fall in its footprint (Poisson, with
// the mean that keeps the average tone) from a smooth random field, and shows
// the share of its area they leave covered. Thin areas break into a few
// grains, dense areas even out, and the fluctuation peaks in the midtones.
// Mirrors src/engine/grain.ts, which explains the model and sets the constants.

// x: grain area over footprint (kappa), y: clump in thin areas, z: clump size in pixels, w: amount
uniform vec4 uGrainA;
// Share of independent colour per dye layer (0 for black and white).
uniform float uChroma;

const float GRAIN_U_MIN = 0.0005;
const float GRAIN_U_MAX = 0.995;
const float GRAIN_NORMAL_ABOVE = 24.0;
const float GRAIN_FIELD_NORM = 1.106;

uvec3 pcg3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  return v;
}

float grainLattice(ivec2 p, uint layer) {
  return 2.0 * float(pcg3(uvec3(uvec2(p), layer)).x >> 8u) / 16777216.0 - 1.0;
}

float grainValueNoise(vec2 p, uint layer) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 s = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec2 c = ivec2(i);
  float a = grainLattice(c, layer);
  float b = grainLattice(c + ivec2(1, 0), layer);
  float d = grainLattice(c + ivec2(0, 1), layer);
  float e = grainLattice(c + ivec2(1, 1), layer);
  return a + (b - a) * s.x + (d - a) * s.y + (a - b - d + e) * s.x * s.y;
}

// Smooth, close to normal field with unit variance.
float grainField(vec2 px, float size, uint layer) {
  vec2 p = px / size;
  float s = grainValueNoise(p, layer);
  s += grainValueNoise(vec2(0.8 * p.x - 0.6 * p.y + 17.3, 0.6 * p.x + 0.8 * p.y + 41.7), layer + 1u);
  s += grainValueNoise(vec2(-0.6 * p.x + 0.8 * p.y + 83.1, -0.8 * p.x - 0.6 * p.y + 7.9), layer + 2u);
  s += grainValueNoise(vec2(-0.8 * p.x - 0.6 * p.y + 29.5, 0.6 * p.x - 0.8 * p.y + 61.2), layer + 3u);
  return s * GRAIN_FIELD_NORM;
}

float grainNormalCdf(float z) {
  float t = 1.0 / (1.0 + 0.2316419 * abs(z));
  float d = 0.3989422804014327 * exp(-z * z / 2.0);
  float p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0.0 ? 1.0 - p : p;
}

float grainCount(float m, float z) {
  if (m > GRAIN_NORMAL_ABOVE) return max(0.0, m + sqrt(m) * z);
  float v = grainNormalCdf(z);
  float p = exp(-m);
  float s = p;
  float k = 0.0;
  for (int i = 0; i < 72; i++) {
    if (v <= s) break;
    k += 1.0;
    p *= m / k;
    s += p;
  }
  return k;
}

// Tone u with grain for a standard normal draw z.
float grainTone(float u, float z) {
  float v = clamp(u, GRAIN_U_MIN, GRAIN_U_MAX);
  float k = min(0.9, uGrainA.x * (1.0 + uGrainA.y * (1.0 - v) * (1.0 - v)));
  // ln(1 - k) by series when k is tiny, where 1 - k loses precision.
  float l = k < 1e-3 ? -k * (1.0 + k * (0.5 + k / 3.0)) : log(1.0 - k);
  return 1.0 - exp(grainCount(-log(1.0 - v) / k, z) * l);
}

vec3 stageGrain(vec3 d, vec2 uv) {
  if (uGrainA.w <= 0.0) return d;
  vec2 px = uv * uOut;
  uint seed = uint(uSeed * 1000.0) * 64u;
  vec3 u = clamp(d, 0.0, 1.0);
  float common_ = grainField(px, uGrainA.z, seed);
  if (uChroma <= 0.0) {
    float g = grainTone(u.g, common_);
    return d + uGrainA.w * (g - u.g);
  }
  // Each dye layer has its own grain, drawn partly from a shared field so the
  // colour noise stays as subtle as on film; the mix keeps unit variance.
  float norm = inversesqrt((1.0 - uChroma) * (1.0 - uChroma) + uChroma * uChroma);
  vec3 g;
  for (int c = 0; c < 3; c++) {
    float own = grainField(px, uGrainA.z, seed + 16u * uint(c + 1));
    g[c] = grainTone(u[c], ((1.0 - uChroma) * common_ + uChroma * own) * norm);
  }
  return d + uGrainA.w * (g - u);
}
