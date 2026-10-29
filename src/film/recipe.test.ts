// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { SLIDERS, defaultRecipe, normalizeRecipe, recipeKey, resetAdjustments, withStock } from './recipe';
import { STOCK, STOCKS } from './stocks';
import { SCANNERS } from './scanners';

describe('recipes', () => {
  it('rejects things that are not recipes', () => {
    for (const v of [null, undefined, 3, 'portra', [], true]) expect(normalizeRecipe(v)).toBeNull();
  });

  it('fills defaults from the stock and clamps out-of-range values', () => {
    const r = normalizeRecipe({ stock: 'cinestill800t', exposure: 99, grain: -4, push: 7, scanner: 'nope' })!;
    expect(r.stock).toBe('cinestill800t');
    expect(r.exposure).toBe(3);
    expect(r.grain).toBe(0);
    expect(r.push).toBe(0);
    expect(r.scanner).toBe('frontier');
    expect(r.halation).toBe(STOCK.cinestill800t.halation);
  });

  it('falls back to a known stock', () => {
    expect(normalizeRecipe({ stock: 'aerochrome' })!.stock).toBe('portra400');
  });

  it('round-trips through JSON unchanged', () => {
    const r = { ...defaultRecipe('ektar100', 'noritsu'), push: 1 as const, exposure: 0.35, wb: { temperature: 4300, tint: -12 } };
    expect(normalizeRecipe(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it('clamps or drops white balance read from a sidecar', () => {
    expect(normalizeRecipe({ stock: 'portra400', wb: { temperature: 900, tint: 400 } })!.wb).toEqual({ temperature: 2000, tint: 100 });
    expect(normalizeRecipe({ stock: 'portra400', wb: { temperature: 'warm' } })!.wb).toBeNull();
    expect(normalizeRecipe({ stock: 'portra400', warmth: 40 })!.wb).toBeNull();
  });

  it('switching stock resets only stock-owned sliders', () => {
    const r = { ...defaultRecipe('portra400'), exposure: 0.5, halation: 70 };
    const s = withStock(r, 'trix400');
    expect(s.exposure).toBe(0.5);
    expect(s.halation).toBe(STOCK.trix400.halation);
    expect(withStock(null, 'gold200')).toEqual(defaultRecipe('gold200'));
  });

  it('reset keeps stock, development and scanner', () => {
    const r = { ...defaultRecipe('gold200', 'flatbed'), push: 2 as const, contrast: 30 };
    const out = resetAdjustments(r);
    expect([out.stock, out.scanner, out.push, out.contrast]).toEqual(['gold200', 'flatbed', 2, 0]);
  });

  it('every stock default sits inside its slider range', () => {
    for (const s of STOCKS) {
      const r = defaultRecipe(s.id);
      for (const d of SLIDERS) {
        expect(r[d.key]).toBeGreaterThanOrEqual(d.min);
        expect(r[d.key]).toBeLessThanOrEqual(d.max);
      }
      for (const row of s.matrix) expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
    expect(SCANNERS.every((sc) => sc.white > sc.black)).toBe(true);
  });

  it('keys distinguish recipes', () => {
    expect(recipeKey(null)).toBe('original');
    expect(recipeKey(defaultRecipe())).not.toBe(recipeKey({ ...defaultRecipe(), exposure: 0.05 }));
  });
});
