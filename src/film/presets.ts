// SPDX-License-Identifier: GPL-3.0-or-later
import { defaultRecipe, normalizeRecipe, type Recipe } from './recipe';

export const PRESET_GROUPS = {
  Treatment: ['lookEnabled', 'stock', 'pack', 'lookAmount', 'lookBlend', 'lookSnapshot'],
  Exposure: ['exposure'],
  'White balance': ['wb'],
  Tone: ['contrast', 'toneCharacter', 'highlights', 'shadows', 'whites', 'blacks'],
  Curve: ['curve'],
  Colour: ['vibrance', 'saturation', 'color'],
  'Colour Grading': ['grading'],
  Detail: ['texture', 'clarity', 'dehaze', 'dehazeDistance', 'captureSharpening', 'sharpen', 'sharpenRadius', 'sharpenMasking'],
  Effects: ['fade', 'halation', 'glow', 'vignette'],
  Grain: ['push', 'grain', 'grainIso', 'grainMidtones'],
  'Film options': ['scanner', 'scannerFromLook'],
} as const satisfies Record<string, readonly (keyof Recipe)[]>;
export type PresetGroup = keyof typeof PRESET_GROUPS;
export const PRESET_EXCLUDED = ['v', 'profile', 'crop', 'lens', 'masks'] as const;
export const DEFAULT_PRESET_GROUPS = (Object.keys(PRESET_GROUPS) as PresetGroup[]).filter(g => g !== 'Exposure' && g !== 'White balance');
export interface Preset { version: 1; id: string; name: string; groups: PresetGroup[]; recipe: Recipe }
export function normalizePreset(value: unknown): Preset | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Preset;
  const recipe = normalizeRecipe(p.recipe);
  if (p.version !== 1 || typeof p.id !== 'string' || !/^[a-f0-9-]{36}$/.test(p.id) || typeof p.name !== 'string' || !p.name.trim() || !recipe || !Array.isArray(p.groups)) return null;
  const groups = [...new Set(p.groups.filter(g => Object.prototype.hasOwnProperty.call(PRESET_GROUPS, g)))];
  return groups.length ? { version: 1, id: p.id, name: p.name.trim(), groups, recipe } : null;
}
export function applyPreset(p: Preset, target: Recipe | null): Recipe {
  const result = { ...(target ?? defaultRecipe()) };
  for (const group of p.groups) for (const key of PRESET_GROUPS[group]) {
    Object.assign(result, { [key]: structuredClone(p.recipe[key]) });
  }
  return result;
}
