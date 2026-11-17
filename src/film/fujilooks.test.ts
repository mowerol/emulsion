// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { DEFAULT_FUJI_SIM, effectiveWb, fujiLookSettings, fujiSimulations, fujiWhiteBalance, kelvinWhite, withFujiLook } from './fujilooks';
import { FUJI_NEUTRAL } from './fujirecipe';
import { defaultRecipe } from './recipe';
import { temperatureTint, type Xy } from '../engine/whitebalance';

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

describe('fujiSimulations', () => {
  it('lists the colour simulations only', () => {
    const names = fujiSimulations().map((s) => s.name);
    expect(names).toContain('Classic Chrome');
    expect(names).toContain('Classic Negative');
    expect(names.some((n) => /acros|monochrome|sepia/i.test(n))).toBe(false);
  });
});
