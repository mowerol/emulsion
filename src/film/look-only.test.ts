// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { customLookId, lookSettings, lutBase, PACK, recipeLookFile, registerCustomLook, withLook } from './looks';
import { defaultRecipe, normalizeRecipe } from './recipe';
import { withLutBase } from './creative';
import { developUniforms, InputMode } from '../engine/params';
const id = 'c0000000-0000-4000-8000-000000000001';
const ctx = { width: 64, height: 64, seed: 1, inputMode: InputMode.SceneLinear, store: 1, look: { id: 7, level: 2, data: new Float32Array(24), eightBit: true } };
it('promotes old LUT-only entries to Looks without changing their LUT ingredients', () => {
  const settings = { colorBalance: null, curve: null, lut: { kind: 'file' as const, hash: 'a'.repeat(64), amount: .6, blend: 'color' as const } };
  registerCustomLook(id, 'Imported', settings, 'lut');
  const stock = customLookId(id);
  expect(PACK.custom.looks[stock]?.kind).toBe('look');
  expect(lookSettings('custom', stock)).toEqual(settings);
  const applied = withLook(defaultRecipe(), 'custom', stock);
  expect(applied.lookSnapshot).toMatchObject({ kind: 'look', settings });
  expect(applied.scannerFromLook).toBe(true);
  expect(developUniforms(applied, ctx)).toMatchObject({ uLutAmount: .6, uLutColor: 1 });
});
it('wraps bundled LUTs as Looks with the same LUT file and rendered parameters', () => {
  const direct = { ...defaultRecipe('portra400'), lookAmount: 100, scanner: 'straight' as const };
  const wrapped = withLook(direct, 't3mujinpack', 'portra400');
  expect(recipeLookFile(wrapped)).toBe(recipeLookFile(direct));
  const before = developUniforms(direct, ctx), after = developUniforms(wrapped, ctx);
  for (const key of ['uLutAmount', 'uLutColor', 'uCbLOn', 'uCurveOn', 'uScC', 'uSharp']) expect(after[key]).toEqual(before[key]);
  expect(wrapped.lookSnapshot?.kind).toBe('look');
});
it('preserves old applied LUT recipes through normalization rather than reapplying defaults', () => {
  const recipe = { ...defaultRecipe('portra400'), lookAmount: 43, lookBlend: 'color' as const, scanner: 'noritsu' as const };
  const reopened = normalizeRecipe(JSON.parse(JSON.stringify(recipe)))!;
  const before = developUniforms(recipe, ctx), after = developUniforms(reopened, ctx);
  expect(recipeLookFile(reopened)).toBe(recipeLookFile(recipe));
  for (const key of ['uLutAmount', 'uLutColor', 'uScC', 'uSharp']) expect(after[key]).toEqual(before[key]);
});
it('changing or removing the base LUT preserves authored controls and scanner', () => {
  const draft = { ...defaultRecipe(), contrast: 25, scanner: 'frontier' as const, scannerFromLook: false };
  const next = withLutBase(draft, lutBase('t3mujinpack', 'portra400'));
  expect(next).toMatchObject({ contrast: 25, scanner: 'frontier', lookEnabled: true });
  expect(withLutBase(next, null)).toMatchObject({ contrast: 25, scanner: 'frontier', lookEnabled: false });
  registerCustomLook(id, 'Authored', { colorBalance: { contrast: .2 }, curve: null, lut: { kind: 'pack', pack: 't3mujinpack', stock: 'portra400', amount: 1 } }, 'look');
  expect(lutBase('custom', customLookId(id))).toBeNull();
});
