// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { applyPreset, DEFAULT_PRESET_GROUPS, PRESET_EXCLUDED, PRESET_GROUPS, normalizePreset, presetScope, presetScopeShort, type Preset } from './presets';
import { defaultRecipe, normalizeRecipe } from './recipe';
import { captureLook, customLookId, legacyLooks, PACK, profileSettingsFor, recipeLookFile, registerCustomLook, unregisterCustomLook } from './looks';
const id = 'e0000000-0000-4000-8000-000000000000';
const preset = (groups: Preset['groups']): Preset => ({ version: 1, id, name: 'Style', groups, recipe: { ...defaultRecipe(), contrast: 20, exposure: 2, wb: { temperature: 4000, tint: 5 } } });
it('assigns every recipe field exactly once, including snapshot and explicit exclusions', () => {
  const fields = [...Object.values(PRESET_GROUPS).flat(), ...PRESET_EXCLUDED];
  expect(new Set(fields).size).toBe(fields.length);
  for (const key of Object.keys(defaultRecipe())) expect(fields).toContain(key);
  expect(fields).toContain('lookSnapshot');
});
it('replaces selected groups including neutral values and preserves shot settings and geometry', () => {
  const p = preset(['Tone', 'Grain']);
  const target = { ...defaultRecipe(), exposure: -1, wb: { temperature: 5600, tint: 2 }, grain: 40, highlights: 30, masks: [] };
  const result = applyPreset(p, target);
  expect(result).toMatchObject({ contrast: 20, highlights: 0, grain: 0, exposure: -1, wb: target.wb, masks: target.masks });
  expect(DEFAULT_PRESET_GROUPS).not.toContain('Exposure');
  expect(DEFAULT_PRESET_GROUPS).not.toContain('White balance');
  expect(applyPreset(preset(['Exposure', 'White balance']), target)).toMatchObject({ exposure: 2, wb: p.recipe.wb });
});
it('treatment can explicitly clear a look and presets retain the captured revision', () => {
  const stock = customLookId(id);
  registerCustomLook(id, 'Warm', { colorBalance: { contrast: 0.2 }, curve: null, lut: { kind: 'file', hash: 'a'.repeat(64), amount: 0.6, blend: 'color' } }, 'look', 1);
  const recipe = captureLook({ ...defaultRecipe(), pack: 'custom', stock, lookEnabled: true, lookAmount: 65 });
  const saved: Preset = { ...preset(['Treatment']), recipe: structuredClone(recipe) };
  const before = profileSettingsFor(recipe);
  registerCustomLook(id, 'Cool', { colorBalance: { contrast: -0.2 }, curve: null, lut: null }, 'look', 2);
  expect(profileSettingsFor(recipe)).toEqual(before);
  expect(profileSettingsFor(applyPreset(saved, null))).toEqual(before);
  unregisterCustomLook(id);
  expect(profileSettingsFor(normalizeRecipe(recipe))).toEqual(before);
  expect(recipeLookFile(recipe)).toBe(`user-looks/${'a'.repeat(64)}`);
  expect(applyPreset(preset(['Treatment']), recipe)).toMatchObject({ lookEnabled: false, lookSnapshot: undefined });
  delete PACK.custom.looks[stock];
});
it('hydrates old references from archived definitions and rejects malformed preset files', () => {
  const stock = customLookId(id);
  legacyLooks.set(stock, { name: 'Original', settings: { colorBalance: { contrast: 0.1 }, curve: null, lut: null } });
  registerCustomLook(id, 'Revised', { colorBalance: { contrast: 0.5 }, curve: null, lut: null }, 'look', 2);
  expect(normalizeRecipe({ ...defaultRecipe(), pack: 'custom', stock, lookEnabled: true })?.lookSnapshot).toMatchObject({ name: 'Original', settings: { colorBalance: { contrast: 0.1 } } });
  expect(normalizePreset({ ...preset(['Tone']), groups: ['nope'] })).toBeNull();
  expect(normalizePreset(preset(['Tone']))?.groups).toEqual(['Tone']);
  legacyLooks.delete(stock); delete PACK.custom.looks[stock];
});
it('keeps a collection name, trimmed, and leaves presets without one uncollected', () => {
  expect(normalizePreset({ ...preset(['Tone']), collection: '  Travel ' })?.collection).toBe('Travel');
  expect(normalizePreset({ ...preset(['Tone']), collection: '   ' })).not.toHaveProperty('collection');
  expect(normalizePreset({ ...preset(['Tone']), collection: 7 })).not.toHaveProperty('collection');
  expect(presetScope({ groups: ['Tone', 'Treatment', 'White balance'] })).toBe('Look · WB · Tone');
  expect(presetScopeShort({ groups: ['Tone', 'Treatment'] })).toBe('Look · Tone');
  expect(presetScopeShort({ groups: ['Treatment', 'Tone', 'Curve', 'Colour', 'Effects'] })).toBe('Look · Tone · Curve · 2 more');
});
