// SPDX-License-Identifier: GPL-3.0-or-later
// A recipe is everything Emulsion knows about how one frame is developed.
// It is what gets saved to the photo's sidecar.

import { STOCK, isStockId, type StockId } from './stocks';
import { isScannerId, type ScannerId } from './scanners';
import { normalizeCurve, type ToneCurve } from './curve';
import { clampWhiteBalance, type WhiteBalance } from '../engine/whitebalance';
import { normalizeCrop, type Crop } from './crop';

export const RECIPE_VERSION = 1;

export type Push = -1 | 0 | 1 | 2;

export interface Recipe {
  v: typeof RECIPE_VERSION;
  stock: StockId;
  push: Push;
  scanner: ScannerId;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  vibrance: number;
  saturation: number;
  fade: number;
  halation: number;
  glow: number;
  vignette: number;
  grain: number;
  /** Grain clump size, percent; the stock's ISO preset by default. */
  grainSize: number;
  /** Grain roughness, percent; the stock's ISO preset by default. */
  grainRough: number;
  /** Point curve on the final display image; null is a straight line. */
  curve: ToneCurve | null;
  /** White balance; null keeps the as-shot white. */
  wb: WhiteBalance | null;
  /** Crop and straighten; null is the whole frame. */
  crop: Crop | null;
}

export type SliderKey = Exclude<keyof Recipe, 'v' | 'stock' | 'push' | 'scanner' | 'curve' | 'wb' | 'crop'>;

export interface SliderDef {
  key: SliderKey;
  label: string;
  group: 'adjust' | 'optics' | 'grain';
  min: number;
  max: number;
  step: number;
  /** When set, the default comes from the stock rather than zero. */
  stockKey?: 'halation' | 'grain' | 'grainSize' | 'grainRough';
  format?: (v: number) => string;
}

const MINUS = '−';
export const formatSigned = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `${MINUS}${Math.abs(v)}` : '0');
export const formatEv = (v: number) => `${v > 0 ? '+' : v < 0 ? MINUS : ''}${Math.abs(v).toFixed(2)} EV`;

export const SLIDERS: SliderDef[] = [
  { key: 'exposure', label: 'Exposure', group: 'adjust', min: -3, max: 3, step: 0.05, format: formatEv },
  { key: 'contrast', label: 'Contrast', group: 'adjust', min: -50, max: 50, step: 1, format: formatSigned },
  { key: 'highlights', label: 'Highlights', group: 'adjust', min: -100, max: 100, step: 1, format: formatSigned },
  { key: 'shadows', label: 'Shadows', group: 'adjust', min: -100, max: 100, step: 1, format: formatSigned },
  { key: 'whites', label: 'Whites', group: 'adjust', min: -100, max: 100, step: 1, format: formatSigned },
  { key: 'blacks', label: 'Blacks', group: 'adjust', min: -100, max: 100, step: 1, format: formatSigned },
  { key: 'vibrance', label: 'Vibrance', group: 'adjust', min: -100, max: 100, step: 1, format: formatSigned },
  { key: 'saturation', label: 'Saturation', group: 'adjust', min: -100, max: 100, step: 1, format: formatSigned },
  { key: 'fade', label: 'Fade', group: 'adjust', min: 0, max: 100, step: 1 },
  { key: 'halation', label: 'Halation', group: 'optics', min: 0, max: 100, step: 1, stockKey: 'halation' },
  { key: 'glow', label: 'Glow', group: 'optics', min: 0, max: 100, step: 1 },
  { key: 'vignette', label: 'Vignette', group: 'optics', min: 0, max: 100, step: 1 },
  { key: 'grain', label: 'Amount', group: 'grain', min: 0, max: 100, step: 1, stockKey: 'grain' },
  { key: 'grainSize', label: 'Size', group: 'grain', min: 50, max: 200, step: 1, stockKey: 'grainSize', format: (v) => `${v}%` },
  { key: 'grainRough', label: 'Roughness', group: 'grain', min: 0, max: 100, step: 1, stockKey: 'grainRough' },
];

export const SLIDER: Record<SliderKey, SliderDef> = Object.fromEntries(SLIDERS.map((s) => [s.key, s])) as Record<SliderKey, SliderDef>;

export const PUSHES: { value: Push; label: string; hint: string; phrase: string }[] = [
  { value: -1, label: 'Pull 1', hint: 'Pulled one stop. Softer contrast and finer grain.', phrase: 'pulled one stop' },
  { value: 0, label: 'Box', hint: 'Box speed. Developed as rated.', phrase: 'at box speed' },
  { value: 1, label: 'Push 1', hint: 'Pushed one stop. More contrast and grain.', phrase: 'pushed one stop' },
  { value: 2, label: 'Push 2', hint: 'Pushed two stops. Hard contrast and heavy grain.', phrase: 'pushed two stops' },
];

export function sliderDefault(def: SliderDef, stock: StockId): number {
  return def.stockKey ? STOCK[stock][def.stockKey] : 0;
}

/** The stock new edits start from. */
export const DEFAULT_STOCK: StockId = 'neutral';

export function defaultRecipe(stock: StockId = DEFAULT_STOCK, scanner: ScannerId = 'frontier'): Recipe {
  const s = STOCK[stock];
  return {
    v: RECIPE_VERSION,
    stock,
    push: 0,
    scanner,
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    vibrance: 0,
    saturation: 0,
    fade: 0,
    halation: s.halation,
    glow: 0,
    vignette: 0,
    grain: s.grain,
    grainSize: s.grainSize,
    grainRough: s.grainRough,
    curve: null,
    wb: null,
    crop: null,
  };
}

/** Switch stock, resetting the sliders whose defaults belong to the stock. */
export function withStock(recipe: Recipe | null, stock: StockId): Recipe {
  if (!recipe) return defaultRecipe(stock);
  const s = STOCK[stock];
  return { ...recipe, stock, halation: s.halation, grain: s.grain, grainSize: s.grainSize, grainRough: s.grainRough };
}

/** Reset the sliders, keeping stock, development, scanner and crop. */
export function resetAdjustments(recipe: Recipe): Recipe {
  return { ...defaultRecipe(recipe.stock, recipe.scanner), push: recipe.push, crop: recipe.crop };
}

/**
 * Another frame's settings applied to this one. The crop stays this frame's own:
 * it belongs to the composition, and frames differ in shape.
 */
export const withSettingsFrom = (from: Recipe, target: Recipe | null): Recipe => ({ ...from, crop: target?.crop ?? null });

/** Panel sections that can be reset on their own. */
export type SectionId = 'development' | 'scanner' | 'crop' | 'adjust' | 'curve' | 'optics' | 'grain';

const SECTION_FIELDS: Record<SectionId, (keyof Recipe)[]> = {
  development: ['push'],
  scanner: ['scanner'],
  crop: ['crop'],
  adjust: ['wb', ...SLIDERS.filter((d) => d.group === 'adjust').map((d) => d.key)],
  curve: ['curve'],
  optics: SLIDERS.filter((d) => d.group === 'optics').map((d) => d.key),
  grain: SLIDERS.filter((d) => d.group === 'grain').map((d) => d.key),
};

/** The recipe with one section back to its defaults (stock defaults where the stock owns them). */
export function resetSection(recipe: Recipe, section: SectionId): Recipe {
  const base = defaultRecipe(recipe.stock);
  const out = { ...recipe } as Record<keyof Recipe, unknown>;
  for (const k of SECTION_FIELDS[section]) out[k] = base[k];
  return out as unknown as Recipe;
}

/** Whether a section differs from its defaults. */
export const sectionChanged = (recipe: Recipe | null, section: SectionId) =>
  !!recipe && JSON.stringify(resetSection(recipe, section)) !== JSON.stringify(recipe);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function normalizeWhiteBalance(input: unknown): WhiteBalance | null {
  if (!input || typeof input !== 'object') return null;
  const { temperature, tint } = input as Record<string, unknown>;
  if (typeof temperature !== 'number' || !Number.isFinite(temperature) || typeof tint !== 'number' || !Number.isFinite(tint)) return null;
  return clampWhiteBalance({ temperature, tint });
}

/**
 * Turn anything read from a sidecar into a valid recipe, or `null` when it is
 * not a recipe at all. Unknown stocks fall back to the default stock; missing or
 * out-of-range values fall back to defaults or are clamped.
 */
export function normalizeRecipe(input: unknown): Recipe | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const stock: StockId = isStockId(o.stock) ? o.stock : DEFAULT_STOCK;
  const scanner: ScannerId = isScannerId(o.scanner) ? o.scanner : 'frontier';
  const base = defaultRecipe(stock, scanner);
  const push = typeof o.push === 'number' && [-1, 0, 1, 2].includes(o.push) ? (o.push as Push) : 0;
  const out: Recipe = { ...base, push, curve: normalizeCurve(o.curve), wb: normalizeWhiteBalance(o.wb), crop: normalizeCrop(o.crop) };
  for (const def of SLIDERS) {
    const v = o[def.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[def.key] = clamp(v, def.min, def.max);
  }
  return out;
}

export const recipeKey = (r: Recipe | null) => (r ? JSON.stringify(r) : 'original');
