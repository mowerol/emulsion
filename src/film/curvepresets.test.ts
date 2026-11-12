// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { BUILTIN_CURVE_PRESETS, curveAsPreset, curvePresets, isCurvePreset, sameCurve } from './curvepresets';
import { isLinear, normalizeCurve, sampleCurve } from './curve';
import { applyPreset, normalizePreset, type Preset } from './presets';
import { defaultRecipe } from './recipe';

const id = (n: number) => `e0000000-0000-4000-8000-00000000000${n}`;
const [s, fade] = BUILTIN_CURVE_PRESETS.map(p => p.curve!);

it('the built-in curves are valid, change only the master curve and stay monotone', () => {
  for (const c of [s, fade]) {
    expect(normalizeCurve(c)).toEqual(c);
    expect([c.r, c.g, c.b].every(isLinear)).toBe(true);
    const v = sampleCurve(c.rgb);
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeGreaterThanOrEqual(v[i - 1]);
  }
});

it('the S-curve darkens shadows, brightens highlights and keeps black, mid-grey and white', () => {
  const v = sampleCurve(s.rgb, 256);
  expect([v[0], v[255]]).toEqual([0, 1]);
  expect(v[128]).toBeCloseTo(128 / 255, 5);
  expect(v[64]).toBeLessThan(64 / 255);
  expect(v[192]).toBeGreaterThan(192 / 255);
});

it('the fade lifts black and lowers white but keeps mid-tone contrast', () => {
  const v = sampleCurve(fade.rgb, 256);
  expect(v[0]).toBeCloseTo(20 / 255, 5);
  expect(v[255]).toBeLessThan(1);
  expect(v[150] - v[106]).toBeGreaterThan(44 / 255);
});

it('lists the built-ins, then saved presets that hold only the curve, by name', () => {
  const saved: Preset[] = [
    curveAsPreset(id(1), 'Zebra', s),
    curveAsPreset(id(2), 'Alpha', fade),
    { ...curveAsPreset(id(3), 'Curve and tone', s), groups: ['Curve', 'Tone'] },
  ];
  expect(isCurvePreset(saved[0])).toBe(true);
  expect(isCurvePreset(saved[2])).toBe(false);
  expect(curvePresets(saved).map(p => p.name)).toEqual(['Subtle S-curve', 'Subtle S-curve fade', 'Alpha', 'Zebra']);
});

it('a saved curve preset survives normalising and applies only the curve', () => {
  const p = normalizePreset(curveAsPreset(id(1), '  Mine  ', fade))!;
  expect(p.name).toBe('Mine');
  expect(p.groups).toEqual(['Curve']);
  const target = { ...defaultRecipe(), contrast: 30, exposure: 1 };
  expect(applyPreset(p, target)).toEqual({ ...target, curve: fade });
});

it('compares curves, treating a straight curve as none', () => {
  expect(sameCurve(s, structuredClone(s))).toBe(true);
  expect(sameCurve(s, fade)).toBe(false);
  expect(sameCurve(null, { rgb: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] })).toBe(true);
});
