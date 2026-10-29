// SPDX-License-Identifier: GPL-3.0-or-later
// A recipe is everything Emulsion knows about how one frame is developed.
// It is what gets saved to the photo's sidecar.

import { STOCK, isStockId, type StockId } from './stocks';
import { isScannerId, type ScannerId } from './scanners';
import { normalizeCurve, type ToneCurve } from './curve';

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
  warmth: number;
  tint: number;
  fade: number;
  halation: number;
  glow: number;
  vignette: number;
  grain: number;
  grainSize: number;
  /** Point curve on the final display image; null is a straight line. */
  curve: ToneCurve | null;
}

export type SliderKey = Exclude<keyof Recipe, 'v' | 'stock' | 'push' | 'scanner' | 'curve'>;

export interface SliderDef {
  key: SliderKey;
  label: string;
  group: 'adjust' | 'optics' | 'grain';
  min: number;
  max: number;
  step: number;
  /** When set, the default comes from the stock rather than zero. */
  stockKey?: 'halation' | 'grain' | 'grainSize';
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
  { key: 'warmth', label: 'Warmth', group: 'adjust', min: -100, max: 100, step: 1, format: formatSigned },
  { key: 'tint', label: 'Tint', group: 'adjust', min: -100, max: 100, step: 1, format: formatSigned },
  { key: 'fade', label: 'Fade', group: 'adjust', min: 0, max: 100, step: 1 },
  { key: 'halation', label: 'Halation', group: 'optics', min: 0, max: 100, step: 1, stockKey: 'halation' },
  { key: 'glow', label: 'Glow', group: 'optics', min: 0, max: 100, step: 1 },
  { key: 'vignette', label: 'Vignette', group: 'optics', min: 0, max: 100, step: 1 },
  { key: 'grain', label: 'Amount', group: 'grain', min: 0, max: 100, step: 1, stockKey: 'grain' },
  { key: 'grainSize', label: 'Size', group: 'grain', min: 50, max: 200, step: 5, stockKey: 'grainSize', format: (v) => `${v}%` },
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

export function defaultRecipe(stock: StockId = 'portra400', scanner: ScannerId = 'frontier'): Recipe {
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
    warmth: 0,
    tint: 0,
    fade: 0,
    halation: s.halation,
    glow: 0,
    vignette: 0,
    grain: s.grain,
    grainSize: s.grainSize,
    curve: null,
  };
}

/** Switch stock, resetting the sliders whose defaults belong to the stock. */
export function withStock(recipe: Recipe | null, stock: StockId): Recipe {
  if (!recipe) return defaultRecipe(stock);
  const s = STOCK[stock];
  return { ...recipe, stock, halation: s.halation, grain: s.grain, grainSize: s.grainSize };
}

/** Reset the sliders, keeping stock, development and scanner. */
export function resetAdjustments(recipe: Recipe): Recipe {
  return { ...defaultRecipe(recipe.stock, recipe.scanner), push: recipe.push };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Turn anything read from a sidecar into a valid recipe, or `null` when it is
 * not a recipe at all. Unknown stocks fall back to the default stock; missing or
 * out-of-range values fall back to defaults or are clamped.
 */
export function normalizeRecipe(input: unknown): Recipe | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const stock: StockId = isStockId(o.stock) ? o.stock : 'portra400';
  const scanner: ScannerId = isScannerId(o.scanner) ? o.scanner : 'frontier';
  const base = defaultRecipe(stock, scanner);
  const push = typeof o.push === 'number' && [-1, 0, 1, 2].includes(o.push) ? (o.push as Push) : 0;
  const out: Recipe = { ...base, push, curve: normalizeCurve(o.curve) };
  for (const def of SLIDERS) {
    const v = o[def.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[def.key] = clamp(v, def.min, def.max);
  }
  return out;
}

export const recipeKey = (r: Recipe | null) => (r ? JSON.stringify(r) : 'original');
