// SPDX-License-Identifier: GPL-3.0-or-later
import type { Recipe } from './recipe';
import { CB_DEFAULTS, type CbParams } from '../engine/colorbalance';

export type GradingKey = Exclude<keyof CbParams, 'contrast' | 'vibrance' | 'saturation_global' | 'shadows_Y'>;
export type ColourGrading = Partial<Pick<CbParams, GradingKey>>;
export type GradeKey = keyof CbParams;

/** Native parameter limits from darktable colorbalancergb.c at 20891f6c. */
export function gradeRange(key: GradeKey): [number, number, number] {
  if (key === 'midtones_Y') return [-0.999, 1, 0.001];
  if (key.endsWith('_H')) return [0, 360, 0.1];
  if (key.endsWith('_C')) return [0, 1, 0.001];
  if (key.endsWith('_weight')) return [0, 3, 0.01];
  if (key === 'white_fulcrum') return [-16, 16, 0.01];
  if (key === 'hue_angle') return [-180, 180, 0.1];
  // Avoid singular mask/contrast pivots at exactly zero.
  if (key === 'grey_fulcrum' || key === 'mask_grey_fulcrum') return [0.0001, 1, 0.0001];
  return [-1, 1, 0.001];
}
export const gradeDefault = (key: GradeKey) => key === 'grey_fulcrum' ? 0.18 : CB_DEFAULTS[key];
export function normalizeGrading(input: unknown): ColourGrading | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const source = input as Record<string, unknown>;
  const result: ColourGrading = {};
  for (const key of Object.keys(CB_DEFAULTS) as GradeKey[]) {
    if (key === 'contrast' || key === 'vibrance' || key === 'saturation_global' || key === 'shadows_Y') continue;
    const value = source[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const [min, max] = gradeRange(key);
    const safe = Math.min(max, Math.max(min, value));
    if (safe !== gradeDefault(key)) result[key] = safe;
  }
  return Object.keys(result).length ? result : null;
}

const linked = (key: GradeKey) => key === 'shadows_Y' ? 'shadows' : key === 'saturation_global' ? 'saturation' : null;
export function gradeValue(recipe: Recipe, key: GradeKey) {
  const field = linked(key);
  return field ? recipe[field] / 100 : recipe.grading?.[key as keyof NonNullable<Recipe['grading']>] ?? gradeDefault(key);
}
export function updateGrade(recipe: Recipe, patch: Partial<Record<GradeKey, number>>): Recipe {
  let next = { ...recipe };
  const grading = { ...recipe.grading };
  for (const [key, value] of Object.entries(patch) as [GradeKey, number][]) {
    const field = linked(key);
    if (field) next = { ...next, [field]: value * 100 };
    else Object.assign(grading, { [key]: value });
  }
  return { ...next, grading: normalizeGrading(grading) };
}

/** darktable's soft slider ranges, with full ranges available through numeric entry. */
export function gradeSoftRange(key: GradeKey): [number, number] {
  const soft: Partial<Record<GradeKey, [number, number]>> = {
    global_Y: [-0.05, 0.05], global_C: [0, 0.01], shadows_C: [0, 0.5],
    highlights_Y: [-0.5, 0.5], highlights_C: [0, 0.2], midtones_Y: [-0.25, 0.25], midtones_C: [0, 0.1],
    chroma_global: [-0.5, 0.5], white_fulcrum: [-2, 2], grey_fulcrum: [0.1, 0.5],
  };
  return soft[key] ?? gradeRange(key).slice(0, 2) as [number, number];
}
