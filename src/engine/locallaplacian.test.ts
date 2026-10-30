// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../film/stocks';
import {
  CLARITY_PRESET, GAMMAS, clarityParams, curve, expandAt, gammaSpan, levelSize, lightness, localLaplacian, numLevels, reduce, withLightness, type Plane,
} from './locallaplacian';

const make = (w: number, h: number, f: (i: number, j: number) => number): Plane => {
  const data = new Float64Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = f(i, j);
  return { w, h, data };
};
const maxDiff = (a: Plane, b: Plane) => a.data.reduce((m, v, k) => Math.max(m, Math.abs(v - b.data[k])), 0);
/** Standard deviation of the middle of a plane, away from its borders. */
const spread = (p: Plane) => {
  const v: number[] = [];
  for (let j = 8; j < p.h - 8; j++) for (let i = 8; i < p.w - 8; i++) v.push(p.data[j * p.w + i]);
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
};

describe('local laplacian', () => {
  it('maps the slider onto darktable\'s clarity preset, from no change', () => {
    expect(clarityParams(100)).toEqual(CLARITY_PRESET);
    expect(clarityParams(0)).toEqual({ sigma: 0.5, shadows: 1, highlights: 1, clarity: 0 });
    expect(clarityParams(-100)).toEqual({ sigma: 0.5, shadows: 1, highlights: 1, clarity: -0.33 });
  });

  it('has an identity curve at no change', () => {
    const p = clarityParams(0);
    for (const g of GAMMAS) for (let x = -0.2; x <= 1.2; x += 0.05) expect(curve(x, g, p)).toBeCloseTo(x, 12);
  });

  it('boosts small differences around each level and compresses large ones with the preset', () => {
    const g = 0.5;
    expect(curve(0.52, g, CLARITY_PRESET) - g).toBeGreaterThan(0.02);
    expect(curve(1, g, CLARITY_PRESET) - g).toBeLessThan(0.5);
  });

  it('sizes and searches like darktable', () => {
    expect([0, 1, 2, 3].map((l) => levelSize(100, l))).toEqual([100, 50, 25, 13]);
    expect(numLevels(2560, 1707)).toBe(10);
    expect(gammaSpan(0)).toEqual([0, 1, 0]);
    expect(gammaSpan(0.5)[0]).toBe(2);
    expect(gammaSpan(0.5)[2]).toBeCloseTo(0.5, 12);
    expect(gammaSpan(1)).toEqual([4, 5, 1]);
  });

  it('reduces and expands a flat plane without change', () => {
    const flat = make(37, 23, () => 0.3);
    const c = reduce(flat);
    expect(c.w).toBe(19);
    expect(c.h).toBe(12);
    expect(c.data.every((v) => Math.abs(v - 0.3) < 1e-12)).toBe(true);
    expect(expandAt(c, 5, 6)).toBeCloseTo(0.3, 12);
    expect(expandAt(c, 0, 0)).toBeCloseTo(0.3, 12);
  });

  it('returns the input exactly at no change, and a flat plane under the preset', () => {
    const tex = make(48, 32, (i, j) => 0.5 + 0.2 * Math.sin(i * 0.7) * Math.cos(j * 0.4));
    expect(maxDiff(localLaplacian(tex, clarityParams(0)), tex)).toBeLessThan(1e-12);
    const flat = make(40, 30, () => 0.42);
    expect(maxDiff(localLaplacian(flat, CLARITY_PRESET), flat)).toBeLessThan(1e-12);
  });

  it('adds local contrast to fine texture, and takes it away below zero', () => {
    const tex = make(64, 48, (i, j) => 0.45 + 0.03 * Math.sin(i * 1.3) * Math.sin(j * 1.1));
    const base = spread(tex);
    expect(spread(localLaplacian(tex, clarityParams(100)))).toBeGreaterThan(base * 1.15);
    expect(spread(localLaplacian(tex, clarityParams(-100)))).toBeLessThan(base * 0.85);
  });
});

describe('lightness', () => {
  it('is CIE L* / 100 of the decoded pixel', () => {
    expect(lightness([1, 1, 1])).toBeCloseTo(1, 4);
    expect(lightness([0, 0, 0])).toBe(0);
    // sRGB-encoded 0.5 is 21.4% linear, L* 53.4.
    expect(lightness([0.5, 0.5, 0.5])).toBeCloseTo(0.5339, 3);
  });

  it('moves lightness and keeps the colour\'s Lab a and b', () => {
    const px: Vec3 = [0.6, 0.45, 0.3];
    expect(withLightness(px, 0).every((v, i) => Math.abs(v - px[i]) < 1e-9)).toBe(true);
    const up = withLightness(px, 0.05);
    expect(lightness(up)).toBeCloseTo(lightness(px) + 0.05, 6);
    const grey = withLightness([0.4, 0.4, 0.4], -0.1);
    expect(Math.abs(grey[0] - grey[1])).toBeLessThan(1e-6);
    expect(Math.abs(grey[1] - grey[2])).toBeLessThan(1e-6);
  });
});
