// SPDX-License-Identifier: GPL-3.0-or-later
// A recipe is everything Emulsion knows about how one frame is developed.
// It is what gets saved to the photo's sidecar.

import { normalizeSettings, type ProfileSettings } from './creative';
import { captureLook } from './looks';
import { normalizeProfile, type CameraProfileId } from './profiles';
import { normalizeLens, type LensAdjust } from '../engine/lenscorrection';
import { normalizePerspective, type Perspective } from '../engine/perspective';
import { normalizeGrading, type ColourGrading } from './grading';
import { STOCK, isStockId, type StockId } from './stocks';
import { isScannerId, type ScannerId } from './scanners';
import { normalizeCurve, type ToneCurve } from './curve';
import { clampWhiteBalance, type WhiteBalance } from '../engine/whitebalance';
import { normalizeCrop, type Crop } from './crop';
import { normalizeMasks, type Mask } from './masks';
import { ISO_MAX, ISO_MIN } from '../engine/grain';
import { DEFAULT_PACK, PACK, isPackId, resolveUserLook, type PackId } from './looks';

export const RECIPE_VERSION = 1;

export type Push = -1 | 0 | 1 | 2;
export type LookBlend = 'normal' | 'color';

export interface Recipe {
  v: typeof RECIPE_VERSION;
  lookSnapshot?: { id: string; name: string; revision: number; kind?: 'lut' | 'look'; settings: ProfileSettings };
  /** Base camera rendering. Missing in older sidecars: preserve their original pipeline. */
  profile: CameraProfileId;
  /** A creative LUT is optional and never selects or replaces the camera profile. */
  lookEnabled: boolean;
  stock: StockId;
  /** The look pack whose LUT renders the stock (Emulsion's own rendering where it has none). */
  pack: PackId;
  /** How much of the pack's LUT to apply, 0 to 100: a blend with Neutral (as Lightroom profiles' Amount). */
  lookAmount: number;
  /**
   * How the look's LUT combines with the photo: 'normal' takes all of it; 'color' takes only its hue
   * and saturation and keeps the photo's lightness (darktable's color blend mode), so the tone
   * controls keep the highlights. A custom look keeps its own (in its settings).
   */
  lookBlend: LookBlend;
  push: Push;
  scanner: ScannerId;
  /** True follows the captured look finish; absent in legacy photos means an explicit scanner choice. */
  scannerFromLook?: boolean;
  exposure: number;
  contrast: number;
  /** Softer/harder output tone curve, independent of grain. */
  toneCharacter: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  texture: number;
  clarity: number;
  /** Darktable's haze removal strength and maximum removal distance. */
  dehaze: number;
  dehazeDistance: number;
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
  /** Additional controls for the recipe colour balance instance, in upstream units. */
  grading: ColourGrading | null;
  lens: LensAdjust | null;
  transform: Perspective | null;
  /** Local adjustments (film/masks.ts), applied in order; empty when there are none. */
  masks: Mask[];
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

export type SliderKey = Exclude<keyof Recipe, 'v' | 'profile' | 'lookEnabled' | 'stock' | 'pack' | 'lookBlend' | 'push' | 'scanner' | 'scannerFromLook' | 'curve' | 'wb' | 'crop' | 'color' | 'grading' | 'lens' | 'transform' | 'masks' | 'lookSnapshot'>;

export interface SliderDef {
  key: SliderKey;
  label: string;
  group: 'look' | 'adjust' | 'detail' | 'optics' | 'grain';
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
  { key: 'lookAmount', label: 'Amount', group: 'look', min: 0, max: 100, step: 1, default: 100, hint: 'How strongly the look applies: 0 is Neutral, 100 the full look.', format: (v) => `${v}%` },
  { key: 'exposure', label: 'Exposure', group: 'adjust', min: -5, max: 5, step: 0.05, format: formatEv },
  { key: 'toneCharacter', label: 'Tone character', group: 'adjust', min: -100, max: 100, step: 1, default: 0, format: formatSigned, hint: 'Softer ← 0 → Harder. Changes the output tone curve independently of grain.' },
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
  { key: 'dehaze', label: 'Dehaze', group: 'detail', min: -100, max: 100, step: 1, format: formatSigned, hint: 'Darktable haze removal: positive values remove haze; negative values add it.' },
  { key: 'dehazeDistance', label: 'Distance', group: 'detail', min: 0, max: 100, step: 1, default: 20, format: (v) => `${v}%`, hint: 'The maximum distance over which haze is removed.' },
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
  { value: -1, label: 'Pull 1', hint: 'Pulled one stop. Finer grain.', phrase: 'pulled one stop' },
  { value: 0, label: 'Box', hint: 'Box speed. Developed as rated.', phrase: 'at box speed' },
  { value: 1, label: 'Push 1', hint: 'Pushed one stop. Coarser grain.', phrase: 'pushed one stop' },
  { value: 2, label: 'Push 2', hint: 'Pushed two stops. Heavy grain.', phrase: 'pushed two stops' },
];

export function sliderDefault(def: SliderDef, stock: StockId): number {
  return def.stockKey ? STOCK[stock][def.stockKey] : (def.default ?? 0);
}

/** The stock new edits start from. */
export const DEFAULT_STOCK: StockId = 'neutral';

export function defaultRecipe(stock: StockId = DEFAULT_STOCK, scanner: ScannerId = 'straight'): Recipe {
  const s = STOCK[stock];
  return {
    v: RECIPE_VERSION,
    profile: 'auto',
    lookEnabled: stock !== 'neutral',
    stock,
    pack: DEFAULT_PACK,
    lookAmount: 100,
    lookBlend: 'normal',
    push: 0,
    scanner,
    exposure: 0,
    contrast: 0,
    toneCharacter: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    texture: 0,
    clarity: 0,
    dehaze: 0,
    dehazeDistance: 20,
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
    grading: null,
    lens: null,
    transform: null,
    masks: [],
  };
}

/**
 * Switch stock (look). A look never moves a slider (Lightroom's model): grain, its size and
 * halation stay as they are, and a first edit starts from the defaults.
 */
export function withStock(recipe: Recipe | null, stock: StockId): Recipe {
  return { ...(recipe ?? defaultRecipe()), stock, lookSnapshot: undefined, lookEnabled: stock !== 'neutral' };
}

/** Reset the sliders, keeping stock, development, scanner, crop and masks. */
export function resetAdjustments(recipe: Recipe): Recipe {
  return { ...defaultRecipe(recipe.stock, recipe.scanner), profile: recipe.profile, lookEnabled: recipe.lookEnabled, pack: recipe.pack, lookAmount: recipe.lookAmount, lookBlend: recipe.lookBlend, push: recipe.push, scannerFromLook: recipe.scannerFromLook, lookSnapshot: recipe.lookSnapshot, crop: recipe.crop, transform: recipe.transform, masks: recipe.masks };
}

/**
 * Another frame's settings applied to this one. The crop and masks stay this frame's own:
 * they belong to the composition, and frames differ in shape and content.
 */
export const withSettingsFrom = (from: Recipe, target: Recipe | null): Recipe => ({ ...from, profile: target?.profile ?? 'auto', crop: target?.crop ?? null, transform: target?.transform ?? null, masks: target?.masks ?? [] });

/** Panel sections that can be reset on their own. */
export type SectionId = 'masks' | 'development' | 'scanner' | 'crop' | 'transform' | 'adjust' | 'curve' | 'color' | 'grading' | 'lens' | 'whitebalance' | 'colour-basics' | 'tone' | 'exposure' | 'hdr' | 'refine-optics' | 'detail' | 'optics' | 'grain';

const SECTION_FIELDS: Record<SectionId, (keyof Recipe)[]> = {
  masks: ['masks'],
  development: ['push'],
  scanner: ['scanner', 'scannerFromLook'],
  crop: ['crop'],
  transform: ['transform'],
  adjust: ['wb', ...SLIDERS.filter((d) => d.group === 'adjust').map((d) => d.key)],
  curve: ['curve'],
  color: ['color'],
  grading: ['grading', 'shadows', 'saturation'],
  lens: ['lens'],
  whitebalance: ['wb'],
  exposure: ['exposure', 'contrast', 'toneCharacter', 'saturation', 'vibrance'],
  hdr: ['highlights', 'shadows', 'whites', 'blacks'],
  'refine-optics': ['fade', ...SLIDERS.filter(d => d.group === 'optics').map(d => d.key)],
  'colour-basics': ['vibrance', 'saturation'],
  tone: SLIDERS.filter(d => d.group === 'adjust' && d.key !== 'vibrance' && d.key !== 'saturation').map(d => d.key),
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
  // A look needs a pack that supplies it. Edits made with Emulsion's retired parametric stocks
  // (no pack, or pack "emulsion") open as Neutral.
  // Custom looks and LUT files may not be listed yet: hold their place (and update older ids).
  const user = resolveUserLook(o.pack, o.stock);
  const pack: PackId = user?.pack ?? (isPackId(o.pack) ? o.pack : DEFAULT_PACK);
  const supplied = !!user || (isStockId(o.stock) && isPackId(o.pack) && !!PACK[pack].looks[o.stock]);
  const stock: StockId = user?.stock ?? (supplied ? o.stock as StockId : DEFAULT_STOCK);
  const scanner: ScannerId = isScannerId(o.scanner) ? o.scanner : 'frontier';
  const base = defaultRecipe(stock, scanner);
  const push = typeof o.push === 'number' && [-1, 0, 1, 2].includes(o.push) ? (o.push as Push) : 0;
  const lookEnabled = supplied && (typeof o.lookEnabled === 'boolean' ? o.lookEnabled : true);
  const out: Recipe = { ...base, profile: normalizeProfile(o.profile), lookEnabled, pack, push, lookBlend: o.lookBlend === 'color' ? 'color' : 'normal', curve: normalizeCurve(o.curve), wb: normalizeWhiteBalance(o.wb), crop: normalizeCrop(o.crop), color: normalizeColor(o.color), grading: normalizeGrading(o.grading), lens: normalizeLens(o.lens), transform: normalizePerspective(o.transform), masks: normalizeMasks(o.masks) };
  // Capture sharpening was saved as `sharpening` before the unsharp mask came.
  const read = (key: string) => (key === 'captureSharpening' && o.captureSharpening === undefined ? o.sharpening : o[key]);
  for (const def of SLIDERS) {
    const v = read(def.key);
    if (typeof v === 'number' && Number.isFinite(v)) out[def.key] = clamp(v, def.min, def.max);
  }
  if (typeof o.scannerFromLook === 'boolean') out.scannerFromLook = o.scannerFromLook;
  const snap = o.lookSnapshot as Recipe['lookSnapshot'];
  if (snap && typeof snap.id === 'string' && typeof snap.name === 'string' && Number.isSafeInteger(snap.revision)) {
    const settings = normalizeSettings(snap.settings);
    if (settings) out.lookSnapshot = { id: snap.id, name: snap.name, revision: snap.revision, kind: snap.kind === 'lut' || snap.kind === 'look' ? snap.kind : settings.colorBalance || settings.curve || settings.scanner && settings.scanner !== 'straight' ? 'look' : 'lut', settings };
  }
  return captureLook(out);
}

export const recipeKey = (r: Recipe | null) => (r ? JSON.stringify(r) : 'original');
