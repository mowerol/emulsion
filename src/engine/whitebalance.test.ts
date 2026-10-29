// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../film/stocks';
import { mulVec } from './color';
import {
  D65_XY,
  blackbodyXy,
  daylightXy,
  neutralizingWhite,
  temperatureTint,
  whiteBalanceMatrix,
  whiteXy,
  type Xy,
} from './whitebalance';

const GREY: Vec3 = [0.18, 0.18, 0.18];
const close = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]) < tol);

describe('white points', () => {
  it('matches the standard illuminants', () => {
    expect(close(daylightXy(6504), [0.3127, 0.329], 1e-3)).toBe(true);
    expect(close(blackbodyXy(2856), [0.4476, 0.4074], 2e-3)).toBe(true);
  });

  it('round-trips temperature and tint', () => {
    for (const t of [2200, 2850, 3500, 4200, 5500, 6500, 9000, 14000]) {
      for (const tint of [-60, 0, 35]) {
        const back = temperatureTint(whiteXy(t, tint));
        expect(Math.abs(back.temperature - t) / t).toBeLessThan(0.002);
        expect(back.tint).toBeCloseTo(tint, 1);
      }
    }
  });

  it('reads D65 as about 6500 K with no tint', () => {
    const { temperature, tint } = temperatureTint(D65_XY);
    expect(Math.abs(temperature - 6504)).toBeLessThan(40);
    expect(Math.abs(tint)).toBeLessThan(2);
  });

  it('moves the white towards green for positive tint, so the image turns magenta', () => {
    expect(whiteXy(5500, 50)[1]).toBeGreaterThan(whiteXy(5500, 0)[1]);
  });
});

describe('white balance', () => {
  it('changes nothing when the white is the as-shot white', () => {
    const m = whiteBalanceMatrix([0.34, 0.35], [0.34, 0.35]);
    // darktable's CAT16 matrices are inverses to six decimals.
    expect(close(m.flat(), [1, 0, 0, 0, 1, 0, 0, 0, 1], 1e-5)).toBe(true);
  });

  it('turns grey blue when the temperature goes below the as-shot white, and yellow above', () => {
    const shot = whiteXy(5500, 0);
    const cool = mulVec(whiteBalanceMatrix(shot, whiteXy(3200, 0)), GREY);
    const warm = mulVec(whiteBalanceMatrix(shot, whiteXy(9000, 0)), GREY);
    expect(cool[2]).toBeGreaterThan(cool[0]);
    expect(warm[0]).toBeGreaterThan(warm[2]);
  });

  it('turns grey magenta with positive tint', () => {
    const shot = whiteXy(5500, 0);
    const out = mulVec(whiteBalanceMatrix(shot, whiteXy(5500, 50)), GREY);
    expect(out[1]).toBeLessThan(out[0]);
    expect(out[1]).toBeLessThan(out[2]);
  });

  it('keeps grey about as bright', () => {
    const out = mulVec(whiteBalanceMatrix(whiteXy(5500, 0), whiteXy(3500, 0)), GREY);
    const y = 0.2627 * out[0] + 0.678 * out[1] + 0.0593 * out[2];
    expect(y / 0.18).toBeGreaterThan(0.85);
    expect(y / 0.18).toBeLessThan(1.15);
  });

  it('finds the white that makes a sampled colour neutral', () => {
    for (const from of [D65_XY, whiteXy(4300, 10)] as Xy[]) {
      const sample: Vec3 = [0.21, 0.17, 0.12];
      const w = neutralizingWhite(sample, from)!;
      const out = mulVec(whiteBalanceMatrix(from, w), sample);
      expect(out[0]).toBeCloseTo(out[1], 4);
      expect(out[1]).toBeCloseTo(out[2], 4);
    }
    expect(neutralizingWhite([0, 0, 0], D65_XY)).toBeNull();
  });
});
