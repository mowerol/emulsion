// Copyright (C) 2010-2024 darktable developers.
// Ported from darktable src/iop/grain.c at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773
// (release 5.6.2). Translated from C to GLSL in single precision; the paper response is
// evaluated directly. Mirrors src/engine/grain.ts, which lists the changes.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Grain, on the print's lightness: darktable's grain. Three octaves of simplex
// noise, sized by the film speed relative to the frame, change L* through a
// model of photographic paper's response, keeping Lab a and b. Needs
// stages/clarity.glsl (clarityLightness, clarityShift).

// x: strength (0 to 1), y: noise zoom, z: the paper curve's delta (from the mid-tones bias), w: per-photo offset
uniform vec4 uGrain;
// The uncropped frame at full resolution, in pixels.
uniform vec2 uGrainFull;

const int GRAIN_PERM[256] = int[256](
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
  247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
  74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
  65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
  52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
  119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
  218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
  184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180
);
const vec3 GRAIN_GRAD3[12] = vec3[12](
  vec3(1, 1, 0), vec3(-1, 1, 0), vec3(1, -1, 0), vec3(-1, -1, 0), vec3(1, 0, 1), vec3(-1, 0, 1),
  vec3(1, 0, -1), vec3(-1, 0, -1), vec3(0, 1, 1), vec3(0, -1, 1), vec3(0, 1, -1), vec3(0, -1, -1)
);

int grainPerm(int i) { return GRAIN_PERM[i & 255]; }

float grainCorner(vec3 d, int gi) {
  float t = 0.6 - dot(d, d);
  if (t < 0.0) return 0.0;
  t *= t;
  return t * t * dot(GRAIN_GRAD3[gi], d);
}

// _simplex_noise
float grainSimplex(vec3 p) {
  const float F3 = 1.0 / 3.0;
  const float G3 = 1.0 / 6.0;
  float s = (p.x + p.y + p.z) * F3;
  ivec3 c = ivec3(floor(p + s));
  float t = float(c.x + c.y + c.z) * G3;
  vec3 d0 = p - (vec3(c) - t);
  ivec3 o1, o2;
  if (d0.x >= d0.y) {
    if (d0.y >= d0.z) { o1 = ivec3(1, 0, 0); o2 = ivec3(1, 1, 0); }
    else if (d0.x >= d0.z) { o1 = ivec3(1, 0, 0); o2 = ivec3(1, 0, 1); }
    else { o1 = ivec3(0, 0, 1); o2 = ivec3(1, 0, 1); }
  } else {
    if (d0.y < d0.z) { o1 = ivec3(0, 0, 1); o2 = ivec3(0, 1, 1); }
    else if (d0.x < d0.z) { o1 = ivec3(0, 1, 0); o2 = ivec3(0, 1, 1); }
    else { o1 = ivec3(0, 1, 0); o2 = ivec3(1, 1, 0); }
  }
  vec3 d1 = d0 - vec3(o1) + G3;
  vec3 d2 = d0 - vec3(o2) + 2.0 * G3;
  vec3 d3 = d0 - 1.0 + 3.0 * G3;
  ivec3 q = c & 255;
  int g0 = grainPerm(q.x + grainPerm(q.y + grainPerm(q.z))) % 12;
  int g1 = grainPerm(q.x + o1.x + grainPerm(q.y + o1.y + grainPerm(q.z + o1.z))) % 12;
  int g2 = grainPerm(q.x + o2.x + grainPerm(q.y + o2.y + grainPerm(q.z + o2.z))) % 12;
  int g3 = grainPerm(q.x + 1 + grainPerm(q.y + 1 + grainPerm(q.z + 1))) % 12;
  return 32.0 * (grainCorner(d0, g0) + grainCorner(d1, g1) + grainCorner(d2, g2) + grainCorner(d3, g3));
}

// _simplex_2d_noise: three octaves matched to the power spectrum of real grain scans.
float grainNoise(vec2 p, float zoom) {
  return grainSimplex(vec3(p * 0.4910 / zoom, 0.0)) * 0.2340
       + grainSimplex(vec3(p * 0.9441 / zoom, 1.0)) * 0.7850
       + grainSimplex(vec3(p * 1.7280 / zoom, 2.0)) * 1.2150;
}

float grainPaper(float exposure, float d) { return (1.0 + 2.0 * d) / (1.0 + exp(4.0 * (0.5 - exposure) / (1.0 + 2.0 * d))) - d; }
float grainPaperInverse(float density, float d) { return -log((1.0 + 2.0 * d) / (density + d) - 1.0) * (1.0 + 2.0 * d) / 4.0 + 0.5; }

vec3 stageGrain(vec3 e, vec2 uv) {
  if (uGrain.x <= 0.0) return e;
  float wd = min(uGrainFull.x, uGrainFull.y);
  vec2 n = uv * uGrainFull / wd;
  // Output pixels per full-resolution pixel; away from 1:1 darktable averages 21 samples (rank-1 lattice).
  float scale = uOut.x / uGrainFull.x;
  float noise = 0.0;
  if (abs(scale - 1.0) > 0.01) {
    float filtermul = 1.0 / (scale * wd);
    for (int l = 0; l < 21; l++) {
      float py = float(l) * 34.0 / 21.0;
      py -= floor(py);
      noise += grainNoise(n + vec2(float(l) / 21.0, py) * filtermul + vec2(uGrain.w, 0.0), uGrain.y) / 21.0;
    }
  } else {
    noise = grainNoise(n + vec2(uGrain.w, 0.0), uGrain.y);
  }
  float l = clamp(clarityLightness(e), 0.0, 1.0);
  float gu = clamp(noise * uGrain.x * 0.15, -0.5, 0.5);
  float delta = grainPaper(gu + grainPaperInverse(l, uGrain.z), uGrain.z) - l;
  return clarityShift(e, delta);
}
