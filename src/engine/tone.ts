// Copyright (C) 2020-2026 darktable developers.
// Ported from darktable src/iop/sigmoid.c at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773
// (release 5.6.2). Translated from C to TypeScript; per-channel processing with full hue
// preservation and the module's primaries (inset, rotation, recover purity; primaries.ts) on
// Rec.2020 base primaries, plus an exact inverse of the per-channel curve and sRGB encoding of the
// output.
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
import { mulVec, srgbEotf, srgbOetf } from './color';
import { NO_PRIMARIES, adjustedPrimaries, type SigmoidPrimaries } from './primaries';

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

/** Pull negative channels up to zero by desaturating towards the pixel's average. */
export function desaturateNegative(p: Vec3): Vec3 {
  const avg = Math.max((p[0] + p[1] + p[2]) / 3, 0);
  const min = Math.min(p[0], p[1], p[2]);
  const k = min < 0 ? -avg / (min - avg) : 1;
  return p.map((v) => avg + k * (v - avg)) as Vec3;
}

/** Indices of the largest, middle and smallest channel, as darktable orders them. */
export function channelOrder(p: Vec3): { max: number; mid: number; min: number } {
  const [r, g, b] = p;
  if (r >= g) {
    if (g > b) return { max: 0, mid: 1, min: 2 };
    if (b > r) return { max: 2, mid: 0, min: 1 };
    if (b > g) return { max: 0, mid: 2, min: 1 };
    return { max: 0, mid: 1, min: 2 };
  }
  if (r >= b) return { max: 1, mid: 0, min: 2 };
  if (b > g) return { max: 2, mid: 1, min: 0 };
  return { max: 1, mid: 2, min: 0 };
}

/** darktable's _preserve_hue_and_energy: restore the input hue after a per-channel curve. */
export function preserveHue(input: Vec3, perChannel: Vec3, hue: number): Vec3 {
  const o = channelOrder(input);
  const chroma = input[o.max] - input[o.min];
  const midscale = chroma !== 0 ? (input[o.mid] - input[o.min]) / chroma : 0;
  const full = perChannel[o.min] + (perChannel[o.max] - perChannel[o.min]) * midscale;
  const naiveMid = (1 - hue) * perChannel[o.mid] + hue * full;
  const energy = perChannel[0] + perChannel[1] + perChannel[2];
  const naiveEnergy = perChannel[o.min] + naiveMid + perChannel[o.max];
  const minPlusMid = input[o.min] + input[o.mid];
  const blend = minPlusMid !== 0 ? (2 * input[o.min]) / minPlusMid : 0;
  const target = blend * energy + (1 - blend) * naiveEnergy;
  const out: Vec3 = [0, 0, 0];
  if (naiveMid <= perChannel[o.mid]) {
    const mid = ((1 - hue) * perChannel[o.mid] + hue * (midscale * perChannel[o.max] + (1 - midscale) * (target - perChannel[o.max]))) / (1 + hue * (1 - midscale));
    out[o.min] = target - perChannel[o.max] - mid;
    out[o.mid] = mid;
    out[o.max] = perChannel[o.max];
  } else {
    const mid = ((1 - hue) * perChannel[o.mid] + hue * (perChannel[o.min] * (1 - midscale) + midscale * (target - perChannel[o.min]))) / (1 + hue * midscale);
    out[o.min] = perChannel[o.min];
    out[o.mid] = mid;
    out[o.max] = target - perChannel[o.min] - mid;
  }
  return out;
}

/** Contrast S-curve on [0, 1], pivoting on `p`. c > 1 adds contrast. Used by the scanner stage. */
export function sCurve(v: number, c: number, p: number): number {
  const x = Math.min(1, Math.max(0, v));
  return x < p ? p * Math.pow(x / p, c) : 1 - (1 - p) * Math.pow((1 - x) / (1 - p), c);
}

// ---------- Emulsion's tone stage ----------

export interface ToneLook {
  /** Print contrast relative to neutral (stock contrast and push). */
  contrast: number;
  /** The stock's sigmoid primaries. */
  primaries: SigmoidPrimaries;
  /** Whites slider, -100 to 100. */
  whites: number;
  /** Blacks slider, -100 to 100; above zero lifts the display black. */
  blacks: number;
}

export const NEUTRAL_LOOK: ToneLook = { contrast: 1, primaries: NO_PRIMARIES, whites: 0, blacks: 0 };

/** Display white target for the Whites slider: ±100 is half a stop of display white. */
export const whiteTargetFor = (whites: number) => NEUTRAL.whiteTarget * Math.pow(2, (0.5 * whites) / 100);
/** Display black target for the Blacks slider: +100 lifts black to 2% of display white. */
export const blackTargetFor = (blacks: number) => NEUTRAL.blackTarget + (Math.max(blacks, 0) / 100) * 2;

/** Curve for one contrast multiplier under the look's whites and blacks. */
export function curveFor(contrast: number, look: ToneLook): SigmoidCurve {
  return sigmoidCurve({
    ...NEUTRAL,
    contrast: NEUTRAL.contrast * contrast,
    whiteTarget: whiteTargetFor(look.whites),
    blackTarget: blackTargetFor(look.blacks),
  });
}

const NEUTRAL_CURVE = sigmoidCurve(NEUTRAL);

/** Scene-linear value to display-encoded value through the neutral curve. */
export const toneForward = (x: number): number => srgbOetf(sigmoid(x, NEUTRAL_CURVE));

/** Display-encoded value to scene-linear value: the exact inverse of `toneForward`. */
export const toneInverse = (e: number): number => sigmoidInverse(srgbEotf(Math.min(Math.max(e, 0), 1)), NEUTRAL_CURVE);

/**
 * One scene-linear Rec.2020 pixel to display-encoded Rec.2020, as darktable's
 * process_loglogistic_per_channel: negatives desaturated away, into the look's
 * primaries, the curve per channel with full hue preservation, and back.
 */
export function toneRgb(x: Vec3, look: ToneLook): Vec3 {
  const curve = curveFor(look.contrast, look);
  const m = adjustedPrimaries(look.primaries);
  const rendering = mulVec(m.input, desaturateNegative(x));
  const per = rendering.map((v) => sigmoid(v, curve)) as Vec3;
  return mulVec(m.output, preserveHue(rendering, per, 1)).map((v) => srgbOetf(Math.max(v, 0))) as Vec3;
}

/** Neutral per-channel render without hue preservation: the exact inverse of the input stage. */
export const toneNeutralRgb = (x: Vec3): Vec3 => x.map(toneForward) as Vec3;

/** Pack a curve as [paperExp, fog, filmPower, paperPower] for the shader. */
export const packCurve = (c: SigmoidCurve): [number, number, number, number] => [c.paperExp, c.fog, c.filmPower, c.paperPower];


/** Sigmoid display targets on a LUT print (encoded Rec.2020), with neutral contrast and
 * hue preservation at zero. The neutral inverse makes this an identity at rest. */
export function lutToneTargets(e: Vec3, whites: number, blacks: number): Vec3 {
  if (whites === 0 && blacks <= 0) return e;
  const curve = curveFor(1, { ...NEUTRAL_LOOK, whites, blacks });
  return e.map(v => srgbOetf(sigmoid(toneInverse(v), curve))) as Vec3;
}
