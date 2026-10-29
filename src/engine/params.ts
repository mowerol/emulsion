// SPDX-License-Identifier: GPL-3.0-or-later
// Recipe to shader uniforms. Pure, so it can be tested without a GPU.

import { STOCK } from '../film/stocks';
import { SCANNER } from '../film/scanners';
import type { Recipe } from '../film/recipe';
import { LUMA_REC2020, REC2020_TO_SRGB, SRGB_TO_REC2020, columnMajor } from './color';
import { toneUniform } from './tone';

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
}

const WORKING = columnMajor(SRGB_TO_REC2020);
const DISPLAY = columnMajor(REC2020_TO_SRGB);

/** What the develop shader needs, shared with the extraction pass. */
export function developUniforms(recipe: Recipe | null, ctx: RenderContext): Uniforms {
  const base: Uniforms = {
    uInputMode: ctx.inputMode,
    uToWorking: WORKING,
    uToDisplay: DISPLAY,
    uTone: toneUniform(),
    uOut: [ctx.width, ctx.height],
    uStore: ctx.store,
    uSeed: ctx.seed,
    uHalThreshold: HALATION_THRESHOLD,
  };
  if (!recipe || ctx.compare) {
    return { ...base, uCompare: 1, uToneC: [1, 1, 1], uExposure: 0, uWB: [1, 1, 1], uBW: 0 };
  }

  const s = STOCK[recipe.stock];
  const sc = SCANNER[recipe.scanner];
  const push = recipe.push;

  const w = recipe.warmth / 100;
  const t = recipe.tint / 100;
  const gains = [s.balance[0] * (1 + 0.22 * w), s.balance[1] * (1 - 0.1 * t), s.balance[2] * (1 - 0.22 * w)];
  const lum = gains[0] * LUMA_REC2020[0] + gains[1] * LUMA_REC2020[1] + gains[2] * LUMA_REC2020[2];

  const contrast = s.contrast * (1 + (recipe.contrast / 100) * 0.6) * (1 + 0.09 * push);
  const grainMul = push > 0 ? 1 + 0.45 * push : 1 + 0.3 * push;

  return {
    ...base,
    uCompare: 0,
    uExposure: recipe.exposure,
    uWB: gains.map((g) => g / lum),
    uVig: recipe.vignette / 100,
    uSharp: sc.sharpness,
    uHal: recipe.halation / 100,
    uHalCol: s.halationColor,
    uGlow: recipe.glow / 100,
    uMat: columnMajor(s.matrix),
    uBW: s.bw ? 1 : 0,
    uBWw: s.bwWeights ?? LUMA_REC2020,
    uToneC: s.crossover.map((d) => Math.max(0.2, contrast * (1 + d))),
    uSat: Math.max(0, s.saturation * (1 + recipe.saturation / 100) * (1 + 0.04 * push)),
    uStockFade: s.fade,
    uGrain: (recipe.grain / 100) * grainMul,
    uGrainSize: (recipe.grainSize / 100) * (push > 0 ? 1 + 0.12 * push : 1),
    uChroma: s.bw ? 0 : s.grainChroma,
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
  };
}
