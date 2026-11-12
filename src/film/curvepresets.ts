// SPDX-License-Identifier: GPL-3.0-or-later
// Quick curve presets under the tone curve: two built-in shapes, plus every saved preset
// that holds only the Curve group, so saving a curve as a preset puts it in the list.

import { LINEAR, normalizeCurve, type CurvePoint, type ToneCurve } from './curve';
import type { Preset } from './presets';
import { defaultRecipe } from './recipe';

export interface CurvePreset { id: string; name: string; curve: ToneCurve | null }

const pts = (...p: [number, number][]): CurvePoint[] => p.map(([x, y]) => [x / 255, y / 255]);
const master = (rgb: CurvePoint[]): ToneCurve => ({ rgb, r: LINEAR, g: LINEAR, b: LINEAR });

/** Gentle shapes on the master curve, in 0-255 display levels. Oli asked for these two. */
export const BUILTIN_CURVE_PRESETS: CurvePreset[] = [
  // A symmetric S: shadows and highlights eased by 8 levels, mid-tones steeper.
  { id: 'builtin:subtle-s', name: 'Subtle S-curve', curve: master(pts([0, 0], [64, 56], [128, 128], [192, 200], [255, 255])) },
  // The same contrast in the mid-tones over a lifted, flattened black and a softened white.
  { id: 'builtin:subtle-s-fade', name: 'Subtle S-curve fade', curve: master(pts([0, 20], [48, 40], [128, 128], [200, 204], [255, 250])) },
];

/** A saved preset that holds the tone curve and nothing else. */
export const isCurvePreset = (p: Pick<Preset, 'groups'>) => p.groups.length === 1 && p.groups[0] === 'Curve';

/** The curve presets to list: the built-ins first, then the saved ones by name. */
export function curvePresets(saved: Preset[]): CurvePreset[] {
  const own = saved.filter(isCurvePreset)
    .map(p => ({ id: p.id, name: p.name, curve: normalizeCurve(p.recipe.curve) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...BUILTIN_CURVE_PRESETS, ...own];
}

/** A preset that stores just this curve. */
export function curveAsPreset(id: string, name: string, curve: ToneCurve | null): Preset {
  return { version: 1, id, name: name.trim(), groups: ['Curve'], recipe: { ...defaultRecipe(), curve: curve ? structuredClone(curve) : null } };
}

/** Whether two curves are the same (null and a straight curve are). */
export const sameCurve = (a: ToneCurve | null, b: ToneCurve | null) => JSON.stringify(normalizeCurve(a)) === JSON.stringify(normalizeCurve(b));
