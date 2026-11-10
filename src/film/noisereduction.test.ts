// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { defaultRecipe, normalizeRecipe, resetSection } from './recipe';
import { CHROMA_ONLY, NOISE_DEFAULTS, effectiveProfiled, noiseBlend, noiseEnabled, profiledEnabled } from './noisereduction';
import { applyPreset } from './presets';

it('keeps old photos off and preserves noise reduction through sidecar and Detail presets', () => {
  const base = defaultRecipe();
  expect(noiseEnabled(normalizeRecipe({ ...base, noiseReduction: undefined }))).toBe(false);
  const recipe = { ...base, noiseReduction: { ...NOISE_DEFAULTS, enabled: true, amount: 37 } };
  const loaded = normalizeRecipe(JSON.parse(JSON.stringify(recipe)))!;
  expect(loaded.noiseReduction).toEqual(recipe.noiseReduction);
  expect(resetSection(loaded, 'noise').noiseReduction).toBeNull();
  expect(resetSection(loaded, 'detail').noiseReduction).toEqual(recipe.noiseReduction);
  expect(applyPreset({ version: 1, id: 'noise', name: 'Noise', groups: ['Detail'], recipe }, null).noiseReduction).toEqual(recipe.noiseReduction);
  expect(normalizeRecipe({ ...base, noiseReduction: { enabled: true, amount: 999 } })?.noiseReduction?.amount).toBe(100);
});

it('blends signed scene-linear RAW values with exact endpoints', () => {
  expect(noiseBlend(-0.2, 0.4, 0)).toBe(-0.2);
  expect(noiseBlend(-0.2, 0.4, 100)).toBe(0.4);
  expect(noiseBlend(-0.2, 0.4, 50)).toBeCloseTo(0.1);
});

it('starts new RAWs with colour noise reduction and leaves older edits as they were', () => {
  const fresh = defaultRecipe();
  expect(fresh.profiledDenoise).toBe('auto');
  // An unedited photo (no recipe) and a new recipe: RAWs get darktable's chroma-only preset.
  expect(effectiveProfiled(null, true)).toEqual(CHROMA_ONLY);
  expect(effectiveProfiled(fresh, true)).toEqual(CHROMA_ONLY);
  expect(effectiveProfiled(fresh, false)).toBeNull();
  // Saved and reloaded, it stays 'auto'.
  expect(normalizeRecipe(JSON.parse(JSON.stringify(fresh)))!.profiledDenoise).toBe('auto');
  // A sidecar from before it existed has no field: off, so it renders as it did.
  const old = JSON.parse(JSON.stringify(fresh));
  delete old.profiledDenoise;
  expect(effectiveProfiled(normalizeRecipe(old), true)).toBeNull();
  // An explicit setting wins; both forces at 0 does nothing.
  const set = { ...CHROMA_ONLY, luma: 30, chroma: 0 };
  expect(effectiveProfiled(normalizeRecipe({ ...fresh, profiledDenoise: set }), true)).toEqual(set);
  expect(profiledEnabled({ ...CHROMA_ONLY, chroma: 0 })).toBe(false);
  // Each section resets only its own controls.
  const edited = { ...fresh, sharpen: 40, profiledDenoise: set };
  expect(resetSection(edited, 'noise')).toEqual({ ...edited, profiledDenoise: 'auto' });
  expect(resetSection(edited, 'detail')).toEqual({ ...edited, sharpen: fresh.sharpen });
});
