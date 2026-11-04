// SPDX-License-Identifier: GPL-3.0-or-later
// Recipe to shader uniforms. Pure, so it can be tested without a GPU.

import { STOCK } from '../film/stocks';
import { scannerFinish } from '../film/scannerfinish';
import type { Recipe } from '../film/recipe';
import { REC2020_TO_SRGB, SRGB_TO_REC2020, columnMajor, mulVec } from './color';
import { NEUTRAL, packCurve, sigmoidCurve, toneCurveFor, whiteTargetFor } from './tone';
import {
  CB_DEFAULTS,
  GRADING_TO_LMS,
  LMS_TO_GRADING,
  LMS_TO_XYZ,
  REC2020_TO_LMS,
  REC2020_TO_XYZ,
  XYZ_TO_REC2020,
  cbCommit,
  cbUniform,
  colorBalanceParams,
  sliderParams,
  workingGamut,
} from './colorbalance';
import { isIdentity } from '../film/curve';
import { lookColorFor, scaledColorBalance } from '../film/creative';
import { profileSettingsFor } from '../film/looks';
import { D65_XY, clampWhiteBalance, temperatureTint, whiteBalanceMatrix, whiteXy, type Xy } from './whitebalance';
import { packRanges, packShapes } from './masks';
import { MASK_UNIT } from './maskstack';
import { NO_ADJUST, maskActive, type Mask } from '../film/masks';
import { effectiveIso, zoomForIso } from './grain';
import { EXPOSURE_BOOST, FEATHERING, SMOOTHING, bandFactors, bandGains } from './toneequalizer';
import { clarityParams } from './locallaplacian';
import type { LoadedLut } from './lutstore';

export type UniformValue = number | number[];
export type Uniforms = Record<string, UniformValue>;

export enum InputMode {
  /** Linear light, sRGB primaries, display-referred. Decoded photos. */
  DisplayLinear = 0,
  /** sRGB-encoded, display-referred. 8-bit thumbnails. */
  DisplayEncoded = 1,
  /** Scene-linear Rec.2020. RAW, decoded by LibRaw. */
  SceneLinear = 2,
}

/** Scene luminance above which highlights cause halation, about two stops over middle grey. */
export const HALATION_THRESHOLD = 0.75;

export interface RenderContext {
  width: number;
  height: number;
  seed: number;
  inputMode: InputMode;
  /** Scale for storing scene values in intermediate textures (1 for float targets). */
  store: number;
  /** Show the original instead of the developed frame. */
  compare?: boolean;
  /** The source's as-shot white point; D65 when unknown or not a RAW. */
  white?: Xy | null;
  /** The stock's LUT in the recipe's pack, when it has one and it has loaded. */
  look?: LoadedLut | null;
  /** Show this mask (its index in the recipe's list) as an overlay. */
  maskShow?: number | null;
}

/** Texture unit of the look LUT (0-6 and 8-10 are taken; 7 is for uploads, and holds the brush mask during masked draws). */
export const LUT_UNIT = 11;

const WORKING = columnMajor(SRGB_TO_REC2020);
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const NEUTRAL_CURVE = packCurve(sigmoidCurve(NEUTRAL));

/** Lowering Blacks to -100 cuts scene light below this, about 4.5 stops under middle grey. */
export const MAX_BLACK_LEVEL = 0.008;
const DISPLAY = columnMajor(REC2020_TO_SRGB);
/** A colour balance instance that does nothing (a saved profile's, when it has none). */
const CB_NONE = cbUniform(cbCommit(CB_DEFAULTS));

/** Colour balance constants: matrices, reference values and the gamut table. */
let colorBalanceBase: Uniforms | null = null;
export const colorBalanceUniforms = () =>
  (colorBalanceBase ??= {
    uCbRgbToLms: columnMajor(REC2020_TO_LMS),
    uCbLmsToXyz: columnMajor(LMS_TO_XYZ),
    uCbXyzToRgb: columnMajor(XYZ_TO_REC2020),
    uCbLmsToGrading: columnMajor(LMS_TO_GRADING),
    uCbGradingToLms: columnMajor(GRADING_TO_LMS),
    uCbGamut: Array.from(workingGamut()),
    uLlToXyz: columnMajor(REC2020_TO_XYZ),
    uLlFromXyz: columnMajor(XYZ_TO_REC2020),
    uLlWhite: mulVec(REC2020_TO_XYZ, [1, 1, 1]),
  });

/** darktable's grain for a recipe: [strength 0-1, noise zoom, paper delta, per-photo offset]. */
export function grainUniform(recipe: Recipe, seed: number): number[] {
  const d = 2 * Math.exp((recipe.grainMidtones / 100) * Math.log(0.0001));
  return [recipe.grain / 100, zoomForIso(effectiveIso(recipe.grainIso, recipe.push)), d, seed];
}

/** What the develop shader needs, shared with the extraction pass. */
export function developUniforms(recipe: Recipe | null, ctx: RenderContext): Uniforms {
  const base: Uniforms = {
    uInputMode: ctx.inputMode,
    uToWorking: WORKING,
    uToDisplay: DISPLAY,
    uSigN: NEUTRAL_CURVE,
    uOut: [ctx.width, ctx.height],
    // The whole source; a region render sets its own (docs/plans/roi.md).
    uRoi: [0, 0, 1, 1],
    uCeRoi: [0, 0, 1, 1],
    uStore: ctx.store,
    uSeed: ctx.seed,
    uHalThreshold: HALATION_THRESHOLD,
    uLutTex: LUT_UNIT,
    uLutOn: 0,
    uLutColor: 0,
    uDcpOn: 0,
    uDcpHasCurve: 0,
  };
  if (!recipe || ctx.compare) {
    return { ...base, ...NO_MASKS, uCompare: 1, uExposure: 0, uExpBlack: 0, uWbMat: IDENTITY, uTeqOn: 0, uCurveOn: 0, uClarityOn: 0, uClarityScale: 1, uTextureOn: 0, uUsmOn: 0, uCeOn: 0 };
  }

  // The look's LUT, applied to the camera profile's print.
  const lut = recipe.lookEnabled ? ctx.look ?? null : null;
  const s = STOCK[recipe.stock];
  const sc = scannerFinish(recipe);
  const wbMat = recipe.wb ? columnMajor(whiteBalanceMatrix(ctx.white ?? D65_XY, whiteXy(recipe.wb.temperature, recipe.wb.tint))) : IDENTITY;

  const teqOn = recipe.highlights !== 0;
  const teq = teqOn ? bandFactors(bandGains(recipe.highlights)) : [0, 0, 0, 0, 0, 0, 0, 0];
  const cb = colorBalanceParams(recipe.contrast, recipe.vibrance, recipe.saturation, recipe.shadows);
  // A custom look's hidden settings, scaled by its Amount.
  const profile = profileSettingsFor(recipe);
  const profileCb = scaledColorBalance(profile, recipe.lookAmount / 100);

  return {
    ...base,
    ...colorBalanceUniforms(),
    uCbP: cbUniform(cbCommit({ ...sliderParams(cb), ...recipe.grading })),
    uCbL: profileCb ? cbUniform(cbCommit(profileCb)) : CB_NONE,
    uCbLOn: profileCb ? 1 : 0,
    ...maskUniforms(recipe.masks, recipe, ctx),
    uCompare: 0,
    uExposure: recipe.exposure,
    uCurveOn: isIdentity(recipe.curve) && (isIdentity(profile?.curve ?? null) || recipe.lookAmount === 0) ? 0 : 1,
    uTeqOn: teqOn ? 1 : 0,
    uClarityOn: recipe.clarity !== 0 ? 1 : 0,
    uClarityScale: 1,
    uDehazeOn: recipe.dehaze !== 0 ? 1 : 0,
    uDehazeStrength: recipe.dehaze / 100,
    uDehazeDistance: recipe.dehazeDistance / 100,
    // The engine measures the ambient light and sets the minimum transmission (Engine.dehazeMap).
    uDehazeA0: [1, 1, 1],
    uDehazeTmin: 1,
    uTextureOn: recipe.texture !== 0 ? 1 : 0,
    uTextureMix: recipe.texture / 100,
    uUsmOn: recipe.sharpen > 0 ? 1 : 0,
    uCeOn: recipe.color || lookColorFor(recipe) ? 1 : 0,
    uLl: llParams(recipe.clarity),
    uTeqF0: teq.slice(0, 4),
    uTeqF1: teq.slice(4, 8),
    uTeqParams: [EXPOSURE_BOOST, FEATHERING, 2 * SMOOTHING * SMOOTHING],
    uExpBlack: recipe.blacks < 0 ? (-recipe.blacks / 100) * MAX_BLACK_LEVEL : 0,
    uProfileTargetsOn: recipe.whites !== 0 || recipe.blacks > 0 || recipe.toneCharacter !== 0 ? 1 : 0,
    uSigS: packCurve(toneCurveFor(recipe.whites, recipe.blacks, recipe.toneCharacter)),
    uSigMag: whiteTargetFor(recipe.whites) / 100,
    uWbMat: wbMat,
    uVig: recipe.vignette / 100,
    uSharp: sc.sharpness,
    uHal: recipe.halation / 100,
    uHalCol: s.halationColor,
    uGlow: recipe.glow / 100,
    uGrain: grainUniform(recipe, ctx.seed),
    uScC: sc.contrast,
    uScSat: sc.saturation,
    uScBlack: sc.black,
    uScWhite: sc.white,
    uScGain: sc.gain,
    uScShadow: sc.shadowTint,
    uScHigh: sc.highlightTint,
    uFade: (recipe.fade / 100) * 0.16,
    // A custom look's LUT at its share within the look, times the look's Amount.
    ...(lut ? {
      uLutOn: 1, uLutId: lut.id, uLutAmount: (recipe.lookAmount / 100) * (profile?.lut?.amount ?? 1),
      // A custom look blends its LUT as it was saved; a LUT chosen directly, as the photo says.
      uLutColor: (profile ? profile.lut?.blend === 'color' : recipe.lookBlend === 'color') ? 1 : 0,
    } : {}),
  };
}

const NO_MASKS: Uniforms = { uTeqTiles: 1, uMaskCount: 0, uMaskShapeCount: 0, uMaskShow: -1, uMaskStack: MASK_UNIT, uMaskTap: -1, uMaskObjectLayer: 0 };

/**
 * The masks' shapes and their adjustments. Temperature moves the photo's white by that many
 * mireds (positive warmer) and tint adds to its tint; the mask's CAT16 goes from the photo's
 * white to that one, which is the photo's own white balance with the moved white, inside the mask.
 */
export function maskUniforms(masks: Mask[], recipe: Recipe, ctx: Pick<RenderContext, 'white' | 'maskShow'>): Uniforms {
  const show = ctx.maskShow ?? -1;
  const { shapes, count, index } = packShapes(masks, show);
  if (!index.length) return NO_MASKS;
  const asShot = ctx.white ?? D65_XY;
  const chosen = recipe.wb ? whiteXy(recipe.wb.temperature, recipe.wb.tint) : asShot;
  let chosenTT: { temperature: number; tint: number } | null = null;
  const meta: number[] = [];
  const wb: number[] = [];
  const cb: number[] = [];
  const range: number[] = [];
  const rangeOn: number[] = [];
  const teq: number[] = [];
  const local: number[] = [];
  // The tone equalizer's map atlas: tile 0 is the photo's instance, then one per masked instance.
  let teqTile = 0;
  for (const i of index) {
    const r = packRanges(masks[i]);
    range.push(...r.points);
    rangeOn.push(...r.flags);
    // A mask that is only shown changes nothing.
    const m = maskActive(masks[i]) ? masks[i] : { ...masks[i], ...NO_ADJUST };
    const cbOn = m.contrast !== 0 || m.vibrance !== 0 || m.saturation !== 0 || m.shadows !== 0;
    meta.push(Math.min(1, Math.max(0, m.opacity / 100)), 2 ** m.exposure, cbOn ? 1 : 0, 0);
    if (m.temperature !== 0 || m.tint !== 0) {
      chosenTT ??= recipe.wb ?? temperatureTint(chosen);
      const moved = clampWhiteBalance({ temperature: 1e6 / (1e6 / chosenTT.temperature - m.temperature), tint: chosenTT.tint + m.tint });
      wb.push(...columnMajor(whiteBalanceMatrix(chosen, whiteXy(moved.temperature, moved.tint))));
    } else wb.push(...IDENTITY);
    const teqOn = m.highlights !== 0;
    teq.push(...(teqOn ? bandFactors(bandGains(m.highlights)) : [0, 0, 0, 0, 0, 0, 0, 0]));
    local.push(teqOn ? 1 : 0, teqOn ? ++teqTile : 0, 0, 0);
    cb.push(...(cbOn ? cbUniform(cbCommit(sliderParams(colorBalanceParams(m.contrast, m.vibrance, m.saturation, m.shadows)))) : CB_NONE));
  }
  return {
    uMaskCount: index.length, uMaskShapeCount: count, uMaskShapes: shapes, uMaskMeta: meta, uMaskWb: wb, uMaskCb: cb,
    uMaskTeq: teq, uMaskLocal: local, uTeqTiles: teqTile + 1,
    uMaskRange: range, uMaskRangeOn: rangeOn, uMaskToXyz: columnMajor(REC2020_TO_XYZ), uMaskStack: MASK_UNIT, uMaskTap: -1,
    uMaskShow: index.indexOf(show),
  };
}

/** Whether a recipe needs the highlight and sharpening passes at all. */
export function needsPasses(u: Uniforms) {
  return {
    highlights: u.uCompare !== 1 && ((u.uHal as number) > 0 || (u.uGlow as number) > 0),
    sharpen: u.uCompare !== 1 && (u.uSharp as number) !== 0,
    toneEqualizer: u.uCompare !== 1 && (u.uTeqOn === 1 || (u.uTeqTiles as number) > 1),
    clarity: u.uCompare !== 1 && u.uClarityOn === 1,
    texture: u.uCompare !== 1 && u.uTextureOn === 1,
    usm: u.uCompare !== 1 && u.uUsmOn === 1,
    colorEq: u.uCompare !== 1 && u.uCeOn === 1,
  };
}

/** The clarity filter's parameters for the Clarity slider: sigma, shadows, highlights, clarity. */
export function llParams(clarity: number): [number, number, number, number] {
  const p = clarityParams(clarity);
  return [p.sigma, p.shadows, p.highlights, p.clarity];
}
