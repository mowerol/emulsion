// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../film/stocks';
import {
  NEUTRAL,
  NEUTRAL_LOOK,
  SIGMOID_GREY,
  channelOrder,
  curveFor,
  desaturateNegative,
  preserveHue,
  sCurve,
  sigmoid,
  sigmoidCurve,
  sigmoidInverse,
  toneForward,
  toneInverse,
  toneNeutralRgb,
  toneRgb,
} from './tone';
import { srgbEotf } from './color';

describe('sigmoid', () => {
  it('meets its targets: grey to grey, zero to black, white approached but never clipped', () => {
    for (const contrast of [0.8, 1.15, 1.5, 2.2]) {
      for (const skew of [-0.5, 0, 0.11, 0.5]) {
        const c = sigmoidCurve({ ...NEUTRAL, contrast, skew });
        expect(sigmoid(SIGMOID_GREY, c)).toBeCloseTo(SIGMOID_GREY, 5);
        expect(sigmoid(0, c)).toBeCloseTo(NEUTRAL.blackTarget / 100, 7);
        expect(sigmoid(1e4, c)).toBeLessThanOrEqual(1);
        expect(sigmoid(1e4, c)).toBeGreaterThan(0.99);
      }
    }
  });

  it('keeps the slope at middle grey set by contrast alone, whatever the skew', () => {
    const slope = (skew: number) => {
      const c = sigmoidCurve({ ...NEUTRAL, contrast: 1.5, skew });
      return (sigmoid(SIGMOID_GREY * 1.001, c) - sigmoid(SIGMOID_GREY * 0.999, c)) / (SIGMOID_GREY * 0.002);
    };
    expect(slope(0.4)).toBeCloseTo(slope(0), 1);
    expect(slope(-0.4)).toBeCloseTo(slope(0), 1);
  });

  it('inverts exactly', () => {
    const c = sigmoidCurve(NEUTRAL);
    for (let ev = -10; ev <= 6; ev += 0.5) {
      const x = 0.18 * 2 ** ev;
      expect(sigmoidInverse(sigmoid(x, c), c) / x).toBeCloseTo(1, 4);
    }
  });

  it('is monotonic', () => {
    const c = sigmoidCurve({ ...NEUTRAL, contrast: 2 });
    let prev = -1;
    for (let ev = -12; ev <= 8; ev += 0.1) {
      const v = sigmoid(0.18 * 2 ** ev, c);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('tone stage', () => {
  it('round-trips display values, so an undeveloped photo is unchanged', () => {
    for (let e = 0.001; e < 1; e += 0.0371) expect(toneForward(toneInverse(e))).toBeCloseTo(e, 5);
    expect(toneForward(toneInverse(0))).toBeCloseTo(0, 3);
  });

  it('keeps the neutral render close to the curve the stocks were tuned on', () => {
    // Old curve values at -3, 0 and +2 EV from middle grey.
    expect(toneForward(0.18 / 8)).toBeCloseTo(0.163, 1);
    expect(toneForward(0.18)).toBeCloseTo(0.46, 2);
    expect(toneForward(0.18 * 4)).toBeCloseTo(0.743, 1);
  });

  it('rolls highlights off instead of clipping', () => {
    expect(toneForward(0.18 * 2 ** 4)).toBeLessThan(0.97);
    expect(toneForward(0.18 * 2 ** 5)).toBeGreaterThan(toneForward(0.18 * 2 ** 4));
  });

  it('renders greys neutral and matches the per-channel curve on them', () => {
    const g = toneRgb([0.18, 0.18, 0.18], NEUTRAL_LOOK);
    expect(g[0]).toBeCloseTo(g[1], 9);
    expect(g[1]).toBeCloseTo(g[2], 9);
    expect(g[0]).toBeCloseTo(toneNeutralRgb([0.18, 0.18, 0.18])[0], 9);
  });

  it('preserves hue through the curve', () => {
    const x: Vec3 = [0.9, 0.3, 0.05];
    const out = toneRgb(x, NEUTRAL_LOOK).map((v) => srgbEotf(v)) as Vec3;
    const ratio = (p: Vec3) => (p[1] - p[2]) / (p[0] - p[2]);
    expect(ratio(out)).toBeCloseTo(ratio(x), 2);
  });

  it('tints greys with crossover', () => {
    const look = { ...NEUTRAL_LOOK, channels: [1, 1, 0.93] as Vec3 };
    const dark = toneRgb([0.03, 0.03, 0.03], look);
    const bright = toneRgb([0.8, 0.8, 0.8], look);
    // Lower blue contrast lifts blue in the shadows and lowers it in the highlights.
    expect(dark[2]).toBeGreaterThan(dark[1]);
    expect(bright[2]).toBeLessThan(bright[1]);
  });

  it('brightens highlights with whites and lifts shadows with blacks', () => {
    const at = (x: number, whites: number, blacks: number) => toneRgb([x, x, x], { ...NEUTRAL_LOOK, whites, blacks })[1];
    expect(at(2, 60, 0)).toBeGreaterThan(at(2, 0, 0));
    expect(at(2, -60, 0)).toBeLessThan(at(2, 0, 0));
    expect(at(0, 0, 80)).toBeGreaterThan(at(0, 0, 0) + 0.05);
    expect(curveFor(1, { ...NEUTRAL_LOOK, blacks: -80 })).toEqual(curveFor(1, NEUTRAL_LOOK));
  });

  it('handles negative input', () => {
    expect(desaturateNegative([0.5, -0.1, 0.2]).every((v) => v >= -1e-9)).toBe(true);
    expect(toneRgb([0.5, -0.1, 0.2], NEUTRAL_LOOK).every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
  });

  it('orders channels like darktable', () => {
    expect(channelOrder([3, 2, 1])).toEqual({ max: 0, mid: 1, min: 2 });
    expect(channelOrder([1, 3, 2])).toEqual({ max: 1, mid: 2, min: 0 });
    expect(preserveHue([1, 1, 1], [0.5, 0.5, 0.5], 1)).toEqual([0.5, 0.5, 0.5]);
  });

  it('keeps the scanner S-curve', () => {
    expect(sCurve(0.46, 1.4, 0.46)).toBeCloseTo(0.46, 9);
    expect(sCurve(0.3, 1, 0.46)).toBeCloseTo(0.3, 9);
  });
});
