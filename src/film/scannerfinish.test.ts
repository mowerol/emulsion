// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { defaultRecipe, normalizeRecipe, type Recipe } from './recipe';
import { captureLook, customLookId, registerCustomLook, unregisterCustomLook } from './looks';
import { recipeFromSettings, settingsFromRecipe, normalizeSettings } from './creative';
import { scannerFinish, scannerFinishId } from './scannerfinish';
import { SCANNER } from './scanners';
import { developUniforms, InputMode } from '../engine/params';
import { applyPreset, normalizePreset, type Preset } from './presets';
const id = 'd0000000-0000-4000-8000-000000000001';
const ctx = { width: 64, height: 64, seed: 1, inputMode: InputMode.SceneLinear, store: 1 };
function look(): Recipe {
  registerCustomLook(id, 'Scanned', { colorBalance: null, curve: null, lut: null, scanner: 'frontier' }, 'look', 1);
  return captureLook({ ...defaultRecipe(), stock: customLookId(id), pack: 'custom', lookEnabled: true, scannerFromLook: true });
}
it('saves and restores a scanner ingredient in an editor draft', () => {
  const settings = normalizeSettings(JSON.parse(JSON.stringify(settingsFromRecipe({ ...defaultRecipe(), scanner: 'flatbed', scannerFromLook: false }, null))))!;
  expect(settings.scanner).toBe('flatbed');
  const draft = recipeFromSettings({ ...defaultRecipe(), scanner: 'noritsu', scannerFromLook: true }, settings);
  expect(draft).toMatchObject({ scanner: 'flatbed', scannerFromLook: false });
  expect(settingsFromRecipe(draft, null)).toEqual(settings);
  expect(normalizeSettings({ scanner: 'unknown' })?.scanner).toBeUndefined();
});
it('resolves exactly one finish and lets None or another scanner replace the look ingredient', () => {
  const r = look();
  expect(scannerFinish(r)).toEqual(SCANNER.frontier);
  for (const scanner of ['straight', 'noritsu', 'flatbed'] as const) {
    const overridden = { ...r, scanner, scannerFromLook: false };
    expect(scannerFinish(overridden)).toEqual(SCANNER[scanner]);
    const actual = developUniforms(overridden, ctx);
    const expected = developUniforms({ ...defaultRecipe(), scanner }, ctx);
    for (const field of ['uSharp', 'uScC', 'uScSat', 'uScBlack', 'uScWhite', 'uScGain', 'uScShadow', 'uScHigh']) expect(actual[field]).toEqual(expected[field]);
  }
});
it('fades an inherited finish with Look Amount and disables it when the look is removed', () => {
  const r = look();
  const zero = scannerFinish({ ...r, lookAmount: 0 });
  for (const field of ['contrast', 'saturation', 'black', 'white', 'sharpness', 'gain', 'shadowTint', 'highlightTint'] as const) expect(zero[field]).toEqual(SCANNER.straight[field]);
  expect(scannerFinish({ ...r, lookAmount: 50 }).sharpness).toBeCloseTo(SCANNER.frontier.sharpness / 2);
  expect(scannerFinish({ ...r, lookAmount: 0, scanner: 'noritsu', scannerFromLook: false })).toEqual(SCANNER.noritsu);
  expect(scannerFinishId({ ...r, lookEnabled: false })).toBe('straight');
});
it('preserves snapshots, legacy photo rendering, and preset inheritance through serialization', () => {
  const r = look();
  unregisterCustomLook(id);
  const reopened = normalizeRecipe(JSON.parse(JSON.stringify(r)))!;
  expect(scannerFinish(reopened)).toEqual(SCANNER.frontier);
  const legacy = normalizeRecipe({ ...defaultRecipe(), scanner: 'flatbed' })!;
  expect(scannerFinish(legacy)).toEqual(SCANNER.flatbed);
  const preset: Preset = { version: 1, id, name: 'Scan', groups: ['Treatment', 'Film options'], recipe: reopened };
  const reloaded = normalizePreset(JSON.parse(JSON.stringify(preset)))!;
  expect(scannerFinish(applyPreset(reloaded, legacy))).toEqual(SCANNER.frontier);
  expect(scannerFinish(applyPreset({ ...reloaded, groups: ['Treatment'] }, legacy))).toEqual(SCANNER.flatbed);
});
