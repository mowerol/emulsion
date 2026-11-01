// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { blendNormal, combine, ellipseValue, erf, gradientValue, maskValue, packShapes } from './masks';
import { MAX_MASKS, newEllipse, newGradient, newMask, normalizeMasks, type Mask } from '../film/masks';
import { defaultRecipe, normalizeRecipe, withSettingsFrom } from '../film/recipe';
import { InputMode, developUniforms, maskUniforms } from './params';

const W = 3000;
const H = 2000;

/** erf by its Maclaurin series, for checking the approximation. */
function erfSeries(x: number) {
  let sum = 0;
  let term = x;
  for (let n = 0; n < 80; n++) {
    sum += term / (2 * n + 1);
    term *= (-x * x) / (n + 1);
  }
  return (2 / Math.sqrt(Math.PI)) * sum;
}

describe('darktable gradient', () => {
  it('erf is within 2e-7 of the series', () => {
    for (let x = -3; x <= 3; x += 0.05) expect(Math.abs(erf(x) - erfSeries(x))).toBeLessThan(2e-7);
  });

  it('is half at the anchor, full above it at rotation 0 and empty below', () => {
    const g = newGradient([0.5, 0.4], 0, 0.1);
    expect(gradientValue(g, 0.5, 0.4, W, H)).toBeCloseTo(0.5, 6);
    expect(gradientValue(g, 0.2, 0.0, W, H)).toBeGreaterThan(0.99);
    expect(gradientValue(g, 0.8, 0.95, W, H)).toBeLessThan(0.01);
    // Turned half way round, the sides swap.
    const flipped = { ...g, rotation: 180 };
    expect(gradientValue(flipped, 0.2, 0.0, W, H)).toBeLessThan(0.01);
  });

  it("follows darktable's sigmoid and linear transitions in units of the diagonal", () => {
    const g = newGradient([0.5, 0.5], 0, 0.2);
    const diag = Math.hypot(W, H);
    // A point 0.1 of the diagonal above the anchor.
    const v = 0.5 - (0.1 * diag) / H;
    expect(gradientValue(g, 0.5, v, W, H)).toBeCloseTo(0.5 + 0.5 * erfSeries(0.1 / 0.2), 6);
    expect(gradientValue({ ...g, linear: true }, 0.5, v, W, H)).toBeCloseTo(0.5 + 0.5 * (0.1 / 0.2), 6);
    // Beyond four compressions it is exactly 0 or 1.
    expect(gradientValue(g, 0.5, 0.5 + (0.81 * diag) / H, W, H)).toBe(0);
  });

  it('bends with curvature', () => {
    const g = { ...newGradient([0.5, 0.5], 0, 0.05), curvature: -1 };
    // Negative curvature: off to the side, the line has dropped below the anchor's height.
    expect(gradientValue(g, 0.05, 0.55, W, H)).toBeGreaterThan(0.5);
    expect(gradientValue({ ...g, curvature: 1 }, 0.05, 0.45, W, H)).toBeLessThan(0.5);
  });
});

describe('darktable ellipse', () => {
  it('is 1 inside, 0 beyond the feather, and quadratic across it', () => {
    const e = newEllipse([0.5, 0.5], [0.2, 0.2], 0, 0.1);
    const m = Math.min(W, H);
    expect(ellipseValue(e, 0.5, 0.5, W, H)).toBe(1);
    expect(ellipseValue(e, 0.5 + (0.19 * m) / W, 0.5, W, H)).toBe(1);
    expect(ellipseValue(e, 0.5 + (0.31 * m) / W, 0.5, W, H)).toBe(0);
    const d = 0.25 * m;
    const r = 0.2 * m;
    const t = 0.3 * m;
    const ratio = (t * t - d * d) / (t * t - r * r);
    expect(ellipseValue(e, 0.5 + d / W, 0.5, W, H)).toBeCloseTo(ratio * ratio, 6);
  });

  it('turns with rotation and feathers proportionally when asked', () => {
    const e = newEllipse([0.5, 0.5], [0.3, 0.1], 0, 0.02);
    const m = Math.min(W, H);
    const along = [0.5 + (0.25 * m) / W, 0.5] as const;
    expect(ellipseValue(e, ...along, W, H)).toBe(1);
    expect(ellipseValue({ ...e, rotation: 90 }, ...along, W, H)).toBe(0);
    const prop = { ...e, border: 0.5, proportional: true };
    // Proportional: the feather reaches 1.5 times the radius.
    expect(ellipseValue(prop, 0.5 + (0.44 * m) / W, 0.5, W, H)).toBeGreaterThan(0);
    expect(ellipseValue(prop, 0.5 + (0.46 * m) / W, 0.5, W, H)).toBe(0);
  });
});

describe('darktable group', () => {
  it('combines as _combine_masks_*', () => {
    expect(combine('copy', 0.3, 0.6)).toBe(0.6);
    expect(combine('add', 0.3, 0.6)).toBe(0.6);
    expect(combine('intersect', 0.3, 0.6)).toBe(0.3);
    expect(combine('subtract', 0.8, 0.5)).toBeCloseTo(0.4, 12);
    expect(combine('subtract', 0, 0.5)).toBe(0);
    expect(combine('sum', 0.7, 0.6)).toBe(1);
    expect(combine('exclude', 0.5, 0.5)).toBeCloseTo(0.25, 12);
    expect(combine('exclude', 0, 0.5)).toBe(0.5);
  });

  it('inverts and scales shapes, then applies the blend opacity', () => {
    const mask: Mask = { ...newMask(newGradient([0.5, 0.5], 0, 0.1), 0), opacity: 50, exposure: 1 };
    expect(maskValue(mask, 0.5, 0.0, W, H)).toBeCloseTo(0.5, 4);
    const inv = { ...mask, shapes: [{ ...mask.shapes[0], invert: true, opacity: 0.8 }] };
    expect(maskValue(inv, 0.5, 1.0, W, H)).toBeCloseTo(0.4, 4);
    // A radial taken out of the gradient leaves a hole.
    const hole = { ...mask, opacity: 100, shapes: [mask.shapes[0], { ...newEllipse([0.5, 0.1], [0.05, 0.05], 0, 0.01), mode: 'subtract' as const }] };
    expect(maskValue(hole, 0.5, 0.1, W, H)).toBe(0);
    expect(maskValue(hole, 0.1, 0.1, W, H)).toBeGreaterThan(0.99);
  });

  it('blends normally, as _blend_normal', () => {
    expect(blendNormal([1, 2, 3], [3, 2, 1], 0.25)).toEqual([1.5, 2, 2.5]);
  });
});

describe('mask recipes', () => {
  it('normalises what a sidecar holds', () => {
    const masks = normalizeMasks([
      { name: 'Sky', exposure: -9, shapes: [{ kind: 'gradient', anchor: [0.5, 0.3], rotation: 10, compression: 4, mode: 'nope' }, { kind: 'star' }] },
      { shapes: [] },
      'junk',
    ]);
    expect(masks).toHaveLength(1);
    expect(masks[0].exposure).toBe(-4);
    expect(masks[0].shapes).toHaveLength(1);
    expect(masks[0].shapes[0]).toMatchObject({ kind: 'gradient', compression: 1, mode: 'add', opacity: 1 });
    expect(normalizeMasks(Array.from({ length: 12 }, () => ({ shapes: [{ kind: 'ellipse' }] })))).toHaveLength(MAX_MASKS);
    expect(normalizeRecipe({ stock: 'neutral' })!.masks).toEqual([]);
  });

  it('keeps each frame its own masks when settings are pasted', () => {
    const from = { ...defaultRecipe(), masks: [newMask(newGradient(), 0)] };
    expect(withSettingsFrom(from, defaultRecipe()).masks).toEqual([]);
  });
});

describe('mask uniforms', () => {
  const ctx = { width: 100, height: 100, seed: 0, inputMode: InputMode.SceneLinear, store: 1 };

  it('packs only masks that change something, and the one shown', () => {
    const idle = newMask(newGradient(), 0);
    const used = { ...newMask(newEllipse(), 1), exposure: 1 };
    const r = { ...defaultRecipe(), masks: [idle, used] };
    const u = developUniforms(r, ctx);
    expect(u.uMaskCount).toBe(1);
    expect(u.uMaskShapeCount).toBe(1);
    expect((u.uMaskMeta as number[]).slice(0, 4)).toEqual([1, 2, 0, 0]);
    expect(u.uMaskShow).toBe(-1);
    const shown = developUniforms(r, { ...ctx, maskShow: 0 });
    expect(shown.uMaskCount).toBe(2);
    expect(shown.uMaskShow).toBe(0);
    // The shown idle mask changes nothing.
    expect((shown.uMaskMeta as number[]).slice(0, 4)).toEqual([1, 1, 0, 0]);
    expect(packShapes([{ ...used, on: false }]).count).toBe(0);
    expect(developUniforms(defaultRecipe(), ctx).uMaskCount).toBe(0);
  });

  it('warms with positive temperature: the white moves bluer, so red gains on blue', () => {
    const m = { ...newMask(newGradient(), 0), temperature: 40 };
    const u = maskUniforms([m], defaultRecipe(), { white: null });
    const wb = u.uMaskWb as number[];
    // Column-major: diagonal at 0, 4, 8.
    expect(wb[0]).toBeGreaterThan(1);
    expect(wb[8]).toBeLessThan(1);
    const none = maskUniforms([{ ...m, temperature: 0, exposure: 1 }], defaultRecipe(), { white: null });
    expect(none.uMaskWb).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('turns on a colour balance instance for the colour sliders', () => {
    const m = { ...newMask(newGradient(), 0), saturation: 30 };
    const u = maskUniforms([m], defaultRecipe(), {});
    expect((u.uMaskMeta as number[])[2]).toBe(1);
    expect((u.uMaskCb as number[]).length).toBe(40);
  });
});
