// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { TONE, sCurve, toneForward, toneGamma, toneInverse, tonePivot } from './tone';

describe('tone curve', () => {
  it('places middle grey at the display target for any contrast', () => {
    for (const c of [0.6, 0.86, 1, 1.14, 1.5]) expect(toneForward(TONE.grey, c)).toBeCloseTo(TONE.greyDisplay, 6);
  });

  it('round-trips display values, so an undeveloped photo is unchanged', () => {
    for (let e = 0.001; e < 1; e += 0.0371) expect(toneForward(toneInverse(e))).toBeCloseTo(e, 6);
    expect(toneForward(toneInverse(0))).toBe(0);
    expect(toneForward(toneInverse(1))).toBeCloseTo(1, 9);
  });

  it('maps display white to the scene white point', () => {
    expect(toneInverse(1)).toBeCloseTo(TONE.grey * 2 ** TONE.whiteStops, 6);
  });

  it('is monotonic and clips above white', () => {
    let prev = -1;
    for (let stops = -9; stops <= 5; stops += 0.25) {
      const v = toneForward(TONE.grey * 2 ** stops, 1.2);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(toneForward(100)).toBe(1);
  });

  it('adds contrast around the pivot', () => {
    const p = tonePivot();
    expect(sCurve(p, 1.4, p)).toBeCloseTo(p, 9);
    expect(sCurve(p * 0.5, 1.4, p)).toBeLessThan(p * 0.5);
    expect(sCurve(1 - (1 - p) * 0.5, 1.4, p)).toBeGreaterThan(1 - (1 - p) * 0.5);
    expect(sCurve(0.3, 1, p)).toBeCloseTo(0.3, 9);
  });

  it('has a sensible display gamma', () => {
    expect(toneGamma()).toBeGreaterThan(1.5);
    expect(toneGamma()).toBeLessThan(2.5);
  });
});
