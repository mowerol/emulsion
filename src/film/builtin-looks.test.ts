// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { BUILTIN_LOOKS, PACK, lookFile, lookSettings, withLook } from './looks';
import { normalizeSettings, scaledColorBalance } from './creative';
import { defaultRecipe, normalizeRecipe } from './recipe';
import { isStockId, type StockId } from './stocks';
import { cbCommit, colorBalanceRgb } from '../engine/colorbalance';
import { lookChoices } from '../ui/lookbrowser';
import { lutSourceOf } from '../library/userlooks';
import { developUniforms, InputMode } from '../engine/params';

describe('Emulsion built-in looks', () => {
  it('stores each look in the form a saved look is read back in', () => {
    expect(new Set(BUILTIN_LOOKS.map((l) => l.id)).size).toBe(BUILTIN_LOOKS.length);
    for (const l of BUILTIN_LOOKS) {
      expect(isStockId(l.id), l.id).toBe(true);
      expect(normalizeSettings(l.settings), l.name).toEqual(l.settings);
    }
    expect(BUILTIN_LOOKS.map((l) => l.name)).toEqual(['Emulsion Standard', 'Emulsion Neg', 'Emulsion Chrome', 'Emulsion Gold', 'B&W Dynamic', 'B&W Classic']);
    expect(lookFile('emulsion-looks', 'emulsion-film-neg' as StockId, 0)).toBeNull();
  });

  it('starts new edits with official Emulsion Standard, rendered with its own settings', () => {
    const fresh = defaultRecipe();
    expect(fresh).toMatchObject({ stock: 'emulsion-standard', pack: 'emulsion-looks', lookEnabled: true, lookAmount: 100, scanner: 'straight' });
    expect(lookChoices().filter(c => c.pack === 'emulsion-looks')[0]).toMatchObject({ name: 'Emulsion Standard', stock: fresh.stock, bw: false });
    expect(normalizeRecipe(JSON.parse(JSON.stringify(fresh)))).toEqual(fresh);
    const applied = withLook(defaultRecipe('neutral'), 'emulsion-looks', fresh.stock);
    expect(applied.lookSnapshot).toMatchObject({ name: 'Emulsion Standard', revision: 2, kind: 'look' });
    // An unedited photo shows Standard exactly as choosing it does, and Standard is not Neutral.
    for (const inputMode of [InputMode.SceneLinear, InputMode.DisplayLinear]) {
      const ctx = { width: 64, height: 64, seed: 1, inputMode, store: 1 };
      const neutral = developUniforms(defaultRecipe('neutral'), ctx);
      expect(developUniforms(fresh, ctx)).toEqual(developUniforms(applied, ctx));
      expect(developUniforms(fresh, ctx)).not.toEqual(neutral);
    }
  });

  it('renders B&W Classic as Pat David’s Ilford HP5 Plus 400, unchanged', () => {
    const id = 'emulsion-bw-classic' as StockId;
    expect(lookFile('emulsion-looks', id, 0)).toBe('gmic-film/bw/ilford_hp_5_plus_400.cube');
    expect(lookSettings('emulsion-looks', id)).toEqual({ colorBalance: null, curve: null, lut: { kind: 'pack', pack: 'gmic-film', stock: 'hp5', amount: 1 } });
    // With no settings of its own it is a plain LUT, so a new look can take it as its base.
    expect(lutSourceOf(withLook(defaultRecipe(), 'emulsion-looks', id))).toEqual({ kind: 'pack', pack: 'gmic-film', stock: 'hp5', amount: 1 });
  });

  it('applies with a snapshot of its settings, and photos keep it on reload', () => {
    const r = withLook(defaultRecipe(), 'emulsion-looks', 'emulsion-film-gold' as StockId);
    expect(r.lookSnapshot?.settings).toEqual(lookSettings('emulsion-looks', 'emulsion-film-gold' as StockId));
    const back = normalizeRecipe(JSON.parse(JSON.stringify(r)))!;
    expect([back.pack, back.stock]).toEqual(['emulsion-looks', 'emulsion-film-gold']);
    // Its settings aren't a LUT a new look could take as its base.
    expect(lutSourceOf(r)).toBeNull();
  });

  it('lists the B&W looks as black and white', () => {
    const bw = lookChoices().filter((c) => c.pack === 'emulsion-looks' && c.bw).map((c) => c.name);
    expect(bw).toEqual(['B&W Dynamic', 'B&W Classic']);
  });

  it('turns colour grey in B&W Dynamic', () => {
    const grade = (id: string, rgb: [number, number, number]) =>
      colorBalanceRgb(rgb, cbCommit(scaledColorBalance(PACK['emulsion-looks'].looks[id as StockId]!.settings!, 1)!));
    for (const rgb of [[0.4, 0.1, 0.05], [0.05, 0.2, 0.5], [0.1, 0.3, 0.08]] as [number, number, number][]) {
      const [r, g, b] = grade('emulsion-bw-dynamic', rgb);
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(1e-3 * Math.max(r, 1e-3));
    }
  });
});
