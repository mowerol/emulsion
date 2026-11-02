// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { commitTyped, parseTyped } from './typed';
import { activeTool } from './tools';
import { INTERFACE_DEFAULTS, normalizePrefs } from './prefs';

describe('typed slider values', () => {
  it('reads signs, the typographic minus, decimal commas and trailing units', () => {
    expect(parseTyped('+12')).toBe(12);
    expect(parseTyped('−35')).toBe(-35);
    expect(parseTyped(' 0,5 EV')).toBe(0.5);
    expect(parseTyped('.25')).toBe(0.25);
    expect(parseTyped('abc')).toBeNull();
  });
  it('clamps to the range and rounds to the step', () => {
    const exposure = { min: -3, max: 3, step: 0.05 };
    expect(commitTyped(exposure, '1.234')).toBe(1.25);
    expect(commitTyped(exposure, '9')).toBe(3);
    expect(commitTyped({ min: -100, max: 100, step: 1 }, '-250')).toBe(-100);
    expect(commitTyped(exposure, '')).toBeNull();
  });
});

describe('canvas tools', () => {
  const t = { pointer: 'select' as const, straighten: false, spacePan: false, beforeMask: 'develop' as const, preview: null };
  it('shows crop and straighten while cropping, then pick, then the masks tab, then the pointer', () => {
    expect(activeTool({ ...t, straighten: true }, true, true, true)).toBe('straighten');
    expect(activeTool(t, true, false, false)).toBe('crop');
    expect(activeTool(t, false, true, true)).toBe('pick');
    expect(activeTool(t, false, false, true)).toBe('mask');
    expect(activeTool(t, false, false, true, true)).toBe('heal');
    expect(activeTool(t, false, true, false, true)).toBe('pick');
    expect(activeTool({ ...t, spacePan: true }, false, false, false)).toBe('pan');
    expect(activeTool({ ...t, pointer: 'pan' }, false, false, false)).toBe('pan');
    expect(activeTool(t, false, false, false)).toBe('select');
  });
});

describe('interface preferences', () => {
  it('defaults to mid grey with the filters open, and recovers from bad saved values', () => {
    expect(normalizePrefs(null)).toEqual(INTERFACE_DEFAULTS);
    expect(INTERFACE_DEFAULTS.theme).toBe('mid');
    expect(normalizePrefs({ theme: 'neon', histogramSmall: 'yes', filtersOpen: false })).toEqual({ theme: 'mid', libraryExif: true, histogramSmall: false, filtersOpen: false, cropOverlay: 'thirds' });
    expect(normalizePrefs({ cropOverlay: 'golden' }).cropOverlay).toBe('golden');
    expect(normalizePrefs({ theme: 'dark' }).theme).toBe('dark');
  });
});
