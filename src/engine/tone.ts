// Copyright (C) 2020-2026 darktable developers.
// Ported from darktable src/iop/sigmoid.c at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773
// (release 5.6.2). Translated from C to TypeScript; the per-channel log-logistic curve, plus an
// exact inverse of it and sRGB encoding of the output.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Reference implementation of the tone stage (stages/tone.glsl). The shader
// does the per-pixel work; this file supplies its constants and lets tests
// check the maths.
//
// darktable's sigmoid maps scene light to display light with a log-logistic
// curve, like film followed by a print: a toe, a straight section through
// middle grey and a highlight shoulder that never clips. Run backwards per
// channel, the same curve turns an ordinary (display-referred) photo into scene
// light, so a frame with no look applied comes back out unchanged.

import type { Vec3 } from '../film/stocks';
import { srgbEotf, srgbOetf } from './color';

export const TONE = {
  /** Scene-linear middle grey used across Emulsion. */
  grey: 0.18,
} as const;

/** darktable's MIDDLE_GREY: sigmoid maps this scene value to the same display value. */
export const SIGMOID_GREY = 0.1845;

export interface SigmoidSettings {
  /** Slope at middle grey; darktable's `middle_grey_contrast`. */
  contrast: number;
  /** -1 to 1; darktable's `contrast_skewness`. */
  skew: number;
  /** Display white the curve approaches, in percent; `display_white_target`. */
  whiteTarget: number;
  /** Display black at zero scene light, in percent; `display_black_target`. */
  blackTarget: number;
}

/**
 * Emulsion's neutral curve. darktable defaults to contrast 1.5 and skew 0; these
 * values were fitted to the curve Emulsion's stocks were tuned on (RMS error
 * 1.3% of display range from -7 to +3 EV), so the stocks keep their look while
 * highlights gain sigmoid's roll-off. darktable's default black target of
 * 0.0152% lifts black by under half an 8-bit level; 0 keeps the inverse exact
 * down to black, so photos round-trip.
 */
export const NEUTRAL: SigmoidSettings = { contrast: 1.15, skew: 0.11, whiteTarget: 100, blackTarget: 0 };

export interface SigmoidCurve {
  magnitude: number;
  paperExp: number;
  fog: number;
  filmPower: number;
  paperPower: number;
}

/** The generalised log-logistic sigmoid, in darktable's form that is stable around zero. */
export function sigmoid(x: number, c: SigmoidCurve): number {
  const film = Math.pow(c.fog + Math.max(x, 0), c.filmPower);
  const paper = c.magnitude * Math.pow(film / (c.paperExp + film), c.paperPower);
  return Number.isNaN(paper) ? c.magnitude : paper;
}

/** Exact inverse of `sigmoid` for display values in [0, magnitude). */
export function sigmoidInverse(y: number, c: SigmoidCurve): number {
  const r = Math.pow(Math.min(Math.max(y, 0) / c.magnitude, 1 - 1e-7), 1 / c.paperPower);
  const film = (c.paperExp * r) / (1 - r);
  return Math.max(Math.pow(film, 1 / c.filmPower) - c.fog, 0);
}

/** darktable's commit_params: curve constants for the given settings. */
export function sigmoidCurve(s: SigmoidSettings): SigmoidCurve {
  const MG = SIGMOID_GREY;
  const d = 1e-6;
  const slope = (c: SigmoidCurve) => (sigmoid(MG + d, c) - sigmoid(MG - d, c)) / 2 / d;

  // Reference slope: no skew, normalised display.
  const refPower = s.contrast;
  const ref: SigmoidCurve = { magnitude: 1, paperExp: Math.pow(MG, refPower) * (1 / MG - 1), fog: 0, filmPower: refPower, paperPower: 1 };

  // Add skew, then find the film power that restores the reference slope.
  const paperPower = Math.pow(5, -s.skew);
  const white = 0.01 * s.whiteTarget;
  const whiteGrey = Math.pow(white / MG, 1 / paperPower) - 1;
  const temp: SigmoidCurve = { magnitude: white, paperExp: MG * whiteGrey, fog: 0, filmPower: 1, paperPower };
  const filmPower = slope(ref) / slope(temp);

  const black = 0.01 * s.blackTarget;
  const whiteBlack = Math.pow(black / white, -1 / paperPower) - 1;
  const fog = (MG * Math.pow(whiteGrey, 1 / filmPower)) / (Math.pow(whiteBlack, 1 / filmPower) - Math.pow(whiteGrey, 1 / filmPower));
  const paperExp = Math.pow(fog + MG, filmPower) * whiteGrey;
  return { magnitude: white, paperExp, fog, filmPower, paperPower };
}

/** Contrast S-curve on [0, 1], pivoting on `p`. c > 1 adds contrast. Used by the scanner stage. */
export function sCurve(v: number, c: number, p: number): number {
  const x = Math.min(1, Math.max(0, v));
  return x < p ? p * Math.pow(x / p, c) : 1 - (1 - p) * Math.pow((1 - x) / (1 - p), c);
}

// ---------- Emulsion's tone stage ----------

/** Display white target for the Whites slider: ±100 is half a stop of display white. */
export const whiteTargetFor = (whites: number) => NEUTRAL.whiteTarget * Math.pow(2, (0.5 * whites) / 100);
/** Display black target for the Blacks slider: +100 lifts black to 2% of display white. */
export const blackTargetFor = (blacks: number) => NEUTRAL.blackTarget + (Math.max(blacks, 0) / 100) * 2;

/** The neutral curve with the Whites and Blacks sliders' display targets. */
export function toneCurveFor(whites: number, blacks: number): SigmoidCurve {
  return sigmoidCurve({ ...NEUTRAL, whiteTarget: whiteTargetFor(whites), blackTarget: blackTargetFor(blacks) });
}

const NEUTRAL_CURVE = sigmoidCurve(NEUTRAL);

/** Scene-linear value to display-encoded value through the neutral curve. */
export const toneForward = (x: number): number => srgbOetf(sigmoid(x, NEUTRAL_CURVE));

/** Display-encoded value to scene-linear value: the exact inverse of `toneForward`. */
export const toneInverse = (e: number): number => sigmoidInverse(srgbEotf(Math.min(Math.max(e, 0), 1)), NEUTRAL_CURVE);

/** The camera profile's print (stageToneProfile): the curve per channel under Whites and Blacks. */
export function toneProfileRgb(x: Vec3, whites: number, blacks: number): Vec3 {
  const curve = toneCurveFor(whites, blacks);
  return x.map((v) => srgbOetf(sigmoid(v, curve))) as Vec3;
}

/** Neutral per-channel render without hue preservation: the exact inverse of the input stage. */
export const toneNeutralRgb = (x: Vec3): Vec3 => x.map(toneForward) as Vec3;

/** Pack a curve as [paperExp, fog, filmPower, paperPower] for the shader. */
export const packCurve = (c: SigmoidCurve): [number, number, number, number] => [c.paperExp, c.fog, c.filmPower, c.paperPower];
