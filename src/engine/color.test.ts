// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { REC2020_TO_SRGB, SRGB_TO_REC2020, columnMajor, mulMat, mulVec, srgbEotf, srgbOetf } from './color';

describe('colour spaces', () => {
  it('sRGB and Rec.2020 matrices are inverses', () => {
    const m = mulMat(REC2020_TO_SRGB, SRGB_TO_REC2020);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(m[i][j]).toBeCloseTo(i === j ? 1 : 0, 6);
  });

  it('keeps white white', () => {
    for (const v of mulVec(SRGB_TO_REC2020, [1, 1, 1])) expect(v).toBeCloseTo(1, 6);
  });

  it('puts every sRGB colour inside Rec.2020', () => {
    for (const c of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0]] as [number, number, number][]) {
      for (const v of mulVec(SRGB_TO_REC2020, c)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('lays matrices out column-major for WebGL', () => {
    expect(columnMajor([[1, 2, 3], [4, 5, 6], [7, 8, 9]])).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9]);
  });

  it('sRGB transfer functions invert', () => {
    for (let v = 0; v <= 1; v += 0.05) expect(srgbOetf(srgbEotf(v))).toBeCloseTo(v, 9);
  });
});
