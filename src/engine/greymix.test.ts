// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../film/stocks';
import { greyApplies, greyMix, greyOf, greyWeights } from './greymix';

// [grey (darktable's p.grey), Rec.2020 pixel, grey value]: darktable 20891f6c's own functions
// (_gamut_mapping, _luma_chroma v3, XYZ_adapt_D50, the xyY/uvY conversions) copied into C, compiled
// with clang and run down _loop_switch's DT_ADAPTATION_XYZ path at the monochrome presets' settings
// (pipe illuminant, identity mix, clip on, gamut 0, normalised grey). Greys: Fuji Acros 100 and
// ILFORD FP4+ presets, luminance, and a red filter fitted to an X-T30 II's Acros + R.
const UPSTREAM: [Vec3, Vec3, number][] = [
  [[0.333, 0.313, 0.353], [0.18, 0.18, 0.18], 0.166745007],
  [[0.333, 0.313, 0.353], [0.6, 0.2, 0.05], 0.259095013],
  [[0.333, 0.313, 0.353], [0.05, 0.3, 0.35], 0.216992646],
  [[0.333, 0.313, 0.353], [0.02, 0.05, 0.4], 0.155193761],
  [[0.333, 0.313, 0.353], [1.5, 1.2, 0.9], 1.10367239],
  [[0.333, 0.313, 0.353], [0.3, -0.02, 0.1], 0.127138674],
  [[0.333, 0.313, 0.353], [0, 0, 0], 0],
  [[0.333, 0.313, 0.353], [-0.1, -0.1, -0.1], 0],
  [[0.333, 0.313, 0.353], [4, 0.001, 0.0005], 1.24787378],
  [[1.732, -0.449, -0.283], [0.18, 0.18, 0.18], 0.177732512],
  [[1.732, -0.449, -0.283], [0.6, 0.2, 0.05], 0.618547797],
  [[1.732, -0.449, -0.283], [0.05, 0.3, 0.35], 0.0343406647],
  [[1.732, -0.449, -0.283], [0.02, 0.05, 0.4], 0.00782612525],
  [[1.732, -0.449, -0.283], [1.5, 1.2, 0.9], 1.50619876],
  [[1.732, -0.449, -0.283], [0.3, -0.02, 0.1], 0.309550017],
  [[1.732, -0.449, -0.283], [0, 0, 0], 0],
  [[1.732, -0.449, -0.283], [-0.1, -0.1, -0.1], 0],
  [[1.732, -0.449, -0.283], [4, 0.001, 0.0005], 4.16444969],
  [[0, 1, 0], [0.18, 0.18, 0.18], 0.179999188],
  [[0, 1, 0], [0.6, 0.2, 0.05], 0.304760575],
  [[0, 1, 0], [0.05, 0.3, 0.35], 0.232526138],
  [[0, 1, 0], [0.02, 0.05, 0.4], 0.0576024503],
  [[0, 1, 0], [1.5, 1.2, 0.9], 1.27000868],
  [[0, 1, 0], [0.3, -0.02, 0.1], 0.0882690772],
  [[0, 1, 0], [0, 0, 0], 0],
  [[0, 1, 0], [-0.1, -0.1, -0.1], 0],
  [[0, 1, 0], [4, 0.001, 0.0005], 1.11676896],
  [[0.241491, 0.221493, 0.537016], [0.18, 0.18, 0.18], 0.161564261],
  [[0.241491, 0.221493, 0.537016], [0.6, 0.2, 0.05], 0.198595673],
  [[0.241491, 0.221493, 0.537016], [0.05, 0.3, 0.35], 0.236851692],
  [[0.241491, 0.221493, 0.537016], [0.02, 0.05, 0.4], 0.202154696],
  [[0.241491, 0.221493, 0.537016], [1.5, 1.2, 0.9], 1.00355959],
  [[0.241491, 0.221493, 0.537016], [0.3, -0.02, 0.1], 0.113867573],
  [[0.241491, 0.221493, 0.537016], [0, 0, 0], 0],
  [[0.241491, 0.221493, 0.537016], [-0.1, -0.1, -0.1], 0],
  [[0.241491, 0.221493, 0.537016], [4, 0.001, 0.0005], 0.897914529]
];

describe('grey mixer (darktable color calibration, grey tab)', () => {
  it('matches darktable on its monochrome preset path', () => {
    // darktable computes in 32-bit floats; mixed-sign weights cancel, so compare relatively.
    for (const [grey, rgb, want] of UPSTREAM) {
      expect(Math.abs(greyOf(rgb, greyWeights(grey)) - want)).toBeLessThanOrEqual(1e-5 * Math.max(want, 1e-3));
    }
  });

  it('normalises the weights to sum 1 unless they sum to 0', () => {
    expect(greyWeights([2, 1, 1])).toEqual([0.5, 0.25, 0.25]);
    expect(greyWeights([1, -1, 0])).toEqual([1, -1, 0]);
  });

  it('applies only with a weight that is not 0', () => {
    expect(greyApplies([0, 0, 0])).toBe(false);
    expect(greyApplies(undefined)).toBe(false);
    expect(greyApplies([0, 1, 0])).toBe(true);
  });

  it('blends by amount: 0 keeps the colour, 1 is grey', () => {
    const rgb: Vec3 = [0.6, 0.2, 0.05], w = greyWeights([0.333, 0.313, 0.353]);
    expect(greyMix(rgb, w, 0)).toEqual(rgb);
    const g = greyOf(rgb, w);
    expect(greyMix(rgb, w, 1)).toEqual([g, g, g]);
    expect(greyMix(rgb, w, 0.5)[0]).toBeCloseTo((0.6 + g) / 2, 12);
  });

  it('a red filter darkens cyan and lightens red against luminance', () => {
    const red = greyWeights([1.732, -0.449, -0.283]), lum = greyWeights([0, 1, 0]);
    const cyan: Vec3 = [0.05, 0.3, 0.35], warm: Vec3 = [0.6, 0.2, 0.05];
    expect(greyOf(cyan, red)).toBeLessThan(greyOf(cyan, lum) / 3);
    expect(greyOf(warm, red)).toBeGreaterThan(greyOf(warm, lum) * 1.5);
  });
});
