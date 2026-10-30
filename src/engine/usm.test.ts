// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { L_SCALE, thresholdMultiply, unsharpMask, usmKernel, usmParams } from './usm';
import type { Plane } from './capture';

const plane = (w: number, h: number, f: (i: number, j: number) => number): Plane => ({
  w, h, data: Float64Array.from({ length: w * h }, (_, k) => f(k % w, Math.floor(k / w))),
});

describe("RawTherapee's unsharp mask", () => {
  it("follows RawTherapee's default threshold curve", () => {
    expect(thresholdMultiply(10, 100)).toBe(0);
    expect(thresholdMultiply(20, 100)).toBe(0);
    expect(thresholdMultiply(50, 100)).toBeCloseTo(50);
    expect(thresholdMultiply(80, 100)).toBe(100);
    expect(thresholdMultiply(1200, 100)).toBe(100);
    expect(thresholdMultiply(1600, 100)).toBeCloseTo(50);
    expect(thresholdMultiply(2000, 100)).toBe(0);
    expect(thresholdMultiply(50, -100)).toBeCloseTo(-50);
  });

  it("uses gaussianBlur's kernels: none below 0.25, three taps below 0.6", () => {
    expect(usmKernel(0.2)).toEqual([1]);
    const k = usmKernel(0.5);
    expect(k).toHaveLength(3);
    // RawTherapee's 3x3 kernel at sigma 0.5 is the outer product of this one.
    const c1 = Math.exp(-0.5 / 0.25);
    expect(k[0] * k[0]).toBeCloseTo(Math.exp(-1 / 0.25) / (1 + 4 * (c1 + Math.exp(-1 / 0.25))), 12);
    expect(k.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(usmKernel(1).length).toBeGreaterThan(3);
  });

  it('maps the sliders onto its parameters, its defaults at 20 and 10', () => {
    expect(usmParams(20, 0.5, 10)).toEqual({ amount: 200, radius: 0.5, contrast: 20 });
  });

  it('steepens an edge both ways and leaves flat areas alone', () => {
    // A vertical edge from L* 40 to L* 60.
    const L = plane(24, 12, (i) => (i < 12 ? 0.4 : 0.6));
    const { delta } = unsharpMask(L, usmParams(20, 0.5, 10));
    const d = (i: number) => delta.data[6 * 24 + i];
    expect(d(11)).toBeLessThan(0);
    expect(d(12)).toBeGreaterThan(0);
    expect(d(11)).toBeCloseTo(-d(12), 6);
    expect(d(3)).toBe(0);
    expect(d(20)).toBe(0);
    // Amount 200: the difference from the 3-tap blur, doubled (the edge is far above the threshold ramp).
    const k = usmKernel(0.5);
    expect(d(12)).toBeCloseTo(2 * (0.6 - (k[0] * 0.4 + (k[1] + k[2]) * 0.6)) * mask(L, 12), 6);
  });

  it('does nothing when the radius is too small for the size, or the amount is zero', () => {
    const L = plane(16, 8, (i) => (i < 8 ? 0.3 : 0.7));
    // Radius 0.5 seen at a third of full size is under RawTherapee's 0.25 cut-off.
    expect(Math.max(...unsharpMask(L, usmParams(20, 0.5, 10), 1 / 3).delta.data.map(Math.abs))).toBe(0);
    expect(Math.max(...unsharpMask(L, usmParams(0, 0.5, 10)).delta.data.map(Math.abs))).toBe(0);
  });

  it('keeps tiny differences below the threshold curve unsharpened', () => {
    // A step of 15 RawTherapee units, under the curve's bottom left of 20.
    const L = plane(16, 8, (i) => (i < 8 ? 0.5 : 0.5 + 15 / L_SCALE));
    expect(Math.max(...unsharpMask(L, usmParams(100, 1, 0)).delta.data.map(Math.abs))).toBe(0);
  });

  it('masks low-contrast texture and sharpens everywhere with masking at zero', () => {
    // Faint noise (about L* 0.3) next to a strong edge.
    const L = plane(48, 16, (i, j) => (i < 32 ? 0.5 + 0.003 * Math.sin(i * 2.1 + j * 1.3) : 0.9));
    const masked = unsharpMask(L, usmParams(50, 0.5, 50)).mask;
    const open = unsharpMask(L, usmParams(50, 0.5, 0)).mask;
    expect(masked.data[8 * 48 + 8]).toBeLessThan(0.05);
    // The mask is blurred by 2 px, so a lone edge peaks below 1.
    expect(masked.data[8 * 48 + 31]).toBeGreaterThan(0.5);
    expect(open.data.every((v) => v === 1)).toBe(true);
  });
});

function mask(L: Plane, i: number) {
  return unsharpMask(L, usmParams(20, 0.5, 10)).mask.data[6 * L.w + i];
}
