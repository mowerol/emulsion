// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { defaultRecipe, normalizeRecipe, resetSection } from './recipe';
import { NOISE_DEFAULTS, noiseBlend, noiseEnabled } from './noisereduction';
import { applyPreset } from './presets';

it('keeps old photos off and preserves noise reduction through sidecar and Detail presets', () => {
  const base = defaultRecipe();
  expect(noiseEnabled(normalizeRecipe({ ...base, noiseReduction: undefined }))).toBe(false);
  const recipe = { ...base, noiseReduction: { ...NOISE_DEFAULTS, enabled: true, amount: 37 } };
  const loaded = normalizeRecipe(JSON.parse(JSON.stringify(recipe)))!;
  expect(loaded.noiseReduction).toEqual(recipe.noiseReduction);
  expect(resetSection(loaded, 'detail').noiseReduction).toBeNull();
  expect(applyPreset({ version: 1, id: 'noise', name: 'Noise', groups: ['Detail'], recipe }, null).noiseReduction).toEqual(recipe.noiseReduction);
  expect(normalizeRecipe({ ...base, noiseReduction: { enabled: true, amount: 999 } })?.noiseReduction?.amount).toBe(100);
});

it('blends signed scene-linear RAW values with exact endpoints', () => {
  expect(noiseBlend(-0.2, 0.4, 0)).toBe(-0.2);
  expect(noiseBlend(-0.2, 0.4, 100)).toBe(0.4);
  expect(noiseBlend(-0.2, 0.4, 50)).toBeCloseTo(0.1);
});
