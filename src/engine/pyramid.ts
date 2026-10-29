// SPDX-License-Identifier: GPL-3.0-or-later
// Blur geometry for halation and glow.
//
// Highlights are extracted at quarter resolution, then halved repeatedly.
// Halation is blurred on the first level at most HALATION_WIDTH wide and glow
// on the first at most GLOW_WIDTH wide. Blurring small, fixed-size levels with
// tightly spaced taps keeps the result smooth (no lattice from spread-out
// taps), cheap, and the same relative size at preview and at full-size export.

/** Halo spread as a fraction of frame width (Gaussian sigma). */
export const HALATION_SIGMA = 0.012;
export const GLOW_SIGMA = 0.022;

const HALATION_WIDTH = 256;
const GLOW_WIDTH = 128;

/** Sigma, in texels, of one horizontal+vertical blur pass at spread 1. */
const KERNEL_SIGMA = 1.41;
const MAX_ITERATIONS = 24;

export interface Pyramid {
  sizes: [number, number][];
  halation: number;
  glow: number;
}

const halve = (v: number) => Math.max(1, Math.round(v / 2));

export function pyramidFor(w: number, h: number): Pyramid {
  const sizes: [number, number][] = [[Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4))]];
  let halation = -1;
  for (;;) {
    const i = sizes.length - 1;
    const [lw, lh] = sizes[i];
    if (halation < 0 && lw <= HALATION_WIDTH) halation = i;
    if (halation >= 0 && i > halation && lw <= GLOW_WIDTH) return { sizes, halation, glow: i };
    sizes.push([halve(lw), halve(lh)]);
  }
}

/** Iterations and tap spread that reach `sigmaFraction` of the frame width on a level `levelWidth` wide. */
export function blurPlan(levelWidth: number, sigmaFraction: number) {
  const sigma = sigmaFraction * levelWidth;
  const iterations = Math.min(MAX_ITERATIONS, Math.max(1, Math.ceil((sigma / KERNEL_SIGMA) ** 2)));
  const spread = sigma / (KERNEL_SIGMA * Math.sqrt(iterations));
  return { iterations, spread };
}
