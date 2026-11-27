// Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
// Ported from RawTherapee rtengine/curves.h (basel, baseu, cupper, clower, clower2,
// simplebasecurve), rtengine/curves.cc (CurveFactory::complexCurve's shCurve) and
// rtengine/improcfun.cc (shadowToneCurve) at commit 3458b9a1813f26b99c8dcf22aad7cc24deffdbae.
// Translated from C++ to TypeScript. The curve, its Shadow compression (fixed at upstream's
// default 50) and its application as one gain from 0.299/0.587/0.114 luminance are unchanged.
// Deviation agreed with Oli (2026-11-25): it runs on Emulsion's linear print (white at 1) after
// the neutral sigmoid, not before RawTherapee's own tone curve, since Emulsion's scene light has
// no white point. Slider mapping is ours, fitted to a measured neutral ramp (see blackParam).
// SPDX-License-Identifier: GPL-3.0-or-later
import type { Vec3 } from '../film/stocks';
import { srgbEotf, srgbOetf } from './color';

const SQR = (x: number) => x * x;

/** Convex function between (0,0) and (1,1); m1 and m2 control the slope at the ends. */
export function basel(x: number, m1: number, m2: number): number {
  if (x === 0) return 0;
  const k = Math.sqrt((m1 - 1) * (m1 - m2) * 0.5) / (1 - m2);
  const l = (m1 - m2) / (1 - m2) + k;
  const lx = Math.log(x);
  return m2 * x + (1 - m2) * (2 - Math.exp(k * lx)) * Math.exp(l * lx);
}

/** Concave function between (0,0) and (1,1). */
export const baseu = (x: number, m1: number, m2: number) => 1 - basel(1 - x, m1, m2);

/** Convex curve between (0,0) and (1,1) with slope m at (0,0); hr controls highlight recovery. */
export function cupper(x: number, m: number, hr: number): number {
  if (hr > 1) return baseu(x, m, 2 * (hr - 1) / m);
  const x1 = (1 - hr) / m;
  const x2 = x1 + hr;
  if (x >= x2) return 1;
  if (x < x1) return x * m;
  return 1 - hr + hr * baseu((x - x1) / hr, m, 0);
}

/** Concave curve between (0,0) and (1,1) with slope m at (1,1); sr controls shadow recovery. */
export const clower = (x: number, m: number, sr: number) => 1 - cupper(1 - x, m, sr);

/** Curve for b < 0: starts with positive slope, then rolls over toward the straight line to (1,1). */
export function clower2(x: number, m: number, sr: number): number {
  const x1 = sr / 1.5 + 0.00001;
  if (x > x1 || sr < 0.001) return 1 - (1 - x) * m;
  const y1 = 1 - (1 - x1) * m;
  return y1 + m * (x - x1) - (1 - m) * SQR(SQR(1 - x / x1));
}

/** RawTherapee's Exposure Black curve: b = Black / 65535 (positive darkens), sr = 0.015 × Shadow compression. */
export function simplebasecurve(x: number, b: number, sr: number): number {
  if (b === 0) return x;
  if (b < 0) {
    const m = 0.5;
    const slope = 1 + b;
    const y = -b + m * slope;
    if (x > m) return y + (x - m) * slope;
    return y * clower2(x / m, slope * m / y, 2 - sr);
  }
  const slope = 1 / (1 - b);
  const m = b + (1 - b) * 0.25;
  const y = (m - b) * slope;
  if (x <= m) return clower(x / m, slope * m / y, sr) * y;
  return y + (x - m) * slope;
}

/** RawTherapee's default Shadow compression (0–100), as 0.015 × it. */
export const BLACKS_SR = 0.015 * 50;
/** RawTherapee Black / 65535 at −100; deepening grows with |amount|^BLACKS_DEEPEN_POWER. */
export const BLACKS_DEEPEN = 0.122;
export const BLACKS_DEEPEN_POWER = 2.5;
/** −Black / 65535 per +100 (the slider's end), inside upstream's 0.25. */
export const BLACKS_OPEN = 0.103;

/**
 * Slider (−100…+100) to RawTherapee's Black / 65535. Ours: least-squares fit of the print to a
 * measured neutral ramp at −100, −50, +50 and +100 (RMS 1.2, 0.5, 0.2, 0.6 of 100 encoded).
 */
export function blackParam(amount: number): number {
  const a = amount / 100;
  return a === 0 ? 0 : a < 0 ? BLACKS_DEEPEN * Math.pow(Math.min(-a, 1), BLACKS_DEEPEN_POWER) : -BLACKS_OPEN * a;
}

const LUMA: Vec3 = [0.299, 0.587, 0.114];
/** shCurve's first entry: RawTherapee holds the gain below one 16-bit step. */
const MIN_Y = 1 / 65535;

/** shCurve: the gain for a pixel of linear luminance y (clipped above 1, where it is exactly 1). */
export function blacksGain(y: number, b: number, sr = BLACKS_SR): number {
  if (b === 0 || y >= 1) return 1;
  const v = Math.max(y, MIN_Y);
  return Math.max(simplebasecurve(v, b, sr), 0) / v;
}

/** The print with Blacks: encoded in and out, the gain applied to linear light (shadowToneCurve). */
export function blacksPrint(e: Vec3, amount: number): Vec3 {
  const b = blackParam(amount);
  if (b === 0) return e;
  const lin = e.map((v) => srgbEotf(Math.max(v, 0))) as Vec3;
  const g = blacksGain(LUMA[0] * lin[0] + LUMA[1] * lin[1] + LUMA[2] * lin[2], b);
  return lin.map((v) => srgbOetf(v * g)) as Vec3;
}
