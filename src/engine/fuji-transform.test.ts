// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { adaptFuji, decodeRec709, encodeFLog2, fujiInputToLog, rec709ToSrgb } from '../../tools/luts/fuji-transform';
import { srgbEotf } from './color';
import { toneForward } from './tone';
import { type Clut } from './lut3d';

describe('local Fuji LUT adaptation', () => {
  it('uses the Rec.709 linear toe instead of treating monitor gamma as the signal curve', () => {
    // darktable's Gamma Rec709 RGB profile, pinned in fuji-transform.ts.
    expect(decodeRec709(0.045)).toBeCloseTo(0.01, 12);
    expect(decodeRec709(0.0405)).toBeCloseTo(0.009, 12);
    expect(rec709ToSrgb(0.045)).toBeCloseTo(0.09985282273412832, 12);
    expect(decodeRec709(0.4090077288641504)).toBeCloseTo(0.18, 12);
    expect(rec709ToSrgb(0)).toBe(0);
    expect(rec709ToSrgb(1)).toBeCloseTo(1, 12);
    // The old gamma-2.2 interpretation gave ~0.01 for this measured Provia output.
    expect(rec709ToSrgb(0.03888876668866252)).toBeCloseTo(0.09071602530683504, 12);
  });

  it('matches LittleCMS evaluating darktable’s exact Rec.709 parametric profile', () => {
    // cmsBuildParametricToneCurve(NULL, 4, {1/.45, 1/1.099, .099/1.099, 1/4.5, .081})
    // evaluated by the installed native LittleCMS, not by the TypeScript implementation.
    const reference = [
      [0.0388887674, 0.00864194799], [0.0405000001, 0.00899999961],
      [0.0450000018, 0.0100000007], [0.0810000002, 0.0179450233],
      [0.112905622, 0.0257889014], [0.409007728, 0.179999992], [0.5, 0.259589404],
    ];
    for (const [signal, linear] of reference) expect(decodeRec709(signal)).toBeCloseTo(linear, 7);
  });

  it('reconstructs the specified F-Log2 input without applying a second photo tone curve', () => {
    for (const [scene, code] of [[0, 95], [0.18, 400], [0.9, 570]]) {
      const input = toneForward(scene);
      const log = fujiInputToLog([input, input, input]);
      expect(log[0] * 1023).toBeCloseTo(code, 0);
      expect(log[1]).toBeCloseTo(log[0], 12);
      expect(log[2]).toBeCloseTo(log[0], 12);
      expect(log[0]).toBeCloseTo(encodeFLog2(scene), 12);
    }
  });

  it('keeps a neutral linear-to-Rec.709 pipeline neutral after adaptation', () => {
    // A sampled, independently specified BT.709 encoder of scene reflection,
    // with input indexed by F-Log2. This detects output transfer mistakes in the whole chain.
    const level = 65, data = new Float32Array(level ** 3 * 3);
    const encode709 = (x: number) => x < 0.018 ? 4.5 * x : 1.099 * Math.pow(x, 0.45) - 0.099;
    const fromLog = (v: number) => v >= 0.100686685370811
      ? Math.max(0, (Math.pow(10, (v - 0.384316) / 0.245281) - 0.064829) / 5.555556)
      : Math.max(0, (v - 0.092864) / 8.799461);
    for (let b = 0; b < level; b++) for (let g = 0; g < level; g++) for (let r = 0; r < level; r++) {
      data.set([r, g, b].map(v => encode709(Math.min(1, fromLog(v / (level - 1))))), ((b * level + g) * level + r) * 3);
    }
    const lut: Clut = { level, data };
    for (const scene of [0.01, 0.0342, 0.18, 0.5]) {
      const d = toneForward(scene);
      const got = adaptFuji(lut, [d, d, d]);
      expect(srgbEotf(got[0])).toBeCloseTo(scene, 2);
    }
  });
});
