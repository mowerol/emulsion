// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { autoContrast, blendFactor, blendMask, borderFor, contrastAt, deconvolve, iterationsFor, kernelFor, tileThreshold, type Plane } from './capture';

const plane = (w: number, h: number, f: (i: number, j: number) => number): Plane => {
  const data = new Float64Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = f(i, j);
  return { w, h, data };
};
const ones = (w: number, h: number) => plane(w, h, () => 1);
/** A small seeded random generator, so noise is the same every run. */
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

describe('capture sharpening parameters', () => {
  it('reaches RawTherapee\'s 20 iterations at 100 and none at 0', () => {
    expect(iterationsFor(0)).toBe(0);
    expect(iterationsFor(100)).toBe(20);
    expect(iterationsFor(50)).toBe(10);
    expect(iterationsFor(1)).toBe(1);
  });

  it('builds RawTherapee\'s kernels: normalised Gaussians on a disc, sized by sigma', () => {
    expect(kernelFor(0.5).half).toBe(1);
    expect(kernelFor(0.7).half).toBe(2);
    expect(kernelFor(1.0).half).toBe(3);
    expect(kernelFor(1.4).half).toBe(4);
    expect(kernelFor(1.8).half).toBe(6);
    for (const s of [0.5, 0.7, 1.0, 1.4, 1.8]) expect(kernelFor(s).weights.flat().reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    // The 5x5's corners fall outside its disc.
    expect(kernelFor(0.7).weights[0][0]).toBe(0);
    expect(kernelFor(0.7).weights[0][1]).toBeGreaterThan(0);
    expect(borderFor(0.7, 20)).toBe(5);
    expect(borderFor(1.4, 20)).toBe(8);
  });
});

describe('blend mask', () => {
  it('is a sigmoid of local contrast with its middle at the threshold', () => {
    expect(blendFactor(0.2, 0.2)).toBeCloseTo(0.5, 12);
    expect(blendFactor(0, 0.2)).toBeLessThan(0.01);
    expect(blendFactor(0.4, 0.2)).toBeGreaterThan(0.99);
  });

  it('measures contrast from neighbours one and two pixels away, in L* / 16', () => {
    // A ramp rising by 327.68 (1 L*) per pixel across: sqrt(2² + 4²) L* / 16.
    const ramp = plane(20, 20, (i) => 327.68 * i);
    expect(contrastAt(ramp, 10, 10)).toBeCloseTo(Math.sqrt(20) / 16, 9);
  });

  it('keeps away from clipped pixels and flat areas', () => {
    const L = plane(40, 40, (i) => (i > 20 ? 20000 : 10000));
    const clip = plane(40, 40, (_, j) => (j > 30 ? 0 : 1));
    const m = blendMask(L, clip, 0.2);
    const v = (i: number, j: number) => m.data[j * 40 + i];
    expect(v(20, 10)).toBeGreaterThan(0.2);
    expect(v(5, 10)).toBeLessThan(0.01);
    expect(v(20, 38)).toBeLessThan(0.05);
    expect(blendMask(L, clip, 0).data.every((x) => x === 1)).toBe(true);
  });
});

describe('auto contrast', () => {
  it('finds a threshold just above the noise of the flattest mid-tone area', () => {
    const r = rng(7);
    // Mid-tone with fine noise, and a detailed area beside it.
    // Noise of variance about 0.75 × the mean, RawTherapee's measure of a flat area.
    const L = plane(240, 160, (i, j) => (i < 120 ? 8000 + (r() - 0.5) * 268 : 8000 + 3000 * Math.sin(i * 0.9) * Math.sin(j * 0.7)));
    const t = autoContrast(L);
    expect(t).toBeGreaterThan(0.01);
    expect(t).toBeLessThan(0.3);
    // In the flat area, at most about 1% of pixels pass half way at that threshold.
    expect(tileThreshold(L, 40, 20, 80)).toBeCloseTo(t, 1);
  });

  it('sharpens everywhere when nothing is a usable mid-tone', () => {
    expect(autoContrast(plane(200, 200, () => 500))).toBe(0);
  });
});

describe('deconvolution', () => {
  it('leaves a flat image alone and changes nothing without iterations', () => {
    const flat = plane(48, 48, () => 1000);
    expect(deconvolve(flat, ones(48, 48), 0.8, 20).data.every((v) => Math.abs(v - 1000) < 1e-6)).toBe(true);
    const step = plane(48, 48, (i) => (i > 24 ? 3000 : 1000));
    expect(deconvolve(step, ones(48, 48), 0.8, 0).data).toEqual(step.data);
  });

  it('steepens an edge that was blurred, and leaves the border alone', () => {
    // A step blurred by a Gaussian of 0.8 px.
    const sharp = plane(64, 48, (i) => (i >= 32 ? 3000 : 1000));
    const k = kernelFor(0.8);
    const blurred = plane(64, 48, (i, j) => {
      let s = 0;
      for (let b = -k.half; b <= k.half; b++) for (let a = -k.half; a <= k.half; a++) s += k.weights[b + k.half][a + k.half] * sharp.data[Math.min(Math.max(j + b, 0), 47) * 64 + Math.min(Math.max(i + a, 0), 63)];
      return s;
    });
    const out = deconvolve(blurred, ones(64, 48), 0.8, 20);
    const slope = (p: Plane) => p.data[24 * 64 + 32] - p.data[24 * 64 + 31];
    expect(slope(out)).toBeGreaterThan(slope(blurred) * 1.3);
    expect(out.data[24 * 64 + 2]).toBe(blurred.data[24 * 64 + 2]);
  });

  it('blends towards the original where the mask is low', () => {
    const step = plane(48, 48, (i) => (i > 24 ? 3000 : 1000));
    const none = plane(48, 48, () => 0.005);
    const out = deconvolve(step, none, 0.8, 20);
    expect(out.data.every((v, q) => Math.abs(v - step.data[q]) < 1e-9)).toBe(true);
  });
});
