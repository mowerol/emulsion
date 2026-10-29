// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  CURVE_RES,
  IDENTITY_CURVE,
  LINEAR,
  MAX_POINTS,
  curveTable,
  isIdentity,
  normalizeCurve,
  normalizePoints,
  sampleCurve,
  type CurvePoint,
} from './curve';

const at = (s: Float32Array, v: number) => s[Math.round(v * (CURVE_RES - 1))];

describe('point curve', () => {
  it('samples the straight line as the identity', () => {
    const s = sampleCurve(LINEAR);
    for (let i = 0; i < CURVE_RES; i++) expect(s[i]).toBeCloseTo(i / (CURVE_RES - 1), 6);
  });

  it('passes through its points', () => {
    const pts: CurvePoint[] = [[0, 0], [0.25, 0.18], [0.75, 0.85], [1, 1]];
    const s = sampleCurve(pts, 1001);
    for (const [x, y] of pts) expect(s[Math.round(x * 1000)]).toBeCloseTo(y, 4);
  });

  it('never overshoots or reverses between points', () => {
    // A steep step that a natural cubic spline would ring around.
    const s = sampleCurve([[0, 0], [0.45, 0.1], [0.55, 0.9], [1, 1]]);
    for (let i = 1; i < CURVE_RES; i++) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1] - 1e-7);
    expect(Math.min(...s)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...s)).toBeLessThanOrEqual(1);
  });

  it('holds flat outside its end points and stays in range', () => {
    const s = sampleCurve([[0.1, 0.2], [0.9, 0.7]]);
    expect(at(s, 0)).toBeCloseTo(0.2, 6);
    expect(at(s, 1)).toBeCloseTo(0.7, 6);
  });

  it('packs master, red, green and blue per step', () => {
    const t = curveTable({ ...IDENTITY_CURVE, r: [[0, 0.1], [1, 1]] });
    expect(t.length).toBe(CURVE_RES * 4);
    expect(t[0]).toBe(0);
    expect(t[1]).toBeCloseTo(0.1, 6);
    expect(t[(CURVE_RES - 1) * 4 + 3]).toBeCloseTo(1, 6);
  });

  it('cleans up points read from a sidecar', () => {
    expect(normalizePoints([[0.5, 2], [-1, 0.3], [0.5005, 0.4], ['x', 1], [1, 1]])).toEqual([[0, 0.3], [0.5, 1], [1, 1]]);
    expect(normalizePoints([[0.5, 0.5]])).toEqual(LINEAR);
    expect(normalizePoints('nope')).toEqual(LINEAR);
    const many = Array.from({ length: 40 }, (_, i) => [i / 39, i / 39]);
    expect(normalizePoints(many).length).toBe(MAX_POINTS);
  });

  it('treats a missing or straight curve as no curve', () => {
    expect(normalizeCurve(undefined)).toBeNull();
    expect(normalizeCurve({ rgb: LINEAR })).toBeNull();
    expect(isIdentity(null)).toBe(true);
    const c = normalizeCurve({ rgb: [[0, 0], [0.5, 0.6], [1, 1]] });
    expect(c?.rgb.length).toBe(3);
    expect(c?.g).toEqual(LINEAR);
  });
});
