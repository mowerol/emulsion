// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { FULL } from '../film/crop';
import { workingScale, displayDensity } from './viewscale';

describe('display working scale', () => {
  it('bounds processing for arbitrary zooms without undersampling the display', () => {
    for (let density = .07; density < 1; density += .0037) {
      const scale = workingScale(density);
      expect(scale).toBeGreaterThanOrEqual(density - 1e-12);
      expect(scale / density).toBeLessThanOrEqual(2 ** .25 + 1e-12);
    }
    expect(workingScale(1)).toBe(1);
    expect(workingScale(4.17)).toBe(1);
  });
  it('retains sufficient detail around a level transition, then releases excess work', () => {
    const scale = workingScale(.637);
    expect(workingScale(.631, scale)).toBe(scale);
    expect(workingScale(.641, scale)).toBe(scale);
    expect(workingScale(.3, scale)).toBeLessThan(scale);
    expect(workingScale(.8, scale)).toBeGreaterThanOrEqual(.8);
  });
  it('uses device pixels, view coverage and crop orientation, independently of source size', () => {
    const view = { x: .2, y: .2, w: .4, h: .4 };
    expect(displayDensity(1200, 800, view, FULL, 6000, 4000)).toBeCloseTo(.5);
    expect(displayDensity(1200, 800, view, { ...FULL, w: .5, h: .5 }, 6000, 4000)).toBeCloseTo(1);
    expect(displayDensity(800, 1200, view, { ...FULL, orient: { turns: 1, flipH: false, flipV: false } }, 6000, 4000)).toBeCloseTo(.5);
    expect(displayDensity(2400, 1600, view, FULL, 6000, 4000)).toBeCloseTo(1);
  });
});
