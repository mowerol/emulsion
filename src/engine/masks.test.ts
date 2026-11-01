// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { blendNormal, blendifFactor, combine, ellipseValue, erf, gradientValue, jzczhz, maskValue, packRanges, pickStats, pickedRange, rangeUnits, packShapes, rangeParameters, rangeValue } from './masks';
import { MAX_MASKS, fullRange, newEllipse, newGradient, newMask, normalizeMasks, type Mask } from '../film/masks';
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
      { name: 'Sky', exposure: -9, ranges: { hue: { points: [300, 200, 400, 10] }, chroma: 'x' }, shapes: [{ kind: 'gradient', anchor: [0.5, 0.3], rotation: 10, compression: 4, mode: 'nope' }, { kind: 'star' }] },
      { shapes: [] },
      'junk',
    ]);
    expect(masks).toHaveLength(1);
    expect(masks[0].exposure).toBe(-4);
    expect(masks[0].shapes).toHaveLength(1);
    // Markers clamped to the channel and kept in order.
    expect(masks[0].ranges).toEqual({ luminance: null, chroma: null, hue: { points: [300, 300, 360, 360], invert: false } });
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

describe('darktable blendif ranges (RGB scene, JzCzhz)', () => {
  it('converts to JzCzhz: lightness grows with light, greys have little chroma, hues sit where expected', () => {
    const grey = jzczhz([0.18, 0.18, 0.18]);
    const white = jzczhz([1, 1, 1]);
    expect(white[0]).toBeGreaterThan(grey[0]);
    // On the Luminance slider, diffuse white sits near the top and middle grey near a third.
    expect(rangeUnits('luminance', white[0])).toBeGreaterThan(80);
    expect(rangeUnits('luminance', white[0])).toBeLessThan(95);
    expect(rangeUnits('luminance', grey[0])).toBeCloseTo(29.3, 0);
    expect(grey[1]).toBeLessThan(0.0005);
    const red = jzczhz([0.5, 0.02, 0.02]);
    const blue = jzczhz([0.02, 0.03, 0.6]);
    expect(red[1]).toBeGreaterThan(grey[1] * 10);
    expect(red[2]).toBeLessThan(0.15);
    expect(blue[2]).toBeGreaterThan(0.6);
    expect(blue[2]).toBeLessThan(0.8);
  });

  it('computes the trapezoid as _blendif_compute_factor, with open ends', () => {
    const p = rangeParameters({ points: [20, 40, 60, 80], invert: false }, 'hue');
    expect(blendifFactor(30 / 360, p, false)).toBeCloseTo(0.5, 9);
    expect(blendifFactor(50 / 360, p, false)).toBe(1);
    expect(blendifFactor(70 / 360, p, false)).toBeCloseTo(0.5, 9);
    expect(blendifFactor(90 / 360, p, false)).toBe(0);
    expect(blendifFactor(90 / 360, p, true)).toBe(1);
    const open = rangeParameters(fullRange('luminance'), 'luminance');
    expect(blendifFactor(1e6, open, false)).toBe(1);
    expect(blendifFactor(-1, open, false)).toBe(1);
    // Feathers narrower than darktable's 0.001 floor (in channel units) are widened to it.
    const sharp = rangeParameters({ points: [10, 10.01, 50, 50], invert: false }, 'luminance');
    expect(sharp[4]).toBe(1000);
  });

  it('multiplies the ranges into the drawn mask', () => {
    const base: Mask = { ...newMask(newEllipse([0.5, 0.5], [0.4, 0.4], 0, 0.05), 0), exposure: 1 };
    const sky: Mask = { ...base, ranges: { luminance: null, chroma: null, hue: { points: [200, 220, 280, 300], invert: false } } };
    const blue: [number, number, number] = [0.02, 0.03, 0.6];
    const red: [number, number, number] = [0.5, 0.02, 0.02];
    expect(rangeValue(sky, blue)).toBe(1);
    expect(rangeValue(sky, red)).toBe(0);
    expect(maskValue(sky, 0.5, 0.5, W, H, red)).toBe(0);
    expect(maskValue(sky, 0.5, 0.5, W, H, blue)).toBe(1);
    expect(rangeValue(base, red)).toBe(1);
    expect(packRanges(sky).flags).toEqual([0, 0, 1, 0]);
  });
});

describe("darktable's blendif picker (set values)", () => {
  const px = (...rgbs: [number, number, number][]) => rgbs.flatMap((c) => [...c, 1]);

  it('gathers the least and greatest Jz, Cz, hz and hz turned half way round', () => {
    const a: [number, number, number] = [0.1, 0.1, 0.1];
    const b: [number, number, number] = [0.5, 0.2, 0.05];
    const s = pickStats(px(a, b, [NaN, 0, 0]))!;
    const ja = jzczhz(a);
    const jb = jzczhz(b);
    expect(s.min[0]).toBeCloseTo(Math.min(ja[0], jb[0]), 12);
    expect(s.max[1]).toBeCloseTo(Math.max(ja[1], jb[1]), 12);
    const turned = (h: number) => (h < 0.5 ? h + 0.5 : h - 0.5);
    expect(s.max[3]).toBeCloseTo(Math.max(turned(ja[2]), turned(jb[2])), 12);
    expect(pickStats(px([NaN, 0, 0]))).toBeNull();
  });

  it('hugs the picked span with a feather of 1% of the slider', () => {
    const grey: [number, number, number] = [0.18, 0.18, 0.18];
    const light: [number, number, number] = [0.3, 0.3, 0.3];
    const r = pickedRange(pickStats(px(grey, light))!, 'luminance')!;
    const lo = rangeUnits('luminance', jzczhz(grey)[0]);
    const hi = rangeUnits('luminance', jzczhz(light)[0]);
    expect(r.invert).toBe(false);
    [lo - 1, lo + 1, hi - 1, hi + 1].forEach((v, i) => expect(r.points[i]).toBeCloseTo(v, 9));
    // Between them it is fully selected. At the ends, darktable's floor of 0.001 on a feather in
    // Jz (5 on this slider at its boost) leaves the picked extremes partly selected.
    const m: Mask = { ...newMask(newGradient(), 0), ranges: { luminance: r, chroma: null, hue: null } };
    expect(rangeValue(m, [0.24, 0.24, 0.24])).toBe(1);
    expect(rangeValue(m, grey)).toBeCloseTo(0.2, 6);
    expect(rangeValue(m, [0.05, 0.05, 0.05])).toBe(0);
  });

  it('keeps the inner markers on the span when it is narrower than the feathers', () => {
    const grey: [number, number, number] = [0.18, 0.18, 0.18];
    const r = pickedRange(pickStats(px(grey))!, 'luminance')!;
    const v = rangeUnits('luminance', jzczhz(grey)[0]);
    [v - 1, v, v, v + 1].forEach((x, i) => expect(r.points[i]).toBeCloseTo(x, 9));
  });

  it('takes a span of hues across red the short way round, inverted', () => {
    // Reds either side of hz = 0 (red and pink-red).
    const warm: [number, number, number] = [0.5, 0.02, 0.12];
    const cool: [number, number, number] = [0.5, 0.02, 0.3];
    const h = [jzczhz(warm)[2], jzczhz(cool)[2]];
    expect(Math.min(...h)).toBeLessThan(0.1);
    expect(Math.max(...h)).toBeGreaterThan(0.9);
    const r = pickedRange(pickStats(px(warm, cool))!, 'hue')!;
    expect(r.invert).toBe(true);
    const lo = Math.min(...h) * 360;
    const hi = Math.max(...h) * 360;
    [lo - 3.6, lo + 3.6, hi - 3.6, hi + 3.6].forEach((x, i) => expect(r.points[i]).toBeCloseTo(x, 6));
    // Inverted, the reds between are selected and cyan is not.
    const m: Mask = { ...newMask(newGradient(), 0), ranges: { luminance: null, chroma: null, hue: r } };
    expect(rangeValue(m, [0.5, 0.02, 0.2])).toBe(1);
    expect(rangeValue(m, [0.02, 0.4, 0.4])).toBe(0);
  });

  it('turns a channel off when the markers span the whole slider', () => {
    // Only reachable below zero, as darktable's test of the markers (not the span) has it.
    expect(pickedRange({ min: [-1, 0, 0, 0.5], max: [10, 1, 1, 1] }, 'luminance')).toBeNull();
    expect(pickedRange({ min: [0, 0, 0, 0.5], max: [10, 1, 1, 1] }, 'hue')).not.toBeNull();
  });
});

