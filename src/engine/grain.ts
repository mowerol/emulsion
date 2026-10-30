// Copyright (C) 2010-2024 darktable developers.
// Ported from darktable src/iop/grain.c at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773
// (release 5.6.2). Translated from C to TypeScript (and GLSL, in stages/grain.glsl). Changes: the
// paper response is evaluated directly rather than from its 128 × 128 table (inputs clamped to the
// table's range); the per-photo offset is Emulsion's seed rather than a hash of the file name modulo
// the view's width (which moves the grain between views); grain sits on the uncropped frame; Lab is
// relative to D65; the lightness channel only, darktable's default. The GPU twin works in single
// precision where darktable uses doubles, which moves its output by about 0.001 at most. Film speed: Size is darktable's
// coarseness in its own ISO units, and pushing or pulling the film multiplies it by 2^push, as a
// pushed film looks like a faster one.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Reference implementation of the grain stage: darktable's grain. Three
// octaves of simplex noise, weighted to match the power spectrum of real grain
// scans, at a size set by the film speed and relative to the frame, change
// lightness through a model of photographic paper's response, so grain is
// strongest in the midtones and fades in shadows and highlights.

/** The coarseness slider shows darktable's scale × this, as ISO. */
export const GRAIN_SCALE_FACTOR = 213.2;
export const ISO_MIN = 20;
export const ISO_MAX = 6400;
/** Film speeds offered as presets. */
export const ISOS = [50, 100, 200, 400, 800, 1600, 3200] as const;
const LIGHTNESS_STRENGTH_SCALE = 0.15;
const LUT_DELTA_MAX = 2;
const LUT_DELTA_MIN = 0.0001;
const PAPER_GAMMA = 1;

// prettier-ignore
export const PERMUTATION = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
  247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
  74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
  65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
  52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
  119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
  218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
  184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
];
const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1],
  [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];
const perm = (i: number) => PERMUTATION[i & 255];
const permMod = (i: number) => perm(i) % 12;
const fastFloor = (x: number) => (x > 0 ? Math.trunc(x) : Math.trunc(x) - 1);

/** _simplex_noise: 3D simplex noise, just inside [-1, 1]. */
export function simplexNoise(xin: number, yin: number, zin: number): number {
  const F3 = 1 / 3;
  const s = (xin + yin + zin) * F3;
  const i = fastFloor(xin + s);
  const j = fastFloor(yin + s);
  const k = fastFloor(zin + s);
  const G3 = 1 / 6;
  const t = (i + j + k) * G3;
  const x0 = xin - (i - t);
  const y0 = yin - (j - t);
  const z0 = zin - (k - t);
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 1, 0];
    else if (x0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 0, 1];
    else [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 1, 0, 1];
  } else {
    if (y0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 0, 1, 1];
    else if (x0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 0, 1, 1];
    else [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 1, 1, 0];
  }
  const corners = [
    [x0, y0, z0],
    [x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3],
    [x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3],
    [x0 - 1 + 3 * G3, y0 - 1 + 3 * G3, z0 - 1 + 3 * G3],
  ];
  const ii = i & 255;
  const jj = j & 255;
  const kk = k & 255;
  const gi = [
    permMod(ii + perm(jj + perm(kk))),
    permMod(ii + i1 + perm(jj + j1 + perm(kk + k1))),
    permMod(ii + i2 + perm(jj + j2 + perm(kk + k2))),
    permMod(ii + 1 + perm(jj + 1 + perm(kk + 1))),
  ];
  let n = 0;
  corners.forEach(([x, y, z], c) => {
    let tt = 0.6 - x * x - y * y - z * z;
    if (tt < 0) return;
    tt *= tt;
    const g = GRAD3[gi[c]];
    n += tt * tt * (g[0] * x + g[1] * y + g[2] * z);
  });
  return 32 * n;
}

/** _simplex_2d_noise: three octaves, "parametrized to match the power spectrum of real grain scans". */
export function grainNoise(x: number, y: number, zoom: number): number {
  const f = [0.491, 0.9441, 1.728];
  const a = [0.234, 0.785, 1.215];
  let total = 0;
  for (let o = 0; o < 3; o++) total += simplexNoise((x * f[o]) / zoom, (y * f[o]) / zoom, o) * a[o];
  return total;
}

const deltaFor = (mb: number) => LUT_DELTA_MAX * Math.exp((mb / 100) * Math.log(LUT_DELTA_MIN));

/** paper_resp: density of photographic paper for an exposure (0 to 1), with mid-tones bias mb. */
export function paperResp(exposure: number, mb: number, gp = PAPER_GAMMA): number {
  const d = deltaFor(mb);
  return (1 + 2 * d) / (1 + Math.exp((4 * gp * (0.5 - exposure)) / (1 + 2 * d))) - d;
}

/** paper_resp_inverse */
export function paperRespInverse(density: number, mb: number, gp = PAPER_GAMMA): number {
  const d = deltaFor(mb);
  return (-Math.log((1 + 2 * d) / (density + d) - 1) * (1 + 2 * d)) / (4 * gp) + 0.5;
}

/**
 * The change in L* (0 to 100) for grain gu at lightness l (0 to 1): what
 * evaluate_grain_lut tabulates, with gu and l clamped to the table's range.
 */
export function grainDelta(gu: number, l: number, mb: number): number {
  const g = Math.min(Math.max(gu, -0.5), 0.5);
  const ll = Math.min(Math.max(l, 0), 1);
  return 100 * (paperResp(g + paperRespInverse(ll, mb), mb) - ll);
}

/** The noise zoom for a film speed: darktable's (1 + 8 scale / 100) / 800 with scale = ISO / 213.2. */
export const zoomForIso = (iso: number) => (1 + (8 * (iso / GRAIN_SCALE_FACTOR)) / 100) / 800;

/** The film speed the grain is drawn at: Size, pushed or pulled. */
export const effectiveIso = (iso: number, push: number) => Math.min(ISO_MAX, Math.max(ISO_MIN, iso * 2 ** push));

export interface GrainParams {
  /** darktable's strength, 0 to 100. */
  strength: number;
  /** darktable's coarseness, in ISO. */
  iso: number;
  /** darktable's mid-tones bias, 0 to 100. */
  midtones: number;
  /** The per-photo offset of the noise, in units of the frame's shorter side. */
  offset: number;
}

/**
 * New L* (0 to 100) at a point of the frame: (x, y) in full-resolution pixels,
 * on a frame `fullW` × `fullH` shown at `scale` output pixels per full pixel.
 * Below or above 1:1 it averages 21 samples over the output pixel (rank-1 lattice).
 */
export function grainL(L: number, x: number, y: number, fullW: number, fullH: number, scale: number, p: GrainParams): number {
  const wd = Math.min(fullW, fullH);
  const nx = x / wd;
  const ny = y / wd;
  const zoom = zoomForIso(p.iso);
  let noise = 0;
  if (Math.abs(scale - 1) > 0.01) {
    const fib1 = 34;
    const fib2 = 21;
    const filtermul = 1 / (scale * wd);
    for (let l = 0; l < fib2; l++) {
      const px = l / fib2;
      let py = (l * fib1) / fib2;
      py -= Math.trunc(py);
      noise += (1 / fib2) * grainNoise(nx + px * filtermul + p.offset, ny + py * filtermul, zoom);
    }
  } else noise = grainNoise(nx + p.offset, ny, zoom);
  return L + grainDelta(noise * (p.strength / 100) * LIGHTNESS_STRENGTH_SCALE, L / 100, p.midtones);
}
