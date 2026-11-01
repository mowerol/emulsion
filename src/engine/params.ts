// SPDX-License-Identifier: GPL-3.0-or-later
// Recipe to shader uniforms. Pure, so it can be tested without a GPU.

import { STOCK } from '../film/stocks';
import { SCANNER } from '../film/scanners';
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
import { scaledColorBalance } from '../film/creative';
import { profileSettingsFor } from '../film/looks';
import { D65_XY, whiteBalanceMatrix, whiteXy, type Xy } from './whitebalance';
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
}

/** Texture unit of the look LUT (0-6 and 8-10 are taken, 7 is for uploads). */
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
    uStore: ctx.store,
    uSeed: ctx.seed,
    uHalThreshold: HALATION_THRESHOLD,
    uLutTex: LUT_UNIT,
    uLutOn: 0,
    uDcpOn: 0,
    uDcpHasCurve: 0,
  };
  if (!recipe || ctx.compare) {
    return { ...base, uCompare: 1, uExposure: 0, uExpBlack: 0, uWbMat: IDENTITY, uTeqOn: 0, uCurveOn: 0, uClarityOn: 0, uTextureOn: 0, uUsmOn: 0, uCeOn: 0 };
  }

  // The look's LUT, applied to the camera profile's print.
  const lut = recipe.lookEnabled ? ctx.look ?? null : null;
  const s = STOCK[recipe.stock];
  const sc = SCANNER[recipe.scanner];
  const wbMat = recipe.wb ? columnMajor(whiteBalanceMatrix(ctx.white ?? D65_XY, whiteXy(recipe.wb.temperature, recipe.wb.tint))) : IDENTITY;

  const teqOn = recipe.highlights !== 0;
  const teq = teqOn ? bandFactors(bandGains(recipe.highlights)) : [0, 0, 0, 0, 0, 0, 0, 0];
  const cb = colorBalanceParams(recipe.contrast, recipe.vibrance, recipe.saturation, recipe.shadows);
  // A saved creative profile's hidden settings, scaled by its Amount.
  const profile = profileSettingsFor(recipe);
  const profileCb = scaledColorBalance(profile, recipe.lookAmount / 100);

  return {
    ...base,
    ...colorBalanceUniforms(),
    uCbP: cbUniform(cbCommit({ ...sliderParams(cb), ...recipe.grading })),
    uCbL: profileCb ? cbUniform(cbCommit(profileCb)) : CB_NONE,
    uCbLOn: profileCb ? 1 : 0,
    uCompare: 0,
    uExposure: recipe.exposure,
    uCurveOn: isIdentity(recipe.curve) && (isIdentity(profile?.curve ?? null) || recipe.lookAmount === 0) ? 0 : 1,
    uTeqOn: teqOn ? 1 : 0,
    uClarityOn: recipe.clarity !== 0 ? 1 : 0,
    uTextureOn: recipe.texture !== 0 ? 1 : 0,
    uTextureMix: recipe.texture / 100,
    uUsmOn: recipe.sharpen > 0 ? 1 : 0,
    uCeOn: recipe.color ? 1 : 0,
    uLl: llParams(recipe.clarity),
    uTeqF0: teq.slice(0, 4),
    uTeqF1: teq.slice(4, 8),
    uTeqParams: [EXPOSURE_BOOST, FEATHERING, 2 * SMOOTHING * SMOOTHING],
    uExpBlack: recipe.blacks < 0 ? (-recipe.blacks / 100) * MAX_BLACK_LEVEL : 0,
    uProfileTargetsOn: recipe.whites !== 0 || recipe.blacks > 0 ? 1 : 0,
    uSigS: packCurve(toneCurveFor(recipe.whites, recipe.blacks)),
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
    // A saved profile's LUT at the share it was saved with, times the profile's Amount.
    ...(lut ? { uLutOn: 1, uLutId: lut.id, uLutAmount: (recipe.lookAmount / 100) * (profile?.look?.amount ?? 1) } : {}),
  };
}

/** Whether a recipe needs the highlight and sharpening passes at all. */
export function needsPasses(u: Uniforms) {
  return {
    highlights: u.uCompare !== 1 && ((u.uHal as number) > 0 || (u.uGlow as number) > 0),
    sharpen: u.uCompare !== 1 && (u.uSharp as number) !== 0,
    toneEqualizer: u.uCompare !== 1 && u.uTeqOn === 1,
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
