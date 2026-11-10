// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/denoiseprofile-reference.json';
import {
  backtransform, conversionMatrices, decompose, denoiseSetup, denoiseWavelets, domainMatrices, fastMexp2f, inferBias, inferShadows,
  maxScale, precondition, shrink, thresholds, VARF, wbFromNeutral,
} from './denoiseprofile';
import { invert3, mulMat, mulVec } from './color';
import type { Mat3, Vec3 } from '../film/stocks';

// The fixture is darktable's own process_wavelets run on these images (tools/denoise-reference).
describe('matches darktable process_wavelets', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const s = denoiseSetup({ a: [c.a, c.a, c.a], b: [c.b, c.b, c.b] }, c.wb as Vec3,
        { strength: c.strength, luma: c.luma, chroma: c.chroma, shadows: c.shadows, bias: c.bias }, c.scale, c.fullW, c.fullH);
      const out = denoiseWavelets(Float32Array.from(c.input), c.w, c.h, s);
      let worst = 0, changed = 0;
      for (let i = 0; i < c.w * c.h * 4; i++) {
        if (i % 4 === 3) continue;
        worst = Math.max(worst, Math.abs(out[i] - c.out[i]) / Math.max(1e-3, Math.abs(c.out[i])));
        changed = Math.max(changed, Math.abs(c.out[i] - c.input[i]));
      }
      // Single-precision upstream against double here: a few parts in 10^5.
      expect(worst).toBeLessThan(2e-4);
      // Each case does something; with no scales at all only the transforms' bias remains.
      expect(changed).toBeGreaterThan(c.w > 8 ? 1e-3 : 1e-6);
    });
  }
});

describe('pieces', () => {
  it('fast_mexp2f is the bit trick, not 2^-x', () => {
    expect(fastMexp2f(0)).toBe(1);
    expect(fastMexp2f(1)).toBe(0.5);
    expect(fastMexp2f(0.5)).toBeCloseTo(0.75, 6); // linear mantissa: 2^-0.5 would be 0.707
    expect(fastMexp2f(200)).toBe(0);
  });

  it('picks seven scales at full resolution and fewer on a preview', () => {
    expect(maxScale(1, 6000, 4000)).toBe(7);
    expect(maxScale(0.25, 6000, 4000)).toBe(5);
    expect(maxScale(1, 64, 48)).toBe(3);
  });

  it('infers upstream defaults from the profile', () => {
    // OM-3 ISO 4000: a = 4.66e-5.
    expect(inferShadows(4.6565532e-5)).toBeCloseTo(1.0975, 4);
    expect(inferBias(4.6565532e-5)).toBeCloseTo(-0.012675, 6);
    expect(inferShadows(1e-9)).toBe(1.8);
    expect(inferBias(1)).toBe(-5);
  });

  it('Y0U0V0 inverts, with the standard form when the adapted matrix is singular', () => {
    const { toY, toRgb } = conversionMatrices([2.1, 1, 1.6]);
    const id = mulMat(toY, toRgb);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(id[i][j]).toBeCloseTo(i === j ? 1 : 0, 10);
    // The neutral-wb rows are unit-noise: Y0 = sqrt(3)·3·(1/3)… as upstream writes it.
    expect(conversionMatrices([1, 1, 1]).toY[0][0]).toBeCloseTo(3 * Math.sqrt(3), 10);
  });

  it('the VST round trip returns positive values close to where they started', () => {
    const s = denoiseSetup({ a: [4.66e-5, 4.66e-5, 4.66e-5], b: [1e-7, 1e-7, 1e-7] }, [2, 1, 1.5], { strength: 1, luma: 0.5, chroma: 0.5 }, 1, 4000, 3000);
    for (const v of [0.002, 0.01, 0.1, 0.5, 0.9]) {
      const back = backtransform(precondition([v, v * 0.7, v * 1.2], s), s);
      // The backtransform is low-bias, not an exact inverse: its bias term shifts it slightly.
      [v, v * 0.7, v * 1.2].forEach((x, c) => expect(Math.abs(back[c] - x) / x).toBeLessThan(0.05));
    }
  });

  it('a flat field stays flat', () => {
    const w = 40, h = 30, img = new Float32Array(w * h * 4);
    for (let i = 0; i < img.length; i += 4) img.set([0.2, 0.15, 0.1, 1], i);
    const s = denoiseSetup({ a: [5e-5, 5e-5, 5e-5], b: [1e-7, 1e-7, 1e-7] }, [1.8, 1, 1.4], { strength: 1, luma: 0.5, chroma: 0.5 }, 1, w, h);
    const out = denoiseWavelets(img, w, h, s);
    for (let i = 4; i < out.length; i += 4) for (let c = 0; c < 3; c++) expect(out[i + c]).toBeCloseTo(out[c], 6);
  });

  it('decomposes into coarse plus detail exactly, and thresholds by BayesShrink', () => {
    const w = 12, h = 9, img = new Float32Array(w * h * 4);
    for (let i = 0; i < img.length; i++) img[i] = Math.sin(i * 1.7) * 3;
    const { coarse, detail, sumSq } = decompose(img, w, h, 1);
    for (let i = 0; i < img.length; i++) expect(coarse[i] + detail[i]).toBeCloseTo(img[i], 5);
    const t = thresholds(1, w * h, sumSq, [8, 8]);
    const sb2 = VARF ** 2;
    expect(t[0]).toBeCloseTo((8 * sb2) / Math.sqrt(Math.max(1e-6, sumSq[0] / (w * h - 1) - sb2)), 10);
    expect(shrink(0.5, 0.2)).toBeCloseTo(0.3, 12);
    expect(shrink(-0.5, 0.2)).toBeCloseTo(-0.3, 12);
    expect(shrink(0.1, 0.2)).toBe(0);
  });

  it('maps the RAW source to darktable domain and back', () => {
    const m: Mat3 = [[1.6, -0.5, -0.1], [-0.2, 1.4, -0.2], [0, -0.4, 1.4]];
    const neutral: Vec3 = [0.45, 1, 0.7]; // green the smallest multiplier, as on most cameras
    const { toDt, fromDt } = domainMatrices(m, neutral, 1.8);
    const v: Vec3 = [0.3, 0.2, 0.1];
    const back = mulVec(fromDt, mulVec(toDt, v));
    back.forEach((x, c) => expect(x).toBeCloseTo(v[c], 12));
    // A neutral grey in camera RGB (LibRaw scale) stays neutral, at green's scale.
    const cam: Vec3 = [0.25, 0.25, 0.25];
    const working = mulVec(m, cam.map((x) => x * 1.8) as Vec3);
    mulVec(toDt, working).forEach((x) => expect(x).toBeCloseTo(0.25, 12));
    expect(wbFromNeutral(neutral)).toEqual([1 / 0.45, 1, 1 / 0.7]);
    expect(invert3(m)).toBeTruthy();
  });

  it('luma and chroma forces scale the thresholds as upstream (8 · force² · 4)', () => {
    const s = denoiseSetup({ a: [5e-5, 5e-5, 5e-5], b: [0, 0, 0] }, [1, 1, 1], { strength: 1, luma: 0.5, chroma: 0 }, 1, 100, 100);
    expect(s.adjt).toEqual([8, 0]);
  });
});
