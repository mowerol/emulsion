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
  Detail: ['noiseReduction', 'texture', 'clarity', 'dehaze', 'dehazeDistance', 'captureSharpening', 'sharpen', 'sharpenRadius', 'sharpenMasking'],
  Effects: ['fade', 'halation', 'glow', 'vignette'],
  Grain: ['push', 'grain', 'grainIso', 'grainMidtones'],
  'Film options': ['scanner', 'scannerFromLook'],
} as const satisfies Record<string, readonly (keyof Recipe)[]>;
export type PresetGroup = keyof typeof PRESET_GROUPS;
export const PRESET_EXCLUDED = ['v', 'profile', 'crop', 'lens', 'transform', 'masks', 'retouch', 'retouchScales'] as const;
export const DEFAULT_PRESET_GROUPS = (Object.keys(PRESET_GROUPS) as PresetGroup[]).filter(g => g !== 'Exposure' && g !== 'White balance');
/** `collection` files a preset under a heading of the person's own; absent, it is under My presets. */
export interface Preset { version: 1; id: string; name: string; groups: PresetGroup[]; recipe: Recipe; collection?: string }
export function normalizePreset(value: unknown): Preset | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Preset;
  const recipe = normalizeRecipe(p.recipe);
  if (p.version !== 1 || typeof p.id !== 'string' || !/^[a-f0-9-]{36}$/.test(p.id) || typeof p.name !== 'string' || !p.name.trim() || !recipe || !Array.isArray(p.groups)) return null;
  const groups = [...new Set(p.groups.filter(g => Object.prototype.hasOwnProperty.call(PRESET_GROUPS, g)))];
  if (!groups.length) return null;
  const collection = typeof p.collection === 'string' && p.collection.trim() ? p.collection.trim().slice(0, 100) : undefined;
  return { version: 1, id: p.id, name: p.name.trim(), groups, recipe, ...(collection ? { collection } : {}) };
}
export function applyPreset(p: Preset, target: Recipe | null): Recipe {
  const result = { ...(target ?? defaultRecipe()) };
  for (const group of p.groups) for (const key of PRESET_GROUPS[group]) {
    Object.assign(result, { [key]: structuredClone(p.recipe[key]) });
  }
  return result;
}

/** Short names for what a preset touches, as its row summarises it. */
export const GROUP_SHORT: Record<PresetGroup, string> = {
  Treatment: 'Look', Exposure: 'Exposure', 'White balance': 'WB', Tone: 'Tone', Curve: 'Curve', Colour: 'Colour',
  'Colour Grading': 'Grading', Detail: 'Detail', Effects: 'Effects', Grain: 'Grain', 'Film options': 'Scanner',
};
/** The names the interface uses for the groups (ids stay as saved). */
export const GROUP_LABEL = (g: PresetGroup) => (g === 'Treatment' ? 'Look' : g === 'Film options' ? 'Scanner finish' : g);
export const presetScope = (p: Pick<Preset, 'groups'>) =>
  (Object.keys(PRESET_GROUPS) as PresetGroup[]).filter(g => p.groups.includes(g)).map(g => GROUP_SHORT[g]).join(' · ');
/** The same names, cut to fit a narrow row: the first few, then how many more. */
export const presetScopeShort = (p: Pick<Preset, 'groups'>, max = 3) => {
  const names = (Object.keys(PRESET_GROUPS) as PresetGroup[]).filter(g => p.groups.includes(g)).map(g => GROUP_SHORT[g]);
  return names.length > max ? `${names.slice(0, max).join(' · ')} · ${names.length - max} more` : names.join(' · ');
};
