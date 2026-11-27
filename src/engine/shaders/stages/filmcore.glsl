// Copyright (C) 2026 darktable developers.
// Film stage: a spektrafilm stock from scene light, in place of the neutral sigmoid. The lattices
// are baked by darktable's own engine (src/common/spektra_sim.c at
// c247126f9a7a2c3cdfc0f675a7698c24710438ca) in tools/spektrabake; between them, darktable's
// development: sf_sim_develop_corr (the DIR coupler correction) and sf_sim_develop (the curve
// lookup, interp_curve_uniform_f). Film modeling powered by spektrafilm, GPLv3, © Andrea Volpato.
// Mirrors src/engine/film.ts (deviations listed there).
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The film's lookups, shared by the develop pass (stages/film.glsl, the stock's data on the look
// LUT's unit, as a film stock has no look LUT) and the Film edges pass (filmdev.frag.glsl):
// n x n x (2n + 1), LUT A in slices 0..n-1, LUT B in n..2n-1, the curves in the last slice.

// The develop pass defines FILM_TEX as uLutTex (the same unit; one more sampler would exceed 16).
#ifndef FILM_TEX
uniform highp sampler3D uFilmTex;
#define FILM_TEX uFilmTex
#endif

uniform float uFilmOn;
uniform float uFilmAmount;
uniform int uFilmN;
uniform vec2 uFilmShaper;
uniform vec3 uFilmDensityLo;
uniform vec3 uFilmDensityHi;
// le0, 1 / le_step
uniform vec2 uFilmCurve;
// active, positive, donor Langmuir, receiver Langmuir
uniform vec4 uFilmCouplers;
uniform mat3 uFilmM;
uniform vec3 uFilmDonorK;
uniform vec3 uFilmDonorDref;
uniform vec3 uFilmReceiverK;
uniform vec3 uFilmReceiverCref;
uniform vec3 uFilmDmax;

vec3 filmAt(int r, int g, int b) { return texelFetch(FILM_TEX, ivec3(r, g, b), 0).rgb; }

// darktable lut3d's tetrahedral interpolation on the lattice starting at slice z0.
vec3 filmTetra(vec3 p, int z0) {
  int n = uFilmN;
  vec3 s = clamp(p, 0.0, 1.0) * float(n - 1);
  ivec3 i = min(ivec3(s), ivec3(n - 2));
  vec3 f = s - vec3(i);
  float r = f.r, g = f.g, b = f.b;
  int z = z0 + i.b;
  vec3 c000 = filmAt(i.r, i.g, z), c111 = filmAt(i.r + 1, i.g + 1, z + 1);
  if (r > g) {
    if (g > b) return (1.0 - r) * c000 + (r - g) * filmAt(i.r + 1, i.g, z) + (g - b) * filmAt(i.r + 1, i.g + 1, z) + b * c111;
    if (r > b) return (1.0 - r) * c000 + (r - b) * filmAt(i.r + 1, i.g, z) + (b - g) * filmAt(i.r + 1, i.g, z + 1) + g * c111;
    return (1.0 - b) * c000 + (b - r) * filmAt(i.r, i.g, z + 1) + (r - g) * filmAt(i.r + 1, i.g, z + 1) + g * c111;
  }
  if (b > g) return (1.0 - b) * c000 + (b - g) * filmAt(i.r, i.g, z + 1) + (g - r) * filmAt(i.r, i.g + 1, z + 1) + r * c111;
  if (b > r) return (1.0 - g) * c000 + (g - b) * filmAt(i.r, i.g + 1, z) + (b - r) * filmAt(i.r, i.g + 1, z + 1) + r * c111;
  return (1.0 - g) * c000 + (g - r) * filmAt(i.r, i.g + 1, z) + (r - b) * filmAt(i.r + 1, i.g + 1, z) + b * c111;
}

// interp_curve_uniform_f: curve 0 is curvesBefore, 1 curvesNorm; 256 points in the last slice.
float filmCurve(float x, int curve, int c) {
  float t = (x - uFilmCurve.x) * uFilmCurve.y;
  int n = uFilmN, base = curve * 256, z = 2 * n;
  if (t <= 0.0) return filmAt(base % n, base / n, z)[c];
  if (t >= 255.0) return filmAt((base + 255) % n, (base + 255) / n, z)[c];
  int i = int(t);
  float f = t - float(i);
  float a = filmAt((base + i) % n, (base + i) / n, z)[c], b = filmAt((base + i + 1) % n, (base + i + 1) / n, z)[c];
  return a + f * (b - a);
}

// LUT A: scene light to film log exposure.
vec3 filmExposure(vec3 x) {
  vec3 v = (log2(max(x, vec3(exp2(uFilmShaper.x)))) - uFilmShaper.x) / (uFilmShaper.y - uFilmShaper.x);
  return filmTetra(v, 0);
}

// The silver each layer develops (the coupler's donor), from its log exposure.
vec3 filmSilver(vec3 e) {
  vec3 d = vec3(filmCurve(e.r, 1, 0), filmCurve(e.g, 1, 1), filmCurve(e.b, 1, 2));
  vec3 silver = uFilmCouplers.y > 0.5 ? uFilmDmax - d : d;
  if (uFilmCouplers.z > 0.5) silver = silver * (uFilmDonorK + uFilmDonorDref) / (uFilmDonorK + silver);
  return silver;
}

// sf_sim_develop_corr: the DIR coupler correction this log exposure releases.
vec3 filmCorrection(vec3 e) {
  if (uFilmCouplers.x < 0.5) return vec3(0.0);
  return uFilmM * filmSilver(e);
}

// sf_sim_develop with the correction, then LUT B: the print, sRGB-encoded Rec.2020.
vec3 filmDevelop(vec3 e, vec3 corr) {
  if (uFilmCouplers.w > 0.5) corr = corr * (uFilmReceiverK + uFilmReceiverCref) / (uFilmReceiverK + corr);
  vec3 x = e - corr;
  vec3 d = vec3(filmCurve(x.r, 0, 0), filmCurve(x.g, 0, 1), filmCurve(x.b, 0, 2));
  return filmTetra((d - uFilmDensityLo) / (uFilmDensityHi - uFilmDensityLo), uFilmN);
}

vec3 stageFilm(vec3 x) {
  vec3 e = filmExposure(x);
  return filmDevelop(e, filmCorrection(e));
}

