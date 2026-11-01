// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { defaultRecipe } from '../film/recipe';
import { toneCurveFor, packCurve } from './tone';
import { InputMode, developUniforms, needsPasses } from './params';

const ctx = { width: 1600, height: 1067, seed: 3, inputMode: InputMode.DisplayLinear, store: 1 };

describe('develop uniforms', () => {
  it("applies a look LUT at the recipe's Amount, with the stock's own colour switched off", () => {
    const lut = { level: 2, data: new Float32Array(24), id: 7, eightBit: true };
    const r = { ...defaultRecipe('portra400'), lookAmount: 40 };
    const u = developUniforms(r, { ...ctx, look: lut });
    expect(u.uLutOn).toBe(1);
    expect(u.uLutAmount).toBeCloseTo(0.4, 12);
    expect(developUniforms({ ...r, lookEnabled: false }, { ...ctx, look: lut }).uLutOn).toBe(0);
    expect(u.uLutColor).toBe(0);
    expect(developUniforms({ ...r, lookBlend: 'color' }, { ...ctx, look: lut }).uLutColor).toBe(1);
    const own = developUniforms(r, ctx);
    expect(own.uLutOn).toBe(0);
    expect(own.uLutAmount).toBeUndefined();
  });

  it('renders the original when there is no recipe or when comparing', () => {
    expect(developUniforms(null, ctx).uCompare).toBe(1);
    expect(developUniforms(defaultRecipe(), { ...ctx, compare: true }).uCompare).toBe(1);
    expect(needsPasses(developUniforms(null, ctx))).toEqual({ highlights: false, sharpen: false, toneEqualizer: false, clarity: false, texture: false, usm: false, colorEq: false });
  });

  it('keeps the base tone independent of the selected creative stock', () => {
    expect(developUniforms(defaultRecipe('portra400'), ctx).uSigS).toEqual(developUniforms(defaultRecipe('gold200'), ctx).uSigS);
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
    const P = u.uCbP as number[];
    expect([P[0], P[1], P[8]]).toEqual([1.4, -0.3, 0.25]);
    expect(P[20]).toBeCloseTo(1.6, 6);
    expect((base.uCbP as number[]).slice(0, 2)).toEqual([1, 0]);
    expect(u.uSigS).toEqual(base.uSigS);
    expect(u.uPrimIn).toEqual(base.uPrimIn);
    expect((u.uCbGamut as number[]).length).toBe(512);
  });

  it('push and pull change grain speed while retaining the camera base', () => {
    const at = (push: -1 | 0 | 1 | 2) => developUniforms({ ...defaultRecipe(), push }, ctx);
    expect(at(2).uSigS).toEqual(at(0).uSigS);
    // Grain is drawn at the pushed film speed: coarser when pushed.
    const zoom = (u: ReturnType<typeof at>) => (u.uGrain as number[])[1];
    expect(zoom(at(2))).toBeGreaterThan(zoom(at(0)));
    expect(zoom(at(-1))).toBeLessThan(zoom(at(0)));
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

  it('maps darktable haze-removal controls and leaves them off by default', () => {
    const base = developUniforms(defaultRecipe(), ctx);
    expect(base.uDehazeOn).toBe(0);
    const u = developUniforms({ ...defaultRecipe(), dehaze: 60, dehazeDistance: 35 }, ctx);
    expect(u.uDehazeOn).toBe(1);
    expect(u.uDehazeStrength).toBeCloseTo(0.6);
    expect(u.uDehazeDistance).toBeCloseTo(0.35);
    expect(u.uDehazeA0).toEqual([1, 1, 1]);
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

  it('skips the highlight passes when halation and glow are off', () => {
    const r = { ...defaultRecipe(), halation: 0, glow: 0 };
    expect(needsPasses(developUniforms(r, ctx)).highlights).toBe(false);
    expect(needsPasses(developUniforms({ ...r, glow: 10 }, ctx)).highlights).toBe(true);
    expect(needsPasses(developUniforms({ ...r, scanner: 'straight' }, ctx)).sharpen).toBe(false);
  });
});


describe('LUT white and black targets', () => {
  const lut = { level: 2, data: new Float32Array(24), id: 1, eightBit: true };
  it('enables target adjustments for either Whites direction and lifted Blacks, preserving the zero path', () => {
    const r = defaultRecipe('portra400');
    const at = (whites: number, blacks: number) => developUniforms({ ...r, whites, blacks }, { ...ctx, look: lut });
    expect(at(0, 0).uProfileTargetsOn).toBe(0);
    for (const whites of [-100, 100]) expect(at(whites, 0).uProfileTargetsOn).toBe(1);
    expect(at(0, 100).uProfileTargetsOn).toBe(1);
    expect(at(0, -100).uProfileTargetsOn).toBe(0);
    expect(at(0, -100).uExpBlack).toBeCloseTo(0.008, 9);
    expect(at(50, 25).uSigS).toEqual(packCurve(toneCurveFor(50, 25)));
    expect(developUniforms({ ...r, whites: 50, blacks: 25 }, ctx).uSigS).toEqual(at(50, 25).uSigS);
  });
});
