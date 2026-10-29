// Copyright (C) 2011-2022 darktable developers.
// Part of curve_tools.c is based on nikon_curve.c from UFraw,
// Copyright 2004-2008 by Shawn Freeman, Udi Fuchs.
// Ported from darktable src/common/curve_tools.c (monotone_hermite_set, catmull_rom_val and the
// sampling in CurveDataSample) and the node limits of src/iop/rgbcurve.c at commit
// 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2). Translated from C to TypeScript;
// samples are kept as floats rather than rounded to integers.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The point curve: a master RGB curve and one per channel, on display values,
// interpolated with darktable's monotone cubic spline so a curve never
// overshoots between its points.

export type CurvePoint = [number, number];
export type CurveChannel = 'rgb' | 'r' | 'g' | 'b';
export type ToneCurve = Record<CurveChannel, CurvePoint[]>;

export const CHANNELS: CurveChannel[] = ['rgb', 'r', 'g', 'b'];
/** darktable's MAX_ANCHORS. */
export const MAX_POINTS = 20;
/** darktable's DT_IOP_RGBCURVE_MIN_X_DISTANCE. */
export const MIN_X_DISTANCE = 0.0025;
/** Lookup table size the GPU samples; darktable's DT_IOP_RGBCURVE_RES. */
export const CURVE_RES = 256;

export const LINEAR: CurvePoint[] = [
  [0, 0],
  [1, 1],
];
export const IDENTITY_CURVE: ToneCurve = { rgb: LINEAR, r: LINEAR, g: LINEAR, b: LINEAR };

const EPSILON = 2 * 1.17549435e-38;

/** Tangents of a monotone cubic Hermite spline (darktable's monotone_hermite_set). */
export function monotoneTangents(x: number[], y: number[]): number[] {
  const n = x.length;
  const delta = new Array<number>(n).fill(0);
  const m = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n - 1; i++) delta[i] = (y[i + 1] - y[i]) / (x[i + 1] - x[i]);
  delta[n - 1] = delta[n - 2];
  m[0] = delta[0];
  m[n - 1] = delta[n - 1];
  for (let i = 1; i < n - 1; i++) m[i] = (delta[i - 1] + delta[i]) * 0.5;
  for (let i = 0; i < n; i++) {
    if (Math.abs(delta[i]) < EPSILON) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const alpha = m[i] / delta[i];
      const beta = m[i + 1] / delta[i];
      const tau = alpha * alpha + beta * beta;
      if (tau > 9) {
        m[i] = (3 * alpha * delta[i]) / Math.sqrt(tau);
        m[i + 1] = (3 * beta * delta[i]) / Math.sqrt(tau);
      }
    }
  }
  return m;
}

/** Evaluate the Hermite spline with `tangents` at `xv` (darktable's catmull_rom_val). */
export function hermiteValue(x: number[], y: number[], tangents: number[], xv: number): number {
  const n = x.length;
  let i = n - 2;
  for (let k = 0; k < n - 2; k++) {
    if (xv < x[k + 1]) {
      i = k;
      break;
    }
  }
  const h = x[i + 1] - x[i];
  const t = (xv - x[i]) / h;
  const t2 = t * t;
  const t3 = t * t2;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * y[i] + h10 * h * tangents[i] + h01 * y[i + 1] + h11 * h * tangents[i + 1];
}

/**
 * Sample a curve at `res` evenly spaced inputs in [0, 1]. Flat before the
 * first point and after the last, clamped to [0, 1], as darktable samples it.
 */
export function sampleCurve(points: CurvePoint[], res = CURVE_RES): Float32Array {
  const x = points.map((p) => p[0]);
  const y = points.map((p) => p[1]);
  const m = monotoneTangents(x, y);
  const out = new Float32Array(res);
  for (let i = 0; i < res; i++) {
    const v = i / (res - 1);
    const s = v < x[0] ? y[0] : v > x[x.length - 1] ? y[y.length - 1] : hermiteValue(x, y, m, v);
    out[i] = Math.min(1, Math.max(0, s));
  }
  return out;
}

export const isLinear = (points: CurvePoint[]) =>
  points.length === 2 && points[0][0] === 0 && points[0][1] === 0 && points[1][0] === 1 && points[1][1] === 1;

export const isIdentity = (c: ToneCurve | null) => !c || CHANNELS.every((k) => isLinear(c[k]));

/** Lookup table for the GPU: per input step, (master, red, green, blue). */
export function curveTable(c: ToneCurve): Float32Array {
  const cols = CHANNELS.map((k) => sampleCurve(c[k]));
  const out = new Float32Array(CURVE_RES * 4);
  for (let i = 0; i < CURVE_RES; i++) for (let k = 0; k < 4; k++) out[i * 4 + k] = cols[k][i];
  return out;
}

/**
 * Make a channel's points valid: inside [0, 1], sorted, at most MAX_POINTS, and
 * at least MIN_X_DISTANCE apart. Fewer than two points gives the straight line.
 */
export function normalizePoints(input: unknown): CurvePoint[] {
  if (!Array.isArray(input)) return LINEAR;
  const pts = input
    .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v)))
    .map(([x, y]) => [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))] as CurvePoint)
    .sort((a, b) => a[0] - b[0]);
  const out: CurvePoint[] = [];
  for (const p of pts) {
    if (out.length && p[0] - out[out.length - 1][0] < MIN_X_DISTANCE) continue;
    out.push(p);
    if (out.length === MAX_POINTS) break;
  }
  return out.length >= 2 ? out : LINEAR;
}

/** A curve read from a sidecar, or null when it is missing or straight. */
export function normalizeCurve(input: unknown): ToneCurve | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const c = Object.fromEntries(CHANNELS.map((k) => [k, normalizePoints(o[k])])) as ToneCurve;
  return isIdentity(c) ? null : c;
}
