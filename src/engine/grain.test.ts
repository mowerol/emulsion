// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { grainCount, grainField, grainShape, grainTone, isoPreset, kappaAt, matchingIso, normalCdf, type GrainShape } from './grain';

const shapeForIso = (iso: number, push: number, longEdge: number) => {
  const p = isoPreset(iso);
  return grainShape(p.size, p.roughness, push, longEdge);
};

const SHAPE: GrainShape = shapeForIso(400, 0, 1600);

/** Normal draws for statistics (a fixed, well-spread sample). */
const Z = Array.from({ length: 4000 }, (_, i) => {
  // Inverse CDF of evenly spaced probabilities, by bisection on normalCdf.
  const p = (i + 0.5) / 4000;
  let lo = -8;
  let hi = 8;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
});

function stats(u: number, g = SHAPE) {
  const v = Z.map((z) => grainTone(u, z, g));
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const variance = v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length;
  const sorted = v.slice().sort((a, b) => a - b);
  return { mean, sd: Math.sqrt(variance), variance, median: sorted[v.length >> 1] };
}

describe('film grain', () => {
  it('keeps the average tone', () => {
    for (const u of [0.02, 0.1, 0.3, 0.5, 0.8, 0.97]) expect(stats(u).mean).toBeCloseTo(u, 2);
  });

  it('has the Boolean model\'s variance', () => {
    for (const u of [0.1, 0.4, 0.7]) {
      const k = kappaAt(SHAPE, u);
      const expected = (1 - u) ** (2 - k) - (1 - u) ** 2;
      expect(stats(u).variance / expected).toBeGreaterThan(0.85);
      expect(stats(u).variance / expected).toBeLessThan(1.15);
    }
  });

  it('is strongest in the midtones and fades at both ends', () => {
    const sd = (u: number) => stats(u).sd;
    const mid = Math.max(sd(0.35), sd(0.5));
    expect(sd(0.03)).toBeLessThan(mid);
    expect(sd(0.97)).toBeLessThan(mid / 2);
  });

  it('breaks thin areas into a few grains, and evens dense areas out', () => {
    // A thin area holds few grains, so its tone comes in coarse steps; a dense
    // area holds many, so it varies smoothly.
    const thin = new Set(Z.map((z) => grainTone(0.03, z, SHAPE).toFixed(4)));
    const dense = new Set(Z.map((z) => grainTone(0.9, z, SHAPE).toFixed(4)));
    expect(thin.size).toBeLessThan(40);
    expect(dense.size).toBeGreaterThan(10 * thin.size);
  });

  it('grows grains in thin areas, with faster film and when pushed', () => {
    expect(kappaAt(SHAPE, 0.1)).toBeGreaterThan(kappaAt(SHAPE, 0.9));
    expect(shapeForIso(1600, 0, 1600).kappa).toBeGreaterThan(SHAPE.kappa);
    expect(shapeForIso(1600, 0, 1600).size).toBeGreaterThan(SHAPE.size);
    expect(shapeForIso(400, 1, 1600).kappa).toBeGreaterThan(SHAPE.kappa);
    expect(shapeForIso(400, 1, 1600).clump).toBeGreaterThan(SHAPE.clump);
  });

  it('sizes grain relative to the frame', () => {
    expect(shapeForIso(400, 0, 3200).size).toBeCloseTo(2 * SHAPE.size, 9);
    expect(grainShape(200, 50, 0, 1600).size).toBeCloseTo(2 * grainShape(100, 50, 0, 1600).size, 9);
  });

  it('turns film speeds into Size and Roughness presets', () => {
    expect(isoPreset(400)).toEqual({ size: 100, roughness: 50 });
    expect(isoPreset(1600).size).toBeGreaterThan(100);
    expect(isoPreset(1600).roughness).toBeGreaterThan(50);
    expect(isoPreset(100).roughness).toBeLessThan(50);
    expect(isoPreset(3200).roughness).toBeLessThanOrEqual(100);
    expect(matchingIso(isoPreset(800).size, isoPreset(800).roughness, [400, 800])).toBe(800);
    expect(matchingIso(101, 50, [400, 800])).toBeNull();
  });

  it('draws a normal approximation for large counts without a jump', () => {
    expect(grainCount(24, 0)).toBeCloseTo(grainCount(24.01, 0), 0);
    expect(grainCount(400, 1)).toBeCloseTo(420, 6);
  });

  it('makes a smooth field with unit variance', () => {
    let s = 0;
    let s2 = 0;
    let jump = 0;
    for (let y = 0; y < 150; y++) {
      for (let x = 0; x < 150; x++) {
        const v = grainField(x * 1.37, y * 1.37, 1, 9);
        s += v;
        s2 += v * v;
        jump = Math.max(jump, Math.abs(grainField(x * 1.37 + 0.01, y * 1.37, 1, 9) - v));
      }
    }
    const n = 150 * 150;
    const sd = Math.sqrt(s2 / n - (s / n) ** 2);
    expect(sd).toBeGreaterThan(0.9);
    expect(sd).toBeLessThan(1.1);
    expect(jump).toBeLessThan(0.1);
  });
});
