// SPDX-License-Identifier: GPL-3.0-or-later
// A recipe is everything Emulsion knows about how one frame is developed.
// It is what gets saved to the photo's sidecar.

import { STOCK, isStockId, type StockId } from './stocks';
import { isScannerId, type ScannerId } from './scanners';
import { normalizeCurve, type ToneCurve } from './curve';
import { clampWhiteBalance, type WhiteBalance } from '../engine/whitebalance';
import { normalizeCrop, type Crop } from './crop';
import { ISO_MAX, ISO_MIN } from '../engine/grain';

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
  texture: number;
  clarity: number;
  /** RawTherapee's capture sharpening (RAWs only): 0 to 100, the deconvolution's iterations. */
  captureSharpening: number;
  /** RawTherapee's unsharp mask: amount 0 to 100 (its amount / 10), radius in pixels, masking 0 to 100. */
  sharpen: number;
  sharpenRadius: number;
  sharpenMasking: number;
  vibrance: number;
  saturation: number;
  fade: number;
  halation: number;
  glow: number;
  vignette: number;
  grain: number;
  /** Grain size: darktable's coarseness, in its ISO units; the stock's film speed by default. */
  grainIso: number;
  /** darktable's grain mid-tones bias, 0 to 100: how much grain falls off in shadows and highlights. */
  grainMidtones: number;
  /** Point curve on the final display image; null is a straight line. */
  curve: ToneCurve | null;
  /** White balance; null keeps the as-shot white. */
  wb: WhiteBalance | null;
  /** Crop and straighten; null is the whole frame. */
  crop: Crop | null;
  /** Colour (darktable's color equalizer) per hue node, red to magenta; null leaves every colour. */
  color: ColorAdjust | null;
}

/**
 * Eight values each, red to magenta (0 leaves it). Hue -120 to 120 is darktable's ±36° (0.3° a
 * step, HUE_MAX at HUE_DEGREES): a little past one neighbouring colour each way, a touch more
 * than Lightroom's HSL. Saturation ±100 is darktable's gain 1 ± SAT_RANGE: grey at -100 and twice
 * the saturation at +100 (darktable's full range triples it, and vivid colours meet the gamut
 * early and stop changing). Brightness ±100 is its gain 1 ± BRIGHT_RANGE, under a third of its
 * range, which at its ends turns vivid colours black.
 */
export interface ColorAdjust {
  hue: number[];
  sat: number[];
  bright: number[];
}

/** The Hue slider's end, and darktable's hue shift there in degrees. */
export const HUE_MAX = 120;
export const HUE_DEGREES = 36;
/** darktable's saturation gain moves this far from 1 at Saturation ±100. */
export const SAT_RANGE = 0.5;
/** darktable's brightness gain moves this far from 1 at Brightness ±100. */
export const BRIGHT_RANGE = 0.3;

export const COLOR_CHANNELS = [
  { key: 'hue', label: 'Hue', min: -HUE_MAX, max: HUE_MAX },
  { key: 'sat', label: 'Saturation', min: -100, max: 100 },
  { key: 'bright', label: 'Brightness', min: -100, max: 100 },
] as const;

/** A colour adjustment with every value at rest, as null. */
export const tidyColor = (c: ColorAdjust | null): ColorAdjust | null =>
  c && [...c.hue, ...c.sat, ...c.bright].some((v) => v !== 0) ? c : null;

function normalizeColor(input: unknown): ColorAdjust | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const list = (v: unknown, lo: number, hi: number) =>
    Array.from({ length: 8 }, (_, i) => {
      const x = Array.isArray(v) ? v[i] : 0;
      return typeof x === 'number' && Number.isFinite(x) ? clamp(x, lo, hi) : 0;
    });
  return tidyColor({ hue: list(o.hue, -HUE_MAX, HUE_MAX), sat: list(o.sat, -100, 100), bright: list(o.bright, -100, 100) });
}

export type SliderKey = Exclude<keyof Recipe, 'v' | 'stock' | 'push' | 'scanner' | 'curve' | 'wb' | 'crop' | 'color'>;

export interface SliderDef {
  key: SliderKey;
  label: string;
  group: 'adjust' | 'detail' | 'optics' | 'grain';
  min: number;
  max: number;
  step: number;
  /** When set, the default comes from the stock rather than zero. */
  stockKey?: 'halation' | 'grain' | 'grainIso';
  /** Drawn on a logarithmic scale (film speeds). */
  log?: boolean;
  /** What the slider does, shown on hover. */
  hint?: string;
  /** The default when it is not zero and not the stock's. */
  default?: number;
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
  { key: 'texture', label: 'Texture', group: 'detail', min: -100, max: 100, step: 1, format: formatSigned },
  { key: 'clarity', label: 'Clarity', group: 'detail', min: -100, max: 100, step: 1, format: formatSigned },
  { key: 'sharpen', label: 'Sharpening', group: 'detail', min: 0, max: 100, step: 1 },
  { key: 'sharpenRadius', label: 'Radius', group: 'detail', min: 0.3, max: 3, step: 0.05, default: 0.5, format: (v) => `${v.toFixed(2)} px` },
  { key: 'sharpenMasking', label: 'Masking', group: 'detail', min: 0, max: 100, step: 1, default: 10 },
  { key: 'captureSharpening', label: 'Capture', group: 'detail', min: 0, max: 100, step: 1 },
  { key: 'halation', label: 'Halation', group: 'optics', min: 0, max: 100, step: 1, stockKey: 'halation' },
  { key: 'glow', label: 'Glow', group: 'optics', min: 0, max: 100, step: 1 },
  { key: 'vignette', label: 'Vignette', group: 'optics', min: 0, max: 100, step: 1 },
  { key: 'grain', label: 'Amount', group: 'grain', min: 0, max: 100, step: 1, stockKey: 'grain' },
  { key: 'grainIso', label: 'Size', group: 'grain', min: ISO_MIN, max: ISO_MAX, step: 1, stockKey: 'grainIso', log: true, hint: 'The grain size, as the ISO of the film.', format: (v) => `ISO ${Math.round(v)}` },
  { key: 'grainMidtones', label: 'Mid-tones', group: 'grain', min: 0, max: 100, step: 1, default: 100, hint: 'How much the grain fades in shadows and highlights, as on a photographic print. At 0 it is even across every tone.', format: (v) => `${v}%` },
];

export const SLIDER: Record<SliderKey, SliderDef> = Object.fromEntries(SLIDERS.map((s) => [s.key, s])) as Record<SliderKey, SliderDef>;

export const PUSHES: { value: Push; label: string; hint: string; phrase: string }[] = [
  { value: -1, label: 'Pull 1', hint: 'Pulled one stop. Softer contrast and finer grain.', phrase: 'pulled one stop' },
  { value: 0, label: 'Box', hint: 'Box speed. Developed as rated.', phrase: 'at box speed' },
  { value: 1, label: 'Push 1', hint: 'Pushed one stop. More contrast and grain.', phrase: 'pushed one stop' },
  { value: 2, label: 'Push 2', hint: 'Pushed two stops. Hard contrast and heavy grain.', phrase: 'pushed two stops' },
];

export function sliderDefault(def: SliderDef, stock: StockId): number {
  return def.stockKey ? STOCK[stock][def.stockKey] : (def.default ?? 0);
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
    texture: 0,
    clarity: 0,
    captureSharpening: 0,
    sharpen: 0,
    sharpenRadius: 0.5,
    sharpenMasking: 10,
    vibrance: 0,
    saturation: 0,
    fade: 0,
    halation: s.halation,
    glow: 0,
    vignette: 0,
    grain: s.grain,
    grainIso: s.grainIso,
    grainMidtones: 100,
    curve: null,
    wb: null,
    crop: null,
    color: null,
  };
}

/**
 * Switch stock. Grain size follows the new stock's film speed; the
 * Grain amount and Halation stay as they are, since every stock starts them at 0
 * and resetting them would wipe the photo's grain on each change of stock.
 */
export function withStock(recipe: Recipe | null, stock: StockId): Recipe {
  if (!recipe) return defaultRecipe(stock);
  const s = STOCK[stock];
  return { ...recipe, stock, grainIso: s.grainIso };
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
export type SectionId = 'development' | 'scanner' | 'crop' | 'adjust' | 'curve' | 'color' | 'detail' | 'optics' | 'grain';

const SECTION_FIELDS: Record<SectionId, (keyof Recipe)[]> = {
  development: ['push'],
  scanner: ['scanner'],
  crop: ['crop'],
  adjust: ['wb', ...SLIDERS.filter((d) => d.group === 'adjust').map((d) => d.key)],
  curve: ['curve'],
  color: ['color'],
  detail: SLIDERS.filter((d) => d.group === 'detail').map((d) => d.key),
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
  const out: Recipe = { ...base, push, curve: normalizeCurve(o.curve), wb: normalizeWhiteBalance(o.wb), crop: normalizeCrop(o.crop), color: normalizeColor(o.color) };
  // Capture sharpening was saved as `sharpening` before the unsharp mask came.
  const read = (key: string) => (key === 'captureSharpening' && o.captureSharpening === undefined ? o.sharpening : o[key]);
  for (const def of SLIDERS) {
    const v = read(def.key);
    if (typeof v === 'number' && Number.isFinite(v)) out[def.key] = clamp(v, def.min, def.max);
  }
  return out;
}

export const recipeKey = (r: Recipe | null) => (r ? JSON.stringify(r) : 'original');
