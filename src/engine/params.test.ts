// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { defaultRecipe } from '../film/recipe';
import { LUMA_REC2020 } from './color';
import { InputMode, developUniforms, needsPasses } from './params';

const ctx = { width: 1600, height: 1067, seed: 3, inputMode: InputMode.DisplayLinear, store: 1 };

describe('develop uniforms', () => {
  it('renders the original when there is no recipe or when comparing', () => {
    expect(developUniforms(null, ctx).uCompare).toBe(1);
    expect(developUniforms(defaultRecipe(), { ...ctx, compare: true }).uCompare).toBe(1);
    expect(needsPasses(developUniforms(null, ctx))).toEqual({ highlights: false, sharpen: false, toneEqualizer: false, clarity: false, texture: false, usm: false, colorEq: false });
  });

  it('keeps luminance in the stock balance', () => {
    const wb = developUniforms(defaultRecipe('gold200'), ctx).uWB as number[];
    expect(wb[0] * LUMA_REC2020[0] + wb[1] * LUMA_REC2020[1] + wb[2] * LUMA_REC2020[2]).toBeCloseTo(1, 9);
  });

  it('leaves white balance alone until it is set, then adapts from the photo\'s as-shot white', () => {
    expect(developUniforms(defaultRecipe(), ctx).uWbMat).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const r = { ...defaultRecipe(), wb: { temperature: 3200, tint: 0 } };
    const fromD65 = developUniforms(r, ctx).uWbMat as number[];
    const fromWarm = developUniforms(r, { ...ctx, white: [0.42, 0.4] }).uWbMat as number[];
    // Balancing for tungsten light makes a daylight photo blue: blue gain beats red.
    expect(fromD65[8]).toBeGreaterThan(fromD65[0]);
    expect(fromWarm).not.toEqual(fromD65);
  });

  it('sends contrast, vibrance, saturation and shadows to the colour balance stage, not the print', () => {
    const base = developUniforms(defaultRecipe(), ctx);
    const u = developUniforms({ ...defaultRecipe(), contrast: 40, vibrance: -30, saturation: 25, shadows: 60 }, ctx);
    expect(u.uCbParams).toEqual([1.4, -0.3, 0.25, 0.6]);
    expect(base.uCbParams).toEqual([1, 0, 0, 0]);
    expect(u.uSigS).toEqual(base.uSigS);
    expect(u.uSat).toEqual(base.uSat);
    expect((u.uCbGamut as number[]).length).toBe(512);
  });

  it('pushing adds contrast and grain, pulling removes them', () => {
    const at = (push: -1 | 0 | 1 | 2) => developUniforms({ ...defaultRecipe(), push }, ctx);
    // Film power of the shared tone curve.
    const c = (u: ReturnType<typeof at>) => (u.uSigS as number[])[2];
    expect(c(at(1))).toBeGreaterThan(c(at(0)));
    expect(c(at(2))).toBeGreaterThan(c(at(1)));
    expect(c(at(-1))).toBeLessThan(c(at(0)));
    // Grain strength (kappa) follows the effective film speed.
    const k = (u: ReturnType<typeof at>) => (u.uGrainA as number[])[0];
    expect(k(at(2))).toBeGreaterThan(k(at(0)));
    expect(k(at(-1))).toBeLessThan(k(at(0)));
  });

  it('applies crossover per channel', () => {
    const u = developUniforms(defaultRecipe('superia400'), ctx);
    const power = (k: string) => (u[k] as number[])[2];
    expect(power('uSigG')).toBeLessThan(power('uSigR'));
  });

  it('runs the clarity filter only when Clarity is set, at darktable\'s preset at +100', () => {
    expect(needsPasses(developUniforms(defaultRecipe(), ctx)).clarity).toBe(false);
    const u = developUniforms({ ...defaultRecipe(), clarity: 100 }, ctx);
    expect(needsPasses(u).clarity).toBe(true);
    expect(u.uLl).toEqual([0.5, 0, 0, 0.33]);
    expect(needsPasses(developUniforms({ ...defaultRecipe(), clarity: 40 }, { ...ctx, compare: true })).clarity).toBe(false);
  });

  it('runs the texture equalizer only when Texture is set, with darktable\'s mix as slider / 100', () => {
    expect(needsPasses(developUniforms(defaultRecipe(), ctx)).texture).toBe(false);
    const u = developUniforms({ ...defaultRecipe(), texture: -40 }, ctx);
    expect(needsPasses(u).texture).toBe(true);
    expect(u.uTextureMix).toBe(-0.4);
  });

  it('runs the tone equalizer only when Highlights is set', () => {
    expect(needsPasses(developUniforms(defaultRecipe(), ctx)).toneEqualizer).toBe(false);
    expect(needsPasses(developUniforms({ ...defaultRecipe(), shadows: 40 }, ctx)).toneEqualizer).toBe(false);
    const u = developUniforms({ ...defaultRecipe(), highlights: -40 }, ctx);
    expect(needsPasses(u).toneEqualizer).toBe(true);
    expect((u.uTeqF0 as number[]).length).toBe(4);
    expect(needsPasses(developUniforms({ ...defaultRecipe(), highlights: -10 }, { ...ctx, compare: true })).toneEqualizer).toBe(false);
  });

  it('maps whites to the display white and blacks to a lift or a cut', () => {
    const at = (whites: number, blacks: number) => developUniforms({ ...defaultRecipe(), whites, blacks }, ctx);
    expect(at(0, 0).uSigMag).toBe(1);
    expect(at(100, 0).uSigMag).toBeCloseTo(Math.SQRT2, 9);
    expect(at(0, 0).uExpBlack).toBe(0);
    expect(at(0, 50).uExpBlack).toBe(0);
    expect(at(0, -100).uExpBlack).toBeCloseTo(0.008, 9);
    expect(at(0, 50).uSigS).not.toEqual(at(0, 0).uSigS);
  });

  it('turns off colour grain for black and white', () => {
    const u = developUniforms(defaultRecipe('trix400'), ctx);
    expect(u.uBW).toBe(1);
    expect(u.uChroma).toBe(0);
  });

  it('skips the highlight passes when halation and glow are off', () => {
    const r = { ...defaultRecipe(), halation: 0, glow: 0 };
    expect(needsPasses(developUniforms(r, ctx)).highlights).toBe(false);
    expect(needsPasses(developUniforms({ ...r, glow: 10 }, ctx)).highlights).toBe(true);
    expect(needsPasses(developUniforms({ ...r, scanner: 'straight' }, ctx)).sharpen).toBe(false);
  });
});
