// SPDX-License-Identifier: GPL-3.0-or-later
// Recipe to shader uniforms. Pure, so it can be tested without a GPU.

import { STOCK, type Mat3 } from '../film/stocks';
import { fujiShiftMatrix } from '../film/fujirecipe';
import { effectiveWb, fujiWhiteBalanceMatrix, type CameraWhites } from '../film/fujilooks';
import { GLOW_FILTERS, diffusionFraction, halationStrength } from './optics';
import { scannerFinish } from '../film/scannerfinish';
import type { Recipe } from '../film/recipe';
import { REC2020_TO_SRGB, SRGB_TO_REC2020, columnMajor, mulMat, mulVec } from './color';
import { BLACK_TOE_END, BLACK_TOE_SCALE, blackToeCurve, NEUTRAL, packCurve, sigmoidCurve, toneCurveFor, whiteTargetFor } from './tone';
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
import { greyApplies, greyWeights } from './greymix';
import { profileSettingsFor } from '../film/looks';
import { D65_XY, clampWhiteBalance, temperatureTint, whiteBalanceMatrix, whiteXy, type Xy } from './whitebalance';
import { packRanges, packShapes } from './masks';
import { MASK_UNIT } from './maskstack';
import { MAX_MASKS, NO_ADJUST, maskActive, type Mask } from '../film/masks';
import { effectiveIso, zoomForIso } from './grain';
import { EXPOSURE_BOOST, FEATHERING, SMOOTHING, bandFactors, bandGains } from './toneequalizer';
import { clarityParams } from './locallaplacian';
import type { LoadedLut } from './lutstore';
import { VIGNETTE_FEATHER, vignetteStrength } from './vignette';
import { adaptiveToneTransform, adaptiveBlackLift, legacyShadowValue, DEFAULT_TONE_ANALYSIS, type ToneControls } from './adaptivetone';

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
  /** A RAW's camera space to the working space, where a Fuji recipe's white balance shift acts. */
  cameraToWorking?: Mat3 | null;
  /** The camera's own Auto white and white balance presets, for a Fuji recipe's white balance. */
  camera?: CameraWhites;
  /** The stock's LUT in the recipe's pack, when it has one and it has loaded. */
  look?: LoadedLut | null;
  /** Show this mask (its index in the recipe's list) as an overlay. */
  maskShow?: number | null;
}

/** Texture unit of the look LUT (0-6 and 8-10 are taken; 7 is for uploads, and holds the brush mask during masked draws). */
export const LUT_UNIT = 11;
/** Texture unit of the masks' Glow fields, one layer per masked instance (a sampler2DArray). */
export const MASK_GLOW_UNIT = 13;

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

/** darktable's grain (Classic) for a recipe: [strength 0-1, noise zoom, paper delta, per-photo offset]. */
export function grainUniform(recipe: Recipe, seed: number): number[] {
  const d = 2 * Math.exp((recipe.grainMidtones / 100) * Math.log(0.0001));
  // Film grain is its own passes after the develop pass (filmgraingpu.ts).
  return [recipe.grainType === 'film' ? 0 : recipe.grain / 100, zoomForIso(effectiveIso(recipe.grainIso, recipe.push)), d, seed];
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
    // One 8-bit step of dither in Finish; a 16-bit export sets one 16-bit step.
    uDither: 1 / 255,
    uHalThreshold: HALATION_THRESHOLD,
    uLutTex: LUT_UNIT,
    uLutOn: 0,
    uLutColor: 0,
    uToneOn: 0,
    uTeqLegacy: 0,
    uToneControls: [0, 0, 0, 0],
    uToneCurve: new Array<number>(128).fill(0),
    uToneBlack: 0,
    uToneWhite: 1,
    uBlackToe: [0, 1],
    uBlackToeCurve: NEUTRAL_CURVE,
    // The engine sets the crop's own (Engine.render); without one the whole source is the crop.
    uVigScale: 1,
    uVigInner: (1 - VIGNETTE_FEATHER / 100) / Math.SQRT2,
    uVigGeoU: [1, 0, 0],
    uVigGeoV: [0, 1, 0],
    uVigGeoW: [0, 0, 1],
  };
  if (!recipe || ctx.compare) {
    return { ...base, ...NO_MASKS, uCompare: 1, uExposure: 0, uExpBlack: 0, uWbMat: IDENTITY, uTeqOn: 0, uCurveOn: 0, uClarityOn: 0, uClarityScale: 1, uTextureOn: 0, uUsmOn: 0, uCeOn: 0 };
  }

  // The look's LUT, applied to the camera profile's print.
  const lut = recipe.lookEnabled ? ctx.look ?? null : null;
  const s = STOCK[recipe.stock];
  const sc = scannerFinish(recipe);
  // The photo's own white balance, else its Fuji recipe's (film/fujilooks.ts).
  const chosenWb = effectiveWb(recipe, ctx.camera);
  const cameraWb = ctx.inputMode === InputMode.SceneLinear && ctx.white && ctx.cameraToWorking
    ? fujiWhiteBalanceMatrix(recipe, ctx.camera, ctx.white, ctx.cameraToWorking) : null;
  const photoWb = cameraWb ?? (chosenWb ? whiteBalanceMatrix(ctx.white ?? D65_XY, whiteXy(chosenWb.temperature, chosenWb.tint)) : null);
  // A Fuji recipe's white balance shift, on top of the photo's own white balance.
  const lookLut = profileSettingsFor(recipe)?.lut;
  const shift = lookLut?.kind === 'fuji' ? fujiShiftMatrix(lookLut.recipe.wbShift, ctx.cameraToWorking ?? null, recipe.lookAmount / 100) : null;
  const wb = shift && photoWb ? mulMat(shift, photoWb) : shift ?? photoWb;
  const wbMat = wb ? columnMajor(wb) : IDENTITY;

  const legacyHighlights = recipe.highlights !== 0 && recipe.toneVersions?.highlights !== 2;
  const teq = legacyHighlights ? bandFactors(bandGains(recipe.highlights)) : [0, 0, 0, 0, 0, 0, 0, 0];
  const cb = colorBalanceParams(recipe.contrast, recipe.vibrance, recipe.saturation, legacyShadowValue(recipe.shadows, recipe.toneVersions));
  // A custom look's hidden settings, scaled by its Amount.
  const profile = profileSettingsFor(recipe);
  const profileCb = scaledColorBalance(profile, recipe.lookAmount / 100);
  const tone: ToneControls = {
    shadows: (recipe.toneVersions?.shadows === 2 ? recipe.shadows : 0) + (profile?.adaptiveShadows ?? 0) * recipe.lookAmount / 100,
    highlights: recipe.toneVersions?.highlights === 2 ? recipe.highlights : 0,
    blacks: recipe.toneVersions?.blacks === 2 ? recipe.blacks : 0,
    whites: recipe.toneVersions?.whites === 2 ? recipe.whites : 0,
  };
  const toneOn = tone.shadows !== 0 || tone.highlights !== 0 || tone.whites !== 0 || tone.blacks < 0;
  const transform = adaptiveToneTransform(DEFAULT_TONE_ANALYSIS, tone);
  const legacyWhites = recipe.toneVersions?.whites === 2 ? 0 : recipe.whites;
  const legacyBlacks = recipe.toneVersions?.blacks === 2 ? 0 : recipe.blacks;
  const toeLift = recipe.toneVersions?.blacks === 2 ? adaptiveBlackLift(recipe.blacks) : 0;
  const printBlacks = Math.max(legacyBlacks, 0);

  return {
    ...base,
    ...colorBalanceUniforms(),
    uCbP: cbUniform(cbCommit({ ...sliderParams(cb), ...recipe.grading })),
    uCbL: profileCb ? cbUniform(cbCommit(profileCb)) : CB_NONE,
    uCbLOn: profileCb ? 1 : 0,
    // A black and white look's grey mixer, blended by the look's Amount (engine/greymix.ts).
    uGreyMix: greyWeights(greyApplies(profile?.grey) ? profile.grey : [0, 1, 0]),
    uGreyAmount: greyApplies(profile?.grey) ? (profile.greyAmount ?? 1) * recipe.lookAmount / 100 : 0,
    ...maskUniforms(recipe.masks, recipe, ctx),
    uCompare: 0,
    uExposure: recipe.exposure,
    uCurveOn: isIdentity(recipe.curve) && (isIdentity(profile?.curve ?? null) || recipe.lookAmount === 0) ? 0 : 1,
    uTeqOn: legacyHighlights || toneOn ? 1 : 0,
    uTeqLegacy: legacyHighlights ? 1 : 0,
    uToneOn: toneOn ? 1 : 0,
    uToneControls: [tone.shadows, tone.highlights, tone.blacks, tone.whites],
    uToneCurve: transform.curve,
    uToneBlack: transform.black,
    uToneWhite: transform.white,
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
    uExpBlack: legacyBlacks < 0 ? (-legacyBlacks / 100) * MAX_BLACK_LEVEL : 0,
    // Legacy uses the full sigmoid; adaptive lift acts only inside the encoded print toe.
    uSigS: packCurve(toneCurveFor(legacyWhites, printBlacks, recipe.toneCharacter)),
    uSigMag: whiteTargetFor(legacyWhites) / 100,
    uBlackToe: toeLift > 0 ? [BLACK_TOE_END, BLACK_TOE_SCALE] : [0, 1],
    uBlackToeCurve: toeLift > 0 ? packCurve(blackToeCurve(toeLift)) : NEUTRAL_CURVE,
    uWbMat: wbMat,
    uVigScale: Math.pow(2, -vignetteStrength(recipe.vignette)),
    uVigInner: (1 - VIGNETTE_FEATHER / 100) / Math.SQRT2,
    uSharp: sc.sharpness,
    uHal: recipe.halation / 100,
    uHalModel: recipe.halationVersion ?? 1,
    uGlowModel: recipe.glowVersion ?? 1,
    uHalStrength: halationStrength(recipe.halation, recipe.halationVersion),
    uGlowFraction: diffusionFraction(recipe.glow, (recipe.glowFilter ?? 'black-pro-mist')),
    // Not read by a shader: it keys the Glow field and the maps made after it.
    uGlowFilter: GLOW_FILTERS.indexOf((recipe.glowFilter ?? 'black-pro-mist')),
    uHalSize: recipe.halationSize,
    uGlowSize: recipe.glowSize,
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
    // A custom look's LUT at its share within the look, times the look's Amount.
    ...(lut ? {
      uLutOn: 1, uLutId: lut.id, uLutAmount: (recipe.lookAmount / 100) * (profile?.lut?.amount ?? 1),
      // A custom look blends its LUT as it was saved; a LUT chosen directly, as the photo says.
      uLutColor: (profile ? profile.lut?.blend === 'color' : recipe.lookBlend === 'color') ? 1 : 0,
    } : {}),
  };
}

const NO_MASKS: Uniforms = { uTeqTiles: 1, uMaskGlowCount: 0, uMaskGlowTex: MASK_GLOW_UNIT, uMaskGlowUpTo: MAX_MASKS, uMaskCount: 0, uMaskShapeCount: 0, uMaskShow: -1, uMaskStack: MASK_UNIT, uMaskTap: -1, uMaskObjectLayer: 0 };

/**
 * The masks' shapes and their adjustments. Temperature moves the photo's white by that many
 * mireds (positive warmer) and tint adds to its tint; the mask's CAT16 goes from the photo's
 * white to that one, which is the photo's own white balance with the moved white, inside the mask.
 */
export function maskUniforms(masks: Mask[], recipe: Recipe, ctx: Pick<RenderContext, 'white' | 'maskShow' | 'camera'>): Uniforms {
  const show = ctx.maskShow ?? -1;
  const { shapes, count, index } = packShapes(masks, show);
  if (!index.length) return NO_MASKS;
  const asShot = ctx.white ?? D65_XY;
  const photoWb = effectiveWb(recipe, ctx.camera);
  const chosen = photoWb ? whiteXy(photoWb.temperature, photoWb.tint) : asShot;
  let chosenTT: { temperature: number; tint: number } | null = null;
  const meta: number[] = [];
  const wb: number[] = [];
  const cb: number[] = [];
  const range: number[] = [];
  const rangeOn: number[] = [];
  const teq: number[] = [];
  const local: number[] = [];
  const glow: number[] = [];
  const filter = (recipe.glowFilter ?? 'black-pro-mist');
  let glowLayer = 0;
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
      chosenTT ??= photoWb ?? temperatureTint(chosen);
      const moved = clampWhiteBalance({ temperature: 1e6 / (1e6 / chosenTT.temperature - m.temperature), tint: chosenTT.tint + m.tint });
      wb.push(...columnMajor(whiteBalanceMatrix(chosen, whiteXy(moved.temperature, moved.tint))));
    } else wb.push(...IDENTITY);
    const teqOn = m.highlights !== 0;
    teq.push(...(teqOn ? bandFactors(bandGains(m.highlights)) : [0, 0, 0, 0, 0, 0, 0, 0]));
    local.push(teqOn ? 1 : 0, teqOn ? ++teqTile : 0, 0, 0);
    // [diffusion fraction, its field's layer, Glow size and filter (the field's key)]: the photo's filter.
    glow.push(...(m.glow > 0 ? [diffusionFraction(m.glow, filter), glowLayer++, m.glowSize, GLOW_FILTERS.indexOf(filter)] : [0, 0, 0, 0]));
    cb.push(...(cbOn ? cbUniform(cbCommit(sliderParams(colorBalanceParams(m.contrast, m.vibrance, m.saturation, legacyShadowValue(m.shadows, m.toneVersions))))) : CB_NONE));
  }
  return {
    uMaskCount: index.length, uMaskShapeCount: count, uMaskShapes: shapes, uMaskMeta: meta, uMaskWb: wb, uMaskCb: cb,
    uMaskTeq: teq, uMaskLocal: local, uTeqTiles: teqTile + 1,
    uMaskGlow: glow, uMaskGlowCount: glowLayer, uMaskGlowTex: MASK_GLOW_UNIT, uMaskGlowUpTo: MAX_MASKS,
    uMaskRange: range, uMaskRangeOn: rangeOn, uMaskToXyz: columnMajor(REC2020_TO_XYZ), uMaskStack: MASK_UNIT, uMaskTap: -1,
    uMaskShow: index.indexOf(show),
  };
}

/** Whether a recipe needs the highlight and sharpening passes at all. */
export function needsPasses(u: Uniforms) {
  return {
    highlights: u.uCompare !== 1 && ((u.uHal as number) > 0 || (u.uGlow as number) > 0 || (u.uMaskGlowCount as number) > 0),
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
