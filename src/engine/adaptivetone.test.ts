// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { adaptiveToneCurve, adaptiveToneGain, adaptiveToneTransform, adaptiveBlackLift, adaptiveBlackBrightness, adaptiveWhiteValue, TONE_PRINT_PIVOT, analyzeTone, copyToneVersions, type ToneControls, type ToneAnalysis } from './adaptivetone';
import { toneForward, toneProfileRgb, SIGMOID_GREY } from './tone';
import { EXPOSURE_BOOST } from './toneequalizer';

const NONE: ToneControls = { shadows: 0, highlights: 0, blacks: 0, whites: 0 };
const scene = Array.from({ length: 1000 }, (_, i) => -10 + i * 0.014);
const analysis = analyzeTone(scene);

describe('adaptive tone', () => {
  it('is exactly neutral with every control at zero, regardless of scene distribution', () => {
    for (const samples of [scene, [-16], [-8], [0], [8], []]) {
      const { curve, black, white } = adaptiveToneTransform(analyzeTone(samples), NONE);
      expect(black).toBe(0);
      expect(white).toBe(1);
      for (let e = -20; e <= 12; e += 0.1) expect(adaptiveToneGain(2 ** e, curve)).toBeCloseTo(1, 12);
    }
  });
  it('adapts the ranges to the photo and ignores isolated outliers', () => {
    analyzeTone(scene.map(v => v + 1)).forEach((v, i) => expect(v).toBeCloseTo(analysis[i] + 1, 10));
    const outliers = analyzeTone([...scene, -100, 100]);
    outliers.forEach((v, i) => expect(Math.abs(v - analysis[i])).toBeLessThan(0.03));
    expect(analyzeTone([NaN, Infinity])).toEqual(analyzeTone([]));
  });
  it('limits full Shadows and Highlights to three stops of reach without the old bright-end taper', () => {
    const shadow = adaptiveToneCurve(analysis, { ...NONE, shadows: 100 });
    const highlight = adaptiveToneCurve(analysis, { ...NONE, highlights: -100 });
    expect(Math.log2(adaptiveToneGain(2 ** -12, shadow))).toBeCloseTo(3, 2);
    expect(Math.log2(adaptiveToneGain(2 ** 5, highlight))).toBeCloseTo(-3, 2);
    expect(Math.log2(adaptiveToneGain(2 ** -12, highlight))).toBeCloseTo(0, 2);
  });
  it.each([[25, 0.75], [50, 1.5], [75, 2.25]])('matches Shadows and Highlights reach at +%s', (value, stops) => {
    const shadow = adaptiveToneCurve(analysis, { ...NONE, shadows: value });
    const highlight = adaptiveToneCurve(analysis, { ...NONE, highlights: value });
    expect(Math.log2(adaptiveToneGain(2 ** -12, shadow))).toBeCloseTo(stops, 2);
    expect(Math.log2(adaptiveToneGain(2 ** 5, highlight))).toBeCloseTo(stops, 2);
  });
  it('lifts the visible shadow range, rather than spending its reach only below the 20th percentile', () => {
    const curve = adaptiveToneCurve([-10, -7, -1, 2], { ...NONE, shadows: 100 });
    expect(Math.log2(adaptiveToneGain(2 ** -5, curve))).toBeGreaterThan(2);
    expect(Math.log2(adaptiveToneGain(2 ** -4, curve))).toBeGreaterThan(1);
    expect(Math.log2(adaptiveToneGain(2 ** 1, curve))).toBeLessThan(0.05);
  });
  it('keeps a backlit subject inside the usable shadow range despite a dark-dominated histogram', () => {
    const darkScene = Array.from({ length: 1000 }, (_, i) => i < 850 ? -11 + i / 170 : -3 + (i - 850) / 50);
    const a = analyzeTone(darkScene);
    const curve = adaptiveToneCurve(a, { ...NONE, shadows: 100 });
    // The gentler maximum still gives a visible backlit subject over 1.5 stops of lift.
    expect(Math.log2(adaptiveToneGain(2 ** -5, curve))).toBeGreaterThan(1.5);
    expect(Math.log2(adaptiveToneGain(2 ** 0, curve))).toBeLessThan(0.05);
  });
  it('gives Blacks a real lifted or clipped endpoint and anchors Whites above middle grey', () => {
    const up = adaptiveToneTransform(analysis, { ...NONE, blacks: 100 });
    const down = adaptiveToneTransform(analysis, { ...NONE, blacks: -100 });
    expect(up.black).toBe(0);
    expect(toneProfileRgb([0, 0, 0], 0, 100)[0]).toBeGreaterThan(0);
    expect(adaptiveBlackBrightness(2 ** analysis[0], down.black)).toBeCloseTo(0, 12);
    expect(adaptiveBlackBrightness(1, up.black)).toBeCloseTo(1, 5);
    const white = adaptiveToneTransform(analysis, { ...NONE, whites: 100 });
    expect(white.white).toBeGreaterThan(1);
    expect(adaptiveWhiteValue(TONE_PRINT_PIVOT, white.white)).toBe(TONE_PRINT_PIVOT);
    expect(adaptiveWhiteValue(1, white.white)).toBeGreaterThan(1);
  });
  it('anchors positive Blacks and gives full negative Blacks the chosen clipping reach', () => {
    const scale = Math.sqrt(3) * EXPOSURE_BOOST;
    // A near-zero black percentile must not make the entire control disappear.
    // Include the shopfront reference photo's approximate measured range.
    for (const a of [[-16, -7, -1, 1], [-9.65, -6.42, -3.25, -1.81], [-5, -4, -1, 1]] satisfies ToneAnalysis[]) {
      const up = adaptiveToneTransform(a, { ...NONE, blacks: 100 });
      const down = adaptiveToneTransform(a, { ...NONE, blacks: -100 });
      const gentle = adaptiveToneTransform(a, { ...NONE, blacks: -25 });
      const print = (scene: number, offset: number, lift = 0) => {
        const y = adaptiveBlackBrightness(scene * scale, offset) / scale;
        return toneProfileRgb([y, y, y], 0, adaptiveBlackLift(lift))[0];
      };
      expect(print(0.01, up.black, 100) - toneForward(0.01)).toBeGreaterThan(0.03);
      expect(print(SIGMOID_GREY, up.black, 100)).toBeCloseTo(toneForward(SIGMOID_GREY), 6);
      expect(print(0.036, down.black)).toBe(0);
      expect(print(0.065, down.black)).toBeGreaterThan(0);
      expect(toneForward(0.18) - print(0.18, gentle.black)).toBeLessThan(0.04);
      expect(toneForward(1) - print(1, down.black)).toBeLessThan(0.03);
    }
  });
  it('preserves tonal order at extreme combinations, including flat scenes', () => {
    for (const samples of [scene, [-16], [-4], [8]]) for (const shadows of [-100, 0, 100]) for (const highlights of [-100, 0, 100]) for (const blacks of [-100, 100]) for (const whites of [-100, 100]) {
      const curve = adaptiveToneCurve(analyzeTone(samples), { shadows, highlights, blacks, whites });
      let last = -Infinity;
      for (let e = -18; e <= 10; e += 0.07) {
        const out = 2 ** e * adaptiveToneGain(2 ** e, curve);
        expect(out).toBeGreaterThan(last);
        expect(Number.isFinite(out)).toBe(true);
        last = out;
      }
    }
  });
  it('copies processing with individual controls, preserving the destination’s other processing', () => {
    expect(copyToneVersions(undefined, { shadows: 2, highlights: 2 }, ['shadows'])).toEqual({ highlights: 2 });
    expect(copyToneVersions({ shadows: 2 }, undefined, ['shadows'])).toEqual({ shadows: 2 });
    expect(copyToneVersions(undefined, { shadows: 2 }, ['shadows'])).toBeUndefined();
  });
});
