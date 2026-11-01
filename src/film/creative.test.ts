// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { CB_DEFAULTS } from '../engine/colorbalance';
import { InputMode, developUniforms } from '../engine/params';
import { curveTable } from './curve';
import { composedCurveTable, normalizeSettings, scaledColorBalance, settingsFromRecipe, withoutProfileFields } from './creative';
import { registerUserLook, userLookId } from './looks';
import { defaultRecipe, type Recipe } from './recipe';

const S = { rgb: [[0, 0.05], [0.5, 0.42], [1, 0.97]], r: [[0, 0], [0.5, 0.55], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0.04], [1, 1]] } as Recipe['curve'];
const graded = (): Recipe => ({
  ...defaultRecipe('portra400'), lookEnabled: true, pack: 't3mujinpack', lookAmount: 70,
  contrast: 20, vibrance: -10, saturation: 15, shadows: 30, exposure: 0.4, clarity: 25,
  grading: { shadows_C: 0.05, shadows_H: 220, highlights_C: 0.04, highlights_H: 50, brilliance_midtones: 0.1 },
  curve: S,
});
const ctx = { width: 64, height: 64, seed: 1, inputMode: InputMode.SceneLinear, store: 1 };
const lut = { level: 2, data: new Float32Array(24), id: 3, eightBit: true };

describe('creative profiles', () => {
  it('saves only colour and tone: Colour Grading, the colour sliders, the curve and the look', () => {
    const s = settingsFromRecipe(graded(), { pack: 't3mujinpack', stock: 'portra400', amount: 0.7 });
    expect(s.colorBalance).toMatchObject({ contrast: 0.2, vibrance: -0.1, saturation_global: 0.15, shadows_Y: 0.3, shadows_C: 0.05, shadows_H: 220 });
    expect(s.curve).toEqual(S);
    expect(JSON.stringify(s)).not.toMatch(/exposure|clarity/);
    expect(settingsFromRecipe(defaultRecipe(), null)).toEqual({ colorBalance: null, curve: null, look: null });
  });

  it('renders a photo the same after saving it as a profile, with its colour sliders back at zero', () => {
    const r = graded();
    const hash = 'cd'.repeat(32);
    registerUserLook(hash, 'Moody', false, normalizeSettings(JSON.parse(JSON.stringify(
      settingsFromRecipe(r, { pack: r.pack, stock: r.stock, amount: r.lookAmount / 100 }))))!);
    const after = withoutProfileFields({ ...r, pack: 'mine', stock: userLookId(hash), lookAmount: 100 });
    expect([after.contrast, after.grading, after.curve, after.exposure, after.clarity]).toEqual([0, null, null, 0.4, 25]);
    const before = developUniforms(r, { ...ctx, look: lut });
    const now = developUniforms(after, { ...ctx, look: lut });
    // The profile's instance does what the photo's own did; the photo's own now does nothing.
    expect(now.uCbL).toEqual(before.uCbP);
    expect(now.uCbLOn).toBe(1);
    expect(now.uCbP).toEqual(developUniforms(defaultRecipe(), ctx).uCbP);
    expect(now.uLutAmount).toBeCloseTo(before.uLutAmount as number, 12);
    expect(now.uCurveOn).toBe(1);
    expect(composedCurveTable(after.curve, normalizeSettings(settingsFromRecipe(r, null))!.curve, 1)).toEqual(composedCurveTable(null, r.curve, 1));
    // Amount fades all of it.
    const half = developUniforms({ ...after, lookAmount: 50 }, { ...ctx, look: lut });
    expect(half.uLutAmount).toBeCloseTo(0.35, 12);
    expect(developUniforms({ ...after, lookAmount: 0 }, ctx).uCurveOn).toBe(0);
  });

  it('scales a profile towards doing nothing, keeping its hues and fulcrums', () => {
    const cb = { shadows_C: 0.08, shadows_H: 210, contrast: 0.3, grey_fulcrum: 0.2, hue_angle: 20 };
    const s = { colorBalance: cb, curve: null, look: null };
    expect(scaledColorBalance(s, 1)).toEqual({ ...CB_DEFAULTS, ...cb });
    const half = scaledColorBalance(s, 0.5)!;
    expect([half.shadows_C, half.contrast, half.hue_angle]).toEqual([0.04, 0.15, 10]);
    expect([half.shadows_H, half.grey_fulcrum]).toEqual([210, 0.2]);
    expect(scaledColorBalance(s, 0)).toEqual({ ...CB_DEFAULTS, shadows_H: 210, grey_fulcrum: 0.2 });
    expect(scaledColorBalance(null, 1)).toBeNull();
  });

  it("composes the profile's curve in front of the photo's own", () => {
    const own = { rgb: [[0, 0], [0.5, 0.6], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] } as Recipe['curve'];
    expect(composedCurveTable(own, null, 1)).toEqual(curveTable(own!));
    expect(composedCurveTable(null, null, 1)).toBeNull();
    // At Amount 0 the profile's curve drops out entirely.
    expect(composedCurveTable(null, S, 0)).toBeNull();
    expect(composedCurveTable(own, S, 0)).toEqual(curveTable(own!));
    // At a table step the composition is exact: profile master, profile channel, own master, own channel.
    const both = composedCurveTable(own, S, 1)!, p = curveTable(S!), o = curveTable(own!);
    const lerp = (t: Float32Array, k: number, v: number) => { const s = v * 255, i = Math.min(Math.floor(s), 254), f = s - i; return t[i * 4 + k] * (1 - f) + t[(i + 1) * 4 + k] * f; };
    const x = 100 / 255;
    expect(both[100 * 4 + 1]).toBeCloseTo(lerp(o, 1, lerp(o, 0, lerp(p, 1, lerp(p, 0, x)))), 6);
    expect(both[100 * 4]).toBeCloseTo(x, 6);
  });

  it('reads profile files defensively', () => {
    expect(normalizeSettings(null)).toBeNull();
    const s = normalizeSettings({ colorBalance: { contrast: 9, shadows_C: 'x', highlights_C: 0.1 }, curve: 'nope', look: { pack: 'gmic-film', stock: 7 } })!;
    expect(s.colorBalance).toEqual({ contrast: 1, highlights_C: 0.1 });
    expect(s.curve).toBeNull();
    expect(s.look).toBeNull();
    expect(normalizeSettings({ look: { pack: 'gmic-film', stock: 'x', amount: 4 } })!.look).toEqual({ pack: 'gmic-film', stock: 'x', amount: 1 });
  });
});
