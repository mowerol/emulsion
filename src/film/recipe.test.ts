// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { SLIDERS, defaultRecipe, normalizeRecipe, recipeKey, resetAdjustments, resetSection, sectionChanged, withSettingsFrom, withStock } from './recipe';
import { STOCK, STOCKS } from './stocks';
import { SCANNERS } from './scanners';

describe('recipes', () => {
  it('reads the look pack and Amount, defaulting old sidecars to Emulsion\'s own looks at full strength', () => {
    const old = normalizeRecipe({ stock: 'portra400' })!;
    expect(old.pack).toBe('emulsion');
    expect(old.lookAmount).toBe(100);
    const r = normalizeRecipe({ stock: 'portra400', pack: 't3mujinpack', lookAmount: 140 })!;
    expect(r.pack).toBe('t3mujinpack');
    expect(r.lookAmount).toBe(100);
    expect(normalizeRecipe({ pack: 'nope', lookAmount: 35 })!).toMatchObject({ pack: 'emulsion', lookAmount: 35 });
    expect(resetAdjustments({ ...defaultRecipe('portra400'), pack: 't3mujinpack', lookAmount: 60, exposure: 1 })).toMatchObject({ pack: 't3mujinpack', lookAmount: 60, exposure: 0 });
  });

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
    expect(normalizeRecipe({ stock: 'aerochrome' })!.stock).toBe('neutral');
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

  it('switching stock keeps the grain amount and halation, and takes the new film speed', () => {
    const r = { ...defaultRecipe('portra400'), exposure: 0.5, halation: 70, grain: 40 };
    const s = withStock(r, 'trix400');
    expect(s.exposure).toBe(0.5);
    expect(s.halation).toBe(70);
    expect(s.grain).toBe(40);
    expect(s.grainIso).toBe(STOCK.trix400.iso);
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

  it('resets one section to its defaults and leaves the rest', () => {
    const r = { ...defaultRecipe('cinestill800t'), exposure: 1, wb: { temperature: 4000, tint: 5 }, grain: 60, grainIso: 1600, push: 1 as const };
    const a = resetSection(r, 'adjust');
    expect(a.exposure).toBe(0);
    expect(a.wb).toBeNull();
    expect(a.grain).toBe(60);
    expect(a.push).toBe(1);
    const g = resetSection(r, 'grain');
    expect(g.grain).toBe(defaultRecipe('cinestill800t').grain);
    expect(g.grainIso).toBe(defaultRecipe('cinestill800t').grainIso);
    expect(g.exposure).toBe(1);
    expect(resetSection(r, 'development').push).toBe(0);
    expect(sectionChanged(r, 'adjust')).toBe(true);
    expect(sectionChanged(a, 'adjust')).toBe(false);
    expect(sectionChanged(r, 'curve')).toBe(false);
    expect(sectionChanged(null, 'grain')).toBe(false);
  });
});

describe('crop in recipes', () => {
  const crop = { x: 0.1, y: 0.1, w: 0.6, h: 0.6, angle: 2.5, aspect: '1:1' as const };

  it('reads a crop from a sidecar and keeps it through slider resets', () => {
    const r = normalizeRecipe({ ...defaultRecipe(), crop })!;
    expect(r.crop).toEqual(crop);
    expect(resetAdjustments({ ...r, exposure: 1 }).crop).toEqual(crop);
    expect(resetSection(r, 'crop').crop).toBeNull();
    expect(sectionChanged(r, 'crop')).toBe(true);
    expect(normalizeRecipe({ ...defaultRecipe() })!.crop).toBeNull();
  });

  it('keeps each frame\'s own crop when settings are pasted', () => {
    const from = { ...defaultRecipe('portra400'), crop };
    expect(withSettingsFrom(from, null).crop).toBeNull();
    const other = { ...defaultRecipe(), crop: { ...crop, x: 0.2 } };
    expect(withSettingsFrom(from, other)).toEqual({ ...from, crop: other.crop });
  });

  it('reads capture sharpening saved under its old name, and starts the unsharp mask at its defaults', () => {
    const r = normalizeRecipe({ stock: 'neutral', sharpening: 60 })!;
    expect(r.captureSharpening).toBe(60);
    expect(r.sharpen).toBe(0);
    expect(r.sharpenRadius).toBe(0.5);
    expect(r.sharpenMasking).toBe(10);
    expect(normalizeRecipe({ captureSharpening: 30, sharpening: 60 })!.captureSharpening).toBe(30);
    expect(resetSection({ ...r, sharpen: 40, sharpenRadius: 1.2, clarity: 20 }, 'detail')).toEqual({ ...r, captureSharpening: 0 });
  });

  it('reads Colour from a sidecar, clamping it, and keeps an untouched one as null', () => {
    const r = normalizeRecipe({ color: { hue: [200, 0, 10], sat: [0, -150, 0, 0, 0, 0, 0, 40], bright: 'x' } })!;
    expect(r.color).toEqual({ hue: [120, 0, 10, 0, 0, 0, 0, 0], sat: [0, -100, 0, 0, 0, 0, 0, 40], bright: [0, 0, 0, 0, 0, 0, 0, 0] });
    expect(normalizeRecipe({ color: { hue: [0], sat: [], bright: [] } })!.color).toBeNull();
    expect(resetSection({ ...r }, 'color').color).toBeNull();
  });
});
