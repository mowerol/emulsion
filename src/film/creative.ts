// SPDX-License-Identifier: GPL-3.0-or-later
// Custom looks' hidden settings. A custom look carries colour and tone settings that apply without
// moving the photo's sliders, plus optionally a LUT (a system look's, or a file of the user's own);
// its Amount scales all of it. The settings run at their usual places in the pipeline: the colour
// balance as a second instance just before the photo's own, the curve composed in front of the
// photo's own curve. A look can also author one scanner finish; grain stays on the photo.

import { CB_DEFAULTS, colorBalanceParams, sliderParams, type CbParams } from '../engine/colorbalance';
import { CURVE_RES, curveTable, isIdentity, normalizeCurve, type ToneCurve } from './curve';
import { isScannerId, type ScannerId } from './scanners';
import { normalizeGrading } from './grading';
import { normalizeColor, tidyColor, type ColorAdjust, type Recipe } from './recipe';
import { profileSettingsFor, registerFileLut } from './looks';

/**
 * A custom look's LUT, with how much of it applies (0 to 1): a system look it refers to, or a LUT
 * file of the user's own (by content hash).
 */
export type LutSource = (
  | { kind: 'pack'; pack: string; stock: string; amount: number }
  | { kind: 'file'; hash: string; amount: number }
) & {
  /** 'color' takes only the LUT's hue and saturation (darktable's color blend mode); absent is normal. */
  blend?: 'color';
  /** File LUT generated from a reference photo; only its display name is kept. */
  photoMatch?: string;
};

export interface ProfileSettings {
  /** A colour balance rgb instance, darktable's units (the photo's own sliders and grading, combined). */
  colorBalance: Partial<CbParams> | null;
  curve: ToneCurve | null;
  lut: LutSource | null;
  scanner?: ScannerId;
  /** HSL: a colour equalizer instance before the photo's own (absent when every value is 0). */
  color?: ColorAdjust;
}

/** The recipe fields a profile takes over when it is saved from a photo. */
export const PROFILE_FIELDS = ['contrast', 'vibrance', 'saturation', 'shadows', 'grading', 'curve', 'color'] as const;

/** The colour balance settings Amount scales towards darktable's defaults. Hues, weights and fulcrums stay. */
const SCALED = /(_Y|_C)$|^(chroma|saturation|brilliance)_|^(vibrance|contrast|hue_angle)$/;

/** The photo's colour and tone settings, as a profile's hidden settings. */
export function settingsFromRecipe(r: Recipe, lut: LutSource | null): ProfileSettings {
  const cb: CbParams = { ...sliderParams(colorBalanceParams(r.contrast, r.vibrance, r.saturation, r.shadows)), ...r.grading };
  const changed = Object.fromEntries(
    (Object.keys(cb) as (keyof CbParams)[]).filter((k) => cb[k] !== CB_DEFAULTS[k] && k !== 'grey_fulcrum').map((k) => [k, cb[k]]),
  ) as Partial<CbParams>;
  const any = Object.keys(changed).length > 0;
  return {
    // The contrast fulcrum is the photo's (Emulsion's middle grey unless Colour Grading moved it).
    colorBalance: any ? { ...changed, grey_fulcrum: cb.grey_fulcrum } : null,
    curve: isIdentity(r.curve) ? null : r.curve,
    lut,
    ...(r.scanner !== 'straight' ? { scanner: r.scanner } : {}),
    ...(tidyColor(r.color) ? { color: structuredClone(r.color!) } : {}),
  };
}

/**
 * The photo with a look's settings on its own sliders, and the look's LUT chosen directly (a LUT file
 * through the hidden LUT file collection): how a look is edited, and how it is detached. Exact when
 * the photo's own colour sliders are at rest, which `colourAtRest` tells.
 */
export function recipeFromSettings(r: Recipe, s: ProfileSettings): Recipe {
  if (s.lut?.kind === 'file' && s.lut.photoMatch) registerFileLut(s.lut.hash, undefined, s.lut.photoMatch);
  const cb = s.colorBalance ?? {};
  const out: Recipe = {
    ...r,
    contrast: (cb.contrast ?? 0) * 100,
    vibrance: (cb.vibrance ?? 0) * 100,
    saturation: (cb.saturation_global ?? 0) * 100,
    shadows: (cb.shadows_Y ?? 0) * 100,
    grading: normalizeGrading(cb),
    curve: s.curve,
    color: s.color ? structuredClone(s.color) : null,
    scanner: s.scanner ?? 'straight',
    scannerFromLook: false,
  };
  return withLutBase(out, s.lut);
}

/** Set an editor's optional raw LUT without changing its authored sliders or scanner. */
export function withLutBase(r: Recipe, lut: LutSource | null): Recipe {
  const out = { ...r, lookSnapshot: undefined };
  if (!lut) return { ...out, lookEnabled: false, stock: 'neutral', lookAmount: 100 };
  const lookAmount = lut.amount * 100;
  const lookBlend = lut.blend === 'color' ? 'color' : 'normal';
  return lut.kind === 'pack'
    ? { ...out, lookEnabled: true, pack: lut.pack as Recipe['pack'], stock: lut.stock as Recipe['stock'], lookAmount, lookBlend }
    : { ...out, lookEnabled: true, pack: 'files', stock: `lut:file:${lut.hash}`, lookAmount, lookBlend };
}

/** Whether the photo's own colour and tone sliders (the ones a look's settings use) are at rest. */
export const colourAtRest = (r: Recipe) =>
  r.contrast === 0 && r.vibrance === 0 && r.saturation === 0 && r.shadows === 0 && !r.grading && isIdentity(r.curve) && !r.color;

/** The photo with the settings a profile took over back at rest (the profile now supplies them). */
export function withoutProfileFields(r: Recipe): Recipe {
  return { ...r, contrast: 0, vibrance: 0, saturation: 0, shadows: 0, grading: null, curve: null, color: null };
}

/** A look's settings at `amount` (0 to 1), as fixed settings: how a look at less than full Amount is detached. */
export function scaledSettings(s: ProfileSettings, amount: number): ProfileSettings {
  const cb = scaledColorBalance(s, amount);
  const changed = cb && Object.fromEntries((Object.keys(cb) as (keyof CbParams)[]).filter((k) => cb[k] !== CB_DEFAULTS[k]).map((k) => [k, cb[k]]));
  // A curve at part strength is a blend with the straight line; scaling its points matches that closely.
  const curve = s.curve && amount < 1
    ? Object.fromEntries(Object.entries(s.curve).map(([k, pts]) => [k, pts.map(([x, y]) => [x, x + (y - x) * amount])])) as ToneCurve
    : s.curve;
  return {
    colorBalance: changed && Object.keys(changed).length ? changed : null,
    curve: amount > 0 ? curve : null,
    lut: s.lut && { ...s.lut, amount: s.lut.amount * amount },
    ...(s.scanner ? { scanner: s.scanner } : {}),
    ...(scaledColor(s.color, amount) ? { color: scaledColor(s.color, amount)! } : {}),
  };
}

/**
 * A look's HSL at `amount` (0 to 1): every hue, saturation and brightness value scaled towards 0,
 * as the colour balance instance's are. Null when nothing is left.
 */
export function scaledColor(c: ColorAdjust | null | undefined, amount: number): ColorAdjust | null {
  if (!c || amount <= 0) return null;
  const k = Math.min(amount, 1);
  return tidyColor(k === 1 ? c : { hue: c.hue.map((v) => v * k), sat: c.sat.map((v) => v * k), bright: c.bright.map((v) => v * k) });
}

/** The HSL of the recipe's look (its colour equalizer instance before the photo's), at the look's Amount. */
export const lookColorFor = (r: Recipe): ColorAdjust | null => scaledColor(profileSettingsFor(r)?.color, r.lookAmount / 100);

export const hasSettings = (s: ProfileSettings | null | undefined) => !!s && (!!s.colorBalance || !!s.curve || !!s.color || !!s.scanner && s.scanner !== 'straight');

/** A profile's colour balance at `amount` (0 to 1), or null when it has none. */
export function scaledColorBalance(s: ProfileSettings | null, amount: number): CbParams | null {
  if (!s?.colorBalance) return null;
  const out = { ...CB_DEFAULTS, ...s.colorBalance };
  for (const k of Object.keys(out) as (keyof CbParams)[]) {
    if (SCALED.test(k)) out[k] = CB_DEFAULTS[k] + (out[k] - CB_DEFAULTS[k]) * amount;
  }
  return out;
}

/** Linear interpolation in a 256-step table, as the GPU's filtered texture read does. */
function at(table: Float32Array, k: number, v: number): number {
  const s = Math.min(Math.max(v, 0), 1) * (CURVE_RES - 1);
  const i = Math.min(Math.floor(s), CURVE_RES - 2);
  const f = s - i;
  return table[i * 4 + k] * (1 - f) + table[(i + 1) * 4 + k] * f;
}

/**
 * The curve stage's table: the profile's curve at `amount` (a blend with the straight line), then the
 * photo's own curve. Each channel's master-then-channel curve is folded into the channel's column;
 * the master column is the straight line. Null when neither has a curve.
 */
export function composedCurveTable(own: ToneCurve | null, profile: ToneCurve | null, amount: number): Float32Array | null {
  const p = profile && amount > 0 && !isIdentity(profile) ? curveTable(profile) : null;
  const o = own && !isIdentity(own) ? curveTable(own) : null;
  if (!p) return o;
  const out = new Float32Array(CURVE_RES * 4);
  for (let i = 0; i < CURVE_RES; i++) {
    const x = i / (CURVE_RES - 1);
    out[i * 4] = x;
    for (let k = 1; k < 4; k++) {
      const viaProfile = x + (at(p, k, at(p, 0, x)) - x) * amount;
      out[i * 4 + k] = o ? at(o, k, at(o, 0, viaProfile)) : viaProfile;
    }
  }
  return out;
}

const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Hidden settings read from a saved profile file; anything unreadable is dropped. */
export function normalizeSettings(input: unknown): ProfileSettings | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  let colorBalance: Partial<CbParams> | null = null;
  if (o.colorBalance && typeof o.colorBalance === 'object') {
    const cb = o.colorBalance as Record<string, unknown>;
    // The recipe's grading normaliser clamps darktable's ranges; it knows every key but the sliders'.
    const graded = normalizeGrading(cb) ?? {};
    const sliders = Object.fromEntries((['contrast', 'vibrance', 'saturation_global', 'shadows_Y', 'grey_fulcrum'] as const)
      .filter((k) => finite(cb[k])).map((k) => [k, Math.min(Math.max(cb[k] as number, -1), 1)]));
    if (finite(cb.grey_fulcrum)) sliders.grey_fulcrum = cb.grey_fulcrum as number;
    const merged = { ...graded, ...sliders } as Partial<CbParams>;
    colorBalance = Object.keys(merged).length ? merged : null;
  }
  const color = normalizeColor(o.color);
  return { colorBalance, curve: normalizeCurve(o.curve), lut: normalizeLut(o.lut ?? (o.look && { kind: 'pack', ...(o.look as object) })), ...(isScannerId(o.scanner) ? { scanner: o.scanner } : {}), ...(color ? { color } : {}) };
}

/** A look's LUT read from a file. Looks saved first wrote a system look as `look: { pack, stock, amount }`. */
function normalizeLut(input: unknown): LutSource | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const amount = finite(o.amount) ? Math.min(Math.max(o.amount as number, 0), 1) : 1;
  const blend = o.blend === 'color' ? { blend: 'color' as const } : {};
  if (o.kind === 'pack' && typeof o.pack === 'string' && typeof o.stock === 'string') return { kind: 'pack', pack: o.pack, stock: o.stock, amount, ...blend };
  if (o.kind === 'file' && typeof o.hash === 'string' && /^[0-9a-f]{64}$/.test(o.hash)) return { kind: 'file', hash: o.hash, amount, ...blend,
    ...(typeof o.photoMatch === 'string' && o.photoMatch.trim() ? { photoMatch: o.photoMatch.trim().slice(0, 200) } : {}) };
  return null;
}

