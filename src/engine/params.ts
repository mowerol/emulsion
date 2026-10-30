// SPDX-License-Identifier: GPL-3.0-or-later
// Recipe to shader uniforms. Pure, so it can be tested without a GPU.

import { STOCK } from '../film/stocks';
import { SCANNER } from '../film/scanners';
import type { Recipe } from '../film/recipe';
import type { Vec3 } from '../film/stocks';
import { LUMA_REC2020, REC2020_TO_SRGB, SRGB_TO_REC2020, columnMajor, mulVec } from './color';
import { NEUTRAL, curveFor, packCurve, sigmoidCurve, whiteTargetFor, type ToneLook } from './tone';
import {
  CONTRAST_FULCRUM,
  HIGHLIGHTS_WEIGHT,
  MASK_GREY_FULCRUM,
  SHADOWS_WEIGHT,
  GRADING_TO_LMS,
  LMS_TO_GRADING,
  LMS_TO_XYZ,
  REC2020_TO_LMS,
  REC2020_TO_XYZ,
  WHITE_FULCRUM,
  XYZ_TO_REC2020,
  colorBalanceParams,
  workingGamut,
  yToLStar,
} from './colorbalance';
import { isIdentity } from '../film/curve';
import { D65_XY, whiteBalanceMatrix, whiteXy, type Xy } from './whitebalance';
import { grainShape, type GrainShape } from './grain';
import { EXPOSURE_BOOST, FEATHERING, SMOOTHING, bandFactors, bandGains } from './toneequalizer';
import { clarityParams } from './locallaplacian';

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
}

const WORKING = columnMajor(SRGB_TO_REC2020);
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const NEUTRAL_CURVE = packCurve(sigmoidCurve(NEUTRAL));

/** Lowering Blacks to -100 cuts scene light below this, about 4.5 stops under middle grey. */
export const MAX_BLACK_LEVEL = 0.008;
const DISPLAY = columnMajor(REC2020_TO_SRGB);

/** Colour balance constants: matrices, reference values and the gamut table. */
let colorBalanceBase: Uniforms | null = null;
export const colorBalanceUniforms = () =>
  (colorBalanceBase ??= {
    uCbRgbToLms: columnMajor(REC2020_TO_LMS),
    uCbLmsToXyz: columnMajor(LMS_TO_XYZ),
    uCbXyzToRgb: columnMajor(XYZ_TO_REC2020),
    uCbLmsToGrading: columnMajor(LMS_TO_GRADING),
    uCbGradingToLms: columnMajor(GRADING_TO_LMS),
    uCbRef: [CONTRAST_FULCRUM, yToLStar(WHITE_FULCRUM)],
    uCbMask: [MASK_GREY_FULCRUM, SHADOWS_WEIGHT, HIGHLIGHTS_WEIGHT],
    uCbGamut: Array.from(workingGamut()),
    uLlToXyz: columnMajor(REC2020_TO_XYZ),
    uLlFromXyz: columnMajor(XYZ_TO_REC2020),
    uLlWhite: mulVec(REC2020_TO_XYZ, [1, 1, 1]),
  });

/** Grain amount at which the model shows its full physical strength; the slider goes to twice that. */
export const GRAIN_FULL = 50;

/** Grain for a recipe at an output long edge: its Size and Roughness sliders, with push or pull on top. */
export function grainShapeFor(recipe: Recipe, longEdge: number): GrainShape {
  return grainShape(recipe.grainSize, recipe.grainRough, recipe.push, longEdge);
}

/** The tone stage's look: stock contrast with push, crossover, whites and blacks. */
export function toneLookFor(recipe: Recipe): ToneLook {
  const s = STOCK[recipe.stock];
  return {
    contrast: s.contrast * (1 + 0.09 * recipe.push),
    channels: s.crossover.map((d) => Math.max(0.2, 1 + d)) as Vec3,
    whites: recipe.whites,
    blacks: recipe.blacks,
  };
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
  };
  if (!recipe || ctx.compare) {
    return { ...base, uCompare: 1, uExposure: 0, uExpBlack: 0, uWbMat: IDENTITY, uWB: [1, 1, 1], uBW: 0, uTeqOn: 0, uCurveOn: 0, uClarityOn: 0, uTextureOn: 0, uUsmOn: 0, uCeOn: 0 };
  }

  const s = STOCK[recipe.stock];
  const sc = SCANNER[recipe.scanner];
  const push = recipe.push;

  // The stock's own colour balance, normalised to keep luminance.
  const gains = s.balance;
  const lum = gains[0] * LUMA_REC2020[0] + gains[1] * LUMA_REC2020[1] + gains[2] * LUMA_REC2020[2];
  const wbMat = recipe.wb ? columnMajor(whiteBalanceMatrix(ctx.white ?? D65_XY, whiteXy(recipe.wb.temperature, recipe.wb.tint))) : IDENTITY;

  const look = toneLookFor(recipe);
  const teqOn = recipe.highlights !== 0;
  const teq = teqOn ? bandFactors(bandGains(recipe.highlights)) : [0, 0, 0, 0, 0, 0, 0, 0];
  const cb = colorBalanceParams(recipe.contrast, recipe.vibrance, recipe.saturation, recipe.shadows);
  const grain = grainShapeFor(recipe, Math.max(ctx.width, ctx.height));

  return {
    ...base,
    ...colorBalanceUniforms(),
    uCbParams: [1 + cb.contrast, cb.vibrance, cb.saturation, cb.shadows],
    uCompare: 0,
    uExposure: recipe.exposure,
    uCurveOn: isIdentity(recipe.curve) ? 0 : 1,
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
    uSigS: packCurve(curveFor(look.contrast, look)),
    uSigR: packCurve(curveFor(look.contrast * look.channels[0], look)),
    uSigG: packCurve(curveFor(look.contrast * look.channels[1], look)),
    uSigB: packCurve(curveFor(look.contrast * look.channels[2], look)),
    uSigMag: whiteTargetFor(recipe.whites) / 100,
    uWbMat: wbMat,
    uWB: gains.map((g) => g / lum),
    uVig: recipe.vignette / 100,
    uSharp: sc.sharpness,
    uHal: recipe.halation / 100,
    uHalCol: s.halationColor,
    uGlow: recipe.glow / 100,
    uMat: columnMajor(s.matrix),
    uBW: s.bw ? 1 : 0,
    uBWw: s.bwWeights ?? LUMA_REC2020,
    uSat: Math.max(0, s.saturation * (1 + 0.04 * push)),
    uStockFade: s.fade,
    uGrainA: [grain.kappa, grain.clump, grain.size, recipe.grain / GRAIN_FULL],
    // Halved: dye-layer grain on colour negative film is muted, not like sensor colour noise.
    uChroma: s.bw ? 0 : 0.5 * s.grainChroma,
    uScC: sc.contrast,
    uScSat: sc.saturation,
    uScBlack: sc.black,
    uScWhite: sc.white,
    uScGain: sc.gain,
    uScShadow: sc.shadowTint,
    uScHigh: sc.highlightTint,
    uFade: (recipe.fade / 100) * 0.16,
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
