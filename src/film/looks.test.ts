// SPDX-License-Identifier: GPL-3.0-or-later
/// <reference types="node" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import catalogue from './lut-catalogue.json';
import { LOCAL_LOOKS } from './local-looks';
import { DEFAULT_PACK, PACKS, isPackId, lookFile, registerUserLook, stockForPack, stocksForPack, userLookHash } from './looks';
import { STOCK, isStockId } from './stocks';
import { defaultRecipe, normalizeRecipe, resetAdjustments, withSettingsFrom, withStock } from './recipe';
import { parseCube, tetrahedral } from '../engine/lut3d';

describe('bundled look catalogues', () => {
  it('ships every advertised new look unchanged, readable by the real LUT parser', () => {
    expect(catalogue.filter(s => s.pack === 'gmic-film')).toHaveLength(269);
    expect(catalogue.filter(s => s.pack === 'picturefx')).toHaveLength(19);
    expect(new Set(catalogue.map(s => s.id)).size).toBe(catalogue.length);
    for (const row of catalogue) {
      expect(isPackId(row.pack)).toBe(true);
      expect(isStockId(row.id)).toBe(true);
      if (!isPackId(row.pack) || !isStockId(row.id)) throw new Error(row.id);
      const file = lookFile(row.pack, row.id, 0)!;
      const bytes = readFileSync(new URL(`../../public/looks/${file}`, import.meta.url));
      expect(createHash('sha256').update(bytes).digest('hex'), file).toBe(row.sha256);
      const lut = parseCube(bytes.toString());
      expect(lut.level, file).toBe(13);
      expect(lut.data.every(Number.isFinite), file).toBe(true);
      expect(tetrahedral(lut, [0.24, 0.53, 0.79]).every(Number.isFinite), file).toBe(true);
    }
  });

  it('offers only supported presets and selects an actual look when changing packs', () => {
    // My looks is empty until the user imports one (tested below).
    for (const pack of PACKS.filter((p) => !p.user)) {
      const choices = stocksForPack(pack.id);
      expect(choices.length).toBeGreaterThan(0);
      for (const s of choices) {
        expect(lookFile(pack.id, s.id, 0)).toBeTruthy();
        expect(stockForPack(pack.id, s.id)).toBe(s.id);
      }
      expect(lookFile(pack.id, stockForPack(pack.id, 'neutral'), 0)).toBeTruthy();
    }
    expect(stockForPack('gmic-film', 'portra400')).toBe('portra400');
    expect(isPackId('emulsion')).toBe(false);
    expect(DEFAULT_PACK).toBe('t3mujinpack');
    expect(lookFile('t3mujinpack', 'portra400', 0)).toBe('t3mujinpack/t3mujinpack - Color Negative - Kodak Portra 400.png');
    expect(isStockId('lut:unknown:film')).toBe(false);
    expect(isStockId('constructor')).toBe(false);
    expect(isPackId('toString')).toBe(false);
  });

  it('registers the optional local packs and preserves their selection in saved recipes', () => {
    if (!LOCAL_LOOKS.length) {
      expect(isPackId('fuji-test')).toBe(false);
      expect(isPackId('spektrafilm')).toBe(false);
      return;
    }
    const fuji = LOCAL_LOOKS.filter(s => s.pack === 'fuji-test');
    if (fuji.length) {
      expect(isPackId('fuji-test')).toBe(true);
      expect(stocksForPack('fuji-test')).toHaveLength(fuji.length);
      expect(new Set(fuji.map(s => s.id)).size).toBe(fuji.length);
      expect(fuji.map(s => s.name)).toContain('Acros');
    }
    const spectral = LOCAL_LOOKS.filter(s => s.pack === 'spektrafilm');
    if (spectral.length) {
      expect(isPackId('spektrafilm')).toBe(true);
      expect(stocksForPack('spektrafilm')).toHaveLength(spectral.length);
      expect(spectral.map(s => s.name)).toEqual(expect.arrayContaining(['Gold 200', 'Portra 400', 'Portra 800', 'UltraMax 400', 'Pro 400H']));
    }
    for (const row of LOCAL_LOOKS) {
      expect(isStockId(row.id)).toBe(true);
      const file = lookFile(row.pack, row.id, 0)!;
      expect(file).toBe(`/local-looks/${row.pack}/${row.file}`);
      const bytes = readFileSync(new URL(`../../${file.slice(1)}`, import.meta.url));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(row.sha256);
      const lut = parseCube(bytes.toString('utf8'));
      expect(lut.level).toBeGreaterThan(1);
      expect(lut.data.every(Number.isFinite)).toBe(true);
      const mid = tetrahedral(lut, [0.5, 0.5, 0.5]);
      expect(mid.every((v) => v >= 0 && v <= 1)).toBe(true);
      const r = { ...withStock(defaultRecipe(), row.id), pack: row.pack, lookAmount: 62 };
      expect(normalizeRecipe(JSON.parse(JSON.stringify(r)))).toEqual(r);
      expect(stockForPack('t3mujinpack', row.id)).toBe('portra400');
    }
  });

  it('does not crush Provia shadows during the local Rec.709 to sRGB adaptation', () => {
    const provia = LOCAL_LOOKS.find(s => s.name === 'Provia');
    if (!provia) return; // Private test LUTs are intentionally absent from a public checkout.
    const lut = parseCube(readFileSync(new URL(`../../local-looks/fuji-test/${provia.file}`, import.meta.url), 'utf8'));
    expect(tetrahedral(lut, [0.2, 0.2, 0.2])[0]).toBeGreaterThan(0.15);
    expect(tetrahedral(lut, [0.1, 0.1, 0.1])[0]).toBeGreaterThan(0.06);
  });

  it('persists new looks through recipes, resets and copy/paste without changing their pack', () => {
    for (const row of catalogue) {
      if (!isPackId(row.pack) || !isStockId(row.id)) throw new Error(row.id);
      const r = { ...withStock(defaultRecipe(), row.id), pack: row.pack, lookAmount: 57, exposure: 0.5 };
      expect(normalizeRecipe(JSON.parse(JSON.stringify(r)))).toEqual(r);
      const pasted = withSettingsFrom(r, defaultRecipe());
      expect(pasted).toMatchObject({ stock: row.id, pack: row.pack, lookAmount: 57 });
      expect(resetAdjustments(r)).toMatchObject({ stock: row.id, pack: row.pack, lookAmount: 57, exposure: 0 });
      expect(STOCK[row.id].grain).toBe(0);
      expect(STOCK[row.id].halation).toBe(0);
    }
  });
});

describe('imported looks (My looks)', () => {
  const hash = 'ab'.repeat(32);
  const id = `lut:mine:${hash}` as const;

  it('keeps a recipe that names an imported look before the list has loaded, as Missing look', () => {
    const r = normalizeRecipe({ stock: id, pack: 'mine', lookAmount: 60 })!;
    expect(r).toMatchObject({ stock: id, pack: 'mine', lookEnabled: true, lookAmount: 60 });
    expect(STOCK[id].name).toBe('Missing look');
    expect(stocksForPack('mine').some((s) => s.id === id)).toBe(false);
    expect(lookFile('mine', id, 0)).toBe(`user-looks/${hash}`);
  });

  it('offers a registered look and renames the placeholder', () => {
    registerUserLook(hash, 'Warm print');
    expect(STOCK[id].name).toBe('Warm print');
    expect(stocksForPack('mine').map((s) => s.id)).toContain(id);
    expect(stockForPack('mine', 'portra400')).toBe(id);
    expect(isStockId(id)).toBe(true);
  });

  it('accepts only content-hash ids in My looks', () => {
    expect(userLookHash(id)).toBe(hash);
    expect(userLookHash('lut:mine:../x')).toBeNull();
    expect(userLookHash('portra400')).toBeNull();
    const r = normalizeRecipe({ stock: 'lut:mine:nope', pack: 'mine' })!;
    expect(r).toMatchObject({ stock: 'neutral', lookEnabled: false });
  });
});
