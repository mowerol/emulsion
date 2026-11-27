// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { gaussianKernel, pixelUmFor, SCATTER_DEFAULTS, scatterBank, scatterImage, scatterMtf, scatterReach, TAIL_AMP } from './scatter';

describe('film scatter (darktable sf_halation stage 1)', () => {
  it('builds darktable’s kernel: radius round(3σ), at least 1, normalised', () => {
    expect(gaussianKernel(0.1).length).toBe(3);
    expect(gaussianKernel(1).length).toBe(7);
    expect(gaussianKernel(4.48).length).toBe(2 * 13 + 1);
    for (const s of [0.37, 1.55, 4.48]) expect(gaussianKernel(s).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it('sizes the blurs in µm on a 36 mm frame', () => {
    const bank = scatterBank(pixelUmFor(6000));
    expect(bank[0].sigma[0]).toBeCloseTo(2.2 / 6, 5);
    expect(bank[3].sigma[1]).toBeCloseTo(2.7684 * 9.7 / 6, 4);
    expect(scatterReach(bank)).toBe(13);
  });

  it('keeps every channel’s weights summing to the scattered fraction', () => {
    for (const amount of [0.3, 1]) {
      const bank = scatterBank(6, { ...SCATTER_DEFAULTS, amount });
      for (let c = 0; c < 3; c++) expect(bank.reduce((a, b) => a + b.weight[c], 0)).toBeCloseTo(amount * TAIL_AMP.reduce((a, b) => a + b, 0) * SCATTER_DEFAULTS.tailWeight[c] + amount * (1 - SCATTER_DEFAULTS.tailWeight[c]), 6);
    }
  });

  it('leaves a flat field and amount 0 unchanged', () => {
    const w = 24, h = 16, flat = new Float32Array(w * h * 3).map((_, i) => [0.2, 0.5, 0.9][i % 3]);
    const out = scatterImage(flat, w, h, 6);
    // Upstream's tail amplitudes sum to 0.9999, so a flat field keeps 99.99 % of its light.
    for (let i = 0; i < out.length; i++) expect(out[i]).toBeCloseTo(flat[i], 3);
    const ramp = new Float32Array(w * h * 3).map((_, i) => (i % 7) / 7);
    expect(scatterImage(ramp, w, h, 6, { ...SCATTER_DEFAULTS, amount: 0 })).toEqual(ramp);
  });

  it('spreads a point, keeps its energy, and spreads red the most', () => {
    const w = 41, h = 41, img = new Float32Array(w * h * 3), mid = 20 * w + 20;
    img.fill(0); for (let c = 0; c < 3; c++) img[3 * mid + c] = 1;
    const out = scatterImage(img, w, h, 6);
    for (let c = 0; c < 3; c++) {
      let sum = 0; for (let i = 0; i < w * h; i++) sum += out[3 * i + c];
      expect(sum).toBeCloseTo(0.9999, 3);
    }
    expect(out[3 * mid]).toBeLessThan(out[3 * mid + 1]);
    expect(out[3 * mid]).toBeLessThan(out[3 * mid + 2]);
  });

  it('gives the film an MTF that falls with frequency, red the softest', () => {
    const [r, g, b] = scatterMtf(40);
    // Scatter alone, without the DIR couplers' gain: R/G/B 0.72/0.75/0.77 at 10 c/mm,
    // 0.25/0.35/0.36 at 40, 0.13/0.22/0.24 at 80 (Portra 400's sheet: 1.07/1.17/1.12, 0.50/0.75/0.75,
    // 0.23/0.39/0.47; docs/research/film-edge-effects-mtf.md section 3).
    expect(scatterMtf(10).map(v => +v.toFixed(2))).toEqual([0.72, 0.75, 0.77]);
    expect(r).toBeLessThan(g);
    expect(r).toBeLessThan(b);
    expect(scatterMtf(80)[0]).toBeCloseTo(0.125, 2);
  });
});
