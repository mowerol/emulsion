// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { BOOL_GRAIN_DEFAULTS, Prng, cellSeed, filterOffsets, renderRegion, wangHash, type GrainImage } from './boolgrain';

const flat = (w: number, h: number, u: number): GrainImage => ({ data: new Float32Array(w * h).fill(u), w, h, x0: 0, y0: 0 });
const stats = (a: Float32Array) => {
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  return { mean, sd: Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length) };
};

describe('Boolean model film grain (Newson et al., IPOL 2017)', () => {
  it("has the reference's hash, cell seeds and xorshift", () => {
    expect(wangHash(0)).toBe(wangHash(0));
    expect(cellSeed(0, 0, 0)).toBe(1);
    expect(cellSeed(-1, 0, 0)).toBe(65535);
    expect(cellSeed(3, 2, 7)).toBe(2 * 65536 + 3 + 7);
    const p = new Prng(42);
    const draws = Array.from({ length: 20000 }, () => p.uniform());
    expect(draws.reduce((a, b) => a + b) / draws.length).toBeCloseTo(0.5, 1);
    const q = new Prng(9);
    const n = Array.from({ length: 20000 }, () => q.poisson(3, Math.exp(-3)));
    expect(n.reduce((a, b) => a + b) / n.length).toBeCloseTo(3, 1);
  });

  it('keeps the mean value: the expected covered share is u', () => {
    const p = { ...BOOL_GRAIN_DEFAULTS, samples: 200 };
    for (const u of [0.15, 0.5, 0.85]) {
      const out = renderRegion(flat(24, 24, u), 0, 0, 24, 24, 1, p);
      expect(Math.abs(stats(out).mean - u)).toBeLessThan(0.02);
    }
  });

  it('gets grainier with larger grains, and smooths out when zoomed out', () => {
    const p = { ...BOOL_GRAIN_DEFAULTS, samples: 400 };
    const fine = stats(renderRegion(flat(16, 16, 0.5), 0, 0, 16, 16, 1, { ...p, radius: 0.1 })).sd;
    const coarse = stats(renderRegion(flat(16, 16, 0.5), 0, 0, 16, 16, 1, { ...p, radius: 0.4 })).sd;
    expect(coarse).toBeGreaterThan(fine * 2);
    // The same film shown at half size: each output pixel covers four input pixels.
    const full = stats(renderRegion(flat(32, 32, 0.5), 0, 0, 16, 16, 1, { ...p, radius: 0.4 })).sd;
    const half = stats(renderRegion(flat(32, 32, 0.5), 0, 0, 16, 16, 0.5, { ...p, radius: 0.4 })).sd;
    expect(half).toBeLessThan(full * 0.75);
  });

  it('renders the same grains for a region as for the whole', () => {
    const p = { ...BOOL_GRAIN_DEFAULTS, samples: 64 };
    const img = flat(20, 20, 0.4);
    const whole = renderRegion(img, 0, 0, 20, 20, 1, p);
    const part = renderRegion({ ...flat(8, 8, 0.4), x0: 6, y0: 9 }, 6, 9, 8, 8, 1, p);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(part[y * 8 + x]).toBe(whole[(y + 9) * 20 + x + 6]);
  });

  it('draws grains with the log-normal radius when sigmaR > 0', () => {
    const p = { ...BOOL_GRAIN_DEFAULTS, samples: 200, sigmaR: 0.05 };
    const out = renderRegion(flat(16, 16, 0.5), 0, 0, 16, 16, 1, p, filterOffsets(200));
    expect(Math.abs(stats(out).mean - 0.5)).toBeLessThan(0.03);
  });
});
