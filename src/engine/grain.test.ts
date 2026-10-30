// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { GRAIN_SCALE_FACTOR, effectiveIso, grainDelta, grainL, grainNoise, paperResp, paperRespInverse, simplexNoise, zoomForIso } from './grain';

describe("darktable's grain", () => {
  it('has simplex noise just inside [-1, 1], continuous, and zero on lattice points', () => {
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < 4000; i++) {
      const v = simplexNoise(i * 0.137, i * 0.071 + 3.3, (i % 3) + 0.2);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeGreaterThan(-1.01);
    expect(hi).toBeLessThan(1.01);
    expect(hi - lo).toBeGreaterThan(1.2);
    expect(Math.abs(simplexNoise(1.5, 2.5, 0.5) - simplexNoise(1.5001, 2.5, 0.5))).toBeLessThan(0.01);
    expect(simplexNoise(3, 5, 7)).toBeCloseTo(0, 12);
  });

  it('sizes the noise by film speed: coarser grain at higher ISO, relative to the frame', () => {
    expect(zoomForIso(1600)).toBeCloseTo((1 + (8 * 1600) / GRAIN_SCALE_FACTOR / 100) / 800, 12);
    expect(zoomForIso(3200)).toBeGreaterThan(zoomForIso(400));
    // The same point of the frame gives the same noise whatever the zoom unit, scaled.
    expect(grainNoise(0.3, 0.2, 0.002)).toBeCloseTo(grainNoise(0.6, 0.4, 0.004), 12);
    expect(effectiveIso(400, 1)).toBe(800);
    expect(effectiveIso(6400, 2)).toBe(6400);
  });

  it("inverts the paper response, whose mid-tones bias flattens shadows and highlights", () => {
    for (const mb of [0, 50, 100]) for (const l of [0.1, 0.5, 0.9]) expect(paperResp(paperRespInverse(l, mb), mb)).toBeCloseTo(l, 5);
    // The same grain moves mid-tones more than near-blacks and near-whites with full bias.
    const mid = Math.abs(grainDelta(0.05, 0.5, 100));
    expect(Math.abs(grainDelta(0.05, 0.03, 100))).toBeLessThan(mid / 2);
    expect(Math.abs(grainDelta(0.05, 0.97, 100))).toBeLessThan(mid / 2);
    expect(grainDelta(0, 0.4, 100)).toBeCloseTo(0, 6);
  });

  it('changes lightness by more as strength rises, and averages towards smooth when zoomed out', () => {
    const p = { strength: 25, iso: 1600, midtones: 100, offset: 3.7 };
    const spread = (strength: number, scale: number) => {
      let s = 0;
      for (let i = 0; i < 200; i++) s += Math.abs(grainL(50, 100 + i * 7.3, 200 + i * 3.1, 6000, 4000, scale, { ...p, strength }) - 50);
      return s / 200;
    };
    expect(spread(50, 1)).toBeGreaterThan(spread(25, 1) * 1.5);
    expect(spread(0, 1)).toBe(0);
    // At a quarter of full size, 21 samples per output pixel average the finest grain away.
    expect(spread(25, 0.25)).toBeLessThan(spread(25, 1));
  });
});
