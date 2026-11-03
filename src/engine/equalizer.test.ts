// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { FLAT, SHARPEN_PRESET, amountScales, applyMix, curveValue, equalize, equalizeParts, scales } from './equalizer';

const plane = (w: number, h: number, f: (i: number, j: number) => number) => {
  const p = new Float64Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) p[j * w + i] = f(i, j);
  return p;
};
const spread = (p: Float64Array, w: number, h: number) => {
  const v: number[] = [];
  for (let j = 10; j < h - 10; j++) for (let i = 10; i < w - 10; i++) v.push(p[j * w + i]);
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
};

describe('contrast equalizer curves', () => {
  it('passes through its points and stays within [0, 1]', () => {
    SHARPEN_PRESET.L.x.forEach((x, k) => expect(curveValue(SHARPEN_PRESET.L, x)).toBeCloseTo(SHARPEN_PRESET.L.y[k], 12));
    expect(curveValue(FLAT, 0.37)).toBe(0.5);
    expect(curveValue({ x: [0, 0.5, 1], y: [0, 1, 1] }, 0.9)).toBeLessThanOrEqual(1);
  });

  it('mixes the preset like darktable: 0 is flat, 1 the preset, -1 its mirror', () => {
    expect(applyMix(SHARPEN_PRESET.L, 0).y).toEqual(FLAT.y);
    expect(applyMix(SHARPEN_PRESET.L, 1)).toEqual(SHARPEN_PRESET.L);
    applyMix(SHARPEN_PRESET.L, -1).y.forEach((y, k) => expect(y).toBeCloseTo(1 - SHARPEN_PRESET.L.y[k], 12));
  });
});

describe('contrast equalizer scales', () => {
  it('runs eight sizes at full resolution, finest boosted most by the preset', () => {
    const sc = scales(5184, 3888, 5184, 3888, 1);
    expect(sc.map((s) => s.mult)).toEqual([1, 2, 4, 8, 16, 32, 64, 128]);
    expect(sc[0].boost).toBeGreaterThan(1.8);
    expect(sc[0].boost).toBeGreaterThan(sc[4].boost);
    expect(sc[7].boost).toBeGreaterThan(1);
    expect(sc[7].boost).toBeLessThan(1.3);
  });

  it('places a preview\'s sizes on the same bands as full resolution, minus the finest', () => {
    const full = scales(5184, 3888, 5184, 3888, 1);
    const preview = scales(2592, 1944, 5184, 3888, 1);
    // A half-size preview's finest band is about full resolution's second (darktable
    // takes a pixel off the filter size before scaling it, so not exactly).
    expect(Math.abs(preview[0].boost / full[1].boost - 1)).toBeLessThan(0.02);
    expect(Math.abs(preview[3].boost / full[4].boost - 1)).toBeLessThan(0.02);
  });

  it('changes nothing at no mix', () => {
    for (const s of scales(2560, 1920, 5184, 3888, 0)) {
      expect(s.boost).toBeCloseTo(1, 12);
    }
  });
});

describe('contrast equalizer', () => {
  it('rebuilds the input exactly at no change, and leaves a flat plane flat with the preset', () => {
    const w = 64, h = 48;
    const tex = plane(w, h, (i, j) => 50 + 10 * Math.sin(i * 0.9) * Math.cos(j * 0.6) + (i > 30 ? 20 : 0));
    const out = equalize(tex, w, h, scales(w, h, w * 4, h * 4, 0));
    expect(out.every((v, k) => Math.abs(v - tex[k]) < 1e-9)).toBe(true);
    const flat = plane(w, h, () => 42);
    expect(equalize(flat, w, h, scales(w, h, w * 4, h * 4, 1)).every((v) => Math.abs(v - 42) < 1e-9)).toBe(true);
  });

  it('adds fine texture with the preset and takes it away below zero', () => {
    const w = 96, h = 72;
    const tex = plane(w, h, (i, j) => 45 + 2 * Math.sin(i * 1.7) * Math.sin(j * 1.3));
    const base = spread(tex, w, h);
    expect(spread(equalize(tex, w, h, scales(w, h, w, h, 1)), w, h)).toBeGreaterThan(base * 1.3);
    expect(spread(equalize(tex, w, h, scales(w, h, w, h, -1)), w, h)).toBeLessThan(base * 0.8);
  });
});

describe('contrast equalizer by amount', () => {
  const sizes: [number, number, number, number][] = [[5184, 3888, 5184, 3888], [1664, 1111, 6246, 4170], [160, 120, 640, 480]];
  const mixes = [-1, -0.63, -0.2, 0, 0.05, 0.4, 0.77, 1];

  it("gives every band's boost as 1 + a·mix + c·mix², with edge weights that do not depend on the amount", () => {
    for (const [w, h, W, H] of sizes) {
      const parts = amountScales(w, h, W, H);
      for (const mix of mixes) {
        const sc = scales(w, h, W, H, mix);
        expect(sc.length).toBe(parts.length);
        sc.forEach((s, i) => {
          expect(s.mult).toBe(parts[i].mult);
          expect(s.sharpen).toBe(parts[i].sharpen);
          expect(1 + parts[i].a * mix + parts[i].c * mix * mix).toBeCloseTo(s.boost, 12);
        });
      }
    }
  });

  it('changes lightness by mix·A + mix²·B, A and B made once for every amount', () => {
    const w = 96, h = 72;
    const L = plane(w, h, (i, j) => 40 + 25 * (i / w) + 3 * Math.sin(i * 1.7) * Math.sin(j * 1.3) + (j > h / 2 ? 12 : 0));
    const { A, B } = equalizeParts(L, w, h, amountScales(w, h, w * 4, h * 4));
    for (const mix of mixes) {
      const ref = equalize(L, w, h, scales(w, h, w * 4, h * 4, mix));
      let worst = 0;
      for (let k = 0; k < w * h; k++) worst = Math.max(worst, Math.abs(mix * A[k] + mix * mix * B[k] - (ref[k] - L[k])));
      expect(worst).toBeLessThan(1e-9);
    }
  });
});
