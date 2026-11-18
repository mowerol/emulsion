// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { DEFAULT_FUJI_SIM, effectiveWb, fujiLookSettings, fujiSimulations, fujiWhiteBalance, fujiWhiteBalanceMatrix, kelvinWhite, withFujiLook } from './fujilooks';
import { FUJI_NEUTRAL } from './fujirecipe';
import { defaultRecipe } from './recipe';
import { temperatureTint, type Xy } from '../engine/whitebalance';
import { mulVec } from '../engine/color';
import { REC2020_TO_XYZ } from '../engine/colorbalance';
import type { Mat3, Vec3 } from './stocks';

const rows: [number, number, number][] = [[4000, 0.38, 0.38], [5000, 0.345, 0.36], [6000, 0.32, 0.34]];
const camera = { autoWhite: [0.33, 0.35] as Xy, presetWhites: { daylight: [0.347, 0.363] as Xy, kelvin: rows } };

describe('kelvinWhite', () => {
  it('is a row at its own Kelvin and interpolates in mireds between rows', () => {
    expect(kelvinWhite(rows, 5000)).toEqual([0.345, 0.36]);
    const mid = 1e6 / ((1e6 / 5000 + 1e6 / 6000) / 2);
    const [x] = kelvinWhite(rows, mid)!;
    expect(x).toBeCloseTo((0.345 + 0.32) / 2, 6);
  });
  it('holds the ends', () => {
    expect(kelvinWhite(rows, 2500)).toEqual([0.38, 0.38]);
    expect(kelvinWhite(rows, 10000)).toEqual([0.32, 0.34]);
    expect(kelvinWhite([], 5000)).toBeNull();
  });
});

describe('fujiWhiteBalance', () => {
  it("uses the camera's own Auto and presets when it has them", () => {
    expect(fujiWhiteBalance({ mode: 'auto' }, camera)!.temperature).toBeCloseTo(temperatureTint([0.33, 0.35]).temperature, 0);
    expect(fujiWhiteBalance({ mode: 'daylight' }, camera)!.temperature).toBeCloseTo(temperatureTint([0.347, 0.363]).temperature, 0);
    expect(fujiWhiteBalance({ mode: 'kelvin', kelvin: 5000 }, camera)!.temperature).toBeCloseTo(temperatureTint([0.345, 0.36]).temperature, 0);
  });
  it("falls back to as shot for Auto and Emulsion's own Kelvin otherwise", () => {
    expect(fujiWhiteBalance({ mode: 'auto' }, null)).toBeNull();
    expect(fujiWhiteBalance({ mode: 'daylight' }, null)).toEqual({ temperature: 5500, tint: 0 });
    expect(fujiWhiteBalance({ mode: 'kelvin', kelvin: 5200 }, null)).toEqual({ temperature: 5200, tint: 0 });
  });
});

describe('effectiveWb', () => {
  const settings = fujiLookSettings(DEFAULT_FUJI_SIM, { ...FUJI_NEUTRAL, wb: { mode: 'kelvin', kelvin: 5200 } })!;
  const withRecipe = withFujiLook(defaultRecipe('neutral'), 'r', 'Recipe', settings);
  it("is the recipe's until the photo has its own", () => {
    expect(effectiveWb(withRecipe, null)).toEqual({ temperature: 5200, tint: 0 });
    expect(effectiveWb({ ...withRecipe, wb: { temperature: 4000, tint: 3 } }, null)).toEqual({ temperature: 4000, tint: 3 });
    expect(effectiveWb({ ...withRecipe, lookEnabled: false }, null)).toBeNull();
    expect(effectiveWb(defaultRecipe('neutral'), camera)).toBeNull();
  });
});

describe('fujiWhiteBalanceMatrix', () => {
  const identity: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const white = (coefficients: Vec3): Xy => {
    const xyz = mulVec(REC2020_TO_XYZ, coefficients.map(v => 1 / v) as Vec3);
    const sum = xyz.reduce((a, b) => a + b, 0);
    return [xyz[0] / sum, xyz[1] / sum];
  };
  const from = white([1.4, 1, 1.2]), to = white([0.8, 1, 2]);
  const native = { autoWhite: to, presetWhites: { daylight: to, kelvin: [[6800, ...to] as [number, number, number]] } };
  const look = (wb: typeof FUJI_NEUTRAL.wb) => withFujiLook(defaultRecipe('neutral'), 'r', 'Recipe', fujiLookSettings(DEFAULT_FUJI_SIM, { ...FUJI_NEUTRAL, wb })!);
  it('uses native Auto coefficients with green unchanged', () => {
    const matrix = fujiWhiteBalanceMatrix(look({ mode: 'auto' }), native, from, identity)!;
    const actual = mulVec(matrix, [0.2, 0.3, 0.4]);
    const expected = [0.2 * 0.8 / 1.4, 0.3, 0.4 * 2 / 1.2];
    actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 6));
  });
  it("uses the camera's Daylight and Kelvin presets the same way", () => {
    const expected = [0.2 * 0.8 / 1.4, 0.3, 0.4 * 2 / 1.2];
    for (const wb of [{ mode: 'daylight' as const }, { mode: 'kelvin' as const, kelvin: 6800 }]) {
      const actual = mulVec(fujiWhiteBalanceMatrix(look(wb), native, from, identity)!, [0.2, 0.3, 0.4]);
      actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 6));
    }
  });
  it('leaves explicit WB and missing camera whites to normal adaptation', () => {
    const r = look({ mode: 'auto' });
    expect(fujiWhiteBalanceMatrix({ ...r, wb: { temperature: 4000, tint: 3 } }, native, from, identity)).toBeNull();
    expect(fujiWhiteBalanceMatrix(r, null, from, identity)).toBeNull();
    expect(fujiWhiteBalanceMatrix({ ...r, lookEnabled: false }, native, from, identity)).toBeNull();
    expect(fujiWhiteBalanceMatrix(look({ mode: 'auto' }), {}, from, identity)).toBeNull();
    expect(fujiWhiteBalanceMatrix(look({ mode: 'kelvin', kelvin: 6800 }), { autoWhite: to }, from, identity)).toBeNull();
    expect(fujiWhiteBalanceMatrix(look({ mode: 'daylight' }), { autoWhite: to, presetWhites: { kelvin: [] } }, from, identity)).toBeNull();
  });
  it('rejects singular camera transforms', () => {
    expect(fujiWhiteBalanceMatrix(look({ mode: 'auto' }), native, from, [[0, 0, 0], [0, 0, 0], [0, 0, 0]])).toBeNull();
  });
});

describe('fujiSimulations', () => {
  it('lists the colour simulations only', () => {
    const names = fujiSimulations().map((s) => s.name);
    expect(names).toContain('Classic Chrome');
    expect(names).toContain('Classic Negative');
    expect(names.some((n) => /acros|monochrome|sepia/i.test(n))).toBe(false);
  });
});
