// SPDX-License-Identifier: GPL-3.0-or-later
// Reference implementation of the tone stage (stages/tone.glsl). The shader
// does the per-pixel work; this file supplies its constants and lets tests
// check the maths.
//
// The curve works in stops relative to middle grey. The scene range
// [black, white] maps to [0, 1], an S-curve around middle grey sets contrast,
// and a power function places middle grey at 0.46 on the display.
//
// The same curve run backwards turns an ordinary (display-referred) photo into
// scene light, so a frame with no look applied comes back out unchanged.
//
// This is a placeholder for a port of darktable's sigmoid tone mapper, which
// handles highlights beyond the white point more gracefully.

export const TONE = {
  /** Scene-linear middle grey. */
  grey: 0.18,
  /** Darkest scene value, in stops below middle grey. */
  blackStops: -7.5,
  /** Brightest scene value before clipping, in stops above middle grey. */
  whiteStops: 3.5,
  /** Where middle grey lands on the display, sRGB-encoded. */
  greyDisplay: 0.46,
} as const;

export const tonePivot = () => -TONE.blackStops / (TONE.whiteStops - TONE.blackStops);
export const toneGamma = () => Math.log(TONE.greyDisplay) / Math.log(tonePivot());

/** [grey, blackStops, whiteStops, gamma] for the shader's uTone uniform. */
export const toneUniform = (): [number, number, number, number] => [TONE.grey, TONE.blackStops, TONE.whiteStops, toneGamma()];

/** Contrast S-curve on [0, 1], pivoting on `p`. c > 1 adds contrast. */
export function sCurve(v: number, c: number, p: number): number {
  const x = Math.min(1, Math.max(0, v));
  return x < p ? p * Math.pow(x / p, c) : 1 - (1 - p) * Math.pow((1 - x) / (1 - p), c);
}

/** Scene-linear value to display-encoded value. */
export function toneForward(x: number, contrast = 1): number {
  const t = Math.log2(Math.max(x, 1e-10) / TONE.grey);
  const u = Math.min(1, Math.max(0, (t - TONE.blackStops) / (TONE.whiteStops - TONE.blackStops)));
  return Math.pow(sCurve(u, contrast, tonePivot()), toneGamma());
}

/** Display-encoded value to scene-linear value (inverse of the neutral curve). */
export function toneInverse(e: number): number {
  const v = Math.pow(Math.min(1, Math.max(0, e)), 1 / toneGamma());
  return TONE.grey * Math.pow(2, v * (TONE.whiteStops - TONE.blackStops) + TONE.blackStops);
}
