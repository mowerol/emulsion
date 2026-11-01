// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../film/stocks';
import { blendColor, hslToRgb, rgbToHsl } from './blend';

const close = (a: Vec3, b: Vec3, digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe("darktable's color blend mode", () => {
  it('converts to HSL and back', () => {
    for (const c of [[0.9, 0.2, 0.1], [0.1, 0.6, 0.3], [0.2, 0.3, 0.8], [0.5, 0.5, 0.5], [0, 0, 0], [1, 1, 1], [0.95, 0.9, 0.2]] as Vec3[]) {
      close(hslToRgb(rgbToHsl(c)), c);
    }
    close(rgbToHsl([1, 0, 0]), [0, 1, 0.5]);
    close(rgbToHsl([0, 0, 1]), [2 / 3, 1, 0.5]);
  });

  it("takes the output's hue and saturation and keeps the input's lightness", () => {
    close(blendColor([0.5, 0.5, 0.5], [1, 0, 0], 1), [1, 0, 0]);
    const a: Vec3 = [0.2, 0.25, 0.3], b: Vec3 = [0.9, 0.5, 0.2];
    const out = rgbToHsl(blendColor(a, b, 1));
    expect(out[2]).toBeCloseTo(rgbToHsl(a)[2], 6);
    expect(out[0]).toBeCloseTo(rgbToHsl(b)[0], 6);
    expect(out[1]).toBeCloseTo(rgbToHsl(b)[1], 6);
  });

  it('at opacity 0 gives back the input, and blends hue the short way round', () => {
    close(blendColor([0.3, 0.6, 0.2], [0.9, 0.1, 0.1], 0), [0.3, 0.6, 0.2]);
    // Hues 0.95 and 0.05 are 0.1 apart across red, not 0.9: halfway is red (0), not cyan (0.5).
    const a = hslToRgb([0.95, 0.8, 0.5]), b = hslToRgb([0.05, 0.8, 0.5]);
    const h = rgbToHsl(blendColor(a, b, 0.5))[0];
    expect(Math.min(h, 1 - h)).toBeLessThan(1e-6);
  });

  it('clips its inputs and output to 0..1, as darktable does', () => {
    blendColor([1.4, -0.2, 0.5], [2, 0.5, -1], 0.7).forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
  });
});
