// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { defaultRecipe, normalizeRecipe, resetSection, resetAdjustments, withSettingsFrom } from './recipe';
import { gradeValue, normalizeGrading, updateGrade } from './grading';
import { CB_DEFAULTS, cbCommit, cbUniform, colorBalanceParams, sliderParams } from '../engine/colorbalance';
import { developUniforms, InputMode } from '../engine/params';

const ctx = { width: 100, height: 100, seed: 1, inputMode: InputMode.DisplayLinear, store: 1 };
describe('Colour Grading', () => {
  it('preserves legacy rendering, including the contrast fulcrum', () => {
    const recipe = normalizeRecipe({ stock: 'pro400h', contrast: 30, saturation: 20, shadows: 10 })!;
    expect(recipe.pack).toBe('emulsion');
    expect(recipe.grading).toBeNull();
    expect(developUniforms(recipe, ctx).uCbP).toEqual(cbUniform(cbCommit(sliderParams(colorBalanceParams(30, 0, 20, 10)))));
    expect(defaultRecipe('portra400').pack).toBe('t3mujinpack');
  });
  it('normalises only supported fields, rejecting nonfinite values and singular endpoints', () => {
    expect(normalizeGrading({ ...CB_DEFAULTS, grey_fulcrum: 0.18 })).toBeNull();
    expect(normalizeGrading({ contrast: 0.5, shadows_Y: 0.2, saturation_global: 0.5, nonsense: 10 })).toBeNull();
    expect(normalizeGrading({ shadows_H: 400, global_C: -1, midtones_Y: -1, mask_grey_fulcrum: 0, hue_angle: Infinity, brilliance_global: NaN })).toEqual({ shadows_H: 360, midtones_Y: -0.999, mask_grey_fulcrum: 0.0001 });
  });
  it('shares Shadows and Saturation, round-trips, copies, and resets without changing Contrast or Vibrance', () => {
    const before = { ...defaultRecipe('portra400'), contrast: 25, vibrance: 15 };
    const edited = updateGrade(before, { shadows_Y: 0.2, saturation_global: 0.3, shadows_H: 220, shadows_C: 0.1, brilliance_midtones: 0.05 });
    expect(edited.shadows).toBe(20);
    expect(edited.saturation).toBe(30);
    expect(gradeValue({ ...edited, shadows: -10 }, 'shadows_Y')).toBe(-0.1);
    expect(normalizeRecipe(JSON.parse(JSON.stringify(edited)))).toEqual(edited);
    expect(withSettingsFrom(edited, null).grading).toEqual(edited.grading);
    expect(resetSection(edited, 'grading')).toEqual(before);
    expect(resetAdjustments(edited).grading).toBeNull();
  });
  it('feeds the recipe instance when a LUT is active, without enabling the stock grade', () => {
    const recipe = updateGrade(defaultRecipe('pro400h'), { global_H: 45, global_C: 0.008, chroma_shadows: 0.2 });
    const params = { ...sliderParams(colorBalanceParams(0, 0, 0, 0)), ...recipe.grading };
    const uniforms = developUniforms(recipe, { ...ctx, look: { level: 2, data: new Float32Array(24), id: 1, eightBit: true } });
    expect(uniforms.uCbP).toEqual(cbUniform(cbCommit(params)));
    expect(uniforms.uCbSOn).toBe(0);
  });
});
