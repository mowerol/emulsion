// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { defaultRecipe, normalizeRecipe } from './recipe';
import { filmGrainColor, monochromeGrain } from './grain';
import { isStockId } from './stocks';

it('includes colour automatically, ignoring the removed preview preference', () => {
  const base = { ...defaultRecipe(), grainType: 'film' as const, grain: 50 };
  expect(filmGrainColor(base)).toBe(true);
  const saved = normalizeRecipe({ ...base, grainColor: false })!;
  expect(saved).not.toHaveProperty('grainColor');
  expect(filmGrainColor(saved)).toBe(true);
});

it('uses monochrome grain automatically for black and white', () => {
  const base = { ...defaultRecipe('trix400'), grainType: 'film' as const, grain: 50 };
  expect(monochromeGrain(base)).toBe(true);
  expect(filmGrainColor(base)).toBe(false);
  expect(filmGrainColor({ ...base, stock: 'gold200' })).toBe(true);
  const catalogStock = 'lut:gmic-film:bw/agfa_apx_100';
  if (!isStockId(catalogStock)) throw Error('Expected bundled B&W LUT');
  expect(filmGrainColor({ ...base, pack: 'gmic-film', stock: catalogStock })).toBe(false);
  expect(filmGrainColor({ ...base, lookEnabled: false })).toBe(true);
  expect(filmGrainColor({ ...base, lookAmount: 0 })).toBe(true);
  const grey = { ...defaultRecipe(), lookEnabled: true, lookSnapshot: { id: 'grey', name: 'Grey', revision: 1, settings: { colorBalance: null, curve: null, lut: null, grey: [0, 1, 0] as [number, number, number] } } };
  expect(filmGrainColor(grey)).toBe(false);
  expect(filmGrainColor({ ...grey, lookSnapshot: { ...grey.lookSnapshot, settings: { ...grey.lookSnapshot.settings, greyAmount: 0 } } })).toBe(true);
  const monoLut = { ...grey, lookSnapshot: { ...grey.lookSnapshot, settings: { ...grey.lookSnapshot.settings, grey: undefined, lut: { kind: 'pack' as const, pack: 'gmic-film', stock: catalogStock, amount: 1 } } } };
  expect(filmGrainColor(monoLut)).toBe(false);
  expect(filmGrainColor({ ...monoLut, lookSnapshot: { ...monoLut.lookSnapshot, settings: { ...monoLut.lookSnapshot.settings, lut: { ...monoLut.lookSnapshot.settings.lut, amount: 0 } } } })).toBe(true);
  for (const colorBalance of [{ chroma_global: -1 }, { saturation_global: -1 }]) {
    const monoBalance = { ...grey, lookSnapshot: { ...grey.lookSnapshot, settings: { ...grey.lookSnapshot.settings, grey: undefined, colorBalance } } };
    expect(filmGrainColor(monoBalance)).toBe(false);
  }
  expect(filmGrainColor({ ...defaultRecipe(), saturation: -100 })).toBe(false);
});

