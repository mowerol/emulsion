// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { LENS_DEFAULTS } from '../engine/lenscorrection';
import { ALL_COPY_GROUPS, COPY_GROUPS, COPY_SECTIONS, DEFAULT_COPY_GROUPS, applyCopiedSettings, normalizeCopyGroups } from './copysettings';
import { FULL } from './crop';
import { newEllipse, newMask } from './masks';
import { newCircleSpot } from './retouch';
import { defaultRecipe, withSettingsFrom } from './recipe';

it('covers every recipe setting once and presents each copy option once', () => {
  const fields = Object.values(COPY_GROUPS).flat();
  expect(new Set(fields).size).toBe(fields.length);
  for (const key of Object.keys(defaultRecipe())) if (key !== 'v') expect(fields).toContain(key);
  const visible = COPY_SECTIONS.flatMap(s => [...s.groups]);
  expect([...visible].sort()).toEqual([...ALL_COPY_GROUPS].sort());
});

it('copies only checked settings, including zero values that clear earlier edits', () => {
  const source = { ...defaultRecipe(), exposure: 0, contrast: 35, grain: 70 };
  const target = { ...defaultRecipe(), exposure: 2, contrast: -20, grain: 15, wb: { temperature: 4200, tint: 8 } };
  const result = applyCopiedSettings({ recipe: source, groups: ['Exposure', 'Contrast'] }, target);
  expect(result).toEqual({ ...target, exposure: 0, contrast: 35 });
  expect(target.exposure).toBe(2);
});

it('leaves geometry/local edits with the photo by default', () => {
  const source = { ...defaultRecipe('portra400'), exposure: 1, lens: { ...LENS_DEFAULTS, enabled: false }, crop: { ...FULL, w: .7 }, masks: [newMask(newEllipse(), 0)] };
  const target = { ...defaultRecipe(), crop: { ...FULL, h: .6 }, retouch: [newCircleSpot([.2, .3])] };
  expect(applyCopiedSettings({ recipe: source, groups: DEFAULT_COPY_GROUPS }, target)).toEqual(withSettingsFrom(source, target));
  for (const option of ['Crop', 'Transform', 'Masks', 'Heal and Remove']) expect(DEFAULT_COPY_GROUPS).not.toContain(option);
});

it('copies opted-in crop, masks and retouch as replacements with independent nested data', () => {
  const source = { ...defaultRecipe(), crop: { ...FULL, w: .7 }, masks: [newMask(newEllipse(), 0)], retouch: [newCircleSpot([.2, .3])], retouchScales: { scales: 3, mergeFrom: 2 } };
  const clip = { recipe: source, groups: ['Crop', 'Masks', 'Heal and Remove'] as const };
  const a = applyCopiedSettings({ ...clip, groups: [...clip.groups] }, defaultRecipe());
  const b = applyCopiedSettings({ ...clip, groups: [...clip.groups] }, defaultRecipe());
  expect(a).toMatchObject({ crop: source.crop, masks: source.masks, retouch: source.retouch, retouchScales: source.retouchScales });
  a.crop!.w = .2;
  a.masks[0].exposure = 2;
  a.retouch[0].opacity = .1;
  expect(b.crop!.w).toBe(.7);
  expect(b.masks[0].exposure).toBe(0);
  expect(b.retouch[0].opacity).toBe(1);
  expect(source.crop.w).toBe(.7);
  expect(source.masks[0].exposure).toBe(0);
});

it('keeps look snapshots and linked settings together, and explicitly clears absent optional values', () => {
  const source = { ...defaultRecipe('gold200'), lookSnapshot: { id: 'test', name: 'Gold', revision: 1, settings: { colorBalance: { contrast: .2 }, curve: null, lut: null } }, scannerFromLook: true, sharpen: 40, sharpenRadius: 2, sharpenMasking: 20 };
  const result = applyCopiedSettings({ recipe: source, groups: ['Look', 'Scanner finish', 'Sharpening'] }, defaultRecipe());
  expect(result).toMatchObject({ stock: 'gold200', lookSnapshot: source.lookSnapshot, scannerFromLook: true, sharpen: 40, sharpenRadius: 2, sharpenMasking: 20 });
  expect(result.lookSnapshot).not.toBe(source.lookSnapshot);
  expect(applyCopiedSettings({ recipe: defaultRecipe(), groups: ['Look'] }, result).lookSnapshot).toBeUndefined();
});

it('recovers remembered scopes without silently selecting unknown or duplicate groups', () => {
  expect(normalizeCopyGroups(null)).toEqual(DEFAULT_COPY_GROUPS);
  expect(normalizeCopyGroups(['Exposure', 'obsolete', 'Exposure'])).toEqual(['Exposure']);
  expect(normalizeCopyGroups([])).toEqual([]);
});
