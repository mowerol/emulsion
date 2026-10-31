// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Mat3, Vec3 } from '../film/stocks';
import { mulMat, mulVec } from './color';
import { BASE, NO_PRIMARIES, SMOOTH_PRIMARIES, adjustedPrimaries, invert3, rgbToXyzFromPrimaries, rotateAndScalePrimary } from './primaries';

const near = (a: Mat3, b: Mat3, digits = 9) => a.forEach((r, i) => r.forEach((v, j) => expect(v).toBeCloseTo(b[i][j], digits)));
const I: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

describe('sigmoid primaries', () => {
  it("reads darktable's Rec.2020 profile as lcms writes it: D50 white, Bradford-adapted colorants", () => {
    expect(BASE.white[0]).toBeCloseTo(0.3457, 4);
    expect(BASE.white[1]).toBeCloseTo(0.3585, 4);
    // Adapting to the warmer D50 moves the blue primary towards yellow-green.
    expect(BASE.primaries[2][1]).toBeGreaterThan(0.046);
  });

  it('builds RGB to XYZ from primaries whose white sums to the whitepoint (Lindbloom)', () => {
    const m = rgbToXyzFromPrimaries(BASE.primaries, BASE.white);
    const w = mulVec(m, [1, 1, 1]);
    expect(w[0] / (w[0] + w[1] + w[2])).toBeCloseTo(BASE.white[0], 9);
    expect(w[1]).toBeCloseTo(1, 9);
  });

  it('inverts 3x3 matrices', () => {
    const m: Mat3 = [[2, 0.3, -0.1], [0.4, 1.5, 0.2], [-0.3, 0.1, 0.9]];
    near(mulMat(m, invert3(m)), I, 12);
  });

  it('leaves a primary where it is without inset or rotation', () => {
    for (let i = 0; i < 3; i++) {
      const p = rotateAndScalePrimary(1, 0, i);
      expect(p[0]).toBeCloseTo(BASE.primaries[i][0], 9);
      expect(p[1]).toBeCloseTo(BASE.primaries[i][1], 9);
    }
  });

  it('turns a primary along the gamut edge and scales it towards white', () => {
    const turned = rotateAndScalePrimary(1, 0.1, 0);
    const half = rotateAndScalePrimary(0.5, 0.1, 0);
    const angle = (p: [number, number]) => Math.atan2(p[1] - BASE.white[1], p[0] - BASE.white[0]);
    const base = angle(BASE.primaries[0]);
    expect(angle(turned) - base).toBeCloseTo(0.1, 9);
    expect(half[0] - BASE.white[0]).toBeCloseTo((turned[0] - BASE.white[0]) / 2, 9);
  });

  it('does nothing without settings', () => {
    const m = adjustedPrimaries(NO_PRIMARIES);
    near(m.input, I);
    near(m.output, I);
  });

  it('keeps white white, both ways', () => {
    const m = adjustedPrimaries({ inset: [0.2, 0.1, 0.3], rotation: [10, -5, 4], purity: 0.6 });
    for (const v of [mulVec(m.input, [1, 1, 1]), mulVec(m.output, [1, 1, 1])]) for (const c of v) expect(c).toBeCloseTo(1, 6);
  });

  it('pulls a saturated colour towards grey on the way in; full purity undoes it on the way out', () => {
    const m = adjustedPrimaries(SMOOTH_PRIMARIES);
    const red: Vec3 = [1, 0, 0];
    const into = mulVec(m.input, red);
    expect(into[1]).toBeGreaterThan(0);
    expect(into[2]).toBeGreaterThan(0);
    const pure = adjustedPrimaries({ ...SMOOTH_PRIMARIES, purity: 1 });
    near(mulMat(pure.output, pure.input), I, 6);
    // Without purity or rotation, the way out is the base primaries: the inset stays.
    near(adjustedPrimaries({ ...SMOOTH_PRIMARIES, rotation: [0, 0, 0] }).output, I, 9);
  });
});
