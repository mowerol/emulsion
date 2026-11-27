// Copyright (C) 2026 darktable developers.
// The Film stage: a spektrafilm stock rendered from scene light, in place of the neutral sigmoid.
// The lattices are baked by darktable's own engine (src/common/spektra_sim.c at
// c247126f9a7a2c3cdfc0f675a7698c24710438ca, data pack 0.3.3) in tools/spektrabake; what runs
// here per pixel is darktable's split of development, from sf_sim_develop_corr and
// sf_sim_develop (the coupler correction and the curve lookup, interp_curve_uniform_f), between
// the two lattices. Film modeling powered by spektrafilm, GPLv3, © Andrea Volpato.
// Mirrors stages/film.glsl. Plan: docs/plans/film-stage.md.
// Deviations (agreed with Oli): baked lattices instead of darktable's live tables (grid error under
// one 8-bit step); the input is Emulsion's linear Rec.2020 with a D65 white through the engine's
// own Rec.2020 setters, not darktable's D50-adapted working profile; each pixel's couplers act on
// itself here, as spektrafilm's LUT mode does, and their spread is Film edges (engine/filmdev.ts).
// A slide (`scan`) is scanned directly: lattice B maps film density to the scan.
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Vec3 } from '../film/stocks';

/** What a .film file's JSON holds (tools/spektrabake/main.c cmd_bake). */
export interface FilmMeta {
  film: string;
  /** The paper's profile, or "scan" for a slide. */
  print: string;
  push: number;
  pack: string;
  packHash: string;
  lutHash: string;
  n: number;
  /** LUT A's input: each channel log2-encoded over [lo, hi] stops. */
  shaper: [number, number];
  /** LUT B's input: film density per channel over [lo, hi]. */
  densityB: { lo: Vec3; hi: Vec3 };
  couplers: {
    active: number;
    positive: number;
    /** Row donor, column receiver, amount-scaled. */
    M: number[];
    dmax: Vec3;
    donorLangmuir: number;
    donorK: Vec3;
    donorDref: Vec3;
    receiverLangmuir: number;
    receiverK: Vec3;
    receiverCref: Vec3;
    diffusionUm: number;
    tailUm: number;
    tailWeight: number;
    le0: number;
    invLeStep: number;
    /** 256 x RGB: density from log exposure, before (curvesNorm) and after (curvesBefore) inhibition. */
    curvesNorm: number[];
    curvesBefore: number[];
  };
  scatter: { core: Vec3; tail: Vec3; tailWeight: Vec3 };
}

/** A baked film, as Film edges and the stage take it. */
export type Film = FilmData;

export interface FilmData {
  meta: FilmMeta;
  /** LUT A then LUT B, n^3 x RGB each, red fastest. */
  a: Float32Array;
  b: Float32Array;
}

export const FILM_CURVE_POINTS = 256;

function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

export class FilmError extends Error {}

/** A .film file: "EMFILM\0\1", the JSON's length, the JSON, then LUT A and LUT B in half floats. */
export function parseFilm(buf: ArrayBuffer): FilmData {
  const head = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
  if (String.fromCharCode(...head.slice(0, 6)) !== 'EMFILM' || head[6] !== 0 || head[7] !== 1) throw new FilmError('Not an Emulsion film file');
  const dv = new DataView(buf);
  const jsonLength = dv.getUint32(8, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jsonLength))) as FilmMeta;
  const count = meta.n ** 3 * 3;
  if (buf.byteLength !== 12 + jsonLength + count * 4) throw new FilmError(`Film file is ${buf.byteLength} bytes, expected ${12 + jsonLength + count * 4}`);
  const halves = new Uint16Array(buf, 12 + jsonLength, count * 2);
  const a = new Float32Array(count), b = new Float32Array(count);
  for (let i = 0; i < count; i++) { a[i] = halfToFloat(halves[i]); b[i] = halfToFloat(halves[count + i]); }
  return { meta, a, b };
}

/**
 * The GPU texture: n x n x (2n + 1) RGBA, LUT A in slices 0..n-1, LUT B in n..2n-1, and in the last
 * slice the curves, texel i (x = i mod n, y = floor(i / n)): curvesBefore at i < 256, curvesNorm
 * at 256 + i.
 */
export function filmTextureData(f: FilmData): { data: Float32Array; size: number; depth: number } {
  const n = f.meta.n, slice = n * n, depth = 2 * n + 1;
  const data = new Float32Array(slice * depth * 4);
  const put = (src: Float32Array, at: number) => {
    for (let i = 0; i < src.length / 3; i++) data.set([src[3 * i], src[3 * i + 1], src[3 * i + 2], 1], (at + i) * 4);
  };
  put(f.a, 0);
  put(f.b, slice * n);
  const curves = Float32Array.from([...f.meta.couplers.curvesBefore, ...f.meta.couplers.curvesNorm]);
  if (curves.length / 3 > slice) throw new FilmError('Curves do not fit the texture');
  put(curves, slice * 2 * n);
  return { data, size: n, depth };
}

/** darktable lut3d's tetrahedral interpolation over one n^3 lattice at `offset` (in texels). */
function tetra(lut: Float32Array, n: number, p: Vec3): Vec3 {
  const s = n - 1;
  const v = p.map(x => Math.min(1, Math.max(0, x)) * s);
  const i = v.map(x => Math.min(Math.floor(x), n - 2));
  const [r, g, b] = v.map((x, k) => x - i[k]);
  const at = (dr: number, dg: number, db: number, k: number) => lut[3 * (((i[2] + db) * n + (i[1] + dg)) * n + (i[0] + dr)) + k];
  return [0, 1, 2].map(k => {
    const c000 = at(0, 0, 0, k), c111 = at(1, 1, 1, k);
    if (r > g) {
      if (g > b) return (1 - r) * c000 + (r - g) * at(1, 0, 0, k) + (g - b) * at(1, 1, 0, k) + b * c111;
      if (r > b) return (1 - r) * c000 + (r - b) * at(1, 0, 0, k) + (b - g) * at(1, 0, 1, k) + g * c111;
      return (1 - b) * c000 + (b - r) * at(0, 0, 1, k) + (r - g) * at(1, 0, 1, k) + g * c111;
    }
    if (b > g) return (1 - b) * c000 + (b - g) * at(0, 0, 1, k) + (g - r) * at(0, 1, 1, k) + r * c111;
    if (b > r) return (1 - g) * c000 + (g - b) * at(0, 1, 0, k) + (b - r) * at(0, 1, 1, k) + r * c111;
    return (1 - g) * c000 + (g - r) * at(0, 1, 0, k) + (r - b) * at(1, 1, 0, k) + b * c111;
  }) as Vec3;
}

/** darktable's interp_curve_uniform_f on one channel of a 256-point curve. */
export function curveAt(curves: ArrayLike<number>, le0: number, invLeStep: number, x: number, c: number): number {
  const t = (x - le0) * invLeStep;
  if (t <= 0) return curves[c];
  if (t >= FILM_CURVE_POINTS - 1) return curves[(FILM_CURVE_POINTS - 1) * 3 + c];
  const i = Math.floor(t), f = t - i;
  return curves[i * 3 + c] + f * (curves[(i + 1) * 3 + c] - curves[i * 3 + c]);
}

/** Scene light to film log exposure (LUT A). */
export function filmExposure(f: FilmData, x: Vec3): Vec3 {
  const [lo, hi] = f.meta.shaper;
  return tetra(f.a, f.meta.n, x.map(v => (Math.log2(Math.max(v, 2 ** lo)) - lo) / (hi - lo)) as Vec3);
}

/** sf_sim_develop_corr: the DIR coupler correction a pixel's log exposure releases. */
export function filmCorrection(f: FilmData, e: Vec3): Vec3 {
  const c = f.meta.couplers;
  if (!c.active) return [0, 0, 0];
  const silver = e.map((v, k) => {
    const d = curveAt(c.curvesNorm, c.le0, c.invLeStep, v, k);
    const s = c.positive ? c.dmax[k] - d : d;
    return c.donorLangmuir ? s * (c.donorK[k] + c.donorDref[k]) / (c.donorK[k] + s) : s;
  });
  return [0, 1, 2].map(m => silver[0] * c.M[m] + silver[1] * c.M[3 + m] + silver[2] * c.M[6 + m]) as Vec3;
}

/** sf_sim_develop with a correction, then print and scan (LUT B): the sRGB-encoded Rec.2020 print. */
export function filmDevelop(f: FilmData, e: Vec3, corr: Vec3): Vec3 {
  const c = f.meta.couplers, { lo, hi } = f.meta.densityB;
  const d = e.map((v, k) => {
    let cr = corr[k];
    if (c.receiverLangmuir) cr = cr * (c.receiverK[k] + c.receiverCref[k]) / (c.receiverK[k] + cr);
    const density = curveAt(c.curvesBefore, c.le0, c.invLeStep, v - cr, k);
    return (density - lo[k]) / (hi[k] - lo[k]);
  }) as Vec3;
  return tetra(f.b, f.meta.n, d);
}

/** The Film stage on one pixel, couplers per pixel: scene light to the print. */
export function filmPrint(f: FilmData, x: Vec3): Vec3 {
  const e = filmExposure(f, x);
  return filmDevelop(f, e, filmCorrection(f, e));
}

/** The stage's uniforms (stages/film.glsl). */
export function filmUniforms(f: FilmData, amount: number) {
  const c = f.meta.couplers;
  return {
    uFilmOn: 1,
    uFilmAmount: amount,
    uFilmN: f.meta.n,
    uFilmShaper: f.meta.shaper,
    uFilmDensityLo: f.meta.densityB.lo,
    uFilmDensityHi: f.meta.densityB.hi,
    uFilmCurve: [c.le0, c.invLeStep],
    uFilmCouplers: [c.active, c.positive, c.donorLangmuir, c.receiverLangmuir],
    // GLSL fills a mat3 by columns, so column k is donor k's row and uFilmM * silver is the correction.
    uFilmM: c.M,
    uFilmDonorK: c.donorK,
    uFilmDonorDref: c.donorDref,
    uFilmReceiverK: c.receiverK,
    uFilmReceiverCref: c.receiverCref,
    uFilmDmax: c.dmax,
  };
}
