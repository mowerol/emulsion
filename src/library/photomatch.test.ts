// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { photoMatchBase, referenceName } from './photomatch';
import { lutSourceOf } from './userlooks';
import { normalizeSettings, recipeFromSettings, settingsFromRecipe, withLutBase } from '../film/creative';
import { fileLutId, PACK, registerCustomLook, registerFileLut } from '../film/looks';
import { defaultRecipe, normalizeRecipe } from '../film/recipe';

describe('photo match LUT', () => {
  it('fits from the camera rendering, excluding the previous look', () => {
    const original = { ...defaultRecipe('portra400'), exposure: .7, contrast: 35, scanner: 'frontier' as const, autoProfile: 'a'.repeat(64) };
    expect(photoMatchBase(original)).toMatchObject({ lookEnabled: false, exposure: .7, contrast: 0, scanner: 'straight', autoProfile: original.autoProfile });
    expect(referenceName('C:\\Photos\\Warm reference.jpg')).toBe('Warm reference.jpg');
  });
  it('replaces a LUT and reopens its saved file, reference identity, intensity and blend', () => {
    const hash = 'e'.repeat(64), reference = 'Evening.jpg';
    registerFileLut(hash, 'Evening match', reference);
    const draft = withLutBase({ ...defaultRecipe('portra400'), contrast: 21 }, { kind: 'file', hash, amount: .6, blend: 'color' });
    expect(draft).toMatchObject({ pack: 'files', stock: fileLutId(hash), contrast: 21 });
    const settings = normalizeSettings(JSON.parse(JSON.stringify(settingsFromRecipe(draft, lutSourceOf(draft)))))!;
    expect(settings.lut).toEqual({ kind: 'file', hash, amount: .6, blend: 'color', photoMatch: reference });
    delete PACK.files.looks[fileLutId(hash)];
    registerCustomLook('b0000000-0000-4000-8000-000000000004', 'Evening', settings);
    const reopened = normalizeRecipe(JSON.parse(JSON.stringify(recipeFromSettings(defaultRecipe(), settings))))!;
    expect(PACK.files.looks[reopened.stock]?.photoMatch).toBe(reference);
    expect(lutSourceOf(reopened)).toEqual(settings.lut);
    expect(withLutBase(reopened, null).lookEnabled).toBe(false);
    expect(lutSourceOf(withLutBase(reopened, { kind: 'pack', pack: 't3mujinpack', stock: 'portra400', amount: 1 }))).toMatchObject({ kind: 'pack' });
  });
});
